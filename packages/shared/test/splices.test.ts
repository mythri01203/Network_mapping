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
  it('removes an existing splice', () => {
    const data = network();
    const result = removeSplice(data, 'JC-1', 'S1');
    if (!result.ok) throw new Error(result.error.message);
    expect(applyPatch(data, result.patch).closures[0].splices).toEqual([]);
  });

  it('fails for an unknown splice', () => {
    expect(removeSplice(network(), 'JC-1', 'S9')).toMatchObject({ ok: false, error: { title: 'Splice Missing' } });
  });
});
