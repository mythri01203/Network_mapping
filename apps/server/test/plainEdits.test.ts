import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { ChangeSet, CollectionName, NetworkSnapshot } from '@fibergis/shared';
import { createSampleNetwork } from '@fibergis/shared/sample';

import type { CollectionReader } from '../src/db/repository';
import { SqliteNetworkRepository } from '../src/db/sqliteRepository';
import { changeSetGuard } from '../src/lib/linkGuard';
import { withPlacementWarnings } from '../src/lib/placementWarnings';
import { isPlainEquipmentEdit, PLAIN_EQUIPMENT_FIELDS, storesOnlyKnownEquipment } from '../src/lib/plainEdits';

/**
 * Phase 24b: an edit of plain item details (a pole renamed) skips the whole-network fibre and site
 * checks and the read of every item for the duplicate warning. This proves the answer is the same:
 * hundreds of random change sets over the sample network (with sites, racks and records that are
 * already broken) are judged by the whole guard twice, once with the shortcut (the repository's
 * reader, which has targeted reads) and once without (a plain reader, which never takes it). The
 * refusal or pass, its message and the warnings must match in full.
 */

const ABORT = new Error('abort: compared only, nothing written');
vi.setConfig({ testTimeout: 180_000 });

let repository: SqliteNetworkRepository;

