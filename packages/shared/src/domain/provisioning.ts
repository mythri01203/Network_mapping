import type { SplitterRatio } from '../model/enums';
import type { Cable, Customer, Equipment, Splitter } from '../model/types';
import { type CommandContext, type CommandResult, fail, type NetworkData, notice, sameId, succeed } from './command';
import { buildCores } from './defaults';
import { polylineLengthMeters } from './geo';
import { nextSequentialId, uniqueId } from './ids';
import { setPortUsage } from './ports';
import { isoDate } from './time';
import { estimateRxForSplitter, findUpstreamChain, RX_WARNING_DBM } from './trace';

export type CustomerDraft = Partial<Customer>;

/** Equipment a subscriber's drop cable can terminate on. */
export const isCustomerTerminal = (type: string) =>
  type === 'FAT' || type.includes('Terminal Box') || type === 'Distribution Point';

const SPLITTER_INSERTION_LOSS_DB: Record<SplitterRatio, number> = {
  '1:2': 3.5,
  '1:4': 7.2,
  '1:8': 10.5,
  '1:16': 14,
  '1:32': 17.5,
  '1:64': 21,
};

export interface SplitterDraft {
  id?: string;
  name?: string;
  terminalBoxId: string;
  ratio: SplitterRatio;
}

/** Installs a splitter in a terminal box so that subscribers can be provisioned on its output ports. */
export function createSplitter(data: NetworkData, draft: SplitterDraft): CommandResult<Splitter> {
  const terminal = data.equipment.find((e) => e.id === draft.terminalBoxId);
  if (!terminal) return fail('Terminal Not Found', `Terminal box ${draft.terminalBoxId} does not exist.`);

  const id =
    draft.id?.trim() ||
    nextSequentialId(
      'SPL-',
      data.splitters.map((s) => s.id),
      2,
    );
  if (data.splitters.some((s) => sameId(s.id, id))) {
    return fail('Duplicate Splitter ID', `Splitter ${id} already exists.`);
  }

  const outputCount = Number(draft.ratio.split(':')[1]);
  const feedCable = findUpstreamChain(terminal.id, data).at(-1)?.cable;
  const created: Splitter = {
    id,
    name: draft.name?.trim() || `${draft.ratio} PLC Splitter (${terminal.id})`,
    terminalBoxId: terminal.id,
    ratio: draft.ratio,
    insertionLossDb: SPLITTER_INSERTION_LOSS_DB[draft.ratio],
    status: 'Active',
    inputPort: { id: `${id}-IN`, connectedCableId: feedCable?.id },
    outputPorts: Array.from({ length: outputCount }, (_, i) => ({
      portNumber: i + 1,
      label: `OUT-${String(i + 1).padStart(2, '0')}`,
      status: 'Available' as const,
    })),
  };

  return succeed(
    created,
    { splitters: [...data.splitters, created] },
    {
      notice: notice('success', 'Splitter Installed', `Added ${created.ratio} splitter ${id} to ${terminal.id}.`),
      audit: [
        {
          action: 'SPLITTER_CREATED',
          details: `Installed ${created.ratio} splitter ${id} in ${terminal.id}`,
          assetId: terminal.id,
          assetType: 'Equipment',
        },
      ],
    },
  );
}

/** Returns `preferred` when it is free, else the first unused address in the 100.64.0.0/10 CGNAT pool. */
export function allocateIpAddress(customers: Customer[], preferred?: string): string {
  const used = new Set(customers.map((c) => c.ipAddress));
  const wanted = preferred?.trim();
  if (wanted && !used.has(wanted)) return wanted;
  for (let n = customers.length + 2; n < 65000; n++) {
    const candidate = `100.64.${Math.floor(n / 250)}.${(n % 250) + 2}`;
    if (!used.has(candidate)) return candidate;
  }
  return wanted ?? '';
}

/**
 * Activates a subscriber on a splitter output port: creates the customer and a 2-core drop cable,
 * occupies the splitter and FAT ports, increments the serving PON and resolves the logical path
 * (OLT, PON, feeder/distribution cables, estimated Rx) from the physical topology.
 */
