import { type ColorScheme, coreIdentity, DEFAULT_COLOR_SCHEMES, findColorScheme, tubeRecordsProblem } from '../fiber/colors';
import { type CoreAssignmentKind, type CoreEventAction, type CoreStatus, type LossSource, type SpliceStatus, type SpliceType, SPLITTER_ARCHITECTURES, type SplitterArchitecture } from '../model/enums';
import type {
  Cable,
  CableEntry,
  CoreAssignment,
  Equipment,
  FiberCore,
  HistoryEntry,
  JointClosure,
  OdfPanel,
  OdfPort,
  PonPort,
  SpliceRecord,
  Splitter,
  SplitterPort,
} from '../model/types';
import {
  applyPatch,
  type AuditEntry,
  type CommandContext,
  type CommandResult,
  fail,
  type NetworkData,
  type NetworkPatch,
  type Notice,
  notice,
  succeed,
} from './command';
import { describeCore, type FiberData, newFiberId, splitterCapacity } from './fiberIndex';
import { describeFiberProblems, newFiberProblems } from './fiberRules';
import { buildOltPonPorts } from './oltConfig';
import { DEFAULT_OPTICAL_SETTINGS } from './opticalSettings';
import { SPLITTER_ARCHITECTURE_LABELS, SPLITTER_OUTPUT_MARKS, splitterOutputReason, splitterPlace } from './splitterManagement';
import { isoDate } from './time';

/**
 * Commands for the fiber path: cable layout and colour scheme, core assignment and release,
 * closures with trays and entries, splices with history, ODF panels, ports and patches, PON port
 * details and splitter ports. Each one checks the result with `newFiberProblems`: an error the
 * change adds refuses it; a warning it adds is shown for the person to accept, and the acceptance
 * goes into the audit trail.
 */

const fiberDataOf = (data: NetworkData): FiberData => ({
  equipment: data.equipment,
  cables: data.cables,
  splitters: data.splitters,
  closures: data.closures,
  customers: data.customers,
});

const schemesOf = (ctx: CommandContext): readonly ColorScheme[] => ctx.schemes ?? DEFAULT_COLOR_SCHEMES;

const cap = (s: string) => `${s[0].toUpperCase()}${s.slice(1)}`;

/** Runs the fiber checks on a proposed patch and turns them into a refusal or a confirmation. */
export function checkedFiberChange<T>(
  data: NetworkData,
  patch: NetworkPatch,
  value: T,
  extras: { notice: Notice; audit: AuditEntry[] },
  ctx: CommandContext = {},
): CommandResult<T> {
  const after = applyPatch(data, patch);
  const { errors, warnings } = newFiberProblems(fiberDataOf(data), fiberDataOf(after), {
    settings: ctx.optical ?? DEFAULT_OPTICAL_SETTINGS,
    schemes: schemesOf(ctx),
  });
  if (errors.length > 0) return fail('Not saved', `${describeFiberProblems(errors)} Nothing was saved.`);
  if (warnings.length === 0) return succeed(value, patch, extras);
  const first = extras.audit[0];
  return succeed(value, patch, {
    notice: extras.notice,
    audit: [
      ...extras.audit,
      {
        action: 'WARNING_ACCEPTED',
        details: `Saved after the warning: ${warnings.map((w) => w.message).join(' ')}`,
        assetId: first?.assetId ?? 'fiber',
        assetType: first?.assetType ?? 'System',
      },
    ],
    confirm: `Please check: ${warnings.map((w) => w.message).join(' ')} Save anyway?`,
  });
}

const historyLine = (action: string, details: string, ctx: CommandContext): HistoryEntry => ({
  at: (ctx.now ?? new Date()).toISOString(),
  ...(ctx.actor ? { by: ctx.actor } : {}),
  action,
  details,
});

/* ------------------------------------------------------------------ */
/* Cable layout and colour scheme                                      */
/* ------------------------------------------------------------------ */

/** Core records for every fiber of the cable. Missing ones are added as Available. */
export function completeCores(cable: Cable): FiberCore[] {
  const byNumber = new Map(cable.cores.map((c) => [c.coreNumber, c]));
  return Array.from({ length: cable.fiberCount }, (_, i) => byNumber.get(i + 1) ?? { coreNumber: i + 1, status: 'Available' as const });
}

export interface CableLayoutDraft {
  colorScheme?: string;
  tubeColorScheme?: string;
  /** All tubes the same size. Ignored when `tubes` is given. */
  fibersPerTube?: number;
  /**
   * Phase 7: tubes in order (tube 1 first), for tubes of different sizes. Each holds a fiber count
   * and, if written on the drum sheet, its colour. They are numbered 1, 2, 3 ... in this order.
   */
  tubes?: { fiberCount: number; colorName?: string }[];
  layoutSource?: string;
}

/**
 * Records how a cable's fibers are identified. Stored colour names are refreshed from the scheme, so
 * the old TIA-598 guesses on older records go away; an unknown scheme stores no colour at all.
 */
export function setCableLayout(data: NetworkData, cableId: string, draft: CableLayoutDraft, ctx: CommandContext = {}): CommandResult<Cable> {
  const cable = data.cables.find((c) => c.id === cableId);
  if (!cable) return fail('Cable Missing', `Cable ${cableId} was not found.`);
  if (cable.fiberCount < 1) return fail('Fiber count needed', `Record how many fibers ${cable.name} has first.`);
  const schemes = schemesOf(ctx);
  for (const id of [draft.colorScheme, draft.tubeColorScheme]) {
    if (id && !findColorScheme(id, schemes)) return fail('Scheme not found', `Colour scheme "${id}" is not in settings.`);
  }
  const tubes = draft.tubes?.length
    ? draft.tubes.map((t, i) => ({ number: i + 1, fiberCount: t.fiberCount, ...(t.colorName?.trim() ? { colorName: t.colorName.trim().slice(0, 40) } : {}) }))
    : undefined;
  if (tubes) {
    const problem = tubeRecordsProblem({ fiberCount: cable.fiberCount, tubes });
    if (problem) {
      return fail('Tubes do not add up', `${cable.name}: ${problem}. Check the drum sheet: the tube sizes must add up to ${cable.fiberCount} fibers.`);
    }
  }
  // Tubes of one size also keep fibersPerTube, so older screens still read them.
  const sameSize = tubes && tubes.every((t) => t.fiberCount === tubes[0].fiberCount) ? tubes[0].fiberCount : undefined;
  const fpt = tubes ? sameSize : draft.fibersPerTube;
  if (!tubes && fpt !== undefined && (!Number.isInteger(fpt) || fpt < 1 || cable.fiberCount % fpt !== 0)) {
    return fail(
      'Tubes do not add up',
      `${cable.fiberCount} fibers cannot be split into tubes of ${fpt}. Check the drum sheet: tubes x fibers per tube must equal ${cable.fiberCount}.`,
    );
  }
  const { tubes: _oldTubes, ...withoutTubes } = cable;
  const base: Cable = {
    ...withoutTubes,
    colorScheme: draft.colorScheme || undefined,
    tubeColorScheme: draft.tubeColorScheme || undefined,
    fibersPerTube: fpt,
    tubeCount: tubes ? tubes.length : fpt ? cable.fiberCount / fpt : undefined,
    ...(tubes ? { tubes } : {}),
    layoutSource: draft.layoutSource?.trim() || undefined,
  };
  const updated: Cable = {
    ...base,
    cores: completeCores(base).map((core) => {
      const id = coreIdentity(base, core.coreNumber, schemes);
      const { tubeNumber: _t, colorName: _n, colorHex: _h, ...rest } = core;
      return {
        ...rest,
        ...(id.tubeNumber !== undefined ? { tubeNumber: id.tubeNumber } : {}),
        ...(id.fiberColor ? { colorName: id.fiberColor.name, colorHex: id.fiberColor.hex } : {}),
      };
    }),
  };
  const schemeName = findColorScheme(updated.colorScheme, schemes)?.name ?? 'not known';
  const tubeText = tubes && !fpt ? `${tubes.length} tubes of ${tubes.map((t) => t.fiberCount).join(', ')}` : fpt ? `${updated.tubeCount} tubes of ${fpt}` : 'tubes not recorded';
  return checkedFiberChange(
    data,
    { cables: data.cables.map((c) => (c.id === cableId ? updated : c)) },
    updated,
    {
      notice: notice('success', 'Fiber layout saved', `${cable.name}: ${tubeText}, colours ${schemeName}.`),
      audit: [
        {
          action: 'CABLE_LAYOUT_SET',
          details: `${cable.id}: scheme ${updated.colorScheme ?? 'not known'}, tube colours ${updated.tubeColorScheme ?? 'not known'}, ${tubes && !fpt ? `tubes of ${tubes.map((t) => t.fiberCount).join(', ')}` : `${fpt ?? '?'} per tube`}${updated.layoutSource ? ` (${updated.layoutSource})` : ''}`,
          assetId: cable.id,
          assetType: 'Cable',
        },
      ],
    },
    ctx,
  );
}

/* ------------------------------------------------------------------ */
/* Core assignment                                                     */
/* ------------------------------------------------------------------ */

export const activeAssignment = (core: Pick<FiberCore, 'assignments'> | undefined): CoreAssignment | undefined =>
  core?.assignments?.find((a) => !a.releasedAt);

/**
 * States that say the glass itself is bad or out of use (Phase 7). They stay on the core while it
 * is given, released or re-given: only marking it repaired or bringing it back into use clears them.
 */
export const CORE_FAULT_STATUSES: readonly CoreStatus[] = ['Damaged', 'Faulty'];
export const isCoreFaultStatus = (status: CoreStatus | undefined): boolean => !!status && CORE_FAULT_STATUSES.includes(status);
/** Damaged, Faulty or Retired. */
export const isCoreConditionStatus = (status: CoreStatus | undefined): boolean => isCoreFaultStatus(status) || status === 'Retired';

/**
 * Status to show. A damaged, faulty or retired core shows that first, even while it still carries
 * a service, because that is what the next person must know. Otherwise an active assignment decides
 * In Use or Reserved, and then the recorded state.
 */
export function effectiveCoreStatus(core: FiberCore | undefined): CoreStatus {
  if (!core) return 'Available';
  if (isCoreConditionStatus(core.status)) return core.status;
  const active = activeAssignment(core);
  if (active) return active.kind === 'reserved' ? 'Reserved' : 'In Use';
  return core.status;
}

export interface CoreUtilization {
  total: number;
  inUse: number;
  reserved: number;
  available: number;
  /** Damaged or faulty. */
  damaged: number;
  /** Taken out of use for good (Phase 7). Also counted in `other`, so the counts still add up. */
  retired: number;
  other: number;
  /** Share of fibers in use, 0 to 100. */
  usedPercent: number;
}

/** Counts worked out from the core records and assignments, never typed. */
export function coreUtilization(cable: Cable): CoreUtilization {
  const counts = { inUse: 0, reserved: 0, available: 0, damaged: 0, retired: 0, other: 0 };
  for (const core of completeCores(cable)) {
    const status = effectiveCoreStatus(core);
    if (status === 'In Use' || status === 'Spliced') counts.inUse += 1;
    else if (status === 'Reserved') counts.reserved += 1;
    else if (status === 'Available' || status === 'Dark') counts.available += 1;
    else if (isCoreFaultStatus(status)) counts.damaged += 1;
    else {
      counts.other += 1;
      if (status === 'Retired') counts.retired += 1;
    }
  }
  const total = cable.fiberCount;
  return { total, ...counts, usedPercent: total > 0 ? Math.round((counts.inUse / total) * 100) : 0 };
}

export interface CoreAssignmentDraft {
  cableId: string;
  coreNumber: number;
  kind: CoreAssignmentKind;
  use: string;
  source?: string;
  destination?: string;
  customerId?: string;
  equipmentId?: string;
  oltId?: string;
  ponPortId?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  notes?: string;
  /**
   * Phase 7: why a core marked Damaged or Faulty is used anyway. Without it such a core is refused.
   * Stored on the assignment with who and when, and written to the audit trail.
   */
  overrideReason?: string;
}

const withCore =(cable: Cable, coreNumber: number, edit: (core: FiberCore) => FiberCore): Cable => ({
  ...cable,
  cores: completeCores(cable).map((c) => (c.coreNumber === coreNumber ? edit(c) : c)),
});

