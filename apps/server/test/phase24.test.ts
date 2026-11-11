import type { FastifyInstance, InjectOptions } from 'fastify';
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { API_PREFIX, type ChangesResponse, type Equipment, type NetworkSnapshot } from '@fibergis/shared';
import { createSampleNetwork } from '@fibergis/shared/sample';

import { buildApp } from '../src/app';
import { type AppConfig, loadConfig } from '../src/config';
import { parseBox, shapesOf, shapeTouchesBox } from '../src/db/recordGeometry';
import { seedSampleNetwork } from '../src/db/seed';
import { SqliteNetworkRepository } from '../src/db/sqliteRepository';
import { writeSafetyCopy } from '../src/lib/backups';
import { startScheduledBackups } from '../src/lib/scheduledBackups';

/** Phase 24: paging, map-area queries, incremental sync, scheduled backups, migration 3. */

vi.setConfig({ testTimeout: 60_000 });

const api = (path: string) => `${API_PREFIX}${path}`;
let app: FastifyInstance;
let repository: SqliteNetworkRepository;
let config: AppConfig;

async function start(databasePath = ':memory:') {
  config = {
    ...loadConfig({ LOG_LEVEL: 'silent', STATIC_DIR: join(tmpdir(), 'fibergis-no-static') }),
    databasePath,
    photosDir: join(mkdtempSync(join(tmpdir(), 'fibergis-photos-')), 'photos'),
    backupsDir: join(mkdtempSync(join(tmpdir(), 'fibergis-backups-')), 'backups'),
    rateLimitPerMinute: 100_000,
  };
  repository = new SqliteNetworkRepository(config.databasePath);
  await seedSampleNetwork(repository);
  app = await buildApp({ config, repository });
}

beforeEach(() => start());
afterEach(async () => {
  await app.close();
  await repository.close();
});

const send = (method: InjectOptions['method'], path: string, payload?: unknown) =>
  app.inject({ method, url: api(path), ...(payload === undefined ? {} : { payload: payload as object }) });

const sample = createSampleNetwork();
const pole = sample.equipment.find((e) => e.id === 'POLE-01')!;
const box = (lat: number, lng: number, d = 0.0002) => `${lat - d},${lng - d},${lat + d},${lng + d}`;

describe('geometry', () => {
  it('a line crossing the box counts, though no point of it is inside', () => {
    const b = parseBox('0,0,1,1')!;
    expect(shapeTouchesBox({ kind: 'line', points: [[0.5, -1], [0.5, 2]] }, b)).toBe(true);
    expect(shapeTouchesBox({ kind: 'line', points: [[2, -1], [2, 2]] }, b)).toBe(false);
    expect(shapeTouchesBox({ kind: 'point', points: [[1, 1]] }, b)).toBe(true);
    // An area larger than the box, around it.
    expect(shapeTouchesBox({ kind: 'ring', points: [[-5, -5], [-5, 5], [5, 5], [5, -5]] }, b)).toBe(true);
    expect(parseBox('1,0,0,1')).toBeUndefined();
    expect(parseBox('a,b,c,d')).toBeUndefined();
    expect(parseBox('0,0,95,1')).toBeUndefined();
  });

  it('reads points, lines, areas, trips and the two ends of a span; nothing is guessed', () => {
    expect(shapesOf('equipment', { id: 'x', lat: 12, lng: 77 })).toEqual([{ kind: 'point', points: [[12, 77]] }]);
    expect(shapesOf('equipment', { id: 'x', lat: 120, lng: 77 })).toEqual([]);
    expect(shapesOf('faults', { id: 'f', affectedLocation: { lat: 1, lng: 2 } })).toEqual([{ kind: 'point', points: [[1, 2]] }]);
    expect(shapesOf('agentTrips', { id: 't', points: [[1700000000000, 1, 2, 5], [1700000000001, 1.1, 2.1, 5]] })[0].points).toEqual([[1, 2], [1.1, 2.1]]);
    const ends = { A: [1, 1] as [number, number], B: [2, 2] as [number, number] };
    expect(shapesOf('spans', { id: 's', fromStructureId: 'A', toStructureId: 'B', routePoints: [[1.5, 1.2]] }, (id) => ends[id as 'A'])).toEqual([{ kind: 'line', points: [[1, 1], [1.5, 1.2], [2, 2]] }]);
    expect(shapesOf('settings', { id: 'x', value: '{}' })).toEqual([]);
  });
});

