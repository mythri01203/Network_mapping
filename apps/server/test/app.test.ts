import type { FastifyInstance } from 'fastify';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { API_PREFIX, createBackup, type NetworkResponse } from '@fibergis/shared';
import { createSampleNetwork } from '@fibergis/shared/sample';

import { buildApp } from '../src/app';
import { type AppConfig, loadConfig } from '../src/config';
import { seedSampleNetwork } from '../src/db/seed';
import { SqliteNetworkRepository } from '../src/db/sqliteRepository';

const sample = createSampleNetwork();
const api = (path: string) => `${API_PREFIX}${path}`;

let app: FastifyInstance;
let repository: SqliteNetworkRepository;

async function start(overrides: Partial<AppConfig> = {}, fetchImpl?: typeof fetch) {
  const config = {
    ...loadConfig({ LOG_LEVEL: 'silent', STATIC_DIR: join(tmpdir(), 'fibergis-no-static') }),
    databasePath: ':memory:',
    // Never the real data folder.
    photosDir: join(mkdtempSync(join(tmpdir(), 'fibergis-photos-')), 'photos'),
    ...overrides,
  };
  repository = new SqliteNetworkRepository(config.databasePath);
  await seedSampleNetwork(repository);
  app = await buildApp({ config, repository, fetch: fetchImpl });
}

const getNetwork = async () => (await app.inject({ method: 'GET', url: api('/network') })).json<NetworkResponse>();

