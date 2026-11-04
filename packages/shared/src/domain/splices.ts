import type { JointClosure, SpliceRecord } from '../model/types';
import { type CommandResult, type NetworkData, fail, notice, succeed } from './command';

const usesEndpoint = (s: SpliceRecord, cableId: string, core: number) =>
  (s.inputCableId === cableId && s.inputCore === core) || (s.outputCableId === cableId && s.outputCore === core);

const withSplices = (data: NetworkData, closureId: string, edit: (splices: SpliceRecord[]) => SpliceRecord[]) =>
  data.closures.map((c): JointClosure => (c.id === closureId ? { ...c, splices: edit(c.splices) } : c));

/** Records a splice. A core can only be terminated once per closure (it may be spliced again further along). */
export function addSplice(data: NetworkData, closureId: string, splice: SpliceRecord): CommandResult<SpliceRecord> {
  const closure = data.closures.find((c) => c.id === closureId);
  if (!closure) return fail('Closure Missing', `Joint closure ${closureId} was not found.`);
  if (splice.inputCableId === splice.outputCableId && splice.inputCore === splice.outputCore) {
    return fail('Invalid Splice', 'A core cannot be spliced to itself.');
  }
  const duplicate = closure.splices.some(
    (s) =>
      usesEndpoint(s, splice.inputCableId, splice.inputCore) ||
      usesEndpoint(s, splice.outputCableId, splice.outputCore),
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

export function removeSplice(data: NetworkData, closureId: string, spliceId: string): CommandResult<SpliceRecord> {
  const closure = data.closures.find((c) => c.id === closureId);
  if (!closure) return fail('Closure Missing', `Joint closure ${closureId} was not found.`);
  const splice = closure.splices.find((s) => s.id === spliceId);
  if (!splice) return fail('Splice Missing', `Splice ${spliceId} was not found in ${closureId}.`);

  return succeed(
    splice,
    { closures: withSplices(data, closureId, (splices) => splices.filter((s) => s.id !== spliceId)) },
    {
      notice: notice('info', 'Splice Removed', `Deleted splice from closure ${closureId}`),
      audit: [
        {
          action: 'SPLICE_REMOVED',
          details: `${closureId}: removed ${splice.inputCableId} core ${splice.inputCore} → ${splice.outputCableId} core ${splice.outputCore}`,
          assetId: closureId,
          assetType: 'Closure',
        },
      ],
    },
  );
}