describe('map-area queries', () => {
  it('returns only what touches the box: points, cables crossing it, spans by their poles', async () => {
    const far: Equipment = { ...pole, id: 'POLE-FAR', name: 'Far pole', lat: pole.lat + 0.05, lng: pole.lng + 0.05 };
    await repository.applyChanges({
      upserts: {
        equipment: [far],
        spans: [{ id: 'SPN-T1', name: 'Test span', fromStructureId: 'POLE-01', toStructureId: 'POLE-FAR', status: 'proposed', basis: 'field_sequence', createdAt: '2026-01-01' } as never],
      },
    });
    const res = await send('GET', `/network/area?bbox=${box(pole.lat, pole.lng)}`);
    expect(res.statusCode, res.body).toBe(200);
    const area = res.json() as { data: Partial<NetworkSnapshot>; versions: Record<string, Record<string, number>>; truncated: boolean };
    expect(area.data.equipment?.map((e) => e.id)).toContain('POLE-01');
    expect(area.data.equipment?.map((e) => e.id)).not.toContain('POLE-FAR');
    expect(area.data.spans?.map((s) => s.id)).toEqual(['SPN-T1']);
    expect(area.versions.equipment?.['POLE-01']).toBeTypeOf('number');
    expect(area.truncated).toBe(false);
    // Every record returned really touches the box, and every sample record that touches it is returned.
    const b = parseBox(box(pole.lat, pole.lng))!;
    const network = await repository.getNetwork();
    for (const [name, records] of Object.entries(network.data)) {
      const expected = (records as Record<string, unknown>[])
        .filter((r) => shapesOf(name as never, r, (id) => {
          const e = network.data.equipment.find((x) => x.id === id);
          return e ? [e.lat, e.lng] : undefined;
        }).some((s) => shapeTouchesBox(s, b)))
        .map((r) => r.id);
      expect(((area.data as Record<string, { id: string }[]>)[name] ?? []).map((r) => r.id), name).toEqual(expected);
    }
    // Only some collections; a limit cuts the answer and says so.
    const only = (await send('GET', `/network/area?bbox=${box(pole.lat, pole.lng, 0.05)}&collections=equipment&limit=2`)).json();
    expect(Object.keys(only.data)).toEqual(['equipment']);
    expect(only.data.equipment).toHaveLength(2);
    expect(only.truncated).toBe(true);
    expect((await send('GET', '/network/area?bbox=1,2,3')).statusCode).toBe(400);
    expect((await send('GET', '/network/area?bbox=0,0,1,1&collections=nope')).statusCode).toBe(400);
  });

  it('follows moves and deletes in the same write, and a restore or reset', async () => {
    const at = (lat: number, lng: number) => send('GET', `/network/area?bbox=${box(lat, lng)}&collections=equipment,spans`).then((r) => r.json());
    await repository.applyChanges({ upserts: { spans: [{ id: 'SPN-T2', name: 'S', fromStructureId: 'POLE-01', toStructureId: 'POLE-02', status: 'proposed', basis: 'field_sequence', createdAt: '2026-01-01' } as never] } });
    const moved = { ...pole, lat: pole.lat + 0.01, lng: pole.lng + 0.01 };
    await repository.applyChanges({ upserts: { equipment: [moved] } });
    expect((await at(pole.lat, pole.lng)).data.equipment?.some((e: Equipment) => e.id === 'POLE-01')).toBeFalsy();
    const there = await at(moved.lat, moved.lng);
    expect(there.data.equipment.map((e: Equipment) => e.id)).toContain('POLE-01');
    // The span followed its pole.
    expect(there.data.spans.map((s: { id: string }) => s.id)).toContain('SPN-T2');
    await repository.applyChanges({ deletes: { spans: ['SPN-T2'], equipment: ['POLE-01'] } });
    expect((await at(moved.lat, moved.lng)).data.equipment ?? []).toEqual([]);
    // A reset puts the sample back, and its index with it.
    expect((await send('POST', '/reset', { confirm: 'reset' })).statusCode).toBe(200);
    expect((await at(pole.lat, pole.lng)).data.equipment.map((e: Equipment) => e.id)).toContain('POLE-01');
  });
});