/** Gives a core to a service or reserves it. A core with an active assignment is refused. */
export function assignCore(data: NetworkData, draft: CoreAssignmentDraft, ctx: CommandContext = {}): CommandResult<Cable> {
  const cable = data.cables.find((c) => c.id === draft.cableId);
  if (!cable) return fail('Allocation Failed', `Cable ${draft.cableId} not found.`);
  if (!Number.isInteger(draft.coreNumber) || draft.coreNumber < 1 || draft.coreNumber > cable.fiberCount) {
    return fail('Allocation Failed', `Core ${draft.coreNumber} not found on cable ${cable.id} (${cable.fiberCount} fibers).`);
  }
  if (!draft.use.trim()) return fail('Say what it is for', 'Write what the fiber is used or reserved for.');
  const core = completeCores(cable).find((c) => c.coreNumber === draft.coreNumber)!;
  const label = describeCore({ cables: new Map([[cable.id, cable]]), schemes: schemesOf(ctx) }, cable.id, draft.coreNumber);
  const current = activeAssignment(core);
  if (current) {
    return fail(
      'Core Already Occupied',
      `${label[0].toUpperCase()}${label.slice(1)} is already ${current.kind === 'reserved' ? 'reserved' : 'in use'} for ${current.use}. Release it first, or choose another fiber.`,
    );
  }
  if ((core.status === 'In Use' || core.status === 'Reserved') && !current) {
    // An older record (or one reserved when the cable was made) with no assignment: still held by
    // something nobody wrote down. Giving it away would hide that, so the person releases it first.
    return fail(
      'Core Already Occupied',
      `${label[0].toUpperCase()}${label.slice(1)} is marked ${core.status}${core.customerId ? ` for ${core.customerId}` : core.connectedToEquipmentId ? ` at ${core.connectedToEquipmentId}` : ''}, with no record of what for. Release it first if it is really free.`,
    );
  }
  if (core.status === 'Retired') {
    return fail('Retired fiber', `${cap(label)} is retired (out of use). Choose another fiber, or bring it back into use first.`);
  }
  const overrideReason = draft.overrideReason?.trim().slice(0, 300);
  const faulty = isCoreFaultStatus(core.status);
  if (faulty && !overrideReason) {
    const last = [...(core.history ?? [])].reverse().find((e) => e.toStatus === core.status);
    return fail(
      core.status === 'Faulty' ? 'Faulty Core' : 'Damaged Core',
      `${cap(label)} is marked ${core.status.toLowerCase()}${last ? ` (${last.reason})` : ''}. Choose another fiber, mark it repaired, or say why it is used anyway.`,
    );
  }
  const now = ctx.now ?? new Date();
  const assignment: CoreAssignment = {
    id: newFiberId('CA'),
    kind: draft.kind,
    use: draft.use.trim(),
    ...(draft.source ? { source: draft.source } : {}),
    ...(draft.destination ? { destination: draft.destination } : {}),
    ...(draft.customerId ? { customerId: draft.customerId } : {}),
    ...(draft.equipmentId ? { equipmentId: draft.equipmentId } : {}),
    ...(draft.oltId ? { oltId: draft.oltId } : {}),
    ...(draft.ponPortId ? { ponPortId: draft.ponPortId } : {}),
    effectiveFrom: draft.effectiveFrom || isoDate(now),
    ...(draft.effectiveTo ? { effectiveTo: draft.effectiveTo } : {}),
    createdAt: now.toISOString(),
    ...(ctx.actor ? { createdBy: ctx.actor } : {}),
    ...(draft.notes ? { notes: draft.notes } : {}),
    ...(faulty && overrideReason ? { override: { status: core.status, reason: overrideReason, at: now.toISOString(), ...(ctx.actor ? { by: ctx.actor } : {}) } } : {}),
  };
  const updated = withCore(cable, draft.coreNumber, (c) => ({
    ...c,
    // A damaged or faulty core used anyway stays marked so: nobody has said it is repaired.
    status: faulty ? c.status : draft.kind === 'reserved' ? 'Reserved' : 'In Use',
    ...(draft.customerId ? { customerId: draft.customerId } : {}),
    ...(draft.equipmentId ? { connectedToEquipmentId: draft.equipmentId } : {}),
    assignments: [...(c.assignments ?? []), assignment],
  }));
  return checkedFiberChange(
    data,
    { cables: data.cables.map((c) => (c.id === cable.id ? updated : c)) },
    updated,
    {
      notice: notice(
        faulty ? 'warning' : 'success',
        draft.kind === 'reserved' ? 'Fiber reserved' : 'Fiber Core Allocated',
        `${label} ${draft.kind === 'reserved' ? 'reserved' : 'given'} for ${assignment.use}.${faulty ? ` It is still marked ${core.status.toLowerCase()}; your reason is kept.` : ''}`,
      ),
      audit: [
        {
          action: draft.kind === 'reserved' ? 'CORE_RESERVED' : 'CORE_ALLOCATED',
          details: `${cable.id} core ${draft.coreNumber}: ${assignment.use}${assignment.source ? `, from ${assignment.source}` : ''}${assignment.destination ? `, to ${assignment.destination}` : ''}`,
          assetId: cable.id,
          assetType: 'Core',
        },
        ...(assignment.override
          ? [
              {
                action: 'CORE_OVERRIDE',
                details: `${cable.id} core ${draft.coreNumber} given while marked ${assignment.override.status}, by ${ctx.actor ?? 'not recorded'} at ${assignment.override.at}. Reason: ${assignment.override.reason}`,
                assetId: cable.id,
                assetType: 'Core' as const,
              },
            ]
          : []),
      ],
    },
    ctx,
  );
}

/** Ends a core's active assignment. The record stays in the core's history. */
export function releaseCore(
  data: NetworkData,
  cableId: string,
  coreNumber: number,
  reason: string,
  ctx: CommandContext = {},
): CommandResult<Cable> {
  const cable = data.cables.find((c) => c.id === cableId);
  if (!cable) return fail('Cable Missing', `Cable ${cableId} was not found.`);
  const core = completeCores(cable).find((c) => c.coreNumber === coreNumber);
  const current = activeAssignment(core);
  const legacyInUse = !current && (core?.status === 'In Use' || core?.status === 'Reserved');
  if (!core || (!current && !legacyInUse)) return fail('Nothing to release', `Fiber ${coreNumber} of ${cable.name} is not assigned.`);
  const now = ctx.now ?? new Date();
  const updated = withCore(cable, coreNumber, (c) => {
    const { customerId: _c, customerName: _n, connectedToEquipmentId: _e, connectedPort: _p, ...rest } = c;
    return {
      ...rest,
      // Releasing a service does not repair the glass: a damaged, faulty or retired core stays so.
      status: isCoreConditionStatus(c.status) ? c.status : 'Available',
      assignments: (c.assignments ?? []).map((a) =>
        a.releasedAt ? a : { ...a, releasedAt: now.toISOString(), ...(ctx.actor ? { releasedBy: ctx.actor } : {}), ...(reason.trim() ? { releaseReason: reason.trim() } : {}) },
      ),
    };
  });
  const stillMarked = isCoreConditionStatus(core.status);
  return succeed(updated, { cables: data.cables.map((c) => (c.id === cableId ? updated : c)) }, {
    notice: notice(
      'info',
      'Fiber released',
      stillMarked
        ? `Fiber ${coreNumber} of ${cable.name} is released. It is still marked ${core.status.toLowerCase()}. Its history is kept.`
        : `Fiber ${coreNumber} of ${cable.name} is available again. Its history is kept.`,
    ),
    audit: [
      {
        action: 'CORE_RELEASED',
        details: `${cable.id} core ${coreNumber} released${current ? ` from ${current.use}` : ''}${reason.trim() ? `: ${reason.trim()}` : ''}`,
        assetId: cable.id,
        assetType: 'Core',
      },
    ],
  });
}

/* ------------------------------------------------------------------ */
/* Core condition: faulty, repaired, retired (Phase 7)                 */
/* ------------------------------------------------------------------ */

export interface CoreConditionDraft {
  /** What was found or done, in the person's words. Required. */
  reason: string;
  /** OTDR file name or test reference, as written. */
  otdrRef?: string;
  /** Ids of photos already saved (field capture or closure photos). */
  photoIds?: string[];
}

/**
 * The status the core had before its last fault or retirement, when one is on record. In Use and
 * Reserved came from a service that is no longer active, so they are not brought back.
 */
function statusBefore(core: FiberCore, actions: readonly CoreEventAction[]): CoreStatus | undefined {
  const event = [...(core.history ?? [])].reverse().find((e) => actions.includes(e.action));
  const before = event?.fromStatus;
  return before && !isCoreConditionStatus(before) && before !== 'In Use' && before !== 'Reserved' ? before : undefined;
}

function changeCondition(
  data: NetworkData,
  cableId: string,
  coreNumber: number,
  draft: CoreConditionDraft,
  ctx: CommandContext,
  rule: {
    action: CoreEventAction;
    auditAction: string;
    title: string;
    /** A refusal for this core, or the status it moves to. */
    next: (core: FiberCore, label: string) => { refuse: string } | { to: CoreStatus };
    done: (label: string, core: FiberCore, to: CoreStatus) => string;
  },
): CommandResult<Cable> {
  const cable = data.cables.find((c) => c.id === cableId);
  if (!cable) return fail('Cable Missing', `Cable ${cableId} was not found.`);
  if (!Number.isInteger(coreNumber) || coreNumber < 1 || coreNumber > cable.fiberCount) {
    return fail('Fiber not on cable', `${cable.name} has ${cable.fiberCount} fibers, so fiber ${coreNumber} does not exist.`);
  }
  const reason = draft.reason.trim().slice(0, 300);
  if (!reason) return fail('Say why', 'Write what was found or done, such as "OTDR shows a break at 420 m".');
  const core = completeCores(cable).find((c) => c.coreNumber === coreNumber)!;
  const label = describeCore({ cables: new Map([[cable.id, cable]]), schemes: schemesOf(ctx) }, cable.id, coreNumber);
  const step = rule.next(core, label);
  if ('refuse' in step) return fail(rule.title, step.refuse);
  const otdrRef = draft.otdrRef?.trim().slice(0, 120);
  const photoIds = (draft.photoIds ?? []).map((p) => p.trim()).filter(Boolean).slice(0, 20);
  const event = {
    at: (ctx.now ?? new Date()).toISOString(),
    ...(ctx.actor ? { by: ctx.actor } : {}),
    action: rule.action,
    fromStatus: core.status,
    toStatus: step.to,
    reason,
    ...(otdrRef ? { otdrRef } : {}),
    ...(photoIds.length ? { photoIds } : {}),
  };
  const updated = withCore(cable, coreNumber, (c) => ({ ...c, status: step.to, history: [...(c.history ?? []), event] }));
  const evidence = [otdrRef ? `OTDR ${otdrRef}` : '', photoIds.length ? `photos ${photoIds.join(', ')}` : ''].filter(Boolean).join('; ');
  return checkedFiberChange(
    data,
    { cables: data.cables.map((c) => (c.id === cable.id ? updated : c)) },
    updated,
    {
      notice: notice('success', rule.title, rule.done(cap(label), core, step.to)),
      audit: [
        {
          action: rule.auditAction,
          details: `${cable.id} core ${coreNumber}: ${core.status} → ${step.to}. ${reason}${evidence ? ` (${evidence})` : ''}`,
          assetId: cable.id,
          assetType: 'Core',
        },
      ],
    },
    ctx,
  );
}

/**
 * Marks a core faulty, with the reason and any evidence kept in its history. A service still on it
 * stays recorded (the customer may be affected); it is not released silently.
 */
export function markCoreFaulty(data: NetworkData, cableId: string, coreNumber: number, draft: CoreConditionDraft, ctx: CommandContext = {}): CommandResult<Cable> {
  return changeCondition(data, cableId, coreNumber, draft, ctx, {
    action: 'marked_faulty',
    auditAction: 'CORE_MARKED_FAULTY',
    title: 'Marked faulty',
    next: (core, label) =>
      core.status === 'Faulty'
        ? { refuse: `${cap(label)} is already marked faulty.` }
        : core.status === 'Retired'
          ? { refuse: `${cap(label)} is retired (out of use). Bring it back into use first if it is being tested again.` }
          : { to: 'Faulty' },
    done: (label, core) => {
      const active = activeAssignment(core);
      return `${label} is marked faulty.${active ? ` It is still recorded for ${active.use}: that service may be affected.` : ''}`;
    },
  });
}

/**
 * Marks a damaged or faulty core repaired. It goes back to the state it had before the fault when
 * that is on record, to In Use or Reserved while a service is still on it, and otherwise to
 * "Not known", because nobody has said whether it is free.
 */
export function markCoreRepaired(data: NetworkData, cableId: string, coreNumber: number, draft: CoreConditionDraft, ctx: CommandContext = {}): CommandResult<Cable> {
  return changeCondition(data, cableId, coreNumber, draft, ctx, {
    action: 'marked_repaired',
    auditAction: 'CORE_REPAIRED',
    title: 'Marked repaired',
    next: (core, label) => {
      if (core.status === 'Retired') return { refuse: `${cap(label)} is retired. Use "Bring back into use" instead.` };
      if (!isCoreFaultStatus(core.status)) return { refuse: `${cap(label)} is not marked damaged or faulty.` };
      const active = activeAssignment(core);
      return { to: active ? (active.kind === 'reserved' ? 'Reserved' : 'In Use') : (statusBefore(core, ['marked_faulty']) ?? 'Unknown') };
    },
    done: (label, _core, to) => `${label} is marked repaired. It is now ${to === 'Unknown' ? 'not known (check whether it is free)' : to.toLowerCase()}.`,
  });
}

/** Takes a core out of use for good. A core still given to a service must be released first. */
export function retireCore(data: NetworkData, cableId: string, coreNumber: number, draft: CoreConditionDraft, ctx: CommandContext = {}): CommandResult<Cable> {
  return changeCondition(data, cableId, coreNumber, draft, ctx, {
    action: 'retired',
    auditAction: 'CORE_RETIRED',
    title: 'Fiber retired',
    next: (core, label) => {
      if (core.status === 'Retired') return { refuse: `${cap(label)} is already retired.` };
      const active = activeAssignment(core);
      if (active) return { refuse: `${cap(label)} is still ${active.kind === 'reserved' ? 'reserved' : 'in use'} for ${active.use}. Release it first.` };
      if (core.status === 'In Use' || core.status === 'Reserved') return { refuse: `${cap(label)} is marked ${core.status}. Release it first.` };
      return { to: 'Retired' };
    },
    done: (label) => `${label} is retired. It cannot be given a service until it is brought back into use.`,
  });
}

/** Brings a retired core back into use: back to its state before it was retired, or "Not known". */
export function returnCoreToService(data: NetworkData, cableId: string, coreNumber: number, draft: CoreConditionDraft, ctx: CommandContext = {}): CommandResult<Cable> {
  return changeCondition(data, cableId, coreNumber, draft, ctx, {
    action: 'returned_to_service',
    auditAction: 'CORE_RETURNED',
    title: 'Back in use',
    next: (core, label) => (core.status !== 'Retired' ? { refuse: `${cap(label)} is not retired.` } : { to: statusBefore(core, ['retired']) ?? 'Unknown' }),
    done: (label, _core, to) => `${label} is back in use. It is now ${to === 'Unknown' ? 'not known (check whether it is free)' : to.toLowerCase()}.`,
  });
}

