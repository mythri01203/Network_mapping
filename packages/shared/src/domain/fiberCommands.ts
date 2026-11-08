import { type ColorScheme, coreIdentity, DEFAULT_COLOR_SCHEMES, findColorScheme } from '../fiber/colors';
import type { CoreAssignmentKind, CoreStatus, LossSource, SpliceStatus, SpliceType } from '../model/enums';
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
  fibersPerTube?: number;
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
  const fpt = draft.fibersPerTube;
  if (fpt !== undefined && (!Number.isInteger(fpt) || fpt < 1 || cable.fiberCount % fpt !== 0)) {
    return fail(
      'Tubes do not add up',
      `${cable.fiberCount} fibers cannot be split into tubes of ${fpt}. Check the drum sheet: tubes x fibers per tube must equal ${cable.fiberCount}.`,
    );
  }
  const base: Cable = {
    ...cable,
    colorScheme: draft.colorScheme || undefined,
    tubeColorScheme: draft.tubeColorScheme || undefined,
    fibersPerTube: fpt,
    tubeCount: fpt ? cable.fiberCount / fpt : undefined,
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
  return checkedFiberChange(
    data,
    { cables: data.cables.map((c) => (c.id === cableId ? updated : c)) },
    updated,
    {
      notice: notice('success', 'Fiber layout saved', `${cable.name}: ${fpt ? `${updated.tubeCount} tubes of ${fpt}` : 'tubes not recorded'}, colours ${schemeName}.`),
      audit: [
        {
          action: 'CABLE_LAYOUT_SET',
          details: `${cable.id}: scheme ${updated.colorScheme ?? 'not known'}, tube colours ${updated.tubeColorScheme ?? 'not known'}, ${fpt ?? '?'} per tube${updated.layoutSource ? ` (${updated.layoutSource})` : ''}`,
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

/** Status to show: an active assignment decides In Use or Reserved; otherwise the recorded state. */
export function effectiveCoreStatus(core: FiberCore | undefined): CoreStatus {
  if (!core) return 'Available';
  const active = activeAssignment(core);
  if (active) return active.kind === 'reserved' ? 'Reserved' : 'In Use';
  return core.status;
}

export interface CoreUtilization {
  total: number;
  inUse: number;
  reserved: number;
  available: number;
  damaged: number;
  other: number;
  /** Share of fibers in use, 0 to 100. */
  usedPercent: number;
}

/** Counts worked out from the core records and assignments, never typed. */
export function coreUtilization(cable: Cable): CoreUtilization {
  const counts = { inUse: 0, reserved: 0, available: 0, damaged: 0, other: 0 };
  for (const core of completeCores(cable)) {
    const status = effectiveCoreStatus(core);
    if (status === 'In Use' || status === 'Spliced') counts.inUse += 1;
    else if (status === 'Reserved') counts.reserved += 1;
    else if (status === 'Available' || status === 'Dark') counts.available += 1;
    else if (status === 'Damaged') counts.damaged += 1;
    else counts.other += 1;
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
}

const withCore = (cable: Cable, coreNumber: number, edit: (core: FiberCore) => FiberCore): Cable => ({
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
  if (core.status === 'In Use' && !current) {
    // An older record marked In Use with no assignment: still occupied by something.
    return fail(
      'Core Already Occupied',
      `${label[0].toUpperCase()}${label.slice(1)} is marked In Use${core.customerId ? ` for ${core.customerId}` : core.connectedToEquipmentId ? ` at ${core.connectedToEquipmentId}` : ''}. Release it first.`,
    );
  }
  if (core.status === 'Damaged') {
    return fail('Damaged Core', `${label[0].toUpperCase()}${label.slice(1)} is marked damaged. Repair or re-test it before giving it a service.`);
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
  };
  const updated = withCore(cable, draft.coreNumber, (c) => ({
    ...c,
    status: draft.kind === 'reserved' ? 'Reserved' : 'In Use',
    ...(draft.customerId ? { customerId: draft.customerId } : {}),
    ...(draft.equipmentId ? { connectedToEquipmentId: draft.equipmentId } : {}),
    assignments: [...(c.assignments ?? []), assignment],
  }));
  return checkedFiberChange(
    data,
    { cables: data.cables.map((c) => (c.id === cable.id ? updated : c)) },
    updated,
    {
      notice: notice('success', draft.kind === 'reserved' ? 'Fiber reserved' : 'Fiber Core Allocated', `${label} ${draft.kind === 'reserved' ? 'reserved' : 'given'} for ${assignment.use}.`),
      audit: [
        {
          action: draft.kind === 'reserved' ? 'CORE_RESERVED' : 'CORE_ALLOCATED',
          details: `${cable.id} core ${draft.coreNumber}: ${assignment.use}${assignment.source ? `, from ${assignment.source}` : ''}${assignment.destination ? `, to ${assignment.destination}` : ''}`,
          assetId: cable.id,
          assetType: 'Core',
        },
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
      status: 'Available',
      assignments: (c.assignments ?? []).map((a) =>
        a.releasedAt ? a : { ...a, releasedAt: now.toISOString(), ...(ctx.actor ? { releasedBy: ctx.actor } : {}), ...(reason.trim() ? { releaseReason: reason.trim() } : {}) },
      ),
    };
  });
  return succeed(updated, { cables: data.cables.map((c) => (c.id === cableId ? updated : c)) }, {
    notice: notice('info', 'Fiber released', `Fiber ${coreNumber} of ${cable.name} is available again. Its history is kept.`),
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

/** Records which feeder fiber is terminated behind an ODF adapter, or clears it. */
export function setOdfPortFeeder(
  data: NetworkData,
  odfId: string,
  panelId: string,
  portNumber: number,
  feeder: { cableId: string; core: number } | null,
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
  return checkedFiberChange(
    data,
    { equipment: data.equipment.map((e) => (e.id === odfId ? result.updated : e)) },
    result.port,
    {
      notice: notice('success', 'ODF port saved', `${result.odf.name} ${result.panel.label} port ${portNumber}: ${feeder ? `fiber ${feeder.core} of ${feeder.cableId}` : 'no feeder'}.`),
      audit: [{ action: feeder ? 'ODF_FEEDER_SET' : 'ODF_FEEDER_CLEARED', details: `${odfId} ${result.panel.label} port ${portNumber}${feeder ? `: ${feeder.cableId} fiber ${feeder.core}` : ''}`, assetId: odfId, assetType: 'Patch' }],
    },
    ctx,
  );
}

/** Patches an OLT PON port to the front of an ODF adapter, or removes the patch. Not a splice. */
export function patchOdfPort(
  data: NetworkData,
  odfId: string,
  panelId: string,
  portNumber: number,
  target: { oltId: string; ponPortId: string; cordLabel?: string } | null,
  ctx: CommandContext = {},
): CommandResult<OdfPort> {
  let olt: Equipment | undefined;
  if (target) {
    olt = data.equipment.find((e) => e.id === target.oltId && e.type === 'OLT');
    if (!olt) return fail('OLT Missing', `OLT ${target.oltId} is not on record.`);
    const ports = olt.ponPorts ?? buildOltPonPorts(olt);
    if (!ports.some((p) => p.id === target.ponPortId)) return fail('PON port missing', `${olt.name} has no port ${target.ponPortId}.`);
    if (!olt.ponPorts) olt = { ...olt, ponPorts: ports };
  }
  const now = ctx.now ?? new Date();
  const result = editOdfPort(data, odfId, panelId, portNumber, (port) => {
    if (target && port.patch) return `This adapter is already patched to ${port.patch.oltId} ${port.patch.ponPortId}. Remove that patch first.`;
    if (!target && !port.patch) return 'This adapter has no patch to remove.';
    const { patch: old, ...rest } = port;
    const line = target ? `Patched to ${target.oltId} ${target.ponPortId}${target.cordLabel ? ` with cord ${target.cordLabel}` : ''}` : `Patch to ${old?.oltId} ${old?.ponPortId} removed`;
    return {
      ...rest,
      ...(target
        ? { patch: { oltId: target.oltId, ponPortId: target.ponPortId, patchedAt: now.toISOString(), ...(ctx.actor ? { patchedBy: ctx.actor } : {}), ...(target.cordLabel?.trim() ? { cordLabel: target.cordLabel.trim() } : {}) } }
        : {}),
      history: [...(port.history ?? []), historyLine(target ? 'PATCHED' : 'UNPATCHED', line, ctx)],
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
  return checkedFiberChange(
    data,
    { equipment },
    result.port,
    {
      notice: notice('success', target ? 'Patched' : 'Patch removed', target ? `${target.oltId} ${target.ponPortId} → ${result.odf.name} ${result.panel.label} port ${portNumber}.` : `${result.odf.name} ${result.panel.label} port ${portNumber} has no patch now. The old patch is in its history.`),
      audit: [{ action: target ? 'PATCH_ADDED' : 'PATCH_REMOVED', details: `${odfId} ${result.panel.label} port ${portNumber}${target ? ` ↔ ${target.oltId} ${target.ponPortId}` : ` (was ${previous?.oltId} ${previous?.ponPortId})`}`, assetId: odfId, assetType: 'Patch' }],
    },
    ctx,
  );
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

export type SplitterInput = { cableId: string; core: number } | { splitterId: string; port: number };

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
  if (input && 'splitterId' in input) {
    const parent = data.splitters.find((s) => s.id === input.splitterId);
    if (!parent) return fail('Splitter Missing', `Splitter ${input.splitterId} was not found.`);
    if (parent.id === splitter.id) return fail('Not possible', 'A splitter cannot feed itself.');
    if (input.port < 1 || input.port > splitterCapacity(parent)) return fail('No such output', `${parent.name} has ${splitterCapacity(parent)} outputs.`);
    const out = parent.outputPorts.find((p) => p.portNumber === input.port);
    if (out?.connectedCustomerId) return fail('Output in use', `Output ${input.port} of ${parent.name} already serves ${out.connectedCustomerName ?? out.connectedCustomerId}.`);
  }
  const now = ctx.now ?? new Date();
  const { connectedCableId: _c, connectedCore: _k, connectedSplitterId: _s, connectedSplitterPort: _p, linkedAt: _a, linkedBy: _b, ...restInput } = splitter.inputPort;
  const inputPort: Splitter['inputPort'] = {
    ...restInput,
    ...(input && 'cableId' in input ? { connectedCableId: input.cableId, connectedCore: input.core } : {}),
    ...(input && 'splitterId' in input ? { connectedSplitterId: input.splitterId, connectedSplitterPort: input.port } : {}),
    ...(input ? { linkedAt: now.toISOString(), ...(ctx.actor ? { linkedBy: ctx.actor } : {}) } : {}),
  };
  const text = !input ? 'not linked' : 'cableId' in input ? `fiber ${input.core} of ${input.cableId}` : `output ${input.port} of splitter ${input.splitterId}`;
  const updated: Splitter = { ...splitter, inputPort, history: [...(splitter.history ?? []), historyLine(input ? 'INPUT_LINKED' : 'INPUT_CLEARED', `Input: ${text}`, ctx)] };
  // A parent output used for a cascade is no longer free.
  const splitters = data.splitters.map((s) => {
    if (s.id === splitterId) return updated;
    if (input && 'splitterId' in input && s.id === input.splitterId) {
      return { ...s, outputPorts: s.outputPorts.map((p) => (p.portNumber === input.port ? { ...p, status: 'Occupied' as const, connectedAt: now.toISOString() } : p)) };
    }
    const was = splitter.inputPort;
    if (was.connectedSplitterId === s.id && was.connectedSplitterPort) {
      return { ...s, outputPorts: s.outputPorts.map((p) => (p.portNumber === was.connectedSplitterPort && !p.connectedCustomerId && !p.connectedDropCableId ? { ...p, status: 'Available' as const } : p)) };
    }
    return s;
  });
  return checkedFiberChange(
    data,
    { splitters },
    updated,
    {
      notice: notice('success', 'Splitter input saved', `${splitter.name} input: ${text}.`),
      audit: [{ action: input ? 'SPLITTER_INPUT_LINKED' : 'SPLITTER_INPUT_CLEARED', details: `${splitter.id} input ${text}`, assetId: splitter.id, assetType: 'Splitter' }],
    },
    ctx,
  );
}

/** Connects one splitter output to a cable fiber (a lead or drop cable), or frees it. */
export function connectSplitterOutput(
  data: NetworkData,
  splitterId: string,
  portNumber: number,
  target: { cableId: string; core: number; equipmentId?: string } | null,
  ctx: CommandContext = {},
): CommandResult<Splitter> {
  const splitter = data.splitters.find((s) => s.id === splitterId);
  if (!splitter) return fail('Splitter Missing', `Splitter ${splitterId} was not found.`);
  const n = splitterCapacity(splitter);
  if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > n) {
    return fail('No such output', `${splitter.name} is ${splitter.ratio}: it has ${n} outputs, so output ${portNumber} would overflow it.`);
  }
  const port: SplitterPort = splitter.outputPorts.find((p) => p.portNumber === portNumber) ?? { portNumber, label: `OUT-${String(portNumber).padStart(2, '0')}`, status: 'Available' };
  if (target) {
    const cable = data.cables.find((c) => c.id === target.cableId);
    if (!cable) return fail('Cable Missing', `Cable ${target.cableId} is not on record.`);
    if (!Number.isInteger(target.core) || target.core < 1 || target.core > cable.fiberCount) {
      return fail('Fiber not on cable', `${cable.name} has ${cable.fiberCount} fibers, so fiber ${target.core} does not exist.`);
    }
    if (port.connectedDropCableId || port.status === 'Occupied') {
      return fail('Output in use', `Output ${portNumber} of ${splitter.name} is already connected${port.connectedDropCableId ? ` to ${port.connectedDropCableId}` : ''}. Free it first.`);
    }
    if (port.status === 'Faulty') return fail('Output faulty', `Output ${portNumber} of ${splitter.name} is marked faulty.`);
  } else if (port.connectedCustomerId) {
    return fail('Customer on this output', `Output ${portNumber} serves ${port.connectedCustomerName ?? port.connectedCustomerId}. Move the customer first.`);
  }
  const now = ctx.now ?? new Date();
  const { connectedDropCableId: _d, connectedCore: _k, connectedEquipmentId: _e, connectedAt: _a, ...rest } = port;
  const line = target ? `Output ${portNumber} → ${target.cableId} fiber ${target.core}` : `Output ${portNumber} freed (was ${port.connectedDropCableId ?? 'nothing'} fiber ${port.connectedCore ?? '?'})`;
  const nextPort: SplitterPort = {
    ...rest,
    status: target ? 'Occupied' : 'Available',
    ...(target ? { connectedDropCableId: target.cableId, connectedCore: target.core, connectedAt: now.toISOString(), ...(target.equipmentId ? { connectedEquipmentId: target.equipmentId } : {}) } : {}),
    history: [...(port.history ?? []), historyLine(target ? 'OUTPUT_CONNECTED' : 'OUTPUT_FREED', line, ctx)],
  };
  const exists = splitter.outputPorts.some((p) => p.portNumber === portNumber);
  const updated: Splitter = {
    ...splitter,
    outputPorts: exists ? splitter.outputPorts.map((p) => (p.portNumber === portNumber ? nextPort : p)) : [...splitter.outputPorts, nextPort].sort((a, b) => a.portNumber - b.portNumber),
  };
  return checkedFiberChange(
    data,
    { splitters: data.splitters.map((s) => (s.id === splitterId ? updated : s)) },
    updated,
    {
      notice: notice('success', target ? 'Output connected' : 'Output freed', `${splitter.name}: ${line}.`),
      audit: [{ action: target ? 'SPLITTER_OUTPUT_CONNECTED' : 'SPLITTER_OUTPUT_FREED', details: `${splitter.id}: ${line}`, assetId: splitter.id, assetType: 'Splitter' }],
    },
    ctx,
  );
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

/* ------------------------------------------------------------------ */
/* Delete cascades                                                     */
/* ------------------------------------------------------------------ */

export interface FiberCascade {
  equipment?: Equipment[];
  splitters?: Splitter[];
  closures?: JointClosure[];
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
        const { connectedDropCableId: _d, connectedCore: _k, connectedAt: _a, ...rest } = p;
        return { ...rest, status: p.connectedCustomerId ? p.status : ('Available' as const) };
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

/** Patches to an OLT being deleted are removed (with history); closures lose the pin link only. */
export function fiberCascadeForEquipment(data: NetworkData, equipmentId: string, ctx: CommandContext = {}): FiberCascade {
  let patches = 0;
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
          return { ...next, status: portStatusFor(next) };
        }),
      })),
    };
  });
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
    summary: [patches ? `${patches} ODF patch(es) to it are removed.` : '', closures ? 'Its closure record stays, without the map pin.' : ''].filter(Boolean).join(' '),
  };
}