describe('paging and filters on GET /<collection>', () => {
  it('without a query the answer is the whole array, as before', async () => {
    const res = await send('GET', '/equipment');
    expect(res.json()).toEqual((await repository.getNetwork()).data.equipment);
    expect(res.headers['x-next-cursor']).toBeUndefined();
  });

  it('pages through the whole collection in stored order', async () => {
    const all = (await repository.getNetwork()).data.equipment.map((e) => e.id);
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 100; i += 1) {
      const res = await send('GET', `/equipment?limit=7${cursor ? `&cursor=${cursor}` : ''}`);
      expect(res.statusCode).toBe(200);
      expect(res.headers['x-network-revision']).toBeDefined();
      seen.push(...(res.json() as Equipment[]).map((e) => e.id));
      cursor = res.headers['x-next-cursor'] as string | undefined;
      if (!cursor) break;
    }
    expect(seen).toEqual(all);
  });

  it('filters by ids, by map box and by revision', async () => {
    expect((await send('GET', '/equipment?ids=POLE-02,POLE-01,NOPE')).json().map((e: Equipment) => e.id)).toEqual(['POLE-01', 'POLE-02'].sort((a, b) => sample.equipment.findIndex((e) => e.id === a) - sample.equipment.findIndex((e) => e.id === b)));
    const inBox = (await send('GET', `/equipment?bbox=${box(pole.lat, pole.lng)}`)).json() as Equipment[];
    expect(inBox.map((e) => e.id)).toContain('POLE-01');
    expect(inBox.every((e) => Math.abs(e.lat - pole.lat) <= 0.0002 && Math.abs(e.lng - pole.lng) <= 0.0002)).toBe(true);
    const revision = await repository.getRevision();
    await repository.applyChanges({ upserts: { equipment: [{ ...pole, name: 'Renamed' }] } });
    expect((await send('GET', `/equipment?changedSince=${revision}`)).json().map((e: Equipment) => e.id)).toEqual(['POLE-01']);
    expect((await send('GET', '/equipment?limit=0')).statusCode).toBe(400);
    expect((await send('GET', '/equipment?cursor=abc')).statusCode).toBe(400);
  });
});

describe('incremental sync: GET /changes?since=', () => {
  it('returns what was stored and deleted since, with versions', async () => {
    const since = await repository.getRevision();
    const renamed = { ...pole, name: 'Pole renamed' };
    const { revision } = await repository.applyChanges({ upserts: { equipment: [renamed] }, deletes: { customers: [sample.customers[0].id] } });
    const res = await send('GET', `/changes?since=${since}`);
    expect(res.statusCode, res.body).toBe(200);
    const changes = res.json() as Extract<ChangesResponse, { reload?: false }>;
    expect(changes.reload).toBeUndefined();
    expect(changes.revision).toBe(revision);
    expect(changes.upserts.equipment).toEqual([renamed]);
    expect(changes.versions.equipment?.['POLE-01']).toBe(revision);
    expect(changes.deletes.customers).toEqual([sample.customers[0].id]);
    // Nothing new: an empty answer.
    const none = (await send('GET', `/changes?since=${revision}`)).json();
    expect(none).toMatchObject({ revision, upserts: {}, deletes: {} });
  });

  it('a resend of the same record is still reported, since its version moved on', async () => {
    const since = await repository.getRevision();
    await repository.applyChanges({ upserts: { equipment: [pole] } });
    expect((await send('GET', `/changes?since=${since}`)).json().upserts.equipment).toEqual([pole]);
  });

  it('applying the changes to the old snapshot gives the new snapshot', async () => {
    const before = await repository.getNetwork();
    await repository.applyChanges({ upserts: { equipment: [{ ...pole, name: 'A' }, { ...pole, id: 'POLE-NEW-1', name: 'New' }] }, deletes: { cables: [sample.cables[0].id] } });
    await repository.applyChanges({ upserts: { zones: [{ ...sample.zones[0], name: 'Zone renamed' }] }, deletes: { equipment: ['POLE-NEW-1'] } });
    const changes = (await repository.getChangesSince(before.revision)) as Extract<ChangesResponse, { reload?: false }>;
    const after = await repository.getNetwork();
    const rebuilt = { ...before.data } as Record<string, { id: string }[]>;
    for (const [name, ids] of Object.entries(changes.deletes)) rebuilt[name] = rebuilt[name].filter((r) => !ids!.includes(r.id));
    for (const [name, records] of Object.entries(changes.upserts)) {
      const list = [...rebuilt[name]];
      for (const r of records as { id: string }[]) {
        const i = list.findIndex((x) => x.id === r.id);
        if (i >= 0) list[i] = r;
        else list.push(r);
      }
      rebuilt[name] = list;
    }
    expect(rebuilt).toEqual(after.data);
  });

  it('says "reload" after a restore or reset, and for a revision the server never had', async () => {
    const since = await repository.getRevision();
    expect((await send('POST', '/reset', { confirm: 'reset' })).statusCode).toBe(200);
    expect((await send('GET', `/changes?since=${since}`)).json()).toMatchObject({ reload: true });
    const now = await repository.getRevision();
    expect((await send('GET', `/changes?since=${now + 5}`)).json()).toMatchObject({ reload: true });
    // After the reload, small changes come as changes again.
    await repository.applyChanges({ upserts: { equipment: [{ ...pole, name: 'Again' }] } });
    expect((await send('GET', `/changes?since=${now}`)).json().upserts.equipment).toHaveLength(1);
    expect((await send('GET', '/changes')).statusCode).toBe(400);
    expect((await send('GET', '/changes?since=-1')).statusCode).toBe(400);
  });

  it('removes the oldest tombstones beyond the limit and moves the floor up', async () => {
    const log = (repository as unknown as { changeLog: { prune(now: number, force: boolean): void; floor(): number; maxTombstones: number } }).changeLog;
    (log as { maxTombstones: number }).maxTombstones = 2;
    const since = await repository.getRevision();
    for (const c of sample.customers.slice(0, 4)) await repository.applyChanges({ deletes: { customers: [c.id] } });
    log.prune(Date.now(), true);
    expect(log.floor()).toBeGreaterThan(since);
    expect((await repository.getChangesSince(since)).reload).toBe(true);
    const fromFloor = (await repository.getChangesSince(log.floor())) as Extract<ChangesResponse, { reload?: false }>;
    expect(fromFloor.deletes.customers).toHaveLength(2);
  });
});