/* ------------------------------------------------------------------ */
/* Closures, trays and entries                                         */
/* ------------------------------------------------------------------ */

export interface ClosureDraft {
  equipmentId?: string;
  name?: string;
  closureType: JointClosure['closureType'];
  lat?: number;
  lng?: number;
  trayCount?: number;
  technician?: string;
  installationDate?: string;
}

/** Creates a closure record, usually for a closure pin already on the map. */
export function createClosure(data: NetworkData, draft: ClosureDraft, ctx: CommandContext = {}): CommandResult<JointClosure> {
  const pin = draft.equipmentId ? data.equipment.find((e) => e.id === draft.equipmentId) : undefined;
  if (draft.equipmentId && !pin) return fail('Pin Missing', `${draft.equipmentId} is not on the map.`);
  if (pin && data.closures.some((c) => c.equipmentId === pin.id)) {
    return fail('Already set up', `${pin.name} already has a closure record. Open it instead.`);
  }
  const lat = pin?.lat ?? draft.lat;
  const lng = pin?.lng ?? draft.lng;
  if (lat === undefined || lng === undefined) return fail('Place needed', 'Choose the closure pin on the map first.');
  const trays = Math.max(0, Math.min(48, Math.round(draft.trayCount ?? 0)));
  const now = ctx.now ?? new Date();
  const closure: JointClosure = {
    id: newFiberId('CLO'),
    name: draft.name?.trim() || pin?.name || 'Closure',
    closureType: draft.closureType,
    lat,
    lng,
    area: pin?.area ?? '',
    entryPortsCount: 0,
    exitPortsCount: 0,
    installationDate: draft.installationDate || '',
    technician: draft.technician?.trim() || '',
    splices: [],
    images: [],
    ...(pin ? { equipmentId: pin.id } : {}),
    trays: Array.from({ length: trays }, (_, i) => ({ id: newFiberId('TRY'), label: `Tray ${i + 1}` })),
    cableEntries: pin
      ? data.cables
          .filter((c) => c.endEquipmentId === pin.id || c.startEquipmentId === pin.id)
          .map((c): CableEntry => ({ cableId: c.id, role: c.endEquipmentId === pin.id ? 'in' : 'out' }))
      : [],
    condition: 'unknown',
    sealStatus: 'unknown',
    createdAt: now.toISOString(),
    ...(ctx.actor ? { createdBy: ctx.actor } : {}),
  };
  return succeed(closure, { closures: [...data.closures, closure] }, {
    notice: notice('success', 'Closure set up', `${closure.name}: ${trays} tray(s). Cables drawn to the pin are listed as entries; check them.`),
    audit: [{ action: 'CLOSURE_CREATED', details: `Closure ${closure.id} for ${pin?.id ?? 'a map point'} with ${trays} tray(s)`, assetId: closure.id, assetType: 'Closure' }],
  });
}

export type ClosureDetails = Partial<
  Pick<
    JointClosure,
    'name' | 'closureType' | 'trays' | 'cableEntries' | 'condition' | 'sealStatus' | 'lastMaintainedAt' | 'maintenanceNotes' | 'photoIds' | 'technician' | 'installationDate' | 'remarks'
  >
>;

/** Saves closure details. A tray holding active splices cannot be removed; entries must be real cables. */
export function saveClosureDetails(data: NetworkData, closureId: string, details: ClosureDetails, ctx: CommandContext = {}): CommandResult<JointClosure> {
  const closure = data.closures.find((c) => c.id === closureId);
  if (!closure) return fail('Closure Missing', `Joint closure ${closureId} was not found.`);
  if (details.trays) {
    const kept = new Set(details.trays.map((t) => t.id));
    const used = closure.splices.find((s) => !s.retiredAt && s.trayId && !kept.has(s.trayId));
    if (used) return fail('Tray in use', 'That tray still holds splices. Move or take them out of service first.');
    const pigtail = (closure.terminations ?? []).find((t) => !t.retiredAt && t.trayId && !kept.has(t.trayId));
    if (pigtail) return fail('Tray in use', 'That tray still holds a fiber ending on a pigtail. Take it out first.');
  }
  if (details.cableEntries) {
    const ids = details.cableEntries.map((e) => e.cableId);
    const missing = ids.find((id) => !data.cables.some((c) => c.id === id));
    if (missing) return fail('Cable Missing', `Cable ${missing} is not on record.`);
    const repeated = ids.find((id, i) => ids.indexOf(id) !== i);
    if (repeated) return fail('Listed twice', `Cable ${repeated} is already listed at this closure.`);
  }
  const updated: JointClosure = { ...closure, ...details };
  if (details.cableEntries) {
    updated.entryPortsCount = details.cableEntries.filter((e) => e.role !== 'out').length;
    updated.exitPortsCount = details.cableEntries.filter((e) => e.role !== 'in').length;
  }
  return checkedFiberChange(
    data,
    { closures: data.closures.map((c) => (c.id === closureId ? updated : c)) },
    updated,
    {
      notice: notice('success', 'Closure saved', `${updated.name} details saved.`),
      audit: [{ action: 'CLOSURE_UPDATED', details: `${closure.id}: ${Object.keys(details).join(', ')}`, assetId: closure.id, assetType: 'Closure' }],
    },
    ctx,
  );
}

/* ------------------------------------------------------------------ */
/* Splices                                                             */
/* ------------------------------------------------------------------ */

export interface SpliceDraft {
  trayId?: string;
  /** The side towards the OLT. */
  inputCableId: string;
  inputCore: number;
  /** The side towards customers. */
  outputCableId: string;
  outputCore: number;
  spliceType?: SpliceType;
  spliceLossDb?: number;
  lossSource?: LossSource;
  otdrRef?: string;
  technician?: string;
  date?: string;
  status?: Extract<SpliceStatus, 'Pending' | 'Spliced' | 'Tested'>;
  notes?: string;
  photoIds?: string[];
  /** Phase 8: cassette and position in the tray, as printed. */
  cassette?: string;
  position?: number;
  /** Phase 8: meter, OTDR or splicer the loss was read on. */
  lossMeter?: string;
  /** Phase 8: splice report or job sheet number. */
  reportRef?: string;
}

function buildSplice(data: NetworkData, closure: JointClosure, draft: SpliceDraft, ctx: CommandContext): SpliceRecord | string {
  const a = data.cables.find((c) => c.id === draft.inputCableId);
  const b = data.cables.find((c) => c.id === draft.outputCableId);
  if (!a || !b) return `Cable ${!a ? draft.inputCableId : draft.outputCableId} is not on record.`;
  for (const [cable, core] of [
    [a, draft.inputCore],
    [b, draft.outputCore],
  ] as const) {
    if (!Number.isInteger(core) || core < 1 || core > cable.fiberCount) return `${cable.name} has ${cable.fiberCount} fibers, so fiber ${core} does not exist.`;
  }
  if (a.id === b.id && draft.inputCore === draft.outputCore) return 'A fiber cannot be spliced to itself.';
  if (draft.trayId && !(closure.trays ?? []).some((t) => t.id === draft.trayId)) return 'That tray is not recorded on this closure.';
  if (draft.spliceLossDb !== undefined) {
    if (!Number.isFinite(draft.spliceLossDb) || draft.spliceLossDb < 0 || draft.spliceLossDb > 10) return 'Enter the splice loss in dB, between 0 and 10.';
    if (!draft.lossSource) return 'Say where the splice loss came from (meter, OTDR, design).';
  }
  if (draft.position !== undefined && (!Number.isInteger(draft.position) || draft.position < 1 || draft.position > 999)) {
    return 'Enter the tray position as a whole number, 1 or more.';
  }
  if ((draft.cassette?.trim().length ?? 0) > 40) return 'Keep the cassette name to 40 characters.';
  const now = ctx.now ?? new Date();
  return {
    id: newFiberId('SPC'),
    inputCableId: a.id,
    inputCableName: a.name,
    inputCore: draft.inputCore,
    outputCableId: b.id,
    outputCableName: b.name,
    outputCore: draft.outputCore,
    ...(draft.spliceLossDb !== undefined ? { spliceLossDb: draft.spliceLossDb, lossSource: draft.lossSource } : {}),
    status: draft.status ?? 'Spliced',
    technician: draft.technician?.trim() || ctx.actor || '',
    date: draft.date || isoDate(now),
    ...(draft.trayId ? { trayId: draft.trayId } : {}),
    spliceType: draft.spliceType ?? 'fusion',
    ...(draft.otdrRef?.trim() ? { otdrRef: draft.otdrRef.trim() } : {}),
    ...(draft.notes?.trim() ? { notes: draft.notes.trim() } : {}),
    ...(draft.photoIds?.length ? { photoIds: draft.photoIds } : {}),
    ...(draft.cassette?.trim() ? { cassette: draft.cassette.trim() } : {}),
    ...(draft.position !== undefined ? { position: draft.position } : {}),
    ...(draft.lossMeter?.trim() ? { lossMeter: draft.lossMeter.trim().slice(0, 120) } : {}),
    ...(draft.reportRef?.trim() ? { reportRef: draft.reportRef.trim().slice(0, 120) } : {}),
  };
}

const spliceSummary = (s: SpliceRecord) => `${s.inputCableId} fiber ${s.inputCore} → ${s.outputCableId} fiber ${s.outputCore}`;

/** Records a splice after checking both fibers exist and neither side already continues elsewhere. */
export function recordSplice(data: NetworkData, closureId: string, draft: SpliceDraft, ctx: CommandContext = {}): CommandResult<SpliceRecord> {
  const closure = data.closures.find((c) => c.id === closureId);
  if (!closure) return fail('Closure Missing', `Joint closure ${closureId} was not found.`);
  const splice = buildSplice(data, closure, draft, ctx);
  if (typeof splice === 'string') return fail('Splice not saved', splice);
  const updated = { ...closure, splices: [...closure.splices, splice] };
  return checkedFiberChange(
    data,
    { closures: data.closures.map((c) => (c.id === closureId ? updated : c)) },
    splice,
    {
      notice: notice('success', 'Splice Recorded', spliceSummary(splice)),
      audit: [{ action: 'SPLICE_ADDED', details: `${closure.id}: ${spliceSummary(splice)}`, assetId: closure.id, assetType: 'Closure' }],
    },
    ctx,
  );
}

const retire = (s: SpliceRecord, reason: string, ctx: CommandContext, replacedBy?: string): SpliceRecord => ({
  ...s,
  retiredAt: (ctx.now ?? new Date()).toISOString(),
  ...(ctx.actor ? { retiredBy: ctx.actor } : {}),
  ...(reason.trim() ? { retiredReason: reason.trim() } : {}),
  ...(replacedBy ? { replacedBySpliceId: replacedBy } : {}),
});

/** Takes a splice out of service. It stays on record as history. */
export function retireSplice(data: NetworkData, closureId: string, spliceId: string, reason: string, ctx: CommandContext = {}): CommandResult<SpliceRecord> {
  const closure = data.closures.find((c) => c.id === closureId);
  const splice = closure?.splices.find((s) => s.id === spliceId);
  if (!closure || !splice) return fail('Splice Missing', `Splice ${spliceId} was not found.`);
  if (splice.retiredAt) return fail('Already out of service', 'This splice is already history.');
  const retired = retire(splice, reason, ctx);
  return succeed(retired, { closures: data.closures.map((c) => (c.id === closureId ? { ...c, splices: c.splices.map((s) => (s.id === spliceId ? retired : s)) } : c)) }, {
    notice: notice('info', 'Splice out of service', `${spliceSummary(splice)} is kept as history.`),
    audit: [{ action: 'SPLICE_RETIRED', details: `${closure.id}: ${spliceSummary(splice)}${reason.trim() ? ` (${reason.trim()})` : ''}`, assetId: closure.id, assetType: 'Closure' }],
  });
}

/** Re-splices: the old splice becomes history and the new one replaces it, in one step. */
export function resplice(
  data: NetworkData,
  closureId: string,
  oldSpliceId: string,
  draft: SpliceDraft,
  reason: string,
  ctx: CommandContext = {},
): CommandResult<SpliceRecord> {
  const closure = data.closures.find((c) => c.id === closureId);
  const old = closure?.splices.find((s) => s.id === oldSpliceId);
  if (!closure || !old) return fail('Splice Missing', `Splice ${oldSpliceId} was not found.`);
  if (old.retiredAt) return fail('Already out of service', 'Choose a splice that is in service.');
  const splice = buildSplice(data, closure, draft, ctx);
  if (typeof splice === 'string') return fail('Splice not saved', splice);
  const updated = { ...closure, splices: [...closure.splices.map((s) => (s.id === oldSpliceId ? retire(s, reason || 'Re-spliced', ctx, splice.id) : s)), splice] };
  return checkedFiberChange(
    data,
    { closures: data.closures.map((c) => (c.id === closureId ? updated : c)) },
    splice,
    {
      notice: notice('success', 'Re-spliced', `${spliceSummary(splice)}. The old splice is kept as history.`),
      audit: [{ action: 'SPLICE_REDONE', details: `${closure.id}: ${spliceSummary(old)} replaced by ${spliceSummary(splice)}`, assetId: closure.id, assetType: 'Closure' }],
    },
    ctx,
  );
}

/* ------------------------------------------------------------------ */
/* ODF panels, ports and patches                                       */
/* ------------------------------------------------------------------ */

export const isOdfType = (type: string) => type === 'ODF' || type === 'Fiber Patch Panel';

