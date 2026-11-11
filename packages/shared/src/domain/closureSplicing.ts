import type { FiberTermination, JointClosure, SpliceRecord, SpliceTray } from '../model/types';
import { spliceLabel, terminationLabel } from './closureTrays';
import { type CommandContext, type CommandResult, fail, type NetworkData, notice, succeed } from './command';
import { checkedFiberChange } from './fiberCommands';
import { randomCode } from './fieldCapture';
import { isoDate } from './time';

/**
 * Phase 8: splicing and closure management commands that are not in `fiberCommands.ts`:
 * "entered by mistake" (a soft delete that keeps the splice as history), fibers ending on a
 * pigtail inside a closure, and tray capacity. Each checks the result with the fiber rules, so a
 * tray position used twice is refused and a full tray or a direction mismatch is a warning the
 * person may accept (written to the audit trail).
 */

const withClosure = (data: NetworkData, closureId: string, edit: (c: JointClosure) => JointClosure) => ({
  closures: data.closures.map((c) => (c.id === closureId ? edit(c) : c)),
});

const struckOut = <T extends { retiredAt?: string }>(item: T, reason: string, ctx: CommandContext, mistake: boolean): T => ({
  ...item,
  retiredAt: (ctx.now ?? new Date()).toISOString(),
  ...(ctx.actor ? { retiredBy: ctx.actor } : {}),
  ...(reason.trim() ? { retiredReason: reason.trim().slice(0, 300) } : {}),
  ...(mistake ? { enteredInError: true } : {}),
});

/* ------------------------------------------------------------------ */
/* Entered by mistake                                                  */
/* ------------------------------------------------------------------ */

/**
 * Strikes out a splice that was entered by mistake. It is never deleted: it stays in the
 * closure's history with when, who and why, and the fiber rules, traces and tray counts ignore it.
 * A splice that really existed should be taken out of service (`retireSplice`) instead.
 */
export function markSpliceEnteredByMistake(data: NetworkData, closureId: string, spliceId: string, reason: string, ctx: CommandContext = {}): CommandResult<SpliceRecord> {
  const closure = data.closures.find((c) => c.id === closureId);
  if (!closure) return fail('Closure Missing', `Joint closure ${closureId} was not found.`);
  const splice = closure.splices.find((s) => s.id === spliceId);
  if (!splice) return fail('Splice Missing', `Splice ${spliceId} was not found in ${closure.name}.`);
  if (splice.retiredAt) return fail('Already history', 'This splice is already out of service. It stays in the history as it is.');
  if (!reason.trim()) return fail('Reason needed', 'Say why this record is a mistake, for example "wrong fiber chosen".');
  const marked = struckOut(splice, reason, ctx, true);
  const replaced = closure.splices.find((s) => s.replacedBySpliceId === splice.id);
  return succeed(marked, withClosure(data, closureId, (c) => ({ ...c, splices: c.splices.map((s) => (s.id === spliceId ? marked : s)) })), {
    notice: notice(
      'info',
      'Marked as a mistake',
      `${spliceLabel(splice)} is struck out and kept in the history.${replaced ? ` The splice it replaced (${spliceLabel(replaced)}) stays out of service; record it again if it is still joined.` : ''}`,
    ),
    audit: [
      {
        action: 'SPLICE_ENTERED_BY_MISTAKE',
        details: `${closure.id}: ${spliceLabel(splice)} struck out as entered by mistake (${reason.trim()})`,
        assetId: closure.id,
        assetType: 'Closure',
      },
    ],
  });
}

/* ------------------------------------------------------------------ */
/* Pigtails: a fiber ending on a connector inside the closure          */
/* ------------------------------------------------------------------ */

export interface TerminationDraft {
  cableId: string;
  core: number;
  /** As chosen from the connector list, or absent when not known. */
  connectorType?: string;
  pigtailLabel?: string;
  /** What the connector plugs into, as written. Never a link. */
  connectsTo?: string;
  trayId?: string;
  cassette?: string;
  position?: number;
  technician?: string;
  date?: string;
  notes?: string;
  photoIds?: string[];
}