describe('migration 3', () => {
  it('adds the index and the change log to a Phase 23 database, fills the index, and can run twice', async () => {
    await app.close();
    await repository.close();
    const path = join(mkdtempSync(join(tmpdir(), 'fibergis-p24-')), 'old.db');
    await start(path);
    await app.close();
    await repository.close();
    const raw = new DatabaseSync(path);
    raw.exec("DROP TABLE record_bounds_rtree; DROP TABLE record_bounds; DROP TABLE change_log; DELETE FROM meta WHERE key = 'change_log_floor'; PRAGMA user_version = 2;");
    const revision = Number((raw.prepare("SELECT value FROM meta WHERE key = 'revision'").get() as { value: string }).value);
    raw.close();
    for (let run = 0; run < 2; run += 1) {
      await start(path);
      const db = (repository as unknown as { db: DatabaseSync }).db;
      expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(3);
      expect(await repository.getRevision()).toBe(revision);
      expect((await send('GET', `/network/area?bbox=${box(pole.lat, pole.lng)}`)).json().data.equipment.map((e: Equipment) => e.id)).toContain('POLE-01');
      // The history starts at the revision the database had.
      expect((await repository.getChangesSince(revision)).reload).toBeFalsy();
      expect((await repository.getChangesSince(revision - 1)).reload).toBe(true);
      await app.close();
      await repository.close();
    }
    await start(path);
  });

  it('a newer schema than this server knows is refused at start', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'fibergis-p24-')), 'new.db');
    new SqliteNetworkRepository(path).close();
    const raw = new DatabaseSync(path);
    raw.exec('PRAGMA user_version = 4');
    raw.close();
    expect(() => new SqliteNetworkRepository(path)).toThrow(/newer than this server supports/);
  });
});

describe('scheduled backups', () => {
  it('writes the safety-copy zip, skips when nothing changed, keeps the newest and never touches the other copies', async () => {
    const log = { info: vi.fn(), error: vi.fn() };
    const dir = config.backupsDir;
    await writeSafetyCopy(dir, new Uint8Array([1]), 'before-restore', 20);
    const scheduled = startScheduledBackups({ repository, everyHours: 0, keep: 2, backupsDir: dir, photosDir: config.photosDir, log });
    const first = await scheduled.runOnce();
    expect(first).toMatch(/^fibergis-scheduled-.+\.zip$/);
    expect(existsSync(join(dir, first!))).toBe(true);
    expect(await scheduled.runOnce()).toBeNull();
    for (let i = 0; i < 3; i += 1) {
      await repository.applyChanges({ upserts: { equipment: [{ ...pole, name: `Change ${i}` }] } });
      await new Promise((r) => setTimeout(r, 5));
      expect(await scheduled.runOnce()).not.toBeNull();
    }
    const files = readdirSync(dir);
    expect(files.filter((f) => f.startsWith('fibergis-scheduled-'))).toHaveLength(2);
    expect(files.filter((f) => f.startsWith('fibergis-before-restore-'))).toHaveLength(1);
    scheduled.stop();
    expect(log.error).not.toHaveBeenCalled();
  });

  it('a failure is logged and nothing is thrown', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fibergis-p24-'));
    const blocked = join(dir, 'file');
    writeFileSync(blocked, 'not a folder');
    const log = { info: vi.fn(), error: vi.fn() };
    const scheduled = startScheduledBackups({ repository, everyHours: 0, keep: 2, backupsDir: join(blocked, 'backups'), photosDir: config.photosDir, log });
    expect(await scheduled.runOnce()).toBeNull();
    expect(log.error).toHaveBeenCalled();
  });

  it('is off by default', () => {
    expect(loadConfig({}).backupEveryHours).toBe(0);
    expect(loadConfig({ BACKUP_EVERY_HOURS: '6' }).backupEveryHours).toBe(6);
    expect(() => loadConfig({ BACKUP_EVERY_HOURS: '-1' })).toThrow();
  });
});