export interface OdfPanelDraft {
  label: string;
  portCount: number;
  rack?: string;
  connectorType?: string;
}

export function addOdfPanel(data: NetworkData, odfId: string, draft: OdfPanelDraft, _ctx: CommandContext = {}): CommandResult<OdfPanel> {
  const odf = data.equipment.find((e) => e.id === odfId);
  if (!odf) return fail('Equipment Missing', `${odfId} was not found.`);
  if (!draft.label.trim()) return fail('Name needed', 'Give the panel the name written on it, such as "Panel A".');
  if (!Number.isInteger(draft.portCount) || draft.portCount < 1 || draft.portCount > 288) return fail('Port count', 'Enter how many adapters the panel has (1 to 288).');
  if ((odf.odfPanels ?? []).some((p) => p.label.toLowerCase() === draft.label.trim().toLowerCase())) {
    return fail('Name in use', `${odf.name} already has a panel called ${draft.label.trim()}.`);
  }
  const panel: OdfPanel = {
    id: newFiberId('ODP'),
    label: draft.label.trim(),
    ...(draft.rack?.trim() ? { rack: draft.rack.trim() } : {}),
    ...(draft.connectorType?.trim() ? { connectorType: draft.connectorType.trim() } : {}),
    ports: Array.from({ length: draft.portCount }, (_, i): OdfPort => ({ id: newFiberId('ODX'), number: i + 1, status: 'available' })),
  };
  const updated: Equipment = { ...odf, odfPanels: [...(odf.odfPanels ?? []), panel] };
  return succeed(panel, { equipment: data.equipment.map((e) => (e.id === odfId ? updated : e)) }, {
    notice: notice('success', 'Panel added', `${odf.name}: ${panel.label} with ${draft.portCount} ports.`),
    audit: [{ action: 'ODF_PANEL_ADDED', details: `${odf.id}: ${panel.label}, ${draft.portCount} ports`, assetId: odf.id, assetType: 'Equipment' }],
  });
}

const portStatusFor = (port: OdfPort): OdfPort['status'] =>
  port.status === 'damaged' || port.status === 'reserved' ? port.status : port.patch || port.feederCableId ? 'in_use' : 'available';

function editOdfPort(
  data: NetworkData,
  odfId: string,
  panelId: string,
  portNumber: number,
  edit: (port: OdfPort, odf: Equipment, panel: OdfPanel) => OdfPort | string,
): { odf: Equipment; panel: OdfPanel; port: OdfPort; updated: Equipment } | string {
  const odf = data.equipment.find((e) => e.id === odfId);
  const panel = odf?.odfPanels?.find((p) => p.id === panelId);
  const port = panel?.ports.find((p) => p.number === portNumber);
  if (!odf || !panel || !port) return 'That ODF port is not on record.';
  const next = edit(port, odf, panel);
  if (typeof next === 'string') return next;
  const finalPort = { ...next, status: portStatusFor(next) };
  const updated: Equipment = {
    ...odf,
    odfPanels: odf.odfPanels!.map((p) => (p.id === panelId ? { ...p, ports: p.ports.map((x) => (x.number === portNumber ? finalPort : x)) } : p)),
  };
  return { odf, panel, port: finalPort, updated };
}

/** Phase 9: an ODF port marked faulty. The value stored is `damaged`; the screens say "Faulty". */
export const isOdfPortFaulty = (port: Pick<OdfPort, 'status'>): boolean => port.status === 'damaged';

/** Phase 9: the last history line of one kind on a port, such as why it was marked faulty. */
export const lastOdfPortLine = (port: Pick<OdfPort, 'history'>, action: string): HistoryEntry | undefined =>
  [...(port.history ?? [])].reverse().find((h) => h.action === action);

/** History actions for a port's condition (Phase 9). */
export const ODF_PORT_MARKS = { faulty: 'MARKED_FAULTY', repaired: 'MARKED_REPAIRED', reserved: 'MARKED_RESERVED', reservationEnded: 'RESERVATION_ENDED' } as const;

const odfPortName = (odf: Pick<Equipment, 'name'>, panel: Pick<OdfPanel, 'label'>, port: Pick<OdfPort, 'number'>) => `${odf.name} ${panel.label} port ${port.number}`;

const clip = (s: string, max = 160) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/**
 * Phase 9: what an ODF port's feeder fiber is given to, worked out from linked records only: the
 * ODF adapter, the PON port patched in front of it, and the far end of the cable when the cable is
 * recorded as ending at this ODF. Nothing is guessed when the cable ends elsewhere.
 */
function odfFeederUse(data: NetworkData, odf: Equipment, panel: OdfPanel, port: OdfPort, cable: Cable) {
  const here = odfPortName(odf, panel, port);
  const farId = cable.startEquipmentId === odf.id ? cable.endEquipmentId : cable.endEquipmentId === odf.id ? cable.startEquipmentId : undefined;
  const far = farId ? (data.equipment.find((e) => e.id === farId)?.name ?? data.customers.find((c) => c.id === farId)?.name) : undefined;
  const patch = port.patch;
  return {
    use: clip(patch ? `PON ${patch.oltId} / ${patch.ponPortId}` : `ODF ${here}`),
    source: clip(patch ? `${patch.oltId} ${patch.ponPortId} via ODF ${here}` : `ODF ${here}`),
    ...(far ? { destination: clip(far) } : {}),
    ...(patch ? { oltId: patch.oltId, ponPortId: patch.ponPortId } : {}),
  };
}

interface FeederFollow {
  cables: Cable[];
  notes: string[];
  audit: AuditEntry[];
}

/**
 * Phase 9: keeps the feeder fiber's assignment in step with its ODF port. The assignment this port
 * made is released (it stays in the fiber's history) when the fiber, the patch or the port goes, and
 * the fiber the port now holds is given to it again, with the use worked out from its patch. An
 * assignment something else made is never changed; the notes say so instead.
 *
 * `strict` is for recording a new feeder fiber: a fiber held for something else (with or without a
 * record of what for), a retired fiber, or a faulty one with no reason is refused, as `assignCore`
 * refuses it. Otherwise (a patch changed, an OLT deleted) such a fiber is left as it is and noted.
 */
function followOdfFeeder(
  data: NetworkData,
  cablesIn: readonly Cable[],
  where: { odf: Equipment; panel: OdfPanel },
  before: OdfPort | undefined,
  after: OdfPort | undefined,
  ctx: CommandContext,
  opts: { strict: boolean; overrideReason?: string; reason: string },
): FeederFollow | string {
  let cables = [...cablesIn];
  const notes: string[] = [];
  const audit: AuditEntry[] = [];
  const now = ctx.now ?? new Date();
  const schemes = schemesOf(ctx);
  const portId = (after ?? before)!.id;
  const label = (cable: Cable, n: number) => describeCore({ cables: new Map([[cable.id, cable]]), schemes }, cable.id, n);
  const feederChanged = before?.feederCableId !== after?.feederCableId || before?.feederCore !== after?.feederCore;
  const patchChanged = before?.patch?.oltId !== after?.patch?.oltId || before?.patch?.ponPortId !== after?.patch?.ponPortId;
  const coreOf = (cableId: string | undefined, n: number | undefined) => {
    const cable = cableId ? cables.find((c) => c.id === cableId) : undefined;
    const core = cable && n ? completeCores(cable).find((c) => c.coreNumber === n) : undefined;
    return cable && core ? { cable, core } : undefined;
  };
  const replace = (cable: Cable) => {
    cables = cables.map((c) => (c.id === cable.id ? cable : c));
  };

  // 1. Release what this port gave, if the fiber, the patch or the port changed.
  let carriedOverride: CoreAssignment['override'];
  const old = coreOf(before?.feederCableId, before?.feederCore);
  const oldOurs = old?.core.assignments?.find((a) => !a.releasedAt && a.odfPortId === portId);
  if (old && oldOurs && (feederChanged || patchChanged || !after?.feederCableId)) {
    carriedOverride = oldOurs.override;
    replace(
      withCore(old.cable, old.core.coreNumber, (c) => {
        const assignments = (c.assignments ?? []).map((a) =>
          a.id === oldOurs.id ? { ...a, releasedAt: now.toISOString(), ...(ctx.actor ? { releasedBy: ctx.actor } : {}), releaseReason: clip(opts.reason, 300) } : a,
        );
        const stillHeld = assignments.some((a) => !a.releasedAt);
        return { ...c, status: isCoreConditionStatus(c.status) || stillHeld ? c.status : 'Available', assignments };
      }),
    );
    audit.push({ action: 'CORE_RELEASED', details: `${old.cable.id} core ${old.core.coreNumber} released from ${oldOurs.use}: ${clip(opts.reason, 200)}`, assetId: old.cable.id, assetType: 'Core' });
  } else if (old && !oldOurs && (feederChanged || !after?.feederCableId)) {
    const other = activeAssignment(old.core);
    if (other) notes.push(`${cap(label(old.cable, old.core.coreNumber))} stays recorded for ${other.use}. Release it on the Fibers screen if nothing uses it now.`);
  }

  // 2. Give the fiber the port now holds to it.
  const now2 = coreOf(after?.feederCableId, after?.feederCore);
  if (!after || !now2) return { cables, notes, audit };
  const ours = now2.core.assignments?.find((a) => !a.releasedAt && a.odfPortId === portId);
  if (ours) return { cables, notes, audit };
  const { cable, core } = now2;
  const name = cap(label(cable, core.coreNumber));
  const active = activeAssignment(core);
  const refuseOrNote = (message: string) => {
    if (opts.strict) return message;
    notes.push(message);
    return null;
  };
  if (active) {
    if (after.patch && active.oltId === after.patch.oltId && active.ponPortId === after.patch.ponPortId) {
      notes.push(`${name} is already recorded in use for ${active.use}.`);
      return { cables, notes, audit };
    }
    const r = refuseOrNote(`${name} is already ${active.kind === 'reserved' ? 'reserved' : 'in use'} for ${active.use}. Release it on the Fibers screen first, or choose another fiber.`);
    return r ?? { cables, notes, audit };
  }
  if (core.status === 'In Use' || core.status === 'Reserved') {
    const r = refuseOrNote(`${name} is marked ${core.status}, with no record of what for. Release it on the Fibers screen first if it is really free.`);
    return r ?? { cables, notes, audit };
  }
  if (core.status === 'Retired') {
    const r = refuseOrNote(`${name} is retired (out of use), so it is not marked in use. Choose another fiber, or bring it back into use first.`);
    return r ?? { cables, notes, audit };
  }
  const faulty = isCoreFaultStatus(core.status);
  const reason = opts.overrideReason?.trim().slice(0, 300) || (faulty ? carriedOverride?.reason : undefined);
  if (faulty && !reason && opts.strict) {
    const last = [...(core.history ?? [])].reverse().find((e) => e.toStatus === core.status);
    return `${name} is marked ${core.status.toLowerCase()}${last ? ` (${last.reason})` : ''}. Choose another fiber, mark it repaired, or say why it is used anyway.`;
  }
  const override = faulty && reason ? (carriedOverride && carriedOverride.reason === reason ? carriedOverride : { status: core.status, reason, at: now.toISOString(), ...(ctx.actor ? { by: ctx.actor } : {}) }) : undefined;
  const assignment: CoreAssignment = {
    id: newFiberId('CA'),
    kind: 'in_use',
    ...odfFeederUse(data, where.odf, where.panel, after, cable),
    equipmentId: where.odf.id,
    odfPortId: portId,
    effectiveFrom: isoDate(now),
    createdAt: now.toISOString(),
    ...(ctx.actor ? { createdBy: ctx.actor } : {}),
    ...(override ? { override } : {}),
  };
  replace(withCore(cable, core.coreNumber, (c) => ({ ...c, status: isCoreConditionStatus(c.status) ? c.status : 'In Use', assignments: [...(c.assignments ?? []), assignment] })));
  audit.push({
    action: 'CORE_ALLOCATED',
    details: `${cable.id} core ${core.coreNumber}: ${assignment.use}, from ${assignment.source}${assignment.destination ? `, to ${assignment.destination}` : ''}`,
    assetId: cable.id,
    assetType: 'Core',
  });
  if (override && override !== carriedOverride) {
    audit.push({ action: 'CORE_OVERRIDE', details: `${cable.id} core ${core.coreNumber} put behind ODF port while marked ${override.status}, by ${ctx.actor ?? 'not recorded'} at ${override.at}. Reason: ${override.reason}`, assetId: cable.id, assetType: 'Core' });
  }
  notes.push(`${name} is now marked in use for ${assignment.use}.`);
  return { cables, notes, audit };
}

/** Combines a fiber-check result with an extra question the command itself asks first. */
function withExtraConfirm<T>(result: CommandResult<T>, question: string | undefined, audit: AuditEntry[] = []): CommandResult<T> {
  if (!result.ok || (!question && audit.length === 0)) return result;
  return {
    ...result,
    audit: [...result.audit, ...audit],
    ...(question ? { confirm: result.confirm ? `${question} ${result.confirm}` : `${question} Save anyway?` } : {}),
  };
}

export interface OdfFeederChoice {
  cableId: string;
  core: number;
  /** Phase 9: why a fiber marked damaged or faulty is put behind this port anyway. */
  overrideReason?: string;
}

/**
 * Records which feeder fiber is terminated behind an ODF adapter, or clears it. Phase 9: the fiber
 * is marked in use for this port (an assignment saying from where and to where), and removing it
 * releases that assignment, keeping it in the fiber's history.
 */