function random(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const sample = createSampleNetwork();

function network(): Partial<NetworkSnapshot> {
  const pole = sample.equipment.find((e) => e.id === 'POLE-01')!;
  const sites = [
    { id: 'SITE-1', name: 'Main exchange' },
    { id: 'SITE-2', name: 'Hub room' },
  ];
  const racks = [
    { id: 'RACK-1', siteId: 'SITE-1', name: 'Rack 1', heightUnits: 10 },
    { id: 'RACK-2', siteId: 'SITE-2', name: 'Rack 2', heightUnits: 4 },
  ];
  const extra = Array.from({ length: 12 }, (_, i) => ({
    ...pole,
    id: `P-${i}`,
    name: `Pole ${i}`,
    lat: pole.lat + i * 0.0003,
    lng: pole.lng + (i % 4) * 0.0002,
    ...(i % 3 === 0 ? { siteId: 'SITE-1', rackId: 'RACK-1', rackUnit: 1 + i, rackUnits: 1 } : {}),
    // Already broken: a site that is not on record.
    ...(i === 5 ? { siteId: 'SITE-GONE' } : {}),
  }));
  const [firstCable] = sample.cables;
  // Already broken: a cable end at an item that is not on record.
  const brokenCable = { ...firstCable, id: 'CBL-BROKEN', name: 'Broken cable', startEquipmentId: 'EQ-GONE' };
  return { ...sample, equipment: [...sample.equipment, ...extra], cables: [...sample.cables, brokenCable], sites, racks } as unknown as Partial<NetworkSnapshot>;
}

const PLAIN = [...PLAIN_EQUIPMENT_FIELDS];
const NOT_PLAIN = ['status', 'lat', 'lng', 'siteId', 'rackId', 'rackUnit', 'rackUnits', 'technology', 'ponPorts', 'odfPanels', 'chassis', 'type', 'catalogModelId', 'logicalPorts'];

function plainValue(rnd: () => number, field: string, data: NetworkSnapshot): unknown {
  const r = rnd();
  if (r < 0.15) return undefined;
  if (field === 'name') return r < 0.5 ? data.equipment[Math.floor(rnd() * data.equipment.length)].name : `Renamed ${Math.floor(rnd() * 1000)}`;
  if (field === 'images') return [];
  if (field === 'maintenance') return [{ id: `M-${Math.floor(rnd() * 100)}`, date: '2026-11-01', by: 'Ravi', what: 'Cleaned' }];
  if (field === 'customAttributes') return { colour: 'green' };
  if (field === 'installedDate') return '2026-01-02';
  if (field === 'warrantyUntil') return '2028-01-01';
  if (field === 'condition') return 'fair';
  if (field === 'ownerType') return 'telecom';
  if (field === 'material') return 'concrete';
  return `value ${Math.floor(rnd() * 100)}`;
}

function notPlainValue(rnd: () => number, field: string, item: Record<string, unknown>): unknown {
  const r = rnd();
  if (field === 'status') return r < 0.5 ? 'Inactive' : 'Active';
  if (field === 'lat' || field === 'lng') return (item[field] as number) + 0.0001;
  if (field === 'siteId') return r < 0.3 ? 'SITE-GONE' : r < 0.6 ? 'SITE-2' : undefined;
  if (field === 'rackId') return r < 0.3 ? 'RACK-GONE' : r < 0.6 ? 'RACK-2' : 'RACK-1';
  if (field === 'rackUnit') return 1 + Math.floor(r * 12);
  if (field === 'rackUnits') return 1 + Math.floor(r * 4);
  if (field === 'technology') return r < 0.5 ? 'EPON' : 'XGS-PON';
  if (field === 'ponPorts') {
    const ports = (item.ponPorts as unknown[] | undefined) ?? [];
    return r < 0.5 ? [] : [...ports, ...ports];
  }
  if (field === 'catalogModelId') return r < 0.5 ? 'CAT-GONE' : undefined;
  if (field === 'type') return r < 0.5 ? 'OLT' : 'Telecom Pole';
  return undefined;
}

/** A random change set: mostly edits of items, plain or not, sometimes with other records. */
function randomChanges(rnd: () => number, data: NetworkSnapshot): ChangeSet {
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)];
  const upserts: Record<string, unknown[]> = {};
  const deletes: Record<string, string[]> = {};
  const edits = 1 + Math.floor(rnd() * 3);
  for (let i = 0; i < edits; i += 1) {
    const item = structuredClone(pick(data.equipment)) as unknown as Record<string, unknown>;
    const set = (field: string, value: unknown) => {
      if (value === undefined) delete item[field];
      else item[field] = value;
    };
    for (let k = 0, n = 1 + Math.floor(rnd() * 3); k < n; k += 1) {
      const field = pick(PLAIN);
      // name and images are required by the schema; the guard does not parse, but keep them real.
      const value = plainValue(rnd, field, data);
      set(field, value === undefined && (field === 'name' || field === 'images' || field === 'area' || field === 'street' || field === 'installedDate') ? item[field] : value);
    }
    const kind = rnd();
    if (kind < 0.25) {
      const field = pick(NOT_PLAIN);
      set(field, notPlainValue(rnd, field, item));
    } else if (kind < 0.3) {
      item.id = `P-NEW-${Math.floor(rnd() * 1000)}`;
    }
    (upserts.equipment ??= []).push(item);
  }
  const extra = rnd();
  if (extra < 0.05) (deletes.equipment ??= []).push(pick(data.equipment).id);
  else if (extra < 0.1) (upserts.cables ??= []).push({ ...pick(data.cables), endEquipmentId: rnd() < 0.5 ? 'EQ-GONE' : pick(data.equipment).id });
  else if (extra < 0.13) (upserts.racks ??= []).push({ ...pick(data.racks), heightUnits: 1 + Math.floor(rnd() * 3) });
  else if (extra < 0.16) (deletes.sites ??= []).push(pick(data.sites).id);
  else if (extra < 0.19 && data.customers.length) (upserts.customers ??= []).push({ ...pick(data.customers), splitterId: 'SPL-GONE' });
  return { upserts, ...(Object.keys(deletes).length ? { deletes } : {}) } as ChangeSet;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

const outcome = (run: () => void) => {
  try {
    run();
    return 'passed';
  } catch (error) {
    return `${(error as { code?: string }).code ?? 'error'}: ${(error as Error).message}`;
  }
};

beforeAll(async () => {
  repository = new SqliteNetworkRepository(':memory:');
  await repository.replaceCollections(network());
});
afterAll(() => repository.close());

