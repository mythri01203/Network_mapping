import type { JointClosure, SpliceRecord } from '../model/types';
import { markSpliceEnteredByMistake } from './closureSplicing';
import { type CommandContext, type CommandResult, fail, type NetworkData, notice, succeed } from './command';
import { isSpliceActive } from './fiberIndex';

const usesEndpoint = (s: SpliceRecord, cableId: string, core: number) =>
  (s.inputCableId === cableId && s.inputCore === core) || (s.outputCableId === cableId && s.outputCore === core);

const withSplices = (data: NetworkData, closureId: string, edit: (splices: SpliceRecord[]) => SpliceRecord[]) =>
  data.closures.map((c): JointClosure => (c.id === closureId ? { ...c, splices: edit(c.splices) } : c));

/**
 * Records a splice. A core can only be terminated once per closure (it may be spliced again further
 * along). Splices out of service or entered by mistake are history and do not count.
 */
export function addSplice(data: NetworkData, closureId: string, splice: SpliceRecord): CommandResult<SpliceRecord> {
  const closure = data.closures.find((c) => c.id === closureId);
  if (!closure) return fail('Closure Missing', `Joint closure ${closureId} was not found.`);
  if (splice.inputCableId === splice.outputCableId && splice.inputCore === splice.outputCore) {
    return fail('Invalid Splice', 'A core cannot be spliced to itself.');
  }
  const duplicate = closure.splices.some(
    (s) =>
      isSpliceActive(s) &&
      (usesEndpoint(s, splice.inputCableId, splice.inputCore) || usesEndpoint(s, splice.outputCableId, splice.outputCore)),
  );
  if (duplicate) {
    return fail(
      'Duplicate Endpoint',
      'That cable core is already spliced in this closure. The same core may still be spliced in other closures along the route.',
    );
  }

  const summary = `${splice.inputCableId} core ${splice.inputCore} → ${splice.outputCableId} core ${splice.outputCore}`;
  return succeed(
    splice,
    { closures: withSplices(data, closureId, (splices) => [...splices, splice]) },
    {
      notice: notice('success', 'Splice Recorded', summary),
      audit: [
        { action: 'SPLICE_ADDED', details: `${closureId}: ${summary}`, assetId: closureId, assetType: 'Closure' },
      ],
    },
  );
}

/**
 * "Entered by mistake". Phase 8: never a hard delete any more. The splice stays in the closure's
 * history with when, who and why (see `markSpliceEnteredByMistake`).
 */
export function removeSplice(
  data: NetworkData,
  closureId: string,
  spliceId: string,
  reason = 'Entered by mistake',
  ctx: CommandContext = {},
): CommandResult<SpliceRecord> {
  return markSpliceEnteredByMistake(data, closureId, spliceId, reason, ctx);
}