export function provisionCustomer(
  data: NetworkData,
  draft: CustomerDraft,
  ctx: CommandContext = {},
): CommandResult<{ customer: Customer; dropCable: Cable }> {
  if (!draft.terminalBoxId || !draft.splitterId || !draft.splitterOutputPort) {
    return fail('Missing Connection Target', 'Please specify Terminal Box, Splitter, and Output Port.');
  }
  const fat = data.equipment.find((e) => e.id === draft.terminalBoxId);
  if (!fat) return fail('Terminal Not Found', `Access terminal ${draft.terminalBoxId} does not exist.`);

  const splitter = data.splitters.find((s) => s.id === draft.splitterId);
  if (!splitter) return fail('Splitter Not Found', `Splitter ${draft.splitterId} does not exist.`);
  if (splitter.terminalBoxId !== fat.id) {
    return fail(
      'Splitter Mismatch',
      `Splitter ${splitter.id} is installed in ${splitter.terminalBoxId}, not ${fat.id}.`,
    );
  }
  if (splitter.status === 'Faulty') {
    return fail(
      'Splitter Faulty',
      `Splitter ${splitter.id} is marked Faulty. Repair it before provisioning new subscribers.`,
    );
  }

  const port = splitter.outputPorts.find((p) => p.portNumber === draft.splitterOutputPort);
  if (!port) return fail('Invalid Port', `Splitter port ${draft.splitterOutputPort} does not exist.`);
  if (port.status === 'Occupied') {
    return fail(
      'Port Already Occupied',
      `Splitter Output Port ${port.portNumber} is already assigned to ${port.connectedCustomerName || port.connectedCustomerId}. Cannot double-book physical port.`,
    );
  }
  if (port.status === 'Faulty') {
    return fail('Port Faulty', `Splitter Output Port ${port.portNumber} is marked Faulty. Choose another port.`);
  }

  const ontSerial = draft.ontSerialNumber?.trim() || `ONT-${uniqueId('SN').slice(-8)}`;
  const duplicateOnt = data.customers.find((c) => sameId(c.ontSerialNumber, ontSerial));
  if (duplicateOnt) {
    return fail(
      'Duplicate ONT Serial',
      `ONT ${ontSerial} is already registered to ${duplicateOnt.name} (${duplicateOnt.id}).`,
    );
  }

  const id =
    draft.id?.trim() ||
    nextSequentialId(
      'CUST-',
      data.customers.map((c) => c.id),
      3,
    );
  if (data.customers.some((c) => sameId(c.id, id))) {
    return fail('Duplicate Customer ID', `Customer ${id} already exists.`);
  }

  const name = draft.name?.trim() || 'New Subscriber';
  // Subscriber location: as entered, otherwise a short drop away from the FAT.
  const hasLocation = Number.isFinite(draft.lat) && Number.isFinite(draft.lng);
  const lat = hasLocation ? draft.lat! : fat.lat + 0.00025 * Math.sin(port.portNumber);
  const lng = hasLocation ? draft.lng! : fat.lng + 0.00025 * Math.cos(port.portNumber);

  const dropRoute: [number, number][] = [
    [fat.lat, fat.lng],
    [lat, lng],
  ];
  const dropLength = Math.max(1, Math.round(polylineLengthMeters(dropRoute)));
  const dropId = nextSequentialId(
    'DROP-',
    data.cables.map((c) => c.id),
    3,
  );
  const dropCable: Cable = {
    id: dropId,
    name: `Drop ${fat.id} → ${id}`,
    type: 'Drop Fiber',
    fiberCount: 2,
    lengthMeters: dropLength,
    installationType: 'Aerial',
    owner: 'Metropolitan Fiber Corp',
    installationDate: isoDate(ctx.now),
    status: 'Active',
    remarks: `Auto-created during provisioning of ${id}`,
    coordinates: dropRoute,
    startEquipmentId: fat.id,
    cores: buildCores(2).map((core) =>
      core.coreNumber === 1
        ? {
            ...core,
            status: 'In Use' as const,
            customerId: id,
            customerName: name,
            connectedToEquipmentId: fat.id,
            connectedPort: `${splitter.id}/OUT-${port.portNumber}`,
            remarks: `Drop to ${id}`,
          }
        : core,
    ),
    cableCategory: 'Fiber',
  };

  const estimate = estimateRxForSplitter(fat, splitter, data, dropLength);
  const feederHop = estimate.hops[0];
  const distributionHop = estimate.hops.length > 1 ? estimate.hops[estimate.hops.length - 1] : undefined;

  const customer: Customer = {
    id,
    name,
    mobile: draft.mobile || '',
    address: draft.address || fat.street || '',
    area: draft.area || fat.area,
    building: draft.building,
    flatNumber: draft.flatNumber,
    lat,
    lng,
    serviceType: draft.serviceType || 'Fiber Broadband',
    plan: draft.plan || 'FTTH Ultra 300 Mbps',
    status: draft.status || 'Active',
    installationDate: isoDate(ctx.now),
    oltId: draft.oltId || estimate.olt?.id || '',
    ponPort: draft.ponPort || estimate.pon?.id || '',
    feederCableId: draft.feederCableId || feederHop?.cable.id || '',
    distributionCableId: draft.distributionCableId || distributionHop?.cable.id || feederHop?.cable.id || '',
    terminalBoxId: fat.id,
    splitterId: splitter.id,
    splitterOutputPort: port.portNumber,
    dropCableId: dropId,
    fiberCore: draft.fiberCore || splitter.inputPort.connectedCore || 1,
    ontSerialNumber: ontSerial,
    routerModel: draft.routerModel || 'Dual-Band Wi-Fi 6 ONT',
    ipAddress: allocateIpAddress(data.customers, draft.ipAddress),
    rxOpticalPowerDbm: draft.rxOpticalPowerDbm ?? estimate.rxDbm ?? 0,
  };

  const servingPon = estimate.olt && estimate.pon ? { oltId: estimate.olt.id, ponId: estimate.pon.id } : undefined;
  const equipment = data.equipment.map((e): Equipment => {
    if (e.id === fat.id) return setPortUsage(e, port.portNumber, true, id, isoDate(ctx.now));
    if (servingPon && e.id === servingPon.oltId) {
      return {
        ...e,
        ponPorts: e.ponPorts?.map((p) =>
          p.id === servingPon.ponId
            ? { ...p, status: 'Active' as const, connectedCustomersCount: p.connectedCustomersCount + 1 }
            : p,
        ),
      };
    }
    return e;
  });
  const splitters = data.splitters.map((s) =>
    s.id !== splitter.id
      ? s
      : {
          ...s,
          outputPorts: s.outputPorts.map((p) =>
            p.portNumber !== port.portNumber
              ? p
              : {
                  ...p,
                  status: 'Occupied' as const,
                  connectedCustomerId: id,
                  connectedCustomerName: name,
                  connectedDropCableId: dropId,
                },
          ),
        },
  );

  const warnings: string[] = [];
  if (!estimate.olt) warnings.push('no upstream OLT could be traced');
  if (estimate.rxDbm !== undefined && estimate.rxDbm < RX_WARNING_DBM) {
    warnings.push(`estimated Rx ${estimate.rxDbm} dBm is weak`);
  }
  const rxNote = estimate.rxDbm !== undefined ? ` (est. Rx ${estimate.rxDbm} dBm)` : '';
  const warningNote = warnings.length ? ` — check: ${warnings.join('; ')}` : '';

  return succeed(
    { customer, dropCable },
    {
      cables: [...data.cables, dropCable],
      splitters,
      equipment,
      customers: [...data.customers, customer],
    },
    {
      notice: notice(
        warnings.length ? 'warning' : 'success',
        'Customer Connected',
        `Activated ${name} on ${fat.id} port ${port.portNumber} via ${dropId}${rxNote}${warningNote}`,
      ),
      audit: [
        {
          action: 'CUSTOMER_CONNECTED',
          details: `Provisioned ${id} on ${splitter.id} port ${port.portNumber} (${fat.id}) with drop ${dropId}`,
          assetId: id,
          assetType: 'Customer',
        },
      ],
    },
  );
}
