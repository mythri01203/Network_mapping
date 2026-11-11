/**
 * Phase 24 measurement: builds a large synthetic network in a temporary database (never the real
 * one) and prints timings for the whole snapshot, map-area queries, incremental sync and guarded
 * writes (old whole-collection guard reads against the targeted ones).
 *
 *   npm run benchmark -w @fibergis/server              (100,000 records)
 *   npm run benchmark -w @fibergis/server -- 20000     (another size)
 *   npm run benchmark -w @fibergis/server -- --write-db=<new file>
 *       (Phase 24b: only writes the same synthetic network to a new database file and stops, for the
 *       browser measurement in e2e/workflows/L-performance.mjs. Refuses a file that exists.)
 */
/* eslint-disable no-console -- a measuring tool: printing is its job. */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { API_PREFIX, type ChangeSet, checkChangeSetCatalog, checkChangeSetFiber, type NetworkSnapshot, newPointDuplicateWarnings } from '@fibergis/shared';
import { createSampleNetwork } from '@fibergis/shared/sample';

import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import type { CollectionReader, WriteGuard } from '../src/db/repository';
import { SpatialIndex } from '../src/db/spatialIndex';
import { SqliteNetworkRepository } from '../src/db/sqliteRepository';
import { changeSetGuard } from '../src/lib/linkGuard';
import { withPlacementWarnings } from '../src/lib/placementWarnings';
import { composeGuards, settingsGuard } from '../src/lib/settingsGuard';

const args = process.argv.slice(2);
const writeDb = args.find((a) => a.startsWith('--write-db='))?.slice('--write-db='.length);
const total = Number(args.find((a) => /^\d+$/.test(a)) ?? 100_000);
if (writeDb !== undefined && (!writeDb || existsSync(writeDb))) throw new Error('--write-db needs the path of a new file (it never overwrites one).');
const dir = mkdtempSync(join(tmpdir(), 'fibergis-benchmark-'));
const path = join(dir, 'bench.db');

const sample = createSampleNetwork();
const pole = sample.equipment.find((e) => e.id === 'POLE-01')!;
const customer = sample.customers[0];
const cable = sample.cables[0];
const origin = { lat: 12.9, lng: 77.55 };

// About 40% poles, 35% spans, 18% customers, 5% cables, 2% attachments; poles in a ~20 km square.
const poles = Math.round(total * 0.4);
const side = Math.ceil(Math.sqrt(poles));
const step = 0.18 / side;
const equipment = Array.from({ length: poles }, (_, i) => ({
  ...pole,
  id: `BP-${i}`,
  name: `Bench pole ${i}`,
  lat: origin.lat + Math.floor(i / side) * step,
  lng: origin.lng + (i % side) * step,
}));
const spans = Array.from({ length: Math.round(total * 0.35) }, (_, i) => ({
  id: `BS-${i}`,
  name: `Bench span ${i}`,
  fromStructureId: `BP-${i % poles}`,
  toStructureId: `BP-${(i + 1) % poles}`,
  status: 'built',
  basis: 'field_sequence',
  createdAt: '2026-01-01',
}));
const customers = Array.from({ length: Math.round(total * 0.18) }, (_, i) => ({
  ...customer,
  id: `BC-${i}`,
  name: `Bench customer ${i}`,
  lat: origin.lat + ((i * 7919) % 1000) * 0.00018,
  lng: origin.lng + ((i * 104729) % 1000) * 0.00018,
}));
const cables = Array.from({ length: Math.round(total * 0.05) }, (_, i) => {
  const start = (i * 37) % poles;
  return {
    ...cable,
    id: `BK-${i}`,
    name: `Bench cable ${i}`,
    coordinates: Array.from({ length: 10 }, (_, k) => [equipment[(start + k) % poles].lat, equipment[(start + k) % poles].lng]),
    startEquipmentId: undefined,
    endEquipmentId: undefined,
  };
});
const attachments = Array.from({ length: Math.round(total * 0.02) }, (_, i) => ({
  id: `BA-${i}`,
  cableId: cables[i % cables.length].id,
  structureId: `BP-${(i * 37) % poles}`,
  status: 'built',
  basis: 'field_sequence',
  createdAt: '2026-01-01',
}));

const data = {
  ...sample,
  equipment: [...sample.equipment, ...equipment],
  spans,
  customers: [...sample.customers, ...customers],
  cables: [...sample.cables, ...cables],
  attachments,
} as unknown as NetworkSnapshot;
const count = Object.values(data).reduce((n, list) => n + (list as unknown[]).length, 0);

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
async function time(label: string, runs: number, work: () => Promise<unknown> | unknown) {
  const results: number[] = [];
  let last: unknown;
  for (let i = 0; i < runs; i += 1) {
    const t = performance.now();
    last = await work();
    results.push(performance.now() - t);
  }
  console.log(`${label.padEnd(58)} ${median(results).toFixed(1).padStart(9)} ms  (median of ${runs})`);
  return last;
}

if (writeDb) {
  const target = new SqliteNetworkRepository(writeDb);
  await time(`Wrote ${count.toLocaleString('en-IN')} records to ${writeDb}`, 1, () => target.replaceCollections(data));
  await target.close();
  rmSync(dir, { recursive: true, force: true });
  process.exit(0);
}

