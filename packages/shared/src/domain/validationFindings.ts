import type { ChangeSet } from '../model/api';
import type { CollectionName } from '../model/collections';
import {
  VALIDATION_FINDING_STATE_LABELS,
  type ValidationFinding,
  type ValidationFindingHistory,
  validationFindingSchema,
  type ValidationFindingState,
} from '../model/validationFindingSchemas';
import { type CommandContext, type CommandResult, fail, type NetworkData, notice, succeed } from './command';
import { randomCode } from './fieldCapture';
import { findGeometryProblems, type FoundProblem, GEOMETRY_FIX_TEXT, type GeometryRule } from './geometryRules';
import { type CheckLimits, checkLimitsFrom } from './validationSettings';

/**
 * Network mapping Phase 15: stored findings of the map check (`validationFindings`). A check run
 * is reconciled with what is stored: a new problem opens a finding, a problem found again keeps its
 * finding, and a stored finding the run did not find is marked "no longer found". Nothing is ever
 * deleted. People mark a finding fine as it is (acknowledged, the logged override of a warning),
 * fixed (resolved), or open again, always with who, when and a note, and every change is kept in
 * its history. Findings name customers by id only and never hold a house position.
 */

export const findingsOf = (data: Partial<Pick<NetworkData, 'validationFindings'>>): ValidationFinding[] => data.validationFindings ?? [];

export const newFindingId = (): string => `VF-${randomCode(10)}`;

/** Who the check itself is in a finding's history. */
export const CHECK_ACTOR = 'Map check';

/* ------------------------------------------------------------------ */
/* From the map check script                                           */
/* ------------------------------------------------------------------ */

export interface MapCheckFindingLike {
  severity: 'error' | 'warning' | 'note';
  rule: string;
  id: string;
  message: string;
}

/** Map-check rules the geometry rules replace, so one problem is never listed twice. */
export const MAP_CHECK_RULES_REPLACED: ReadonlySet<string> = new Set(['cable-end-far']);

/** Plain fix text for the most common map-check rules. Others get the general line. */
const MAP_CHECK_FIX: Record<string, string> = {
  'cable-end-missing': 'Open the cable and choose the item its end really connects to. Nothing is linked for you.',
  'cable-end-not-connected': 'Open the cable and choose what each end connects to, or leave it if the work is not finished.',
  'cable-no-route': 'Open the cable and draw its route on the map.',
  'cable-length-mismatch': 'Compare the drawn line with the cable marks or an OTDR length, and correct whichever is wrong.',
  'coordinates-swapped': 'Open the item and swap its latitude and longitude, or place it again on the map.',
  'possible-duplicate': 'Check on site or on the photos whether this is one item mapped twice. Delete the copy, or mark this "fine as it is".',
  'customer-path-incomplete': 'Open the customer and record the missing part of their path (box, splitter output, drop fibre).',
  'customer-link-missing': 'Open the customer and choose the right OLT, box, splitter or cable. The old link names a record that is gone.',
  'splitter-port-shared': 'Two customers are on one splitter output. Check on site which one is really there and move the other.',
  'core-shared': 'Two customers use one fibre of one drop. Check on site and record the right fibre for each.',
  'rx-looks-fake': 'Take a real light reading at the ONT and record it with the meter photo.',
  'rx-too-strong': 'Check for a missing splitter or a wrong path, then take a new reading.',
  'rx-too-weak': 'Check connectors, bends and the path, clean the connectors, then take a new reading.',
};

const GENERAL_FIX = 'Open the item, compare it with the street or the records, and correct what is wrong. Then run the check again.';

const COLLECTION_BY_PREFIX: [RegExp, CollectionName][] = [
  [/^(cable|core|tube|splice-cable|attachment-cable|duct-cable|slack-cable)/, 'cables'],
  [/^(customer|rx-|made-up-serial|core-shared|splitter-port-shared|splitter-port-missing|splitter-port-disagrees)/, 'customers'],
  [/^splitter/, 'splitters'],
  [/^(span)/, 'spans'],
  [/^(duct)/, 'ducts'],
  [/^(ont)/, 'onts'],
  [/^(fault)/, 'faults'],
  [/^(work-order)/, 'workOrders'],
  [/^(alarm)/, 'alarms'],
  [/^(service)/, 'services'],
  [/^(building|unit)/, 'buildings'],
  [/^(permission)/, 'permissions'],
  [/^(slack)/, 'slackLoops'],
];

/**
 * Customer names in a map-check sentence replaced by "customer <id>". The script quotes names in
 * double quotes; a finding is read by every role, so a name is never stored.
 */
export function scrubCustomerNames(message: string, namesToIds: ReadonlyMap<string, string>): string {
  if (namesToIds.size === 0) return message;
  return message.replace(/"([^"]{1,200})"/g, (whole, name: string) => {
    const id = namesToIds.get(name);
    return id ? `customer ${id}` : whole;
  });
}