export function setOdfPortFeeder(
  data: NetworkData,
  odfId: string,
  panelId: string,
  portNumber: number,
  feeder: OdfFeederChoice | null,
  ctx: CommandContext = {},
): CommandResult<OdfPort> {
  if (feeder) {
    const cable = data.cables.find((c) => c.id === feeder.cableId);
    if (!cable) return fail('Cable Missing', `Cable ${feeder.cableId} is not on record.`);
    if (!Number.isInteger(feeder.core) || feeder.core < 1 || feeder.core > cable.fiberCount) {
      return fail('Fiber not on cable', `${cable.name} has ${cable.fiberCount} fibers, so fiber ${feeder.core} does not exist.`);
    }
  }
  const result = editOdfPort(data, odfId, panelId, portNumber, (port) => {
    const { feederCableId: _c, feederCore: _k, ...rest } = port;
    const line = feeder ? `Feeder ${feeder.cableId} fiber ${feeder.core} at the back` : `Feeder ${port.feederCableId ?? ''} fiber ${port.feederCore ?? ''} removed`;
    return { ...rest, ...(feeder ? { feederCableId: feeder.cableId, feederCore: feeder.core } : {}), history: [...(port.history ?? []), historyLine(feeder ? 'FEEDER_SET' : 'FEEDER_CLEARED', line, ctx)] };
  });
  if (typeof result === 'string') return fail('Port Missing', result);
  const before = result.panel.ports.find((p) => p.number === portNumber);
  const here = odfPortName(result.odf, result.panel, result.port);
  const followed = followOdfFeeder(data, data.cables, { odf: result.updated, panel: result.panel }, before, result.port, ctx, {
    strict: !!feeder,
    overrideReason: feeder?.overrideReason,
    reason: feeder ? `Fiber at the back of ODF ${here} changed` : `Feeder removed from ODF ${here}`,
  });
  if (typeof followed === 'string') return fail('Fiber not free', `${followed} Nothing was saved.`);
  return checkedFiberChange(
    data,
    { equipment: data.equipment.map((e) => (e.id === odfId ? result.updated : e)), ...(followed.audit.length ? { cables: followed.cables } : {}) },
    result.port,
    {
      notice: notice(
        'success',
        'ODF port saved',
        `${result.odf.name} ${result.panel.label} port ${portNumber}: ${feeder ? `fiber ${feeder.core} of ${feeder.cableId}` : 'no feeder'}.${followed.notes.length ? ` ${followed.notes.join(' ')}` : ''}`,
      ),
      audit: [
        { action: feeder ? 'ODF_FEEDER_SET' : 'ODF_FEEDER_CLEARED', details: `${odfId} ${result.panel.label} port ${portNumber}${feeder ? `: ${feeder.cableId} fiber ${feeder.core}` : ''}`, assetId: odfId, assetType: 'Patch' },
        ...followed.audit,
      ],
    },
    ctx,
  );
}

export interface OdfPatchTarget {
  oltId: string;
  ponPortId: string;
  cordLabel?: string;
  /** Phase 9: the patch cord as recorded: connector at this adapter, connector at the PON port, length. */
  cordConnectorOdf?: string;
  cordConnectorPon?: string;
  cordLengthMeters?: number;
  /** Phase 9: why an adapter marked faulty is patched anyway. Without it a faulty adapter is refused. */
  overrideReason?: string;
}

/** Phase 9: the cord in plain words, such as "cord PC-7, SC/APC to SC/UPC, 3 m". Only what is recorded. */
export function describePatchCord(patch: Partial<Pick<NonNullable<OdfPort['patch']>, 'cordLabel' | 'cordConnectorOdf' | 'cordConnectorPon' | 'cordLengthMeters'>>): string {
  const ends = patch.cordConnectorOdf || patch.cordConnectorPon ? `${patch.cordConnectorOdf ?? 'connector not recorded'} to ${patch.cordConnectorPon ?? 'connector not recorded'}` : undefined;
  const parts = [patch.cordLabel ? `cord ${patch.cordLabel}` : undefined, ends, patch.cordLengthMeters !== undefined ? `${patch.cordLengthMeters} m` : undefined].filter(Boolean);
  return parts.join(', ');
}

/**
 * Patches an OLT PON port to the front of an ODF adapter, or removes the patch. Not a splice.
 * Phase 9: an adapter marked faulty is refused unless the person says why (kept with the patch);
 * a reserved one asks first and ends the reservation; the feeder fiber behind the adapter is
 * marked in use for the PON port, and released again when the patch goes.
 */
export function patchOdfPort(
  data: NetworkData,
  odfId: string,
  panelId: string,
  portNumber: number,
  target: OdfPatchTarget | null,
  ctx: CommandContext = {},
): CommandResult<OdfPort> {
  let olt: Equipment | undefined;
  if (target) {
    olt = data.equipment.find((e) => e.id === target.oltId && e.type === 'OLT');
    if (!olt) return fail('OLT Missing', `OLT ${target.oltId} is not on record.`);
    const ports = olt.ponPorts ?? buildOltPonPorts(olt);
    if (!ports.some((p) => p.id === target.ponPortId)) return fail('PON port missing', `${olt.name} has no port ${target.ponPortId}.`);
    if (!olt.ponPorts) olt = { ...olt, ponPorts: ports };
    if (target.cordLengthMeters !== undefined && !(target.cordLengthMeters > 0 && target.cordLengthMeters <= 500)) {
      return fail('Cord length', 'Write the cord length in metres, more than 0 and up to 500, or leave it empty.', 'warning');
    }
  }
  const now = ctx.now ?? new Date();
  const overrideReason = target?.overrideReason?.trim().slice(0, 300);
  let reservedQuestion: string | undefined;
  const extraAudit: AuditEntry[] = [];
  const result = editOdfPort(data, odfId, panelId, portNumber, (port, odf, panel) => {
    if (target && port.patch) return `This adapter is already patched to ${port.patch.oltId} ${port.patch.ponPortId}. Remove that patch first.`;
    if (!target && !port.patch) return 'This adapter has no patch to remove.';
    if (target && isOdfPortFaulty(port) && !overrideReason) {
      const why = lastOdfPortLine(port, ODF_PORT_MARKS.faulty);
      return `Port ${port.number} is marked faulty${why ? ` (${why.details.replace(/^Marked faulty: /, '')})` : ''}. Use another port, mark it repaired, or say why it is patched anyway.`;
    }
    const { patch: old, ...rest } = port;
    const cord = target ? describePatchCord({ ...target, cordLabel: target.cordLabel?.trim() || undefined }) : old ? describePatchCord(old) : '';
    const line = target ? `Patched to ${target.oltId} ${target.ponPortId}${cord ? ` (${cord})` : ''}` : `Patch to ${old?.oltId} ${old?.ponPortId} removed${cord ? ` (${cord})` : ''}`;
    const lines = [historyLine(target ? 'PATCHED' : 'UNPATCHED', clip(line, 500), ctx)];
    let status = port.status;
    if (target && port.status === 'reserved') {
      const why = lastOdfPortLine(port, ODF_PORT_MARKS.reserved);
      const reservedFor = why ? why.details.replace(/^Reserved: /, '') : 'reason not recorded';
      reservedQuestion = `Port ${port.number} is reserved (${reservedFor}). Patching it ends the reservation.`;
      lines.unshift(historyLine(ODF_PORT_MARKS.reservationEnded, clip(`Reservation (${reservedFor}) ended: patched to ${target.oltId} ${target.ponPortId}`, 500), ctx));
      extraAudit.push({ action: 'ODF_PORT_RESERVATION_ENDED', details: `${odfId} ${panel.label} port ${port.number}: patched to ${target.oltId} ${target.ponPortId}`, assetId: odfId, assetType: 'Patch' });
      status = 'available';
    }
    const override = target && isOdfPortFaulty(port) && overrideReason ? { status: port.status, reason: overrideReason, at: now.toISOString(), ...(ctx.actor ? { by: ctx.actor } : {}) } : undefined;
    if (override) {
      extraAudit.push({ action: 'PATCH_OVERRIDE', details: `${odf.id} ${panel.label} port ${port.number} patched while marked faulty, by ${ctx.actor ?? 'not recorded'} at ${override.at}. Reason: ${override.reason}`, assetId: odf.id, assetType: 'Patch' });
    }
    return {
      ...rest,
      status,
      ...(target
        ? {
            patch: {
              oltId: target.oltId,
              ponPortId: target.ponPortId,
              patchedAt: now.toISOString(),
              ...(ctx.actor ? { patchedBy: ctx.actor } : {}),
              ...(target.cordLabel?.trim() ? { cordLabel: target.cordLabel.trim().slice(0, 60) } : {}),
              ...(target.cordConnectorOdf?.trim() ? { cordConnectorOdf: target.cordConnectorOdf.trim().slice(0, 20) } : {}),
              ...(target.cordConnectorPon?.trim() ? { cordConnectorPon: target.cordConnectorPon.trim().slice(0, 20) } : {}),
              ...(target.cordLengthMeters !== undefined ? { cordLengthMeters: target.cordLengthMeters } : {}),
              ...(override ? { override } : {}),
            },
          }
        : {}),
      history: [...(port.history ?? []), ...lines],
    };
  });
  if (typeof result === 'string') return fail('Patch not saved', result);
  // Keep the cable-level link on the PON port in step, so the older trace still finds its feeder.
  const feederCable = result.port.feederCableId;
  const previous = result.odf.odfPanels?.find((p) => p.id === panelId)?.ports.find((p) => p.number === portNumber)?.patch;
  let equipment = data.equipment.map((e) => (e.id === odfId ? result.updated : e));
  const ponOwner = target?.oltId ?? previous?.oltId;
  const ponId = target?.ponPortId ?? previous?.ponPortId;
  if (ponOwner && ponId && feederCable) {
    equipment = equipment.map((e) => {
      if (e.id !== ponOwner) return e;
      const base = e.id === olt?.id ? olt : e;
      return {
        ...base,
        ponPorts: (base.ponPorts ?? buildOltPonPorts(base)).map((p): PonPort => {
          if (p.id !== ponId) return p;
          if (target && !p.connectedFeederCableId) return { ...p, connectedFeederCableId: feederCable };
          if (!target && p.connectedFeederCableId === feederCable && !p.feederCore) return { ...p, connectedFeederCableId: undefined };
          return p;
        }),
      };
    });
  }
  // Phase 9: the fiber behind the adapter now carries (or no longer carries) this PON port.
  const before = result.panel.ports.find((p) => p.number === portNumber);
  const here = odfPortName(result.odf, result.panel, result.port);
  const followed = followOdfFeeder(data, data.cables, { odf: result.updated, panel: result.panel }, before, result.port, ctx, {
    strict: false,
    reason: target ? `ODF ${here} patched to ${target.oltId} ${target.ponPortId}` : `Patch removed from ODF ${here}`,
  }) as FeederFollow;
  const checked = checkedFiberChange(
    data,
    { equipment, ...(followed.audit.length ? { cables: followed.cables } : {}) },
    result.port,
    {
      notice: notice(
        result.port.patch?.override ? 'warning' : 'success',
        target ? 'Patched' : 'Patch removed',
        `${target ? `${target.oltId} ${target.ponPortId} → ${result.odf.name} ${result.panel.label} port ${portNumber}.` : `${result.odf.name} ${result.panel.label} port ${portNumber} has no patch now. The old patch is in its history.`}${result.port.patch?.override ? ' The port is still marked faulty; your reason is kept.' : ''}${followed.notes.length ? ` ${followed.notes.join(' ')}` : ''}`,
      ),
      audit: [
        { action: target ? 'PATCH_ADDED' : 'PATCH_REMOVED', details: `${odfId} ${result.panel.label} port ${portNumber}${target ? ` ↔ ${target.oltId} ${target.ponPortId}` : ` (was ${previous?.oltId} ${previous?.ponPortId})`}`, assetId: odfId, assetType: 'Patch' },
        ...followed.audit,
      ],
    },
    ctx,
  );
  return withExtraConfirm(checked, reservedQuestion, extraAudit);
}

export type OdfPortMark = 'faulty' | 'repaired' | 'reserved' | 'end_reservation';

/**
 * Phase 9: marks an ODF adapter faulty or reserved, or clears the mark, with the reason in the
 * port's history (never deleted). A faulty port keeps its patch and feeder (it may have gone bad in
 * service); a reserved one must be free. Repairing needs a reason, such as "Adapter replaced".
 */