describe('API', () => {
  beforeEach(() => start());
  afterEach(async () => {
    await app.close();
    await repository.close();
  });

  it('reports health with record counts', async () => {
    const response = await app.inject({ method: 'GET', url: api('/health') });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ok',
      revision: 1,
      counts: { equipment: sample.equipment.length, cables: sample.cables.length, catalog: 0 },
    });
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('returns the seeded network in its original order', async () => {
    const { revision, data } = await getNetwork();
    expect(revision).toBe(1);
    expect(data).toEqual(sample);
  });

  it('applies a change set atomically and bumps the revision once', async () => {
    const cable = { ...sample.cables[0], name: 'Renamed feeder' };
    const response = await app.inject({
      method: 'POST',
      url: api('/changes'),
      payload: { upserts: { cables: [cable] }, deletes: { faults: [sample.faults[0].id, 'missing'] } },
    });
    expect(response.json()).toEqual({ revision: 2, upserted: 1, deleted: 1 });

    const { data } = await getNetwork();
    expect(data.cables[0]).toEqual(cable);
    expect(data.faults.map((fault) => fault.id)).not.toContain(sample.faults[0].id);
  });

  it('rejects invalid records without writing anything', async () => {
    const response = await app.inject({
      method: 'POST',
      url: api('/changes'),
      payload: { upserts: { cables: [{ ...sample.cables[0], fiberCount: 'twelve' }] } },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: 'validation_error',
      issues: [{ path: 'upserts.cables.0.fiberCount' }],
    });
    expect((await getNetwork()).revision).toBe(1);
  });

  it('accepts equipment placed from a custom catalog type', async () => {
    const custom = { ...sample.equipment[0], id: 'EQ-CUSTOM', type: 'Custom Network Node' };
    const response = await app.inject({ method: 'POST', url: api('/changes'), payload: { upserts: { equipment: [custom] } } });
    expect(response.statusCode).toBe(200);
    expect((await getNetwork()).data.equipment.find((e) => e.id === 'EQ-CUSTOM')?.type).toBe('Custom Network Node');
  });

  it('supports record-level CRUD', async () => {
    const zone = { ...sample.zones[0], id: 'ZONE-NEW', name: 'New zone' };
    const created = await app.inject({ method: 'PUT', url: api('/zones/ZONE-NEW'), payload: zone });
    expect(created.statusCode).toBe(201);
    expect(created.headers['x-network-revision']).toBe('2');

    const updated = await app.inject({ method: 'PUT', url: api('/zones/ZONE-NEW'), payload: { ...zone, name: 'B' } });
    expect(updated.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: api('/zones/ZONE-NEW') })).json()).toMatchObject({ name: 'B' });

    const list = (await app.inject({ method: 'GET', url: api('/zones') })).json<{ id: string }[]>();
    expect(list.at(-1)?.id).toBe('ZONE-NEW');

    expect((await app.inject({ method: 'DELETE', url: api('/zones/ZONE-NEW') })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: api('/zones/ZONE-NEW') })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: api('/zones/ZONE-NEW') })).statusCode).toBe(404);
  });

  it('rejects unknown collections and mismatched ids', async () => {
    expect((await app.inject({ method: 'GET', url: api('/widgets') })).json()).toMatchObject({ error: 'not_found' });
    const mismatch = await app.inject({ method: 'PUT', url: api('/zones/OTHER'), payload: sample.zones[0] });
    expect(mismatch.statusCode).toBe(400);
  });

  it('round-trips a backup through restore', async () => {
    const backup = (await app.inject({ method: 'GET', url: api('/backup') })).json();
    expect(backup).toMatchObject({ format: 'fibergis-backup', data: { equipment: sample.equipment } });

    await app.inject({ method: 'POST', url: api('/changes'), payload: { deletes: { equipment: ['OLT-01'] } } });
    const restore = await app.inject({ method: 'POST', url: api('/restore'), payload: backup });
    expect(restore.statusCode).toBe(200);
    expect((await getNetwork()).data).toEqual(sample);
  });

  it('restores legacy backups and leaves missing collections untouched', async () => {
    const legacy = { version: '3.0.0', equipments: sample.equipment.slice(0, 2), customComponents: [] };
    const response = await app.inject({ method: 'POST', url: api('/restore'), payload: legacy });
    expect(response.json()).toMatchObject({ restored: ['equipment', 'catalog'] });

    const { data } = await getNetwork();
    expect(data.equipment).toHaveLength(2);
    expect(data.cables).toEqual(sample.cables);
  });

  it('rejects restores without network data', async () => {
    const response = await app.inject({ method: 'POST', url: api('/restore'), payload: { hello: 'world' } });
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toMatch(/does not contain any FiberGIS network data/);
  });

  it('resets to the sample network but keeps the custom catalog', async () => {
    const component = { id: 'CUS-1', type: 'Box', category: 'Custom', name: 'Box', description: '', iconBg: '#000' };
    await app.inject({
      method: 'POST',
      url: api('/changes'),
      payload: { upserts: { catalog: [component] }, deletes: { cables: [sample.cables[0].id] } },
    });
    const reset = await app.inject({ method: 'POST', url: api('/reset') });
    expect(reset.json()).toEqual({ revision: 3 });

    const { data } = await getNetwork();
    expect(data.cables).toEqual(sample.cables);
    expect(data.catalog).toEqual([component]);
  });

  it('returns JSON 404s for unknown API routes and malformed JSON as 400', async () => {
    const missing = await app.inject({ method: 'GET', url: api('/nope/a/b') });
    expect(missing.statusCode).toBe(404);
    const malformed = await app.inject({
      method: 'POST',
      url: api('/changes'),
      headers: { 'content-type': 'application/json' },
      payload: '{nope',
    });
    expect(malformed.statusCode).toBe(400);
  });

  it('allows configured CORS origins only', async () => {
    const allowed = await app.inject({
      method: 'GET',
      url: api('/health'),
      headers: { origin: 'http://localhost:3000' },
    });
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    const denied = await app.inject({
      method: 'GET',
      url: api('/health'),
      headers: { origin: 'https://evil.example' },
    });
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('routing', () => {
  afterEach(async () => {
    await app.close();
    await repository.close();
  });

  const osrmRoute = {
    code: 'Ok',
    routes: [
      {
        distance: 1234.4,
        duration: 180.6,
        geometry: {
          coordinates: [
            [78.4, 17.4],
            [78.5, 17.5],
          ],
        },
        legs: [
          {
            steps: [
              { name: 'Main Road', maneuver: { type: 'depart' } },
              { name: 'Ring Road', maneuver: { type: 'turn', modifier: 'left' } },
              { name: '', maneuver: { type: 'arrive' } },
            ],
          },
        ],
      },
    ],
  };

  it('proxies OSRM and normalises the route', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(osrmRoute)));
    await start({ osrmUrl: 'https://osrm.test' }, fetchMock as unknown as typeof fetch);
    const response = await app.inject({
      method: 'POST',
      url: api('/routing/route'),
      payload: {
        points: [
          [17.4, 78.4],
          [17.5, 78.5],
        ],
      },
    });
    expect(response.json()).toEqual({
      coordinates: [
        [17.4, 78.4],
        [17.5, 78.5],
      ],
      distanceMeters: 1234,
      durationSeconds: 181,
      steps: ['Head out on Main Road', 'Turn left onto Ring Road', 'Arrive at the destination'],
    });
    const calledUrl = String((fetchMock.mock.calls[0] as unknown[])[0]);
    expect(calledUrl).toContain('https://osrm.test/route/v1/driving/78.4,17.4;78.5,17.5?');
  });

  it('uses the trip service to optimise multi-stop routes', async () => {
    const trip = { code: 'Ok', trips: osrmRoute.routes };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(trip)));
    await start({ osrmUrl: 'https://osrm.test' }, fetchMock as unknown as typeof fetch);
    const response = await app.inject({
      method: 'POST',
      url: api('/routing/route'),
      payload: {
        optimize: true,
        points: [
          [17.4, 78.4],
          [17.5, 78.5],
          [17.6, 78.6],
        ],
      },
    });
    expect(response.statusCode).toBe(200);
    const calledUrl = String((fetchMock.mock.calls[0] as unknown[])[0]);
    expect(calledUrl).toContain('/trip/v1/driving/');
    expect(calledUrl).toContain('roundtrip=false');
  });

  it('maps upstream failures to 502 and missing routes to 422', async () => {
    await start({}, (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch);
    const points = [
      [17.4, 78.4],
      [17.5, 78.5],
    ];
    const down = await app.inject({ method: 'POST', url: api('/routing/route'), payload: { points } });
    expect(down.statusCode).toBe(502);
    await app.close();
    await repository.close();

    await start(
      {},
      (async () => new Response(JSON.stringify({ code: 'NoRoute', message: 'Impossible route' }))) as typeof fetch,
    );
    const none = await app.inject({ method: 'POST', url: api('/routing/route'), payload: { points } });
    expect(none.statusCode).toBe(422);
    expect(none.json()).toMatchObject({ error: 'no_route', message: 'Impossible route' });
  });
});

