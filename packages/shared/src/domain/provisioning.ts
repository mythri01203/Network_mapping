import type { SplitterRatio } from '../model/enums';
import type { Cable, Customer, Equipment, Splitter } from '../model/types';
import { type CommandContext, type CommandResult, fail, type NetworkData, notice, sameId, succeed } from './command';
import { buildCores, hasRecordedLocation, isValidCoordinate } from './defaults';
import { polylineLengthMeters } from './geo';
import { nextSequentialId } from './ids';
import { DEFAULT_OPTICAL_SETTINGS } from './opticalSettings';
import { setPortUsage } from './ports';
import { isoDate } from './time';
import { estimateRxForSplitter, findUpstreamChain } from './trace';

export type CustomerDraft = Partial<Customer>;

/** Equipment a subscriber's drop cable can terminate on. */
export const isCustomerTerminal = (type: string) =>
  type === 'FAT' || type.includes('Terminal Box') || type === 'Distribution Point';

export interface SplitterDraft {
  id?: string;
  name?: string;
  terminalBoxId: string;
  ratio: SplitterRatio;
}

/** Installs a splitter in a terminal box so that subscribers can be provisioned on its output ports. */
export function createSplitter(
  data: NetworkData,
  draft: SplitterDraft,
  ctx: CommandContext = {},
): CommandResult<Splitter> {
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
    insertionLossDb: (ctx.optical ?? DEFAULT_OPTICAL_SETTINGS).splitterDb[draft.ratio],
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

/** A given reading keeps its stated origin. An estimate is stored as calculated. No estimate stores nothing. */
const readingFor = (
  draft: CustomerDraft,
  estimate: { rxDbm?: number; launchDbm?: number },
): Pick<Customer, 'rxOpticalPowerDbm' | 'rxSource' | 'rxMeasuredAt' | 'rxLaunchDbm'> => {
  if (draft.rxOpticalPowerDbm !== undefined) {
    return {
      rxOpticalPowerDbm: draft.rxOpticalPowerDbm,
      ...(draft.rxSource ? { rxSource: draft.rxSource } : {}),
      ...(draft.rxMeasuredAt ? { rxMeasuredAt: draft.rxMeasuredAt } : {}),
    };
  }
  if (estimate.rxDbm === undefined) return {};
  return {
    rxOpticalPowerDbm: estimate.rxDbm,
    rxSource: 'calculated',
    ...(estimate.launchDbm !== undefined ? { rxLaunchDbm: estimate.launchDbm } : {}),
  };
};

/**
 * Activates a subscriber on a splitter output port: creates the customer and a 2-core drop cable,
 * occupies the splitter and FAT ports, increments the serving PON and resolves the logical path
 * (OLT, PON, feeder/distribution cables, estimated Rx) from the physical topology. Facts nobody gave
 * stay blank: no generated serial or IP, and no made-up house position. A blank position leaves the
 * drop cable with no route or length until `setCustomerLocation` records one.
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

  const ontSerial = draft.ontSerialNumber?.trim() || '';
  const duplicateOnt = ontSerial ? data.customers.find((c) => sameId(c.ontSerialNumber, ontSerial)) : undefined;
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
  // Subscriber location: as entered, or recorded as unknown (0, 0). Never an offset from the box.
  const draftPoint = { lat: draft.lat ?? Number.NaN, lng: draft.lng ?? Number.NaN };
  const hasLocation = isValidCoordinate(draftPoint.lat, draftPoint.lng) && hasRecordedLocation(draftPoint);
  const lat = hasLocation ? draftPoint.lat : 0;
  const lng = hasLocation ? draftPoint.lng : 0;

  const dropRoute: [number, number][] = hasLocation
    ? [
        [fat.lat, fat.lng],
        [lat, lng],
      ]
    : [];
  const dropLength = hasLocation ? Math.max(1, Math.round(polylineLengthMeters(dropRoute))) : 0;
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
    owner: '',
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

  const optical = ctx.optical ?? DEFAULT_OPTICAL_SETTINGS;
  const estimate = estimateRxForSplitter(fat, splitter, data, dropLength, optical);
  const feederHop = estimate.hops[0];
  const distributionHop = estimate.hops.length > 1 ? estimate.hops[estimate.hops.length - 1] : undefined;

  const customer: Customer = {
    id,
    name,
    mobile: draft.mobile || '',
    address: draft.address || '',
    area: draft.area || fat.area,
    building: draft.building,
    flatNumber: draft.flatNumber,
    lat,
    lng,
    ...(hasLocation && draft.locationMethod ? { locationMethod: draft.locationMethod } : {}),
    ...(hasLocation && draft.locationAccuracyMeters !== undefined
      ? { locationAccuracyMeters: draft.locationAccuracyMeters }
      : {}),
    serviceType: draft.serviceType || 'Fiber Broadband',
    plan: draft.plan || '',
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
    // The drop's core 1 is the one marked In Use above.
    fiberCore: draft.fiberCore || 1,
    ontSerialNumber: ontSerial,
    routerModel: draft.routerModel || '',
    ipAddress: draft.ipAddress?.trim() || '',
    ...readingFor(draft, estimate),
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
  if (!estimate.olt) warnings.push('not linked to any OLT, so this customer cannot be traced');
  if (!hasLocation) warnings.push('the house location is not recorded, so the drop has no length');
  if (estimate.rxDbm !== undefined && estimate.rxDbm < optical.rx.goodFloorDbm) {
    warnings.push(`estimated Rx ${estimate.rxDbm} dBm is weak`);
  }
  const rxNote = estimate.rxDbm !== undefined ? ` (estimated Rx ${estimate.rxDbm} dBm)` : '';
  const warningNote = warnings.length ? `. Check: ${warnings.join('; ')}` : '';

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
        estimate.olt ? 'Customer Connected' : 'Customer Saved, Not Linked',
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

export interface CustomerLocation {
  lat: number;
  lng: number;
  method: NonNullable<Customer['locationMethod']>;
  accuracyMeters?: number;
}

/** Records a customer's real position and redraws their drop from the box to it, as one undoable step. */
export function setCustomerLocation(
  data: NetworkData,
  customerId: string,
  location: CustomerLocation,
): CommandResult<Customer> {
  const customer = data.customers.find((c) => c.id === customerId);
  if (!customer) return fail('Customer Missing', `Customer ${customerId} was not found.`);
  const { lat, lng, method, accuracyMeters } = location;
  if (!isValidCoordinate(lat, lng) || !hasRecordedLocation({ lat, lng })) {
    return fail('Invalid Location', 'Choose a real position for this customer.');
  }

  const updated: Customer = { ...customer, lat, lng, locationMethod: method, locationAccuracyMeters: accuracyMeters };
  const fat = data.equipment.find((e) => e.id === customer.terminalBoxId);
  const drop = data.cables.find((c) => c.id === customer.dropCableId);
  const cables =
    fat && drop
      ? data.cables.map((c) => {
          if (c.id !== drop.id) return c;
          const coordinates: [number, number][] = [
            [fat.lat, fat.lng],
            [lat, lng],
          ];
          return { ...c, coordinates, lengthMeters: Math.max(1, Math.round(polylineLengthMeters(coordinates))) };
        })
      : undefined;

  return succeed(
    updated,
    { customers: data.customers.map((c) => (c.id === customerId ? updated : c)), ...(cables ? { cables } : {}) },
    {
      notice: notice('success', 'Location Saved', `Saved where ${customer.name} is.`),
      audit: [
        {
          action: 'CUSTOMER_LOCATION_SET',
          details: `${customer.id} placed at [${lat.toFixed(5)}, ${lng.toFixed(5)}] by ${method}${accuracyMeters !== undefined ? ` (within ${Math.round(accuracyMeters)} m)` : ''}`,
          assetId: customer.id,
          assetType: 'Customer',
        },
      ],
    },
  );
}

/**
 * Links a customer to the path that now reaches their terminal box, for a customer added before the
 * cable existed. Runs only when a person asks. Reports why when the box still reaches no OLT.
 */
export function relinkCustomer(
  data: NetworkData,
  customerId: string,
  ctx: CommandContext = {},
): CommandResult<Customer> {
  const customer = data.customers.find((c) => c.id === customerId);
  if (!customer) return fail('Customer Missing', `Customer ${customerId} was not found.`);
  const fat = data.equipment.find((e) => e.id === customer.terminalBoxId);
  const splitter = data.splitters.find((s) => s.id === customer.splitterId);
  if (!fat || !splitter) {
    return fail('Cannot Link Yet', `${customer.name} has no terminal box and splitter on record. Connect them first.`, 'warning');
  }

  const drop = data.cables.find((c) => c.id === customer.dropCableId);
  const optical = ctx.optical ?? DEFAULT_OPTICAL_SETTINGS;
  const estimate = estimateRxForSplitter(fat, splitter, data, drop?.lengthMeters ?? 0, optical);
  if (!estimate.olt) {
    return fail('Cannot Link Yet', `No cable connects ${fat.name} to an OLT. Draw that cable first, ending on the box.`, 'warning');
  }

  const feederHop = estimate.hops[0];
  const distributionHop = estimate.hops.length > 1 ? estimate.hops[estimate.hops.length - 1] : undefined;
  const servesAlready = customer.oltId === estimate.olt.id && customer.ponPort === estimate.pon?.id;
  // A real reading stays. An unrecorded value or an older estimate gets the new estimate, if any.
  const keepsReading = customer.rxSource === 'field_measured' || customer.rxSource === 'device_reported';
  const reading: Partial<Customer> = keepsReading
    ? {}
    : { rxOpticalPowerDbm: undefined, rxSource: undefined, rxLaunchDbm: undefined, ...readingFor({}, estimate) };
  const updated: Customer = {
    ...customer,
    ...reading,
    oltId: estimate.olt.id,
    ponPort: estimate.pon?.id ?? '',
    feederCableId: feederHop?.cable.id ?? '',
    distributionCableId: distributionHop?.cable.id ?? feederHop?.cable.id ?? '',
  };

  const servingPonId = estimate.pon?.id;
  const equipment =
    !servesAlready && servingPonId
      ? data.equipment.map((e) =>
          e.id !== estimate.olt!.id
            ? e
            : {
                ...e,
                ponPorts: e.ponPorts?.map((p) =>
                  p.id === servingPonId
                    ? { ...p, status: 'Active' as const, connectedCustomersCount: p.connectedCustomersCount + 1 }
                    : p,
                ),
              },
        )
      : undefined;
  const splitters = splitter.inputPort.connectedCableId
    ? undefined
    : data.splitters.map((s) =>
        s.id === splitter.id
          ? { ...s, inputPort: { ...s.inputPort, connectedCableId: estimate.hops.at(-1)?.cable.id } }
          : s,
      );

  return succeed(
    updated,
    {
      customers: data.customers.map((c) => (c.id === customerId ? updated : c)),
      ...(equipment ? { equipment } : {}),
      ...(splitters ? { splitters } : {}),
    },
    {
      notice: notice(
        estimate.pon ? 'success' : 'warning',
        'Customer Linked',
        estimate.pon
          ? `${customer.name} now traces to ${estimate.olt.name} port ${estimate.pon.id}.`
          : `${customer.name} now traces to ${estimate.olt.name}, but no PON port is linked to the cable. Choose a port on the cable.`,
      ),
      audit: [
        {
          action: 'CUSTOMER_RELINKED',
          details: `${customer.id} linked to ${estimate.olt.id}${estimate.pon ? ` ${estimate.pon.id}` : ''} via ${estimate.hops.map((h) => h.cable.id).join(', ')}`,
          assetId: customer.id,
          assetType: 'Customer',
        },
      ],
    },
  );
}