/** The map-check script's findings as problems to store. Its own sentence, with customers by id. */
export function problemsFromMapCheck(findings: readonly MapCheckFindingLike[], data: Pick<NetworkData, 'customers' | 'equipment' | 'cables'> & Partial<Pick<NetworkData, 'closures' | 'splitters'>>): FoundProblem[] {
  const names = new Map<string, string>();
  for (const c of data.customers) if (c.name && c.name.trim()) names.set(c.name, c.id);
  const equipment = new Map(data.equipment.map((e) => [e.id, e]));
  const cables = new Map(data.cables.map((c) => [c.id, c]));
  const customers = new Set(data.customers.map((c) => c.id));
  const seen = new Map<string, number>();
  const out: FoundProblem[] = [];
  for (const f of findings) {
    if (MAP_CHECK_RULES_REPLACED.has(f.rule)) continue;
    const base = `map:${f.rule}:${f.id}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const collection: CollectionName | undefined = customers.has(f.id)
      ? 'customers'
      : equipment.has(f.id)
        ? 'equipment'
        : cables.has(f.id)
          ? 'cables'
          : COLLECTION_BY_PREFIX.find(([re]) => re.test(f.rule))?.[1];
    const eq = equipment.get(f.id);
    const cable = cables.get(f.id);
    const mid = cable?.coordinates?.[Math.floor((cable.coordinates?.length ?? 0) / 2)];
    // Where to look: never a customer's house.
    const at = collection === 'customers' ? undefined : eq && Number.isFinite(eq.lat) ? { lat: eq.lat, lng: eq.lng } : mid ? { lat: mid[0], lng: mid[1] } : undefined;
    out.push({
      key: n === 1 ? base : `${base}:${n}`,
      rule: f.rule,
      severity: f.severity,
      source: 'map_check',
      ...(collection ? { targetCollection: collection } : {}),
      targetId: f.id,
      message: scrubCustomerNames(f.message, names).slice(0, 800),
      fix: MAP_CHECK_FIX[f.rule] ?? GENERAL_FIX,
      ...(at && !(at.lat === 0 && at.lng === 0) ? at : {}),
    });
  }
  return out;
}

/** Every problem one run finds: the geometry rules here, plus the map-check findings when given (the server runs the script). */
export function collectValidationProblems(
  data: Parameters<typeof findGeometryProblems>[0] & Partial<Pick<NetworkData, 'closures' | 'splitters'>>,
  options: { limits?: CheckLimits; mapCheck?: readonly MapCheckFindingLike[] } = {},
): FoundProblem[] {
  const limits = options.limits ?? checkLimitsFrom();
  return [...findGeometryProblems(data, limits), ...(options.mapCheck ? problemsFromMapCheck(options.mapCheck, data) : [])];
}

/** The fix text for a rule: the geometry rules' own, the map check's, or the general line. */
export const findingFixText = (rule: string): string => GEOMETRY_FIX_TEXT[rule as GeometryRule] ?? MAP_CHECK_FIX[rule] ?? GENERAL_FIX;

/* ------------------------------------------------------------------ */
/* Reconciling a run with what is stored                               */
/* ------------------------------------------------------------------ */

export interface ReconcileSummary {
  found: number;
  opened: number;
  foundAgain: number;
  reopened: number;
  noLongerFound: number;
  unchanged: number;
}

/**
 * What a run changes in the stored findings. Only changed findings are returned, so a run that finds
 * the same problems writes nothing. A finding marked fixed and found again is opened again; one
 * marked fine as it is stays so (that is what the person said about it).
 */
export function reconcileFindings(stored: readonly ValidationFinding[], found: readonly FoundProblem[], ctx: { now?: Date; actor?: string } = {}): { upserts: ValidationFinding[]; summary: ReconcileSummary } {
  const now = (ctx.now ?? new Date()).toISOString();
  const byKey = new Map(stored.map((f) => [f.key, f]));
  const foundKeys = new Set<string>();
  const upserts: ValidationFinding[] = [];
  const summary: ReconcileSummary = { found: 0, opened: 0, foundAgain: 0, reopened: 0, noLongerFound: 0, unchanged: 0 };
  const entry = (event: ValidationFindingHistory['event'], note?: string): ValidationFindingHistory => ({ at: now, event, by: CHECK_ACTOR, ...(note ? { note } : {}) });

  for (const p of found) {
    if (foundKeys.has(p.key)) continue;
    foundKeys.add(p.key);
    summary.found += 1;
    const existing = byKey.get(p.key);
    const fields = {
      rule: p.rule,
      severity: p.severity,
      source: p.source,
      ...(p.targetCollection ? { targetCollection: p.targetCollection } : {}),
      targetId: p.targetId,
      ...(p.relatedIds?.length ? { relatedIds: p.relatedIds.slice(0, 20) } : {}),
      message: p.message.slice(0, 800),
      fix: p.fix.slice(0, 500),
      ...(p.lat !== undefined && p.lng !== undefined ? { lat: p.lat, lng: p.lng } : {}),
    };
    if (!existing) {
      summary.opened += 1;
      upserts.push({
        id: newFindingId(),
        key: p.key,
        ...fields,
        state: 'open',
        presence: 'found',
        presenceAt: now,
        firstFoundAt: now,
        history: [entry('found')],
        createdAt: now,
        ...(ctx.actor ? { createdBy: ctx.actor } : {}),
      });
      continue;
    }
    const history = [...existing.history];
    let next: ValidationFinding = { ...stripLocation(existing), ...fields, history };
    let changed = existing.message !== p.message || existing.severity !== p.severity;
    if (existing.presence === 'no_longer_found') {
      next = { ...next, presence: 'found', presenceAt: now };
      history.push(entry('found_again'));
      summary.foundAgain += 1;
      changed = true;
    }
    if (existing.state === 'resolved') {
      next = { ...next, state: 'open', stateBy: CHECK_ACTOR, stateAt: now, stateNote: 'Found again after it was marked fixed.' };
      history.push(entry('reopened', 'Found again after it was marked fixed.'));
      summary.reopened += 1;
      changed = true;
    }
    if (changed) upserts.push(next);
    else summary.unchanged += 1;
  }

  for (const f of stored) {
    if (foundKeys.has(f.key) || f.presence === 'no_longer_found') continue;
    summary.noLongerFound += 1;
    upserts.push({ ...f, presence: 'no_longer_found', presenceAt: now, history: [...f.history, entry('not_found')] });
  }
  return { upserts, summary };
}

const stripLocation = (f: ValidationFinding): ValidationFinding => {
  const { lat: _lat, lng: _lng, relatedIds: _related, targetCollection: _c, ...rest } = f;
  return rest as ValidationFinding;
};

/* ------------------------------------------------------------------ */
/* People's decisions                                                  */
/* ------------------------------------------------------------------ */

const NOTE_NEEDED: Record<Exclude<ValidationFindingState, 'open'>, string> = {
  acknowledged: 'Write why it is fine as it is, so the next person knows.',
  resolved: 'Write what was fixed.',
};

function setState(data: NetworkData, id: string, state: ValidationFindingState, note: string, ctx: CommandContext): CommandResult<ValidationFinding> {
  const finding = findingsOf(data).find((f) => f.id === id);
  if (!finding) return fail('Not found', `Finding ${id} was not found.`);
  const text = note.trim();
  if (state !== 'open' && !text) return fail('Not saved', NOTE_NEEDED[state], 'warning');
  if (state === 'open' && !text) return fail('Not saved', 'Write why it needs a look again.', 'warning');
  if (finding.state === state) return fail('Nothing to change', `This finding is already "${VALIDATION_FINDING_STATE_LABELS[state]}".`, 'info');
  const at = (ctx.now ?? new Date()).toISOString();
  const by = ctx.actor?.trim() || 'Not recorded';
  const event: ValidationFindingHistory['event'] = state === 'acknowledged' ? 'acknowledged' : state === 'resolved' ? 'resolved' : 'reopened';
  const updated: ValidationFinding = {
    ...finding,
    state,
    stateBy: by,
    stateAt: at,
    stateNote: text.slice(0, 1000),
    history: [...finding.history, { at, event, by, note: text.slice(0, 1000) }],
  };
  const words = VALIDATION_FINDING_STATE_LABELS[state];
  return succeed(
    updated,
    { validationFindings: findingsOf(data).map((f) => (f.id === id ? updated : f)) },
    {
      notice: notice('success', 'Saved', `${words}. Kept in the finding's history.`),
      audit: [
        {
          action: state === 'acknowledged' ? 'WARNING_ACCEPTED' : state === 'resolved' ? 'VALIDATION_FINDING_RESOLVED' : 'VALIDATION_FINDING_REOPENED',
          details: `${finding.rule} on ${finding.targetId}: ${words} by ${by}. ${text}`.slice(0, 900),
          assetId: finding.id,
          assetType: 'ValidationFinding',
        },
      ],
    },
  );
}

