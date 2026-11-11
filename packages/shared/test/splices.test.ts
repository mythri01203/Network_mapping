import { describe, expect, it } from 'vitest';

import { applyPatch } from '../src/domain/command';
import { addSplice, removeSplice } from '../src/domain/splices';
import { closure, emptyNetwork, splice } from './fixtures';

const network = () => ({ ...emptyNetwork(), closures: [closure({ id: 'JC-1', splices: [splice({ id: 'S1' })] })] });

describe('addSplice', () => {
  it('fails for an unknown closure', () => {
    expect(addSplice(network(), 'JC-404', splice({ id: 'S2' }))).toMatchObject({
      ok: false,
      error: { title: 'Closure Missing' },
    });
  });

  it('refuses to splice a core to itself', () => {
    const self = splice({ id: 'S2', inputCableId: 'CBL-A', outputCableId: 'CBL-A', inputCore: 5, outputCore: 5 });
    expect(addSplice(network(), 'JC-1', self)).toMatchObject({ ok: false, error: { title: 'Invalid Splice' } });
  });

  it('refuses a core that is already terminated in the closure', () => {
    const reused = splice({ id: 'S2', inputCableId: 'CBL-B', inputCore: 1, outputCableId: 'CBL-C', outputCore: 1 });
    expect(addSplice(network(), 'JC-1', reused)).toMatchObject({ ok: false, error: { title: 'Duplicate Endpoint' } });
  });

  it('records a new splice', () => {
    const data = network();
    const next = splice({ id: 'S2', inputCore: 2, outputCore: 2 });
    const result = addSplice(data, 'JC-1', next);
    if (!result.ok) throw new Error(result.error.message);
    expect(applyPatch(data, result.patch).closures[0].splices.map((s) => s.id)).toEqual(['S1', 'S2']);
    expect(result.audit[0]).toMatchObject({ action: 'SPLICE_ADDED', assetId: 'JC-1' });
  });
});

describe('removeSplice', () => {
  it('keeps the splice as history, struck out as entered by mistake (Phase 8: no hard delete)', () => {
    const data = network();
    const result = removeSplice(data, 'JC-1', 'S1', 'Wrong fiber chosen', { actor: 'Asha', now: new Date('2026-11-10T09:00:00.000Z') });
    if (!result.ok) throw new Error(result.error.message);
    const [kept] = applyPatch(data, result.patch).closures[0].splices;
    expect(kept).toMatchObject({ id: 'S1', enteredInError: true, retiredAt: '2026-11-10T09:00:00.000Z', retiredBy: 'Asha', retiredReason: 'Wrong fiber chosen' });
    expect(result.audit[0]).toMatchObject({ action: 'SPLICE_ENTERED_BY_MISTAKE', assetId: 'JC-1' });
  });

  it('lets the same fibers be spliced again once the mistaken record is struck out', () => {
    const data = network();
    const removed = removeSplice(data, 'JC-1', 'S1');
    if (!removed.ok) throw new Error(removed.error.message);
    const after = applyPatch(data, removed.patch);
    const again = addSplice(after, 'JC-1', splice({ id: 'S2' }));
    expect(again.ok).toBe(true);
  });

  it('fails for an unknown splice', () => {
    expect(removeSplice(network(), 'JC-1', 'S9')).toMatchObject({ ok: false, error: { title: 'Splice Missing' } });
  });
});
