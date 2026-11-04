import { describe, expect, it } from 'vitest';

import { changeSetSchema, createBackup, parseBackup, routeRequestSchema } from '../src/model/api';
import { COLLECTION_NAMES, networkSnapshotSchema } from '../src/model/collections';
import { createSampleNetwork } from '../src/sample';

describe('sample network', () => {
  it('validates against the collection schemas', () => {
    const result = networkSnapshotSchema.safeParse(createSampleNetwork());
    expect(result.success ? [] : result.error.issues.slice(0, 5)).toEqual([]);
  });

  it('returns an independent copy each time', () => {
    const first = createSampleNetwork();
    first.equipment[0].name = 'changed';
    expect(createSampleNetwork().equipment[0].name).not.toBe('changed');
  });

  it('has unique ids within every collection', () => {
    const sample = createSampleNetwork();
    for (const name of COLLECTION_NAMES) {
      const ids = sample[name].map((record) => record.id);
      expect(new Set(ids).size, name).toBe(ids.length);
    }
  });
});

describe('parseBackup', () => {
  it('round-trips the current envelope format', () => {
    const data = createSampleNetwork();
    const result = parseBackup(createBackup(data, '2026-11-04T09:30:00.000Z', [17.4, 78.4]));
    expect(result).toEqual({ ok: true, backup: { collections: data, projectStartPoint: [17.4, 78.4] } });
  });

  it('maps legacy flat backups and their old key names', () => {
    const data = createSampleNetwork();
    const legacy = {
      version: '3.0.0',
      timestamp: '2026-01-01T00:00:00.000Z',
      projectStartPoint: [17.4, 78.4],
      equipments: data.equipment,
      cables: data.cables,
      customComponents: [],
    };
    const result = parseBackup(legacy);
    expect(result.ok && result.backup.collections).toEqual({
      equipment: data.equipment,
      cables: data.cables,
      catalog: [],
    });
  });

  it('rejects non-objects and files without network data', () => {
    expect(parseBackup('nope')).toMatchObject({ ok: false });
    expect(parseBackup({ hello: 'world' })).toEqual({
      ok: false,
      error: 'The file does not contain any FiberGIS network data.',
    });
  });

  it('reports the first invalid record with its path', () => {
    const result = parseBackup({ cables: [{ id: 'C1' }] });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/^Invalid backup data \(cables\.0\./);
  });
});

describe('request schemas', () => {
  it('accepts valid change sets and rejects unknown collections', () => {
    const cable = createSampleNetwork().cables[0];
    expect(changeSetSchema.safeParse({ upserts: { cables: [cable] }, deletes: { faults: ['F1'] } }).success).toBe(true);
    expect(changeSetSchema.safeParse({ upserts: { widgets: [] } }).success).toBe(false);
    expect(changeSetSchema.safeParse({ deletes: { cables: [''] } }).success).toBe(false);
  });

  it('requires at least two route points', () => {
    expect(routeRequestSchema.safeParse({ points: [[17.4, 78.4]] }).success).toBe(false);
    expect(
      routeRequestSchema.safeParse({
        points: [
          [17.4, 78.4],
          [17.5, 78.5],
        ],
      }).success,
    ).toBe(true);
  });
});