/** "Fine as it is": the logged override of a warning. A note is needed. */
export const acknowledgeFinding = (data: NetworkData, id: string, note: string, ctx: CommandContext = {}) => setState(data, id, 'acknowledged', note, ctx);
/** "Fixed". A note saying what was done is needed. The next check opens it again if it is still found. */
export const resolveFinding = (data: NetworkData, id: string, note: string, ctx: CommandContext = {}) => setState(data, id, 'resolved', note, ctx);
/** Open again, with a reason. */
export const reopenFinding = (data: NetworkData, id: string, note: string, ctx: CommandContext = {}) => setState(data, id, 'open', note, ctx);

/* ------------------------------------------------------------------ */
/* Server and restore checks                                           */
/* ------------------------------------------------------------------ */

export const changeSetTouchesValidationFindings = (changes: ChangeSet): boolean =>
  (changes.upserts?.validationFindings?.length ?? 0) > 0 || (changes.deletes?.validationFindings?.length ?? 0) > 0;

export interface FindingProblem {
  id: string;
  message: string;
}

/** Why one finding is broken data on its own, or null. */
export function findingError(f: ValidationFinding): string | null {
  if (f.state !== 'open' && (!f.stateBy?.trim() || !f.stateAt || !f.stateNote?.trim())) {
    return `A finding marked "${VALIDATION_FINDING_STATE_LABELS[f.state]}" needs who, when and a note.`;
  }
  if (f.history.length === 0) return 'A finding needs its history (at least when it was found).';
  return null;
}

