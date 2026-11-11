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
import { connectionUsesOf } from './connectionRules';
import { buildCores, defaultFiberCount, isLatLngPair } from './defaults';
import { fiberCascadeForCable } from './fiberCommands';
import { polylineLengthMeters } from './geo';
import { cableIdPrefix, newRecordId } from './ids';
import { buildOltPonPorts } from './oltConfig';
import { cascadeAudit, ospCascadeForCable } from './outsidePlant';
import { isoDate } from './time';

export type CableDraft = Partial<Cable> & { name: string; type: CableType; coordinates: [number, number][] };

const SINGLE_MODE_STANDARDS = new Set(['G.652D', 'G.657A1', 'G.657A2', 'G.657B3', 'G.655', 'G.654E']);
const MULTI_MODE_STANDARDS = new Set(['OM1', 'OM2', 'OM3', 'OM4', 'OM5']);

/**
 * Phase 5: why the recorded build of a cable cannot be right, or null. Only real contradictions: a
 * G.65x fibre is single-mode and an OM fibre is multimode by definition, and a coaxial cable has no fibre.
 */
export function cableBuildProblem(cable: Partial<Pick<Cable, 'fiberStandard' | 'fiberMode' | 'cableCategory' | 'type'>>): string | null {
  const coax = cable.cableCategory === 'Coaxial' || cable.type === 'Coaxial Cable';
  if (coax && (cable.fiberStandard || cable.fiberMode)) return 'A coaxial cable has no fibre, so it has no fibre standard or mode. Leave them not recorded.';
  if (cable.fiberStandard && cable.fiberMode) {
    if (SINGLE_MODE_STANDARDS.has(cable.fiberStandard) && cable.fiberMode === 'multi_mode') return `${cable.fiberStandard} fibre is single-mode. Check the drum sheet: either the standard or the mode is wrong.`;
    if (MULTI_MODE_STANDARDS.has(cable.fiberStandard) && cable.fiberMode === 'single_mode') return `${cable.fiberStandard} fibre is multimode. Check the drum sheet: either the standard or the mode is wrong.`;
  }
  return null;
}

/** The mode a fibre standard implies, shown as a hint; never stored unless the person chooses it. */
export function modeForStandard(standard: string | undefined): 'single_mode' | 'multi_mode' | undefined {
  if (!standard) return undefined;
  if (SINGLE_MODE_STANDARDS.has(standard)) return 'single_mode';
  if (MULTI_MODE_STANDARDS.has(standard)) return 'multi_mode';
  return undefined;
}

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
  const id = draft.id?.trim() || newRecordId(cableIdPrefix(draft.type));
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
  const build = cableBuildProblem(draft);
  if (build) return fail('Check the cable details', build, 'warning');

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
  const build = cableBuildProblem(item);
  if (build) return fail('Check the cable details', build, 'warning');
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
  const connectionUses = connectionUsesOf(data, id);
  if (connectionUses.length > 0) {
    return fail('Cannot Delete Cable', `${id}: ${connectionUses.join('; ')}. Change those records first.`);
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
      c.cableAId === id ||
      c.cableBId === id ||
      c.splices.some((s) => s.inputCableId === id || s.outputCableId === id) ||
      (c.cableEntries ?? []).some((e) => e.cableId === id),
  );
  const warnings = [
    coresInUse > 0 ? `${coresInUse} core(s) are marked In Use.` : '',
    affectedClosures.length > 0 ? `Splices in ${affectedClosures.map((c) => c.id).join(', ')} will be removed.` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const affected = new Set(affectedClosures.map((c) => c.id));
  const osp = ospCascadeForCable(data, id);
  const fiber = fiberCascadeForCable(data, id);
  const feedsPon = (e: Equipment) => e.ponPorts?.some((p) => p.connectedFeederCableId === id);
  const equipmentBase = fiber.equipment ?? data.equipment;

  return succeed(
    target,
    {
      ...osp.patch,
      cables: data.cables.filter((c) => c.id !== id),
      ...(fiber.splitters ? { splitters: fiber.splitters } : {}),
      ...(fiber.equipment ? { equipment: fiber.equipment } : {}),
      ...(equipmentBase.some(feedsPon)
        ? {
            equipment: equipmentBase.map((e) =>
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
                    ...(c.cableEntries ? { cableEntries: c.cableEntries.filter((e) => e.cableId !== id) } : {}),
                  }
                : c,
            ),
          }
        : {}),
    },
    {
      confirm: `Delete cable ${id} and its core inventory? ${warnings} ${osp.summary} ${fiber.summary} You can undo this with Ctrl+Z.`.replace(
        /\s+/g,
        ' ',
      ),
      notice: notice('info', 'Cable Deleted', `Removed cable ${id}. Press Ctrl+Z to undo.`),
      audit: [
        cascadeAudit(
          {
            action: 'CABLE_DELETED',
            details: `Deleted ${target.type} ${id}${coresInUse ? ` (${coresInUse} cores were In Use)` : ''}`,
            assetId: id,
            assetType: 'Cable',
          },
          osp,
        ),
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
