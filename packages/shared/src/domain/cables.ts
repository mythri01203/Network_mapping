import type { CableType } from '../model/enums';
import type { Cable, Equipment } from '../model/types';
import {
  type CommandContext,
  type CommandResult,
  fail,
  type NetworkData,
  notice,
  previewIds,
  sameId,
  succeed,
} from './command';
import { buildCores, defaultFiberCount, isLatLngPair } from './defaults';
import { polylineLengthMeters } from './geo';
import { cableIdPrefix, nextSequentialId } from './ids';
import { buildOltPonPorts } from './oltConfig';
import { isoDate } from './time';

export type CableDraft = Partial<Cable> & { name: string; type: CableType; coordinates: [number, number][] };

const coreLabel = (coreNumber: number) => coreNumber.toString().padStart(2, '0');

/** Cores for a new cable. Reserved and damaged cores come from the top, so core 1 upward stay free. */
export function buildCoresWithCapacity(count: number, reserved = 0, damaged = 0) {
  return buildCores(count).map((core) => {
    if (core.coreNumber > count - reserved) {
      return { ...core, status: 'Reserved' as const, remarks: 'Reserved at installation' };
    }
    if (core.coreNumber > count - reserved - damaged) {
      return { ...core, status: 'Damaged' as const, remarks: 'Damaged at installation' };
    }
    return core;
  });
}

export function createCable(data: NetworkData, draft: CableDraft, ctx: CommandContext = {}): CommandResult<Cable> {
  const id =
    draft.id?.trim() ||
    nextSequentialId(
      cableIdPrefix(draft.type),
      data.cables.map((c) => c.id),
      draft.type === 'Drop Fiber' ? 3 : 2,
    );
  if (data.cables.some((c) => sameId(c.id, id))) {
    return fail('Duplicate Cable ID', `Cable with ID "${id}" already exists.`);
  }
  if (!draft.coordinates || draft.coordinates.length < 2 || !draft.coordinates.every(isLatLngPair)) {
    return fail('Invalid Route', 'Cable must have at least 2 valid geographic route points.');
  }
  for (const endpoint of [draft.startEquipmentId, draft.endEquipmentId]) {
    if (endpoint && !data.equipment.some((e) => e.id === endpoint)) {
      return fail('Invalid Endpoint', `Endpoint equipment ${endpoint} does not exist.`);
    }
  }

  // A cable leaving an OLT port is that port's feeder, which is how a trace finds the serving PON.
  const startOlt = data.equipment.find((e) => e.id === draft.startEquipmentId && e.type === 'OLT');
  const ponPorts = startOlt && draft.startPortName ? buildOltPonPorts(startOlt) : undefined;
  const pon = ponPorts?.find((p) => p.id === draft.startPortName);
  if (pon?.connectedFeederCableId) {
    return fail('PON Port In Use', `${pon.id} on ${startOlt!.id} already feeds cable ${pon.connectedFeederCableId}.`);
  }

  const isCoax = draft.type === 'Coaxial Cable';
  const fiberCount = draft.cores?.length || draft.fiberCount || defaultFiberCount(draft.type);
  const measuredLength = Math.round(polylineLengthMeters(draft.coordinates));
  const created: Cable = {
    ...draft,
    id,
    fiberCount,
    lengthMeters: draft.lengthMeters && draft.lengthMeters > 0 ? draft.lengthMeters : measuredLength,
    installationType:
      draft.installationType ||
      (draft.type === 'Underground Fiber' ? 'Underground' : draft.type === 'Aerial Fiber' ? 'Aerial' : undefined),
    owner: draft.owner || '',
    installationDate: draft.installationDate || isoDate(ctx.now),
    status: draft.status || 'Active',
    remarks: draft.remarks || 'Drawn via interactive GIS route wizard',
    cores: draft.cores || buildCores(fiberCount),
    cableCategory: isCoax ? 'Coaxial' : 'Fiber',
  };

  const endpoints =
    created.startEquipmentId || created.endEquipmentId
      ? ` ${created.startEquipmentId ?? '?'} → ${created.endEquipmentId ?? '?'}`
      : '';
  const equipment: Equipment[] | undefined =
    startOlt && ponPorts && pon
      ? data.equipment.map((e) =>
          e.id !== startOlt.id
            ? e
            : {
                ...e,
                ponPorts: ponPorts.map((p) => (p.id === pon.id ? { ...p, connectedFeederCableId: id } : p)),
                logicalPorts: e.logicalPorts?.map((p) =>
                  p.portNumber === pon.portNumber ? { ...p, connectedCableId: id } : p,
                ),
              },
        )
      : undefined;

  return succeed(
    created,
    { cables: [...data.cables, created], ...(equipment ? { equipment } : {}) },
    {
      notice: notice(
        'success',
        isCoax ? 'Coaxial Cable Created' : 'Fiber Cable Created',
        `Mapped ${created.name} (${created.lengthMeters} m, ${created.fiberCount} ${isCoax ? 'conductor' : 'cores'})`,
      ),
      audit: [
        {
          action: 'CABLE_CREATED',
          details: `Added ${created.type} ${created.id} (${created.lengthMeters} m)${endpoints}`,
          assetId: created.id,
          assetType: 'Cable',
        },
      ],
    },
  );
}

