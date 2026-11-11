import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  type ChangeSet,
  checkChangeSetCatalog,
  checkChangeSetLinks,
  type CollectionName,
  type LinkCheckData,
  type NetworkSnapshot,
} from '@fibergis/shared';
import { createSampleNetwork } from '@fibergis/shared/sample';

import type { CollectionReader } from '../src/db/repository';
import { SqliteNetworkRepository } from '../src/db/sqliteRepository';
import { changeSetGuard } from '../src/lib/linkGuard';
import { catalogCheckReader, collectionsRead, LINK_COLLECTIONS, linkCheckReader } from '../src/lib/targetedReads';

/**
 * Phase 24: the targeted link checks must give exactly the answer of the old whole-collection reads.
 * The sample network, with poles, spans, attachments, ducts, slack loops, permissions, inspections
 * and catalogue models added (some already broken), gets hundreds of random change sets. For each,
 * the problem lists of the link and catalogue checks are compared in full (old reads against
 * targeted reads), and the whole guard's answer is compared with the old reads against the
 * repository's shared, frozen reader (so a check that changed a record it was given would fail).
 */

const ABORT = new Error('abort: compared only, nothing written');

// 600 change sets, each checked four ways.
vi.setConfig({ testTimeout: 120_000 });

let repository: SqliteNetworkRepository;