const repository = new SqliteNetworkRepository(path);
try {
  console.log(`Synthetic network: ${count.toLocaleString('en-IN')} records (temporary database ${path})`);
  await time('Load (one replace, index and history included)', 1, () => repository.replaceCollections(data));
  const db = (repository as unknown as { db: DatabaseSync }).db;
  await time('Rebuild the spatial index (what migration 3 does)', 1, () => {
    db.exec('BEGIN IMMEDIATE');
    new SpatialIndex(db).rebuild();
    db.exec('COMMIT');
  });

  const config = { ...loadConfig({ LOG_LEVEL: 'silent', DATABASE_PATH: path, STATIC_DIR: join(dir, 'no-static'), SEED_SAMPLE_DATA: 'false' }), rateLimitPerMinute: 1_000_000 };
  const app = await buildApp({ config, repository });
  const get = (url: string) => app.inject({ method: 'GET', url: `${API_PREFIX}${url}` });
  const post = (url: string, payload: object) => app.inject({ method: 'POST', url: `${API_PREFIX}${url}`, payload });

  const snapshot = (await time('GET /network (whole snapshot, HTTP)', 3, () => get('/network'))) as { body: string };
  console.log(`  snapshot size ${(snapshot.body.length / 1024 / 1024).toFixed(1)} MB`);
  const at = equipment[Math.floor(poles / 2)];
  for (const [label, d] of [
    ['500 m box', 0.0023],
    ['2 km box', 0.009],
  ] as const) {
    const area = (await time(`GET /network/area, ${label}`, 5, () => get(`/network/area?bbox=${at.lat - d},${at.lng - d},${at.lat + d},${at.lng + d}`))) as { body: string; json(): { data: Record<string, unknown[]> } };
    const counts = Object.entries(area.json().data).map(([n, l]) => `${l.length} ${n}`).join(', ');
    console.log(`  ${counts}; ${(area.body.length / 1024).toFixed(0)} KB`);
  }
  await time('GET /spans?limit=1000 (one page)', 5, () => get('/spans?limit=1000&cursor=20000'));

  const since = await repository.getRevision();
  for (let i = 0; i < 20; i += 1) await repository.applyChanges({ upserts: { equipment: [{ ...equipment[i], name: `Edited ${i}` }] } });
  const changes = (await time('GET /changes?since= (20 writes behind)', 5, () => get(`/changes?since=${since}`))) as { body: string };
  console.log(`  answer ${(changes.body.length / 1024).toFixed(1)} KB`);

  // Guarded writes: the route as it is now, and the guard alone with the old reads.
  const old = (repository as unknown as { readCollection: CollectionReader }).readCollection.bind(repository) as CollectionReader;
  const guardOf = (changes: ChangeSet): WriteGuard | undefined => withPlacementWarnings(changes, composeGuards(changeSetGuard(changes), settingsGuard(changes))).guard;
  const cases: [string, () => ChangeSet][] = [
    ['span stored (link check)', () => ({ upserts: { spans: [{ ...spans[5], name: `Renamed ${Math.random()}` }] } } as unknown as ChangeSet)],
    ['attachment stored (link check)', () => ({ upserts: { attachments: [{ ...attachments[3], structureId: 'BP-99' }] } } as unknown as ChangeSet)],
    ['pole renamed (fiber, catalogue, duplicate checks)', () => ({ upserts: { equipment: [{ ...equipment[7], name: `Renamed ${Math.random()}` }] } } as unknown as ChangeSet)],
    // Phase 24b: a move is not a plain detail, so it still takes the whole-network fibre check.
    ['pole moved (full fiber check)', () => ({ upserts: { equipment: [{ ...equipment[9], lat: equipment[9].lat + Math.random() * 1e-5 }] } } as unknown as ChangeSet)],
    ['span deleted (link check)', () => ({ deletes: { spans: [spans[spans.length - 1 - Math.floor(Math.random() * 100)].id] } } as unknown as ChangeSet)],
  ];
  for (const [label, make] of cases) {
    await time(`POST /changes, ${label}`, 5, async () => {
      const res = await post('/changes', make());
      if (res.statusCode !== 200) throw new Error(`${label}: ${res.statusCode} ${res.body}`);
    });
    const abort = new Error('measured');
    await time(`  its guard with the old whole reads`, 3, async () => {
      const changes = make();
      const guard = guardOf(changes);
      await repository.applyChanges(changes, (read) => {
        void read;
        guard?.(old);
        throw abort;
      }).catch((e) => {
        if (e !== abort) throw e;
      });
    });
    await time(`  its guard with the targeted reads`, 3, async () => {
      const changes = make();
      const guard = guardOf(changes);
      await repository.applyChanges(changes, (read) => {
        guard?.(read);
        throw abort;
      }).catch((e) => {
        if (e !== abort) throw e;
      });
    });
  }
  // Where a pole edit's time goes: each check on its own, with whole reads (parse time included once).
  const rename = cases[2][1]();
  const whole = Object.fromEntries((['equipment', 'cables', 'splitters', 'closures', 'customers', 'catalog', 'settings'] as const).map((n) => [n, old(n)])) as unknown as NetworkSnapshot;
  await time('  parse equipment, cables, splitters, closures, customers', 1, () => ['equipment', 'cables', 'splitters', 'closures', 'customers'].map((n) => old(n as never)));
  await time('  fiber check (whole network before and after)', 1, () => checkChangeSetFiber(whole, rename));
  await time('  catalogue check', 1, () => checkChangeSetCatalog(whole, rename));
  await time('  duplicate point warning', 1, () => newPointDuplicateWarnings(whole.equipment, rename, whole.settings));
  await app.close();
} finally {
  await repository.close();
  rmSync(dir, { recursive: true, force: true });
}