const sameEntry = (a: ValidationFindingHistory, b: ValidationFindingHistory) => a.at === b.at && a.event === b.event && (a.by ?? '') === (b.by ?? '') && (a.note ?? '') === (b.note ?? '');

/**
 * The findings a change stores that are broken data: a decision with no who, when or note, history
 * rewritten or cut, a finding's rule, key or record changed, or a finding deleted (findings are
 * kept; mark them fixed instead). `stored` looks up the stored finding by id.
 */
export function checkChangeSetValidationFindings(changes: ChangeSet, stored: (id: string) => ValidationFinding | undefined): FindingProblem[] {
  const problems: FindingProblem[] = [];
  for (const id of changes.deletes?.validationFindings ?? []) {
    problems.push({ id, message: `Finding ${id}: findings are kept as history and never deleted. Mark it fixed or fine as it is instead.` });
  }
  for (const f of changes.upserts?.validationFindings ?? []) {
    const parsed = validationFindingSchema.safeParse(f);
    if (!parsed.success) {
      problems.push({ id: f.id, message: `Finding ${f.id}: ${parsed.error.issues[0]?.message ?? 'not a valid finding'}.` });
      continue;
    }
    const own = findingError(f);
    if (own) {
      problems.push({ id: f.id, message: `Finding ${f.id}: ${own}` });
      continue;
    }
    const before = stored(f.id);
    if (!before) continue;
    if (before.key !== f.key || before.rule !== f.rule || before.targetId !== f.targetId) {
      problems.push({ id: f.id, message: `Finding ${f.id}: what it is about cannot be changed. A new problem is a new finding.` });
      continue;
    }
    const kept = before.history.length <= f.history.length && before.history.every((h, i) => sameEntry(h, f.history[i]));
    if (!kept) problems.push({ id: f.id, message: `Finding ${f.id}: its history can only grow. Nothing in it may be changed or removed.` });
  }
  return problems;
}

/** Broken findings in a whole network (for a restore). History is not compared: there is nothing stored to compare with. */
export function findValidationFindingErrors(data: Partial<Pick<NetworkData, 'validationFindings'>>): FindingProblem[] {
  return findingsOf(data).flatMap((f) => {
    const message = findingError(f);
    return message ? [{ id: f.id, message: `Finding ${f.id}: ${message}` }] : [];
  });
}

/* ------------------------------------------------------------------ */
/* Lists                                                               */
/* ------------------------------------------------------------------ */

const SEVERITY_ORDER = { error: 0, warning: 1, note: 2 } as const;
const STATE_ORDER: Record<ValidationFindingState, number> = { open: 0, acknowledged: 1, resolved: 2 };

/** Open and still found first, then by how serious, then newest. */
export function sortFindings(list: readonly ValidationFinding[]): ValidationFinding[] {
  return [...list].sort(
    (a, b) =>
      STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
      (a.presence === b.presence ? 0 : a.presence === 'found' ? -1 : 1) ||
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      b.firstFoundAt.localeCompare(a.firstFoundAt) ||
      a.key.localeCompare(b.key),
  );
}

export function findingCounts(list: readonly ValidationFinding[]): { open: number; acknowledged: number; resolved: number; noLongerFound: number; errors: number } {
  const counts = { open: 0, acknowledged: 0, resolved: 0, noLongerFound: 0, errors: 0 };
  for (const f of list) {
    counts[f.state] += 1;
    if (f.presence === 'no_longer_found') counts.noLongerFound += 1;
    if (f.severity === 'error' && f.state === 'open' && f.presence === 'found') counts.errors += 1;
  }
  return counts;
}