/** Records a fiber ending on a pigtail in a closure. Not a splice: nothing continues from it in the records. */
export function recordTermination(data: NetworkData, closureId: string, draft: TerminationDraft, ctx: CommandContext = {}): CommandResult<FiberTermination> {
  const closure = data.closures.find((c) => c.id === closureId);
  if (!closure) return fail('Closure Missing', `Joint closure ${closureId} was not found.`);
  const cable = data.cables.find((c) => c.id === draft.cableId);
  if (!cable) return fail('Not saved', `Cable ${draft.cableId} is not on record.`);
  if (!Number.isInteger(draft.core) || draft.core < 1 || draft.core > cable.fiberCount) {
    return fail('Not saved', `${cable.name} has ${cable.fiberCount} fibers, so fiber ${draft.core} does not exist.`);
  }
  if (draft.trayId && !(closure.trays ?? []).some((t) => t.id === draft.trayId)) return fail('Not saved', 'That tray is not recorded on this closure.');
  if (draft.position !== undefined && (!Number.isInteger(draft.position) || draft.position < 1 || draft.position > 999)) {
    return fail('Not saved', 'Enter the tray position as a whole number, 1 or more.');
  }
  const connector = draft.connectorType?.trim();
  if (connector && connector.length > 20) return fail('Not saved', 'Keep the connector type to 20 characters.');
  if ((draft.cassette?.trim().length ?? 0) > 40) return fail('Not saved', 'Keep the cassette name to 40 characters.');
  const now = ctx.now ?? new Date();
  const termination: FiberTermination = {
    id: `PGT-${randomCode(10)}`,
    cableId: cable.id,
    cableName: cable.name,
    core: draft.core,
    ...(connector ? { connectorType: connector } : {}),
    ...(draft.pigtailLabel?.trim() ? { pigtailLabel: draft.pigtailLabel.trim().slice(0, 60) } : {}),
    ...(draft.connectsTo?.trim() ? { connectsTo: draft.connectsTo.trim().slice(0, 120) } : {}),
    ...(draft.trayId ? { trayId: draft.trayId } : {}),
    ...(draft.cassette?.trim() ? { cassette: draft.cassette.trim() } : {}),
    ...(draft.position !== undefined ? { position: draft.position } : {}),
    technician: draft.technician?.trim() || ctx.actor || '',
    date: draft.date || isoDate(now),
    ...(draft.notes?.trim() ? { notes: draft.notes.trim().slice(0, 500) } : {}),
    ...(draft.photoIds?.length ? { photoIds: draft.photoIds } : {}),
  };
  const summary = `${terminationLabel(termination)}${connector ? ` (${connector})` : ' (connector not recorded)'}`;
  return checkedFiberChange(
    data,
    withClosure(data, closureId, (c) => ({ ...c, terminations: [...(c.terminations ?? []), termination] })),
    termination,
    {
      notice: notice('success', 'Pigtail recorded', summary),
      audit: [{ action: 'PIGTAIL_ADDED', details: `${closure.id}: ${summary}`, assetId: closure.id, assetType: 'Closure' }],
    },
    ctx,
  );
}

/**
 * Takes a pigtail out (the connector was cut off or the fiber spliced instead), or strikes it out
 * as entered by mistake. Either way it stays in the closure's history with when, who and why.
 */
export function takeTerminationOut(
  data: NetworkData,
  closureId: string,
  terminationId: string,
  reason: string,
  options: { mistake?: boolean } = {},
  ctx: CommandContext = {},
): CommandResult<FiberTermination> {
  const closure = data.closures.find((c) => c.id === closureId);
  if (!closure) return fail('Closure Missing', `Joint closure ${closureId} was not found.`);
  const termination = (closure.terminations ?? []).find((t) => t.id === terminationId);
  if (!termination) return fail('Pigtail Missing', `Pigtail ${terminationId} was not found in ${closure.name}.`);
  if (termination.retiredAt) return fail('Already history', 'This pigtail is already out. It stays in the history as it is.');
  if (options.mistake && !reason.trim()) return fail('Reason needed', 'Say why this record is a mistake.');
  const out = struckOut(termination, reason, ctx, !!options.mistake);
  return succeed(out, withClosure(data, closureId, (c) => ({ ...c, terminations: (c.terminations ?? []).map((t) => (t.id === terminationId ? out : t)) })), {
    notice: notice('info', options.mistake ? 'Marked as a mistake' : 'Pigtail taken out', `${terminationLabel(termination)} is kept in the history.`),
    audit: [
      {
        action: options.mistake ? 'PIGTAIL_ENTERED_BY_MISTAKE' : 'PIGTAIL_REMOVED',
        details: `${closure.id}: ${terminationLabel(termination)}${reason.trim() ? ` (${reason.trim()})` : ''}`,
        assetId: closure.id,
        assetType: 'Closure',
      },
    ],
  });
}

/* ------------------------------------------------------------------ */
/* Tray capacity                                                       */
/* ------------------------------------------------------------------ */

/**
 * Sets (or clears, with undefined) the number of splice positions printed on a tray. More splices
 * than positions is a warning the person may accept, never a block: the capacity may be wrong.
 */
export function setTrayCapacity(data: NetworkData, closureId: string, trayId: string, capacity: number | undefined, ctx: CommandContext = {}): CommandResult<SpliceTray> {
  const closure = data.closures.find((c) => c.id === closureId);
  if (!closure) return fail('Closure Missing', `Joint closure ${closureId} was not found.`);
  const tray = (closure.trays ?? []).find((t) => t.id === trayId);
  if (!tray) return fail('Tray Missing', 'That tray is not recorded on this closure.');
  if (capacity !== undefined && (!Number.isInteger(capacity) || capacity < 1 || capacity > 144)) {
    return fail('Not saved', 'Enter the number of splice positions on the tray, from 1 to 144.');
  }
  const { capacity: _old, ...rest } = tray;
  const updated: SpliceTray = capacity === undefined ? rest : { ...rest, capacity };
  return checkedFiberChange(
    data,
    withClosure(data, closureId, (c) => ({ ...c, trays: (c.trays ?? []).map((t) => (t.id === trayId ? updated : t)) })),
    updated,
    {
      notice: notice('success', 'Tray saved', capacity === undefined ? `${tray.label}: positions not recorded.` : `${tray.label}: ${capacity} splice positions.`),
      audit: [
        {
          action: 'TRAY_CAPACITY_SET',
          details: `${closure.id} ${tray.label}: ${tray.capacity ?? 'not recorded'} → ${capacity ?? 'not recorded'} positions`,
          assetId: closure.id,
          assetType: 'Closure',
        },
      ],
    },
    ctx,
  );
}