/** Small seeded random numbers, so a failure can be repeated. */
function random(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const sample = createSampleNetwork();
const basePole = sample.equipment.find((e) => e.id === 'POLE-01')!;

function network(): Partial<NetworkSnapshot> {
  const poles = Array.from({ length: 30 }, (_, i) => ({
    ...basePole,
    id: `P-${i}`,
    name: `Pole ${i}`,
    lat: basePole.lat + i * 0.0003,
    lng: basePole.lng + (i % 5) * 0.0002,
    ...(i % 4 === 0 ? { catalogModelId: `CAT-${i % 3}` } : i % 7 === 0 ? { catalogModelId: 'CAT-GONE' } : {}),
  }));
  const catalog = Array.from({ length: 4 }, (_, i) => ({ id: `CAT-${i}`, type: 'Pole', category: 'OSP', name: `Model ${i}`, description: '', iconBg: '#fff' }));
  const cables = sample.cables.map((c) => c.id);
  const spans = poles.slice(1).map((p, i) => ({ id: `S-${i}`, name: `Span ${i}`, fromStructureId: poles[i].id, toStructureId: p.id, status: 'built', basis: 'field_sequence', createdAt: '2026-01-01' }));
  // One already broken: it names a pole that is not there.
  spans.push({ id: 'S-BROKEN', name: 'Broken', fromStructureId: 'P-0', toStructureId: 'P-MISSING', status: 'built', basis: 'field_sequence', createdAt: '2026-01-01' });
  const attachments = Array.from({ length: 25 }, (_, i) => ({
    id: `A-${i}`,
    cableId: cables[i % cables.length],
    ...(i % 3 === 0 ? { spanId: `S-${i % 29}` } : { structureId: `P-${i % 30}` }),
    status: 'active',
    basis: 'field_sequence',
    createdAt: '2026-01-01',
  }));
  const ducts = Array.from({ length: 6 }, (_, i) => ({
    id: `D-${i}`,
    name: `Duct ${i}`,
    coordinates: [
      [basePole.lat, basePole.lng],
      [basePole.lat + 0.001, basePole.lng + 0.001],
    ],
    fromStructureId: `P-${i}`,
    toStructureId: `P-${i + 1}`,
    cableIds: [cables[i % cables.length]],
    subducts: [{ id: `D-${i}-W1`, label: 'W1', cableIds: i % 2 ? [cables[(i + 1) % cables.length]] : [], ...(i === 2 ? { condition: 'blocked' } : {}) }],
    ...(i === 4 ? { condition: 'blocked' } : {}),
    createdAt: '2026-01-01',
  }));
  const slackLoops = Array.from({ length: 8 }, (_, i) => ({ id: `L-${i}`, cableId: cables[i % cables.length], structureId: `P-${i * 2}`, lat: basePole.lat, lng: basePole.lng, lengthMeters: 10, createdAt: '2026-01-01' }));
  const permissions = Array.from({ length: 4 }, (_, i) => ({ id: `PM-${i}`, authority: 'BESCOM', structureIds: [`P-${i}`, `P-${i + 3}`], cableIds: [cables[i]], createdAt: '2026-01-01' }));
  const inspections = Array.from({ length: 6 }, (_, i) => ({
    id: `I-${i}`,
    targetType: (['pole', 'span', 'duct'] as const)[i % 3],
    targetId: [`P-${i}`, `S-${i}`, `D-${i % 6}`][i % 3],
    inspectedOn: '2026-01-01',
    inspectedBy: 'Ravi',
    condition: 'good',
    createdAt: '2026-01-01',
  }));
  return { ...sample, equipment: [...sample.equipment, ...poles], catalog, spans, attachments, ducts, slackLoops, permissions, inspections } as unknown as Partial<NetworkSnapshot>;
}

/** A random change set over what is stored now. */
function randomChanges(rnd: () => number, data: NetworkSnapshot): ChangeSet {
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)] ?? ('MISSING-EMPTY' as T);
  const ids = (name: CollectionName) => (data[name] as { id: string }[]).map((r) => r.id);
  const someId = (name: CollectionName) => (rnd() < 0.15 ? `MISSING-${Math.floor(rnd() * 3)}` : pick(ids(name)));
  const upserts: Record<string, unknown[]> = {};
  const deletes: Record<string, string[]> = {};
  const up = (name: string, record: unknown) => (upserts[name] ??= []).push(record);
  const del = (name: string, id: string) => (deletes[name] ??= []).push(id);
  const ops = 1 + Math.floor(rnd() * 4);
  for (let i = 0; i < ops; i += 1) {
    const op = Math.floor(rnd() * 14);
    if (op === 0) del('equipment', pick(ids('equipment')));
    else if (op === 1) del('cables', pick(ids('cables')));
    else if (op === 2) del('spans', pick(ids('spans')));
    else if (op === 3) del('ducts', pick(ids('ducts')));
    else if (op === 4) del('catalog', pick(ids('catalog')));
    else if (op === 5) {
      const name = pick(['attachments', 'slackLoops', 'permissions', 'inspections'] as CollectionName[]);
      del(name, pick(ids(name)));
    } else if (op === 6) {
      const from = someId('equipment');
      up('spans', { id: rnd() < 0.5 ? pick(ids('spans')) : `S-NEW-${i}`, name: 'New span', fromStructureId: from, toStructureId: rnd() < 0.1 ? from : someId('equipment'), status: 'built', basis: 'field_sequence', createdAt: '2026-01-02' });
    } else if (op === 7) {
      up('attachments', { id: rnd() < 0.5 ? pick(ids('attachments')) : `A-NEW-${i}`, cableId: someId('cables'), ...(rnd() < 0.5 ? { spanId: someId('spans') } : { structureId: someId('equipment') }), status: 'active', basis: 'field_sequence', createdAt: '2026-01-02' });
    } else if (op === 8) {
      const duct = structuredClone(pick(data.ducts as unknown as Record<string, unknown>[]));
      const cable = someId('cables');
      duct.cableIds = rnd() < 0.2 ? [cable, cable] : [cable];
      (duct.subducts as { cableIds: string[]; condition?: string }[])[0].cableIds = rnd() < 0.5 ? [someId('cables')] : [];
      if (rnd() < 0.3) (duct.subducts as { condition?: string }[])[0].condition = pick(['clear', 'damaged', 'blocked']);
      if (rnd() < 0.3) duct.condition = pick(['clear', 'blocked']);
      if (rnd() < 0.3) duct.fromStructureId = someId('equipment');
      if (rnd() < 0.2) duct.id = `D-NEW-${i}`;
      up('ducts', duct);
    } else if (op === 9) {
      const item = structuredClone(pick(data.equipment)) as unknown as Record<string, unknown>;
      if (rnd() < 0.7) item.catalogModelId = rnd() < 0.3 ? 'CAT-GONE' : someId('catalog');
      else delete item.catalogModelId;
      if (rnd() < 0.2) item.id = `P-NEW-${i}`;
      up('equipment', item);
    } else if (op === 10) {
      up('catalog', { id: rnd() < 0.5 ? 'CAT-GONE' : `CAT-NEW-${i}`, type: 'Pole', category: 'OSP', name: 'New', description: '', iconBg: '#fff' });
    } else if (op === 11) {
      up('permissions', { id: rnd() < 0.5 ? pick(ids('permissions')) : `PM-NEW-${i}`, authority: 'BBMP', structureIds: [someId('equipment'), someId('equipment')], cableIds: [someId('cables')], createdAt: '2026-01-02' });
    } else if (op === 12) {
      const t = pick(['pole', 'span', 'duct'] as const);
      up('inspections', { id: rnd() < 0.5 ? pick(ids('inspections')) : `I-NEW-${i}`, targetType: t, targetId: t === 'pole' ? someId('equipment') : t === 'span' ? someId('spans') : someId('ducts'), inspectedOn: '2026-01-02', inspectedBy: 'Ravi', condition: 'fair', createdAt: '2026-01-02' });
    } else {
      // Deleted and stored again in the same change.
      const span = pick(data.spans as unknown as { id: string }[]);
      del('spans', span.id);
      up('spans', { ...span, name: 'Again' });
    }
  }
  return { ...(Object.keys(upserts).length ? { upserts } : {}), ...(Object.keys(deletes).length ? { deletes } : {}) } as ChangeSet;
}

