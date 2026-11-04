import type { CableType } from '../model/enums';
import type { Cable } from '../model/types';
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
import { isoDate } from './time';

export type CableDraft = Partial<Cable> & { name: string; type: CableType; coordinates: [number, number][] };

const coreLabel = (coreNumber: number) => coreNumber.toString().padStart(2, '0');

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

  const isCoax = draft.type === 'Coaxial Cable';
  const fiberCount = draft.cores?.length || draft.fiberCount || defaultFiberCount(draft.type);
  const measuredLength = Math.round(polylineLengthMeters(draft.coordinates));
  const created: Cable = {
    ...draft,
    id,
    fiberCount,
    lengthMeters: draft.lengthMeters && draft.lengthMeters > 0 ? draft.lengthMeters : measuredLength,
    installationType: draft.installationType || (draft.type === 'Underground Fiber' ? 'Underground' : 'Aerial'),
    owner: draft.owner || 'Metropolitan Fiber Corp',
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
  return succeed(
    created,
    { cables: [...data.cables, created] },
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

  return succeed(
    target,
    {
      cables: data.cables.filter((c) => c.id !== id),
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
      notice: notice('info', 'Cable Deleted', `Removed cable ${id} from map`),
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