export function updateCable(data: NetworkData, item: Cable): CommandResult<Cable> {
  if (!data.cables.some((c) => c.id === item.id)) return fail('Cable Missing', `Cable ${item.id} was not found.`);
  return succeed(
    item,
    { cables: data.cables.map((c) => (c.id === item.id ? item : c)) },
    {
      notice: notice('success', 'Cable Updated', `Saved cable specifications for ${item.id}`),
      audit: [
        { action: 'CABLE_UPDATED', details: `Updated ${item.type} ${item.id}`, assetId: item.id, assetType: 'Cable' },
      ],
    },
  );
}

/**
 * Validates that a cable can be removed. Splices that reference it are stripped from their closures;
 * the caller must confirm because In-Use cores and splice records are lost.
 */
export function deleteCable(data: NetworkData, id: string): CommandResult<Cable> {
  const target = data.cables.find((c) => c.id === id);
  if (!target) return fail('Cable Missing', `Cable ${id} was not found.`);

  const dependentCustomers = data.customers.filter(
    (c) => c.feederCableId === id || c.distributionCableId === id || c.dropCableId === id,
  );
  if (dependentCustomers.length > 0) {
    return fail(
      'Cannot Delete Cable',
      `${id} carries service for ${dependentCustomers.length} customer(s) (${previewIds(dependentCustomers.map((c) => c.id))}). Re-route them first.`,
    );
  }
  const feedingSplitters = data.splitters.filter((s) => s.inputPort.connectedCableId === id);
  if (feedingSplitters.length > 0) {
    return fail(
      'Cannot Delete Cable',
      `${id} feeds splitter(s) ${feedingSplitters.map((s) => s.id).join(', ')}. Re-patch the splitter input first.`,
    );
  }

  const coresInUse = target.cores.filter((c) => c.status === 'In Use').length;
  const affectedClosures = data.closures.filter(
    (c) =>
      c.cableAId === id || c.cableBId === id || c.splices.some((s) => s.inputCableId === id || s.outputCableId === id),
  );
  const warnings = [
    coresInUse > 0 ? `${coresInUse} core(s) are marked In Use.` : '',
    affectedClosures.length > 0 ? `Splices in ${affectedClosures.map((c) => c.id).join(', ')} will be removed.` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const affected = new Set(affectedClosures.map((c) => c.id));
  const feedsPon = (e: Equipment) => e.ponPorts?.some((p) => p.connectedFeederCableId === id);

  return succeed(
    target,
    {
      cables: data.cables.filter((c) => c.id !== id),
      ...(data.equipment.some(feedsPon)
        ? {
            equipment: data.equipment.map((e) =>
              feedsPon(e)
                ? {
                    ...e,
                    ponPorts: e.ponPorts?.map((p) =>
                      p.connectedFeederCableId === id ? { ...p, connectedFeederCableId: undefined } : p,
                    ),
                    logicalPorts: e.logicalPorts?.map((p) =>
                      p.connectedCableId === id ? { ...p, connectedCableId: undefined } : p,
                    ),
                  }
                : e,
            ),
          }
        : {}),
      ...(affected.size > 0
        ? {
            closures: data.closures.map((c) =>
              affected.has(c.id)
                ? {
                    ...c,
                    cableAId: c.cableAId === id ? undefined : c.cableAId,
                    cableBId: c.cableBId === id ? undefined : c.cableBId,
                    splices: c.splices.filter((s) => s.inputCableId !== id && s.outputCableId !== id),
                  }
                : c,
            ),
          }
        : {}),
    },
    {
      confirm: `Delete cable ${id} and its core inventory? ${warnings} You can undo this with Ctrl+Z.`.replace(
        /\s+/g,
        ' ',
      ),
      notice: notice('info', 'Cable Deleted', `Removed cable ${id}. Press Ctrl+Z to undo.`),
      audit: [
        {
          action: 'CABLE_DELETED',
          details: `Deleted ${target.type} ${id}${coresInUse ? ` (${coresInUse} cores were In Use)` : ''}`,
          assetId: id,
          assetType: 'Cable',
        },
      ],
    },
  );
}

export interface CoreAllocation {
  cableId: string;
  coreNumber: number;
  customerId?: string;
  equipmentId?: string;
  portName?: string;
}

/** Marks a core In Use, refusing cores that are already occupied or damaged. */
export function allocateCore(
  data: NetworkData,
  allocation: CoreAllocation,
  ctx: CommandContext = {},
): CommandResult<Cable> {
  const { cableId, coreNumber, customerId, equipmentId, portName } = allocation;
  const cable = data.cables.find((c) => c.id === cableId);
  if (!cable) return fail('Allocation Failed', `Cable ${cableId} not found.`);
  const core = cable.cores.find((c) => c.coreNumber === coreNumber);
  if (!core) return fail('Allocation Failed', `Core ${coreNumber} not found on cable ${cableId}.`);
  if (core.status === 'In Use') {
    return fail(
      'Core Already Occupied',
      `Fiber Core ${coreLabel(coreNumber)} (${core.colorName}) is already occupied by ${core.connectedToEquipmentId || core.customerId || 'another circuit'}. Select an available core.`,
    );
  }
  if (core.status === 'Damaged') {
    return fail('Damaged Core', `Fiber Core ${coreLabel(coreNumber)} has damage/high attenuation. Cannot allocate.`);
  }

  const target = customerId || equipmentId || 'unspecified target';
  const updated: Cable = {
    ...cable,
    cores: cable.cores.map((c) =>
      c.coreNumber === coreNumber
        ? {
            ...c,
            status: 'In Use' as const,
            connectedToEquipmentId: equipmentId,
            connectedPort: portName,
            customerId,
            remarks: `Allocated to ${target} on ${isoDate(ctx.now)}`,
          }
        : c,
    ),
  };
  return succeed(
    updated,
    { cables: data.cables.map((c) => (c.id === cableId ? updated : c)) },
    {
      notice: notice(
        'success',
        'Fiber Core Allocated',
        `Core ${coreLabel(coreNumber)} (${core.colorName}) allocated to ${target}`,
      ),
      audit: [
        {
          action: 'CORE_ALLOCATED',
          details: `${cableId} core ${coreNumber} allocated to ${target}${portName ? ` (${portName})` : ''}`,
          assetId: cableId,
          assetType: 'Core',
        },
      ],
    },
  );
}