export function markOdfPort(
  data: NetworkData,
  odfId: string,
  panelId: string,
  portNumber: number,
  mark: OdfPortMark,
  reason: string,
  ctx: CommandContext = {},
): CommandResult<OdfPort> {
  const why = reason.trim().slice(0, 300);
  if (!why && mark !== 'end_reservation') {
    return fail('Say why', mark === 'faulty' ? 'Write what is wrong, such as "Adapter cracked" or "High loss on test".' : mark === 'reserved' ? 'Write what it is kept for, such as "OLT-2 PON 5, next week".' : 'Write what was done, such as "Adapter replaced" or "Cleaned and tested".', 'warning');
  }
  let line: HistoryEntry | undefined;
  let action = '';
  const result = editOdfPort(data, odfId, panelId, portNumber, (port) => {
    if (mark === 'faulty') {
      if (isOdfPortFaulty(port)) return `Port ${port.number} is already marked faulty.`;
      line = historyLine(ODF_PORT_MARKS.faulty, `Marked faulty: ${why}`, ctx);
      action = 'ODF_PORT_FAULTY';
      return { ...port, status: 'damaged', history: [...(port.history ?? []), line] };
    }
    if (mark === 'repaired') {
      if (!isOdfPortFaulty(port)) return `Port ${port.number} is not marked faulty.`;
      line = historyLine(ODF_PORT_MARKS.repaired, `Repaired: ${why}`, ctx);
      action = 'ODF_PORT_REPAIRED';
      return { ...port, status: 'available', history: [...(port.history ?? []), line] };
    }
    if (mark === 'reserved') {
      if (port.status === 'reserved') return `Port ${port.number} is already reserved.`;
      if (isOdfPortFaulty(port)) return `Port ${port.number} is marked faulty. Mark it repaired first, or reserve another port.`;
      if (port.patch) return `Port ${port.number} is in use (patched to ${port.patch.oltId} ${port.patch.ponPortId}), so it cannot be kept for something else.`;
      line = historyLine(ODF_PORT_MARKS.reserved, `Reserved: ${why}`, ctx);
      action = 'ODF_PORT_RESERVED';
      return { ...port, status: 'reserved', history: [...(port.history ?? []), line] };
    }
    if (port.status !== 'reserved') return `Port ${port.number} is not reserved.`;
    line = historyLine(ODF_PORT_MARKS.reservationEnded, `Reservation ended${why ? `: ${why}` : ''}`, ctx);
    action = 'ODF_PORT_RESERVATION_ENDED';
    return { ...port, status: 'available', history: [...(port.history ?? []), line] };
  });
  if (typeof result === 'string') return fail('Not saved', result, 'warning');
  const titles: Record<OdfPortMark, string> = { faulty: 'Port marked faulty', repaired: 'Port marked repaired', reserved: 'Port reserved', end_reservation: 'Reservation ended' };
  return succeed(result.port, { equipment: data.equipment.map((e) => (e.id === odfId ? result.updated : e)) }, {
    notice: notice(mark === 'faulty' ? 'warning' : 'success', titles[mark], `${odfPortName(result.odf, result.panel, result.port)}: ${line!.details}.${mark === 'faulty' && result.port.patch ? ' Its patch stays recorded.' : ''}`),
    audit: [{ action, details: `${odfId} ${result.panel.label} port ${portNumber}: ${line!.details}`, assetId: odfId, assetType: 'Patch' }],
  });
}

export interface OdfPortDetails {
  label?: string;
  connectorType?: string;
  notes?: string;
  /** The pigtail at the back. `null` clears it. */
  pigtail?: { connectorType?: string; lengthMeters?: number; label?: string; notes?: string } | null;
  /** The patch cord in front. Only for a patched port. */
  cord?: { cordLabel?: string; cordConnectorOdf?: string; cordConnectorPon?: string; cordLengthMeters?: number };
}

/** Removes empty strings and undefined, so a cleared field is not stored. */
function presentOnly<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined && !(typeof v === 'string' && v.trim() === '')).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v])) as Partial<T>;
}

/** Phase 9: saves what is written on an adapter, its pigtail and its patch cord. Nothing is filled in. */
export function saveOdfPortDetails(data: NetworkData, odfId: string, panelId: string, portNumber: number, details: OdfPortDetails, ctx: CommandContext = {}): CommandResult<OdfPort> {
  const badLength = (n: number | undefined, max: number) => n !== undefined && !(Number.isFinite(n) && n > 0 && n <= max);
  if (details.pigtail && badLength(details.pigtail.lengthMeters, 100)) return fail('Pigtail length', 'Write the pigtail length in metres, more than 0 and up to 100, or leave it empty.', 'warning');
  if (details.cord && badLength(details.cord.cordLengthMeters, 500)) return fail('Cord length', 'Write the cord length in metres, more than 0 and up to 500, or leave it empty.', 'warning');
  const changed: string[] = [];
  const result = editOdfPort(data, odfId, panelId, portNumber, (port) => {
    if (details.cord && !port.patch) return `Port ${port.number} has no patch cord. Record the patch first.`;
    let next: OdfPort = { ...port };
    for (const key of ['label', 'connectorType', 'notes'] as const) {
      if (!(key in details)) continue;
      const max = key === 'notes' ? 500 : key === 'label' ? 40 : 20;
      const value = details[key]?.trim().slice(0, max);
      const { [key]: _old, ...rest } = next;
      next = value ? { ...rest, [key]: value } : (rest as OdfPort);
      changed.push(key === 'connectorType' ? 'adapter connector' : key);
    }
    if ('pigtail' in details) {
      const { pigtail: _p, ...rest } = next;
      const pig = details.pigtail ? presentOnly(details.pigtail) : {};
      if (pig.connectorType) pig.connectorType = pig.connectorType.slice(0, 20);
      if (pig.label) pig.label = pig.label.slice(0, 60);
      if (pig.notes) pig.notes = pig.notes.slice(0, 300);
      next = Object.keys(pig).length ? { ...rest, pigtail: pig } : (rest as OdfPort);
      changed.push('pigtail');
    }
    if (details.cord && port.patch) {
      const { cordLabel: _a, cordConnectorOdf: _b, cordConnectorPon: _c, cordLengthMeters: _d, ...base } = port.patch;
      const cord = presentOnly(details.cord);
      next = { ...next, patch: { ...base, ...cord } };
      changed.push('patch cord');
    }
    const text = changed.length ? `Details saved: ${changed.join(', ')}` : 'Details saved';
    return { ...next, history: [...(port.history ?? []), historyLine('DETAILS_SAVED', text, ctx)] };
  });
  if (typeof result === 'string') return fail('Not saved', result, 'warning');
  return checkedFiberChange(
    data,
    { equipment: data.equipment.map((e) => (e.id === odfId ? result.updated : e)) },
    result.port,
    {
      notice: notice('success', 'Port details saved', `${odfPortName(result.odf, result.panel, result.port)}: ${changed.join(', ') || 'nothing changed'}.`),
      audit: [{ action: 'ODF_PORT_DETAILS', details: `${odfId} ${result.panel.label} port ${portNumber}: ${changed.join(', ')}`, assetId: odfId, assetType: 'Patch' }],
    },
    ctx,
  );
}

/** Phase 9: how many adapters on an ODF are patched, fed, faulty, reserved and free. Counted from the ports. */
export function odfPortCounts(odf: Pick<Equipment, 'odfPanels'>): { total: number; patched: number; fed: number; faulty: number; reserved: number; free: number } {
  const ports = (odf.odfPanels ?? []).flatMap((p) => p.ports);
  const faulty = ports.filter(isOdfPortFaulty).length;
  const reserved = ports.filter((p) => p.status === 'reserved').length;
  return {
    total: ports.length,
    patched: ports.filter((p) => p.patch).length,
    fed: ports.filter((p) => p.feederCableId).length,
    faulty,
    reserved,
    free: ports.filter((p) => !p.patch && !p.feederCableId && !isOdfPortFaulty(p) && p.status !== 'reserved').length,
  };
}

/* ------------------------------------------------------------------ */
/* PON port details                                                    */
/* ------------------------------------------------------------------ */

export type PonPortDetails = Partial<
  Pick<
    PonPort,
    | 'vendorAddress'
    | 'addressParts'
    | 'technology'
    | 'opticsClass'
    | 'opticsClassSource'
    | 'vendorBudgetDb'
    | 'vendorBudgetSource'
    | 'maxOnu'
    | 'adminStatus'
    | 'connectedFeederCableId'
    | 'feederCore'
    | 'txPowerDbm'
  >
>;

/** Saves what a person recorded about one PON port. The vendor's address is kept exactly as typed. */
export function updatePonPort(data: NetworkData, oltId: string, ponPortId: string, details: PonPortDetails, ctx: CommandContext = {}): CommandResult<PonPort> {
  const olt = data.equipment.find((e) => e.id === oltId);
  if (!olt || olt.type !== 'OLT') return fail('OLT Missing', `OLT ${oltId} was not found.`);
  const ports = olt.ponPorts ?? buildOltPonPorts(olt);
  const port = ports.find((p) => p.id === ponPortId);
  if (!port) return fail('PON port missing', `${olt.name} has no port ${ponPortId}.`);
  if (details.feederCore !== undefined) {
    const cableId = details.connectedFeederCableId ?? port.connectedFeederCableId;
    if (!cableId) return fail('Cable needed', 'Choose the feeder cable before its fiber.');
    const cable = data.cables.find((c) => c.id === cableId);
    if (!cable) return fail('Cable Missing', `Cable ${cableId} is not on record.`);
    if (details.feederCore > cable.fiberCount || details.feederCore < 1) return fail('Fiber not on cable', `${cable.name} has ${cable.fiberCount} fibers.`);
  }
  if (details.connectedFeederCableId && details.connectedFeederCableId !== port.connectedFeederCableId) {
    const other = data.equipment
      .flatMap((e) => (e.ponPorts ?? []).map((p) => ({ e, p })))
      .find(({ e, p }) => p.connectedFeederCableId === details.connectedFeederCableId && !(e.id === oltId && p.id === ponPortId) && p.feederCore === (details.feederCore ?? port.feederCore));
    if (other && other.p.feederCore !== undefined) {
      return fail('Fiber in use', `${other.e.name} ${other.p.id} already drives that fiber.`);
    }
  }
  const updatedPort: PonPort = { ...port, ...details };
  for (const key of Object.keys(details) as (keyof PonPortDetails)[]) {
    if (details[key] === undefined || details[key] === '') delete (updatedPort as Partial<PonPort>)[key];
  }
  const updated: Equipment = { ...olt, ponPorts: ports.map((p) => (p.id === ponPortId ? updatedPort : p)) };
  return checkedFiberChange(
    data,
    { equipment: data.equipment.map((e) => (e.id === oltId ? updated : e)) },
    updatedPort,
    {
      notice: notice('success', 'PON port saved', `${olt.name} ${ponPortId} details saved.`),
      audit: [{ action: 'PON_PORT_UPDATED', details: `${oltId} ${ponPortId}: ${Object.keys(details).join(', ')}`, assetId: oltId, assetType: 'Equipment' }],
    },
    ctx,
  );
}

/* ------------------------------------------------------------------ */
/* Splitters                                                           */
/* ------------------------------------------------------------------ */

/**
 * What feeds a splitter's input: one fiber, or one output of another splitter in the same box.
 * Phase 11: `overrideReason` says why an output marked faulty is used anyway; without it a faulty
 * output is refused.
 */
export type SplitterInput = { cableId: string; core: number } | { splitterId: string; port: number; overrideReason?: string };

/** Phase 11: the port record of one output, or a new one when the splitter has none for it yet. */
const outputPortOf = (sp: Splitter, n: number): SplitterPort =>
  sp.outputPorts.find((p) => p.portNumber === n) ?? { portNumber: n, label: `OUT-${String(n).padStart(2, '0')}`, status: 'Available' };

const withOutputPort = (sp: Splitter, port: SplitterPort): Splitter => {
  const exists = sp.outputPorts.some((p) => p.portNumber === port.portNumber);
  return {
    ...sp,
    outputPorts: exists ? sp.outputPorts.map((p) => (p.portNumber === port.portNumber ? port : p)) : [...sp.outputPorts, port].sort((a, b) => a.portNumber - b.portNumber),
  };
};

/** Active customers whose own record names this splitter output. */
const customersOnOutput = (data: NetworkData, splitterId: string, n: number) =>
  data.customers.filter((c) => c.status !== 'Disconnected' && c.splitterId === splitterId && c.splitterOutputPort === n);

/** Splitters whose input hangs straight on this output (a cascade in one box). */
const cascadeOnOutput = (data: NetworkData, splitterId: string, n: number, except?: string) =>
  data.splitters.filter((s) => s.id !== except && s.inputPort.connectedSplitterId === splitterId && s.inputPort.connectedSplitterPort === n);

const outputOverride = (port: SplitterPort, reason: string, ctx: CommandContext, now: Date): NonNullable<SplitterPort['override']> => ({
  status: port.status,
  reason,
  at: now.toISOString(),
  ...(ctx.actor ? { by: ctx.actor } : {}),
});

const faultyOutputRefusal = (sp: Splitter, port: SplitterPort) =>
  fail(
    'Output faulty',
    `Output ${port.portNumber} of ${sp.name} is marked faulty (${splitterOutputReason(port)}). Use another output, mark it repaired, or say why it is used anyway.`,
    'warning',
  );