describe('plain item edits skip the whole-network checks with the same answer', () => {
  it('on random change sets over the sample network', async () => {
    const rnd = random(2424);
    let plain = 0;
    let known = 0;
    let refused = 0;
    let warned = 0;
    let compared = 0;
    for (let round = 0; round < 600; round += 1) {
      const { data } = await repository.getNetwork();
      const changes = randomChanges(rnd, data);
      // Without targeted reads: the shortcut is never taken, as before Phase 24b.
      const old = (<C extends CollectionName>(name: C) => structuredClone(data[name])) as CollectionReader;
      const before = withPlacementWarnings(changes, changeSetGuard(changes));
      const expected = before.guard ? outcome(() => before.guard!(old)) : 'passed';
      const after = withPlacementWarnings(changes, changeSetGuard(changes));
      await expect(
        repository.applyChanges(changes, (read) => {
          if (isPlainEquipmentEdit(read, changes)) plain += 1;
          if (storesOnlyKnownEquipment(read, changes)) known += 1;
          const frozen = Object.assign(<C extends CollectionName>(name: C) => deepFreeze(read(name)), { find: read.find }) as CollectionReader;
          expect(after.guard ? outcome(() => after.guard!(frozen)) : 'passed').toBe(expected);
          expect(after.warnings).toEqual(before.warnings);
          compared += 1;
          throw ABORT;
        }),
      ).rejects.toBe(ABORT);
      if (expected !== 'passed') refused += 1;
      if (before.warnings.length > 0) warned += 1;
      // Now and then a change is really stored (without checks), so stored problems pile up too.
      if (round % 50 === 49) await repository.applyChanges(randomChanges(rnd, data));
    }
    expect(compared).toBe(600);
    // The shortcut was really taken, and the cases include refusals, passes and warnings.
    expect(plain).toBeGreaterThan(200);
    expect(known).toBeGreaterThan(plain);
    expect(refused).toBeGreaterThan(30);
    expect(refused).toBeLessThan(600);
    expect(warned).toBeGreaterThan(0);
  });

  it('is never taken without targeted reads, for new or deleted items, or with other records', () => {
    const stored = sample.equipment[0] as unknown as Record<string, unknown>;
    const find = { byIds: (_n: CollectionName, ids: Iterable<string>) => ([...ids].includes(stored.id as string) ? [stored] : []), mentioning: () => [] };
    const read = Object.assign((() => []) as unknown as CollectionReader, { find }) as CollectionReader;
    const renamed = { upserts: { equipment: [{ ...stored, name: 'New name' }] } } as unknown as ChangeSet;
    expect(isPlainEquipmentEdit(read, renamed)).toBe(true);
    expect(isPlainEquipmentEdit((() => []) as unknown as CollectionReader, renamed)).toBe(false);
    expect(isPlainEquipmentEdit(read, { upserts: { equipment: [{ ...stored, id: 'NEW', name: 'x' }] } } as unknown as ChangeSet)).toBe(false);
    expect(isPlainEquipmentEdit(read, { ...renamed, deletes: { equipment: ['X'] } } as unknown as ChangeSet)).toBe(false);
    expect(isPlainEquipmentEdit(read, { upserts: { ...renamed.upserts, cables: [sample.cables[0]] } } as unknown as ChangeSet)).toBe(false);
    expect(isPlainEquipmentEdit(read, { upserts: { equipment: [{ ...stored, status: 'Inactive' }] } } as unknown as ChangeSet)).toBe(false);
    expect(isPlainEquipmentEdit(read, { upserts: { equipment: [{ ...stored, lat: (stored.lat as number) + 0.001 }] } } as unknown as ChangeSet)).toBe(false);
    expect(storesOnlyKnownEquipment(read, renamed)).toBe(true);
    expect(storesOnlyKnownEquipment(read, { upserts: { equipment: [{ ...stored, id: 'NEW' }] } } as unknown as ChangeSet)).toBe(false);
  });

  it('the fibre and site rules still never read the plain fields', () => {
    // A tripwire: if a rule starts reading one of these fields, the shortcut must be looked at again.
    // `name` is used in messages only (every problem key is built from ids), so it is not searched.
    const source = (path: string) => readFileSync(fileURLToPath(new URL(`../../../packages/shared/src/domain/${path}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
    const sitesRacks = source('sitesRacks.ts');
    const start = sitesRacks.indexOf('export function findSiteRackProblems');
    const siteRules = sitesRacks.slice(start, sitesRacks.indexOf('\n}\n', start));
    expect(start).toBeGreaterThan(-1);
    const oltConfig = source('oltConfig.ts');
    const chassisStart = oltConfig.indexOf('export function oltChassisProblems');
    expect(chassisStart).toBeGreaterThan(-1);
    const chassisRules = oltConfig.slice(chassisStart, oltConfig.indexOf('\n}\n', chassisStart));
    const rules = [source('fiberRules.ts'), source('fiberIndex.ts'), source('closureTrays.ts'), siteRules, chassisRules].join('\n');
    const fields = PLAIN.filter((f) => f !== 'name');
    const read = fields.filter((field) => new RegExp(`\\.${field}\\b|\\['${field}'\\]`).test(rules));
    expect(read).toEqual([]);
  });
});