const linkData = (read: CollectionReader) => Object.fromEntries(LINK_COLLECTIONS.map((name) => [name, read(name)])) as unknown as LinkCheckData;

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

describe('targeted link checks give the same answer as whole reads', () => {
  it('on random change sets over the sample network', async () => {
    const rnd = random(24);
    let targetedLinks = 0;
    let targetedCatalog = 0;
    let refused = 0;
    let compared = 0;
    for (let round = 0; round < 600; round += 1) {
      const { data } = await repository.getNetwork();
      const changes = randomChanges(rnd, data);
      // The old reader: a fresh copy of the stored records for every read, no targeted reads.
      const old = (<C extends CollectionName>(name: C) => structuredClone(data[name])) as CollectionReader;
      const guard = changeSetGuard(changes);
      const expected = guard ? outcome(() => guard(old)) : 'passed';
      await expect(
        repository.applyChanges(changes, (read) => {
          const links = linkCheckReader(read, changes, collectionsRead(linkData));
          if (links) targetedLinks += 1;
          expect(checkChangeSetLinks(linkData(links ?? read), changes)).toEqual(checkChangeSetLinks(linkData(old), changes));
          const catalog = catalogCheckReader(read, changes);
          if (catalog) targetedCatalog += 1;
          const catalogData = (r: CollectionReader) => ({ equipment: r('equipment'), catalog: r('catalog') });
          expect(checkChangeSetCatalog(catalogData(catalog ?? read), changes)).toEqual(checkChangeSetCatalog(catalogData(old), changes));
          // The whole guard, with the repository's shared reader, every record frozen.
          const frozen = Object.assign(<C extends CollectionName>(name: C) => deepFreeze(read(name)), { find: read.find }) as CollectionReader;
          expect(guard ? outcome(() => guard(frozen)) : 'passed').toBe(expected);
          compared += 1;
          throw ABORT;
        }),
      ).rejects.toBe(ABORT);
      if (expected !== 'passed') refused += 1;
      // Now and then a change is really stored (without checks), so stored problems pile up too.
      if (round % 40 === 39) await repository.applyChanges(randomChanges(rnd, data));
    }
    expect(compared).toBe(600);
    // The targeted path was really taken, and the cases include refusals and passes.
    expect(targetedLinks).toBeGreaterThan(200);
    expect(targetedCatalog).toBeGreaterThan(100);
    expect(refused).toBeGreaterThan(50);
    expect(refused).toBeLessThan(600);
  });

  it('falls back to whole reads for a collection it does not know, and without targeted reads', () => {
    const plain = (() => [] as unknown[]) as unknown as CollectionReader;
    expect(linkCheckReader(plain, { deletes: { equipment: ['P-1'] } }, new Set(['equipment']))).toBeUndefined();
    const withFind = Object.assign(plain, { find: { byIds: () => [], mentioning: () => [] } });
    expect(linkCheckReader(withFind, { deletes: { equipment: ['P-1'] } }, new Set(['equipment', 'sites' as CollectionName]))).toBeUndefined();
    expect(linkCheckReader(withFind, { deletes: { equipment: ['P-1'] } }, new Set(['equipment']))).toBeDefined();
  });
});