describe('static web app', () => {
  let dir: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'fibergis-web-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>FiberGIS</title>');
    writeFileSync(join(dir, 'assets', 'app-abc123.js'), 'console.log(1)');
    await start({ staticDir: dir });
  });

  afterEach(async () => {
    await app.close();
    await repository.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('serves hashed assets with immutable caching and falls back to index.html for app routes', async () => {
    const asset = await app.inject({ method: 'GET', url: '/assets/app-abc123.js' });
    expect(asset.headers['cache-control']).toContain('immutable');

    const page = await app.inject({ method: 'GET', url: '/map/equipment/OLT-01' });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('<title>FiberGIS</title>');
    expect(page.headers['cache-control']).toBe('no-cache');

    const apiMiss = await app.inject({ method: 'GET', url: api('/nope/a/b') });
    expect(apiMiss.statusCode).toBe(404);
    expect(apiMiss.json()).toMatchObject({ error: 'not_found' });
  });
});

describe('photos', () => {
  let dir: string;
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(50, 1)]);
  const put = (id: string, payload: Buffer, type = 'image/jpeg') =>
    app.inject({ method: 'PUT', url: api(`/photos/${id}`), headers: { 'content-type': type }, payload });

  beforeEach(async () => {
    dir = join(mkdtempSync(join(tmpdir(), 'fibergis-photo-test-')), 'photos');
    await start({ photosDir: dir });
  });
  afterEach(async () => {
    await app.close();
    await repository.close();
    rmSync(join(dir, '..'), { recursive: true, force: true });
  });

  it('stores a photo once and serves it back', async () => {
    expect(existsSync(dir)).toBe(false);
    const first = await put('PH-ABCDEFGH12', jpeg);
    expect(first.statusCode).toBe(201);
    expect(first.json()).toEqual({ id: 'PH-ABCDEFGH12', url: '/api/v1/photos/PH-ABCDEFGH12', bytes: jpeg.length, created: true });

    const again = await put('PH-ABCDEFGH12', Buffer.concat([jpeg, Buffer.from([1, 2, 3])]));
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ created: false, bytes: jpeg.length });
    expect(readdirSync(dir)).toEqual(['PH-ABCDEFGH12.jpg']);

    const got = await app.inject({ method: 'GET', url: api('/photos/PH-ABCDEFGH12') });
    expect(got.statusCode).toBe(200);
    expect(got.headers['content-type']).toBe('image/jpeg');
    expect(got.headers['cache-control']).toContain('immutable');
    expect(got.rawPayload.equals(jpeg)).toBe(true);
    expect((await app.inject({ method: 'HEAD', url: api('/photos/PH-ABCDEFGH12') })).statusCode).toBe(200);
  });

  it('accepts PNG and checks the bytes match the declared type', async () => {
    expect((await put('PH-PNG000001', png, 'image/png')).statusCode).toBe(201);
    const fake = await put('PH-FAKE00001', Buffer.from('<svg onload=alert(1)>'), 'image/jpeg');
    expect(fake.statusCode).toBe(415);
    expect(fake.json()).toMatchObject({ error: 'unsupported_media_type' });
    const gif = await put('PH-GIF000001', Buffer.from('GIF89a....'), 'image/gif');
    expect(gif.statusCode).toBe(415);
    const text = await put('PH-TXT000001', Buffer.from('hello'), 'text/plain');
    expect(text.statusCode).toBe(415);
    expect(readdirSync(dir)).toEqual(['PH-PNG000001.png']);
  });

  it('refuses oversized photos, bad ids and empty bodies', async () => {
    const big = Buffer.concat([jpeg, Buffer.alloc(5 * 1024 * 1024)]);
    expect((await put('PH-BIG0000001', big)).statusCode).toBe(413);
    expect((await put('..%2F..%2Fevil', jpeg)).statusCode).toBe(400);
    expect((await put('ab', jpeg)).statusCode).toBe(400);
    expect((await put('PH-EMPTY00001', Buffer.alloc(0))).statusCode).toBe(400);
    expect(existsSync(dir) ? readdirSync(dir) : []).toEqual([]);
  });

  it('answers 404 for a photo that has not arrived', async () => {
    const missing = await app.inject({ method: 'GET', url: api('/photos/PH-NOTHERE01') });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ error: 'not_found' });
  });

  it('keeps photos beside the database by default, never in the real data folder for tests', () => {
    expect(loadConfig({ DATABASE_PATH: '/srv/fibergis/net.db' }).photosDir.replaceAll('\\', '/')).toMatch(/\/srv\/fibergis\/photos$/);
    expect(loadConfig({ DATABASE_PATH: '/srv/net.db', PHOTOS_DIR: '/data/pics' }).photosDir).toBe('/data/pics');
    expect(loadConfig({ DATABASE_PATH: ':memory:' }).photosDir).toContain('fibergis-memory-photos');
  });
});

describe('persistence', () => {
  it('keeps data and revision across reopen and never re-seeds a used database', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fibergis-db-'));
    const path = join(dir, 'nested', 'network.db');
    try {
      const first = new SqliteNetworkRepository(path);
      expect(await seedSampleNetwork(first)).toBe(true);
      await first.applyChanges({ deletes: { equipment: sample.equipment.map((item) => item.id) } });
      await first.close();

      const second = new SqliteNetworkRepository(path);
      expect(await seedSampleNetwork(second)).toBe(false);
      expect(await second.getRevision()).toBe(2);
      expect(await second.list('equipment')).toEqual([]);
      expect(await second.list('cables')).toEqual(sample.cables);
      await second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('accepts a backup created from the shared helper', async () => {
    const repo = new SqliteNetworkRepository(':memory:');
    const backup = createBackup(sample, new Date(0).toISOString());
    expect(await repo.replaceCollections(backup.data)).toBe(1);
    expect((await repo.getNetwork()).data).toEqual(sample);
    await repo.close();
  });
});