/** Links a splitter's input to the exact fiber or upstream splitter output that feeds it, or clears it. */
export function linkSplitterInput(data: NetworkData, splitterId: string, input: SplitterInput | null, ctx: CommandContext = {}): CommandResult<Splitter> {
  const splitter = data.splitters.find((s) => s.id === splitterId);
  if (!splitter) return fail('Splitter Missing', `Splitter ${splitterId} was not found.`);
  if (input && 'cableId' in input) {
    const cable = data.cables.find((c) => c.id === input.cableId);
    if (!cable) return fail('Cable Missing', `Cable ${input.cableId} is not on record.`);
    if (!Number.isInteger(input.core) || input.core < 1 || input.core > cable.fiberCount) {
      return fail('Fiber not on cable', `${cable.name} has ${cable.fiberCount} fibers, so fiber ${input.core} does not exist.`);
    }
  }
  const now = ctx.now ?? new Date();
  const was = splitter.inputPort;
  const overrideReason = input && 'splitterId' in input ? input.overrideReason?.trim().slice(0, 300) : undefined;
  const sameLink = !!input && 'splitterId' in input && was.connectedSplitterId === input.splitterId && was.connectedSplitterPort === input.port;
  let reservedQuestion: string | undefined;
  const extraAudit: AuditEntry[] = [];
  if (input && 'splitterId' in input) {
    const parent = data.splitters.find((s) => s.id === input.splitterId);
    if (!parent) return fail('Splitter Missing', `Splitter ${input.splitterId} was not found.`);
    if (parent.id === splitter.id) return fail('Not possible', 'A splitter cannot feed itself.');
    if (input.port < 1 || input.port > splitterCapacity(parent)) return fail('No such output', `${parent.name} has ${splitterCapacity(parent)} outputs.`);
    const out = parent.outputPorts.find((p) => p.portNumber === input.port);
    if (out?.connectedCustomerId) return fail('Output in use', `Output ${input.port} of ${parent.name} already serves ${out.connectedCustomerName ?? out.connectedCustomerId}.`);
    // Phase 11: a customer whose own record names the output, a drop fiber on it, or a faulty mark.
    const onIt = customersOnOutput(data, parent.id, input.port);
    if (onIt.length > 0) return fail('Output in use', `Output ${input.port} of ${parent.name} already serves ${onIt.map((c) => c.name).join(', ')}.`);
    if (out?.connectedDropCableId) return fail('Output in use', `Output ${input.port} of ${parent.name} already goes to ${out.connectedDropCableId}${out.connectedCore ? ` fiber ${out.connectedCore}` : ''}. Free it first.`);
    if (out?.status === 'Faulty' && !sameLink && !overrideReason) return faultyOutputRefusal(parent, out);
  }
  const { connectedCableId: _c, connectedCore: _k, connectedSplitterId: _s, connectedSplitterPort: _p, linkedAt: _a, linkedBy: _b, ...restInput } = was;
  const inputPort: Splitter['inputPort'] = {
    ...restInput,
    ...(input && 'cableId' in input ? { connectedCableId: input.cableId, connectedCore: input.core } : {}),
    ...(input && 'splitterId' in input ? { connectedSplitterId: input.splitterId, connectedSplitterPort: input.port } : {}),
    ...(input ? { linkedAt: now.toISOString(), ...(ctx.actor ? { linkedBy: ctx.actor } : {}) } : {}),
  };
  const text = !input ? 'not linked' : 'cableId' in input ? `fiber ${input.core} of ${input.cableId}` : `output ${input.port} of splitter ${input.splitterId}`;
  const updated: Splitter = { ...splitter, inputPort, history: [...(splitter.history ?? []), historyLine(input ? 'INPUT_LINKED' : 'INPUT_CLEARED', `Input: ${text}`, ctx)] };
  let splitters = data.splitters.map((s) => (s.id === splitterId ? updated : s));
  const editOutput = (spId: string, n: number, fn: (p: SplitterPort, sp: Splitter) => SplitterPort, create: boolean) => {
    splitters = splitters.map((s) => (s.id === spId && (create || s.outputPorts.some((p) => p.portNumber === n)) ? withOutputPort(s, fn(outputPortOf(s, n), s)) : s));
  };
  // The output it hung on before is free again, unless something else is on it. A faulty mark stays.
  if (was.connectedSplitterId && was.connectedSplitterPort && !sameLink) {
    const n = was.connectedSplitterPort;
    editOutput(
      was.connectedSplitterId,
      n,
      (p) => {
        const { override: _o, ...rest } = p;
        const stillUsed = !!p.connectedCustomerId || !!p.connectedDropCableId || cascadeOnOutput(data, was.connectedSplitterId!, n, splitterId).length > 0;
        return {
          ...rest,
          status: p.status === 'Faulty' ? 'Faulty' : stillUsed ? p.status : 'Available',
          history: [...(p.history ?? []), historyLine('CASCADE_REMOVED', `No longer feeds splitter ${splitter.name}`, ctx)],
        };
      },
      false,
    );
  }
  // A parent output used for a cascade is no longer free. Phase 11: a faulty one keeps its mark and the reason given.
  if (input && 'splitterId' in input && !sameLink) {
    editOutput(
      input.splitterId,
      input.port,
      (p, parent) => {
        const lines = [historyLine('CASCADE_LINKED', `Feeds splitter ${splitter.name}`, ctx)];
        let status: SplitterPort['status'] = 'Occupied';
        let override: SplitterPort['override'];
        if (p.status === 'Faulty') {
          status = 'Faulty';
          override = outputOverride(p, overrideReason!, ctx, now);
          extraAudit.push({
            action: 'SPLITTER_OUTPUT_OVERRIDE',
            details: `${parent.id} output ${p.portNumber} used for splitter ${splitter.id} while marked faulty, by ${ctx.actor ?? 'not recorded'} at ${override.at}. Reason: ${override.reason}`,
            assetId: parent.id,
            assetType: 'Splitter',
          });
        } else if (p.status === 'Reserved') {
          const why = splitterOutputReason(p);
          reservedQuestion = `Output ${p.portNumber} of ${parent.name} is reserved (${why}). Using it ends the reservation.`;
          lines.unshift(historyLine(SPLITTER_OUTPUT_MARKS.reservationEnded, clip(`Reservation (${why}) ended: feeds splitter ${splitter.name}`, 500), ctx));
          extraAudit.push({ action: 'SPLITTER_OUTPUT_RESERVATION_ENDED', details: `${parent.id} output ${p.portNumber}: feeds splitter ${splitter.id}`, assetId: parent.id, assetType: 'Splitter' });
        }
        const { override: _o, ...rest } = p;
        return { ...rest, status, connectedAt: now.toISOString(), ...(override ? { override } : {}), history: [...(p.history ?? []), ...lines] };
      },
      true,
    );
  }
  const overridden = extraAudit.some((a) => a.action === 'SPLITTER_OUTPUT_OVERRIDE');
  const checked = checkedFiberChange(
    data,
    { splitters },
    updated,
    {
      notice: notice(overridden ? 'warning' : 'success', 'Splitter input saved', `${splitter.name} input: ${text}.${overridden ? ' That output is still marked faulty; your reason is kept.' : ''}`),
      audit: [{ action: input ? 'SPLITTER_INPUT_LINKED' : 'SPLITTER_INPUT_CLEARED', details: `${splitter.id} input ${text}`, assetId: splitter.id, assetType: 'Splitter' }],
    },
    ctx,
  );
  return withExtraConfirm(checked, reservedQuestion, extraAudit);
}

/** Where a splitter output goes: one fiber of a lead or drop cable. */
export interface SplitterOutputTarget {
  cableId: string;
  core: number;
  equipmentId?: string;
  /** Phase 11: why an output marked faulty is connected anyway. Without it a faulty output is refused. */
  overrideReason?: string;
}

/**
 * Connects one splitter output to a cable fiber (a lead or drop cable), or frees it. Phase 11: a
 * faulty output needs a reason (kept on the port and in the audit trail) and keeps its faulty mark;
 * a reserved one asks first and ends the reservation; freeing a faulty output keeps it faulty.
 */
export function connectSplitterOutput(
  data: NetworkData,
  splitterId: string,
  portNumber: number,
  target: SplitterOutputTarget | null,
  ctx: CommandContext = {},
): CommandResult<Splitter> {
  const splitter = data.splitters.find((s) => s.id === splitterId);
  if (!splitter) return fail('Splitter Missing', `Splitter ${splitterId} was not found.`);
  const n = splitterCapacity(splitter);
  if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > n) {
    return fail('No such output', `${splitter.name} is ${splitter.ratio}: it has ${n} outputs, so output ${portNumber} would overflow it.`);
  }
  const port = outputPortOf(splitter, portNumber);
  const now = ctx.now ?? new Date();
  const overrideReason = target?.overrideReason?.trim().slice(0, 300);
  const cascade = cascadeOnOutput(data, splitterId, portNumber);
  const lines: HistoryEntry[] = [];
  const extraAudit: AuditEntry[] = [];
  let reservedQuestion: string | undefined;
  let override: SplitterPort['override'];
  if (target) {
    const cable = data.cables.find((c) => c.id === target.cableId);
    if (!cable) return fail('Cable Missing', `Cable ${target.cableId} is not on record.`);
    if (!Number.isInteger(target.core) || target.core < 1 || target.core > cable.fiberCount) {
      return fail('Fiber not on cable', `${cable.name} has ${cable.fiberCount} fibers, so fiber ${target.core} does not exist.`);
    }
    if (port.connectedDropCableId || port.status === 'Occupied') {
      return fail('Output in use', `Output ${portNumber} of ${splitter.name} is already connected${port.connectedDropCableId ? ` to ${port.connectedDropCableId}` : ''}. Free it first.`);
    }
    if (cascade.length > 0) return fail('Output in use', `Output ${portNumber} of ${splitter.name} already feeds splitter ${cascade.map((s) => s.name).join(', ')}.`);
    if (port.status === 'Faulty') {
      if (!overrideReason) return faultyOutputRefusal(splitter, port);
      override = outputOverride(port, overrideReason, ctx, now);
      extraAudit.push({
        action: 'SPLITTER_OUTPUT_OVERRIDE',
        details: `${splitter.id} output ${portNumber} connected to ${target.cableId} fiber ${target.core} while marked faulty, by ${ctx.actor ?? 'not recorded'} at ${override.at}. Reason: ${override.reason}`,
        assetId: splitter.id,
        assetType: 'Splitter',
      });
    }
    if (port.status === 'Reserved') {
      const why = splitterOutputReason(port);
      reservedQuestion = `Output ${portNumber} of ${splitter.name} is reserved (${why}). Connecting it ends the reservation.`;
      lines.push(historyLine(SPLITTER_OUTPUT_MARKS.reservationEnded, clip(`Reservation (${why}) ended: connected to ${target.cableId} fiber ${target.core}`, 500), ctx));
      extraAudit.push({ action: 'SPLITTER_OUTPUT_RESERVATION_ENDED', details: `${splitter.id} output ${portNumber}: connected to ${target.cableId} fiber ${target.core}`, assetId: splitter.id, assetType: 'Splitter' });
    }
  } else if (port.connectedCustomerId) {
    return fail('Customer on this output', `Output ${portNumber} serves ${port.connectedCustomerName ?? port.connectedCustomerId}. Move the customer first.`);
  }
  const { connectedDropCableId: _d, connectedCore: _k, connectedEquipmentId: _e, connectedAt: _a, override: _o, ...rest } = port;
  const line = target
    ? `Output ${portNumber} → ${target.cableId} fiber ${target.core}${override ? ` (marked faulty; used because: ${override.reason})` : ''}`
    : `Output ${portNumber} freed (was ${port.connectedDropCableId ?? 'nothing'} fiber ${port.connectedCore ?? '?'})`;
  const freedStatus: SplitterPort['status'] = port.status === 'Faulty' ? 'Faulty' : cascade.length > 0 ? 'Occupied' : 'Available';
  const nextPort: SplitterPort = {
    ...rest,
    status: target ? (port.status === 'Faulty' ? 'Faulty' : 'Occupied') : freedStatus,
    ...(target ? { connectedDropCableId: target.cableId, connectedCore: target.core, connectedAt: now.toISOString(), ...(target.equipmentId ? { connectedEquipmentId: target.equipmentId } : {}) } : {}),
    ...(override ? { override } : {}),
    history: [...(port.history ?? []), ...lines, historyLine(target ? 'OUTPUT_CONNECTED' : 'OUTPUT_FREED', clip(line, 500), ctx)],
  };
  const updated = withOutputPort(splitter, nextPort);
  const checked = checkedFiberChange(
    data,
    { splitters: data.splitters.map((s) => (s.id === splitterId ? updated : s)) },
    updated,
    {
      notice: notice(
        override ? 'warning' : 'success',
        target ? 'Output connected' : 'Output freed',
        `${splitter.name}: ${line}.${override ? ' The output is still marked faulty; your reason is kept.' : ''}${!target && port.status === 'Faulty' ? ' It stays marked faulty.' : ''}`,
      ),
      audit: [{ action: target ? 'SPLITTER_OUTPUT_CONNECTED' : 'SPLITTER_OUTPUT_FREED', details: `${splitter.id}: ${line}`, assetId: splitter.id, assetType: 'Splitter' }],
    },
    ctx,
  );
  return withExtraConfirm(checked, reservedQuestion, extraAudit);
}

export type SplitterDetails = Partial<Pick<Splitter, 'kind' | 'manufacturer' | 'model' | 'insertionLossDb' | 'lossSource' | 'name' | 'status'>> & {
  /** Per-output loss, for unequal couplers. */
  portLossDb?: Record<number, number | undefined>;
};

/** Saves a splitter's make, type and loss. A loss below what physics allows is refused. */
export function saveSplitterDetails(data: NetworkData, splitterId: string, details: SplitterDetails, ctx: CommandContext = {}): CommandResult<Splitter> {
  const splitter = data.splitters.find((s) => s.id === splitterId);
  if (!splitter) return fail('Splitter Missing', `Splitter ${splitterId} was not found.`);
  const { portLossDb, ...fields } = details;
  const updated: Splitter = {
    ...splitter,
    ...fields,
    outputPorts: portLossDb
      ? splitter.outputPorts.map((p) => {
          if (!(p.portNumber in portLossDb)) return p;
          const value = portLossDb[p.portNumber];
          const { lossDb: _l, ...rest } = p;
          return value === undefined ? rest : { ...rest, lossDb: value };
        })
      : splitter.outputPorts,
    history: [...(splitter.history ?? []), historyLine('DETAILS_SAVED', Object.keys(details).join(', '), ctx)],
  };
  return checkedFiberChange(
    data,
    { splitters: data.splitters.map((s) => (s.id === splitterId ? updated : s)) },
    updated,
    {
      notice: notice('success', 'Splitter saved', `${updated.name} details saved.`),
      audit: [{ action: 'SPLITTER_UPDATED', details: `${splitter.id}: ${Object.keys(details).join(', ')}`, assetId: splitter.id, assetType: 'Splitter' }],
    },
    ctx,
  );
}

export type SplitterOutputMark = 'faulty' | 'repaired' | 'reserved' | 'end_reservation';

/**
 * Phase 11: marks one splitter output faulty or reserved, or clears the mark, with the reason in the
 * port's history (never deleted). A faulty output keeps what is connected to it (it may have gone
 * bad in service); a reserved one must have nothing on it. Repairing needs a reason too.
 */
