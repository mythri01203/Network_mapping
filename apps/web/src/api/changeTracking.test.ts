import { type NetworkSnapshot, changeSetSchema } from '@fibergis/shared';
import { createSampleNetwork } from '@fibergis/shared/sample';
import { describe, expect, it } from 'vitest';
import {
  buildChangeSet,
  changedIds,
  countPending,
  differingCollections,
  isEmptyPending,
  mergePending,
  omitCollections,
  reconcile,
  sameValue,
} from './changeTracking';

const sample = (): NetworkSnapshot => createSampleNetwork();

describe('changedIds', () => {
  it('reports added, replaced and removed records by reference', () => {
    const prev = sample();
    const [first, second, ...rest] = prev.equipment;
    const next: NetworkSnapshot = {
      ...prev,
      equipment: [{ ...first, name: 'Renamed' }, ...rest, { ...second, id: 'NEW-1' }],
    };
    expect(changedIds(prev, next)).toEqual({ equipment: [first.id, 'NEW-1', second.id] });
  });

  it('skips collections whose array is unchanged', () => {
    const prev = sample();
    expect(changedIds(prev, { ...prev })).toEqual({});
  });

  it('compares by content when given sameValue', () => {
    const prev = sample();
    const copy: NetworkSnapshot = { ...prev, cables: prev.cables.map((cable) => ({ ...cable })) };
    expect(changedIds(prev, copy)).toEqual({ cables: prev.cables.map((cable) => cable.id) });
    expect(changedIds(prev, copy, sameValue)).toEqual({});
  });
});

describe('pending id helpers', () => {
  it('merges without duplicates and counts ids', () => {
    const merged = mergePending({ equipment: ['A', 'B'] }, { equipment: ['B', 'C'], cables: ['X'] }, {});
    expect(merged).toEqual({ equipment: ['A', 'B', 'C'], cables: ['X'] });
    expect(countPending(merged)).toBe(4);
    expect(isEmptyPending(merged)).toBe(false);
    expect(isEmptyPending(mergePending({}, { cables: [] }))).toBe(true);
  });

  it('drops whole collections', () => {
    expect(omitCollections({ equipment: ['A'], cables: ['X'] }, ['equipment'])).toEqual({ cables: ['X'] });
  });
});

describe('buildChangeSet', () => {
  it('upserts records that exist locally and deletes the rest', () => {
    const snapshot = sample();
    const kept = snapshot.equipment[0];
    const changes = buildChangeSet({ equipment: [kept.id, 'GONE'] }, snapshot);
    expect(changes).toEqual({ upserts: { equipment: [kept] }, deletes: { equipment: ['GONE'] } });
  });

  it('omits empty sections', () => {
    expect(buildChangeSet({}, sample())).toEqual({});
    expect(buildChangeSet({ cables: ['GONE'] }, sample())).toEqual({ deletes: { cables: ['GONE'] } });
  });

  it('produces change sets the server accepts', () => {
    const snapshot = sample();
    const pending = Object.fromEntries(
      Object.entries(snapshot).map(([name, records]) => [name, (records as { id: string }[]).map((r) => r.id)]),
    );
    const result = changeSetSchema.safeParse(buildChangeSet({ ...pending, faults: ['GONE'] }, snapshot));
    expect(result.success, result.error?.message).toBe(true);
  });
});

describe('sameValue', () => {
  it('ignores key order and undefined properties', () => {
    expect(sameValue({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1, d: undefined })).toBe(true);
  });

  it('detects differences in nested values and shapes', () => {
    expect(sameValue({ a: [1, 2] }, { a: [1, 3] })).toBe(false);
    expect(sameValue({ a: [1] }, { a: { 0: 1 } })).toBe(false);
    expect(sameValue({ a: null }, { a: {} })).toBe(false);
    expect(sameValue({ a: 1 }, { a: 1, b: 0 })).toBe(false);
  });
});

describe('reconcile', () => {
  it('takes server versions of records without pending edits', () => {
    const local = sample();
    const server = sample();
    const target = server.equipment[0];
    server.equipment = [{ ...target, name: 'Edited elsewhere' }, ...server.equipment.slice(1)];
    server.cables = server.cables.slice(1);

    const merged = reconcile(server, local, {});
    expect(merged.equipment[0].name).toBe('Edited elsewhere');
    expect(merged.cables.map((cable) => cable.id)).toEqual(server.cables.map((cable) => cable.id));
  });

  it('keeps local versions of pending records, including deletions and new records', () => {
    const local = sample();
    const server = sample();
    const [edited, removed] = local.equipment;
    local.equipment = [
      { ...edited, name: 'Mine' },
      ...local.equipment.slice(2),
      { ...edited, id: 'LOCAL-NEW', name: 'New' },
    ];
    server.equipment = [{ ...server.equipment[0], name: 'Theirs' }, ...server.equipment.slice(1)];

    const merged = reconcile(server, local, { equipment: [edited.id, removed.id, 'LOCAL-NEW'] });
    const byId = new Map(merged.equipment.map((item) => [item.id, item]));
    expect(byId.get(edited.id)?.name).toBe('Mine');
    expect(byId.has(removed.id)).toBe(false);
    expect(byId.get('LOCAL-NEW')?.name).toBe('New');
  });

  it('preserves local object identity when nothing changed', () => {
    const local = sample();
    const server = sample();
    const merged = reconcile(server, local, {});
    expect(differingCollections(local, merged)).toEqual({});
    expect(merged.equipment).toBe(local.equipment);
  });

  it('orders audit logs newest first', () => {
    const local = sample();
    const server = sample();
    const base = local.auditLogs[0];
    server.auditLogs = [
      { ...base, id: 'old', timestamp: '2020-01-01T00:00:00.000Z' },
      { ...base, id: 'new', timestamp: '2030-01-01T00:00:00.000Z' },
    ];
    local.auditLogs = [];
    expect(reconcile(server, local, {}).auditLogs.map((log) => log.id)).toEqual(['new', 'old']);
  });
});