export function markSplitterOutput(
  data: NetworkData,
  splitterId: string,
  portNumber: number,
  mark: SplitterOutputMark,
  reason: string,
  ctx: CommandContext = {},
): CommandResult<SplitterPort> {
  const splitter = data.splitters.find((s) => s.id === splitterId);
  if (!splitter) return fail('Splitter Missing', `Splitter ${splitterId} was not found.`);
  const n = splitterCapacity(splitter);
  if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > n) return fail('No such output', `${splitter.name} is ${splitter.ratio}: it has ${n} outputs.`);
  const why = reason.trim().slice(0, 300);
  if (!why && mark !== 'end_reservation') {
    return fail(
      'Say why',
      mark === 'faulty'
        ? 'Write what is wrong, such as "No light on this output" or "Connector broken".'
        : mark === 'reserved'
          ? 'Write what it is kept for, such as "New building, block B".'
          : 'Write what was done, such as "Connector replaced" or "Cleaned and tested".',
      'warning',
    );
  }
  const port = outputPortOf(splitter, portNumber);
  const customers = customersOnOutput(data, splitterId, portNumber);
  const cascade = cascadeOnOutput(data, splitterId, portNumber);
  const onIt = [
    ...customers.map((c) => `customer ${c.name}`),
    ...(port.connectedCustomerId && !customers.some((c) => c.id === port.connectedCustomerId) ? [`customer ${port.connectedCustomerName ?? port.connectedCustomerId}`] : []),
    ...(port.connectedDropCableId ? [`${port.connectedDropCableId}${port.connectedCore ? ` fiber ${port.connectedCore}` : ''}`] : []),
    ...cascade.map((s) => `splitter ${s.name}`),
  ];
  const here = `Output ${portNumber} of ${splitter.name}`;
  let line: HistoryEntry;
  let action: string;
  let next: SplitterPort;
  if (mark === 'faulty') {
    if (port.status === 'Faulty') return fail('Not saved', `${here} is already marked faulty.`, 'warning');
    line = historyLine(SPLITTER_OUTPUT_MARKS.faulty, `Marked faulty: ${why}`, ctx);
    action = 'SPLITTER_OUTPUT_FAULTY';
    next = { ...port, status: 'Faulty', history: [...(port.history ?? []), line] };
  } else if (mark === 'repaired') {
    if (port.status !== 'Faulty') return fail('Not saved', `${here} is not marked faulty.`, 'warning');
    line = historyLine(SPLITTER_OUTPUT_MARKS.repaired, `Repaired: ${why}`, ctx);
    action = 'SPLITTER_OUTPUT_REPAIRED';
    const { override: _o, ...rest } = port;
    next = { ...rest, status: onIt.length > 0 ? 'Occupied' : 'Available', history: [...(port.history ?? []), line] };
  } else if (mark === 'reserved') {
    if (port.status === 'Reserved') return fail('Not saved', `${here} is already reserved.`, 'warning');
    if (port.status === 'Faulty') return fail('Not saved', `${here} is marked faulty. Mark it repaired first, or reserve another output.`, 'warning');
    if (onIt.length > 0 || port.status === 'Occupied') {
      return fail('Not saved', `${here} is in use${onIt.length ? ` (${onIt.join(', ')})` : ''}, so it cannot be kept for something else.`, 'warning');
    }
    line = historyLine(SPLITTER_OUTPUT_MARKS.reserved, `Reserved: ${why}`, ctx);
    action = 'SPLITTER_OUTPUT_RESERVED';
    next = { ...port, status: 'Reserved', history: [...(port.history ?? []), line] };
  } else {
    if (port.status !== 'Reserved') return fail('Not saved', `${here} is not reserved.`, 'warning');
    line = historyLine(SPLITTER_OUTPUT_MARKS.reservationEnded, `Reservation ended${why ? `: ${why}` : ''}`, ctx);
    action = 'SPLITTER_OUTPUT_RESERVATION_ENDED';
    next = { ...port, status: 'Available', history: [...(port.history ?? []), line] };
  }
  const updated = withOutputPort(splitter, next);
  const titles: Record<SplitterOutputMark, string> = { faulty: 'Output marked faulty', repaired: 'Output marked repaired', reserved: 'Output reserved', end_reservation: 'Reservation ended' };
  return checkedFiberChange(
    data,
    { splitters: data.splitters.map((s) => (s.id === splitterId ? updated : s)) },
    next,
    {
      notice: notice(
        mark === 'faulty' ? 'warning' : 'success',
        titles[mark],
        `${here}: ${line.details}.${mark === 'faulty' && onIt.length > 0 ? ` Still recorded on it: ${onIt.join(', ')}. Check them.` : ''}`,
      ),
      audit: [{ action, details: `${splitter.id} output ${portNumber}: ${line.details}`, assetId: splitter.id, assetType: 'Splitter' }],
    },
    ctx,
  );
}

export interface SplitterArchitectureDraft {
  value: SplitterArchitecture;
  /** Splitter level from the PON port (1 is the first splitter), when the person knows it. */
  level?: number;
  /** How the person knows, such as "Seen on site". Required. */
  reason: string;
}

/**
 * Phase 11: records what a person knows about a splitter's place (centralised or distributed, and
 * its level), with the reason, or removes it (`null`). The worked-out answer from the records is
 * never changed and is shown beside it; when the two differ the person is asked first.
 */
export function recordSplitterArchitecture(data: NetworkData, splitterId: string, draft: SplitterArchitectureDraft | null, ctx: CommandContext = {}): CommandResult<Splitter> {
  const splitter = data.splitters.find((s) => s.id === splitterId);
  if (!splitter) return fail('Splitter Missing', `Splitter ${splitterId} was not found.`);
  const now = ctx.now ?? new Date();
  let recorded: Splitter['architecture'];
  let question: string | undefined;
  if (draft) {
    const reason = draft.reason.trim().slice(0, 300);
    if (!reason) return fail('Say why', 'Write how you know, such as "Seen on site: one 1:32 in the cabinet, nothing in the boxes".', 'warning');
    if (!(SPLITTER_ARCHITECTURES as readonly string[]).includes(draft.value)) return fail('Not saved', 'Choose centralised or distributed.', 'warning');
    if (draft.level !== undefined && (!Number.isInteger(draft.level) || draft.level < 1 || draft.level > 20)) {
      return fail('Level', 'Write the level as a whole number from 1 (the first splitter after the PON port) to 20, or leave it empty.', 'warning');
    }
    if (draft.value === 'centralised' && draft.level !== undefined && draft.level > 1) {
      return fail('Not possible', 'A centralised tree has only one splitter level, so a splitter on it is level 1.');
    }
    recorded = { value: draft.value, ...(draft.level !== undefined ? { level: draft.level } : {}), reason, at: now.toISOString(), ...(ctx.actor ? { by: ctx.actor } : {}) };
    const place = splitterPlace(fiberDataOf(data), splitterId, { settings: ctx.optical ?? DEFAULT_OPTICAL_SETTINGS });
    const worked = place?.suggestion.architecture;
    const clash = [
      worked && worked !== draft.value ? `The records show it as ${SPLITTER_ARCHITECTURE_LABELS[worked].toLowerCase()}` : undefined,
      draft.level !== undefined && place?.level !== undefined && draft.level !== place.level ? `the records put it at level ${place.level}` : undefined,
    ].filter(Boolean);
    if (clash.length) question = `${cap(clash.join(', and '))}. Your answer is kept beside it, with your reason.`;
  } else if (!splitter.architecture) {
    return fail('Nothing to remove', `${splitter.name} has no recorded answer.`, 'warning');
  }
  const label = (a: NonNullable<Splitter['architecture']>) => `${SPLITTER_ARCHITECTURE_LABELS[a.value].toLowerCase()}${a.level !== undefined ? `, level ${a.level}` : ''}`;
  const text = recorded ? `Recorded as ${label(recorded)}: ${recorded.reason}` : `Recorded answer removed (was ${label(splitter.architecture!)})`;
  const { architecture: _old, ...rest } = splitter;
  const updated: Splitter = {
    ...rest,
    ...(recorded ? { architecture: recorded } : {}),
    history: [...(splitter.history ?? []), historyLine(recorded ? 'ARCHITECTURE_RECORDED' : 'ARCHITECTURE_CLEARED', clip(text, 500), ctx)],
  };
  const checked = checkedFiberChange(
    data,
    { splitters: data.splitters.map((s) => (s.id === splitterId ? updated : s)) },
    updated,
    {
      notice: notice(question ? 'warning' : 'success', recorded ? 'Arrangement recorded' : 'Recorded answer removed', `${splitter.name}: ${text}.`),
      audit: [{ action: recorded ? 'SPLITTER_ARCHITECTURE_RECORDED' : 'SPLITTER_ARCHITECTURE_CLEARED', details: `${splitter.id}: ${text}`, assetId: splitter.id, assetType: 'Splitter' }],
    },
    ctx,
  );
  return withExtraConfirm(checked, question);
}

/* ------------------------------------------------------------------ */
/* Delete cascades                                                     */
/* ------------------------------------------------------------------ */

export interface FiberCascade {
  equipment?: Equipment[];
  splitters?: Splitter[];
  closures?: JointClosure[];
  /** Phase 9: fibers whose ODF assignment was released or changed. */
  cables?: Cable[];
  summary: string;
}

/** Fiber links that name a cable being deleted: ODF rear, PON direct feeder, splitter outputs. */
export function fiberCascadeForCable(data: NetworkData, cableId: string, base: Equipment[] = data.equipment): FiberCascade {
  const notes: string[] = [];
  let odfPorts = 0;
  const equipment = base.map((e) => {
    let changed = false;
    const odfPanels = e.odfPanels?.map((panel) => ({
      ...panel,
      ports: panel.ports.map((port) => {
        if (port.feederCableId !== cableId) return port;
        changed = true;
        odfPorts += 1;
        const { feederCableId: _c, feederCore: _k, ...rest } = port;
        return { ...rest, status: portStatusFor({ ...rest, status: port.status }) };
      }),
    }));
    const ponPorts = e.ponPorts?.map((p) => {
      if (p.connectedFeederCableId !== cableId || p.feederCore === undefined) return p;
      changed = true;
      const { feederCore: _k, ...rest } = p;
      return rest;
    });
    return changed ? { ...e, odfPanels, ponPorts } : e;
  });
  if (odfPorts) notes.push(`${odfPorts} ODF port(s) lose their feeder fiber.`);
  let outputs = 0;
  const splitters = data.splitters.map((s) => {
    if (!s.outputPorts.some((p) => p.connectedDropCableId === cableId)) return s;
    return {
      ...s,
      outputPorts: s.outputPorts.map((p) => {
        if (p.connectedDropCableId !== cableId) return p;
        outputs += 1;
        // Phase 11: a faulty mark stays; the faulty-use reason went with the cable.
        const { connectedDropCableId: _d, connectedCore: _k, connectedAt: _a, override: _o, ...rest } = p;
        return { ...rest, status: p.connectedCustomerId || p.status === 'Faulty' ? p.status : ('Available' as const) };
      }),
    };
  });
  if (outputs) notes.push(`${outputs} splitter output(s) are freed.`);
  return {
    ...(equipment.some((e, i) => e !== base[i]) ? { equipment } : {}),
    ...(outputs ? { splitters } : {}),
    summary: notes.join(' '),
  };
}

/**
 * Patches to an OLT being deleted are removed (with history); closures lose the pin link only.
 * Phase 9: the feeder fibers behind those patches are given back to their ODF ports alone, and an
 * ODF being deleted releases the fibers its ports held (the releases stay in the fibers' history).
 */
export function fiberCascadeForEquipment(data: NetworkData, equipmentId: string, ctx: CommandContext = {}): FiberCascade {
  let patches = 0;
  let cables: Cable[] = data.cables;
  let fibersChanged = false;
  const follow = (odf: Equipment, panel: OdfPanel, before: OdfPort, after: OdfPort | undefined, reason: string) => {
    if (!before.feederCableId) return;
    const followed = followOdfFeeder(data, cables, { odf, panel }, before, after, ctx, { strict: false, reason }) as FeederFollow;
    if (followed.audit.length) {
      cables = followed.cables;
      fibersChanged = true;
    }
  };
  const equipment = data.equipment.map((e) => {
    if (!e.odfPanels?.some((p) => p.ports.some((x) => x.patch?.oltId === equipmentId))) return e;
    return {
      ...e,
      odfPanels: e.odfPanels.map((panel) => ({
        ...panel,
        ports: panel.ports.map((port) => {
          if (port.patch?.oltId !== equipmentId) return port;
          patches += 1;
          const { patch, ...rest } = port;
          const next = { ...rest, history: [...(port.history ?? []), historyLine('UNPATCHED', `Patch to ${patch.oltId} ${patch.ponPortId} removed with the OLT`, ctx)] };
          const done = { ...next, status: portStatusFor(next) };
          follow(e, panel, port, done, `OLT ${patch.oltId} deleted`);
          return done;
        }),
      })),
    };
  });
  const gone = data.equipment.find((e) => e.id === equipmentId);
  for (const panel of gone?.odfPanels ?? []) {
    for (const port of panel.ports) follow(gone!, panel, port, undefined, `ODF ${gone!.name} deleted`);
  }
  const closures = data.closures.some((c) => c.equipmentId === equipmentId)
    ? data.closures.map((c) => {
        if (c.equipmentId !== equipmentId) return c;
        const { equipmentId: _e, ...rest } = c;
        return rest;
      })
    : undefined;
  return {
    ...(patches ? { equipment } : {}),
    ...(closures ? { closures } : {}),
    ...(fibersChanged ? { cables } : {}),
    summary: [
      patches ? `${patches} ODF patch(es) to it are removed.` : '',
      closures ? 'Its closure record stays, without the map pin.' : '',
      fibersChanged ? 'Fibers it held are released; their history is kept.' : '',
    ]
      .filter(Boolean)
      .join(' '),
  };
}
