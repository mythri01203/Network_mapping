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
      payload: { upserts: { cables: [cable] }, deletes: { documents: [sample.documents[0].id, 'missing'] } },
    });
    expect(response.json()).toEqual({ revision: 2, upserted: 1, deleted: 1, versions: { cables: { [cable.id]: 2 } } });

    const { data } = await getNetwork();
    expect(data.cables[0]).toEqual(cable);
    expect(data.documents.map((doc) => doc.id)).not.toContain(sample.documents[0].id);
  });

  it('refuses deleting a fault that a work order still names (Phase 8)', async () => {
    const named = sample.workOrders.find((w) => w.faultId)!;
    const response = await app.inject({ method: 'POST', url: api('/changes'), payload: { deletes: { faults: [named.faultId!] } } });
    expect(response.statusCode).toBe(409);
    expect(response.json().message).toContain(`names fault ${named.faultId}`);
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
      // Splices naming the cable go with it, as the app does; a splice left naming nothing is refused.
      payload: {
        upserts: {
          catalog: [component],
          closures: sample.closures.map((c) => ({ ...c, splices: c.splices.filter((s) => s.inputCableId !== sample.cables[0].id && s.outputCableId !== sample.cables[0].id) })),
        },
        deletes: { cables: [sample.cables[0].id] },
      },
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

describe('outside-plant link checks', () => {
  beforeEach(() => start());
  afterEach(async () => {
    await app.close();
    await repository.close();
  });

  const [poleA, poleB] = sample.equipment.filter((e) => e.type.includes('Pole'));
  const span = {
    id: 'SPN-TEST000001',
    name: 'A – B',
    fromStructureId: poleA.id,
    toStructureId: poleB.id,
    status: 'built',
    basis: 'office_drawn',
    createdAt: '2026-11-07T10:00:00.000Z',
  };
  const attachment = {
    id: 'ATT-TEST000001',
    cableId: sample.cables[0].id,
    spanId: span.id,
    status: 'built',
    basis: 'office_confirmed',
    createdAt: '2026-11-07T10:00:00.000Z',
  };
  const send = (payload: object) => app.inject({ method: 'POST', url: api('/changes'), payload });

  it('stores a span and an attachment whose links exist, even in the same change set', async () => {
    const response = await send({ upserts: { spans: [span], attachments: [attachment] } });
    expect(response.statusCode).toBe(200);
    const { data } = await getNetwork();
    expect(data.spans).toEqual([span]);
    expect(data.attachments).toEqual([attachment]);
  });

  it('refuses a span to a missing pole in plain words and writes nothing', async () => {
    const response = await send({ upserts: { spans: [{ ...span, toStructureId: 'POLE-GONE' }] } });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: 'link_error', message: expect.stringMatching(/"POLE-GONE" does not exist\. Nothing was saved/) });
    expect((await getNetwork()).revision).toBe(1);
    const put = await app.inject({ method: 'PUT', url: api(`/attachments/${attachment.id}`), payload: attachment });
    expect(put.statusCode).toBe(409);
  });

  it('refuses a duct listing a missing cable, and a span with the same pole at both ends', async () => {
    const duct = {
      id: 'DCT-TEST000001',
      name: 'Duct',
      coordinates: [
        [12.9, 77.6],
        [12.901, 77.6],
      ],
      status: 'built',
      basis: 'office_drawn',
      cableIds: ['CBL-GONE'],
      subducts: [],
      createdAt: '2026-11-07T10:00:00.000Z',
    };
    expect((await send({ upserts: { ducts: [duct] } })).statusCode).toBe(409);
    expect((await send({ upserts: { ducts: [{ ...duct, cableIds: [sample.cables[0].id] }] } })).statusCode).toBe(200);
    expect((await send({ upserts: { spans: [{ ...span, toStructureId: poleA.id }] } })).statusCode).toBe(400);
  });

  it('refuses deleting a pole a span still names, unless the span goes too', async () => {
    await send({ upserts: { spans: [span] } });
    const alone = await app.inject({ method: 'DELETE', url: api(`/equipment/${poleA.id}`) });
    expect(alone.statusCode).toBe(409);
    expect((await send({ deletes: { equipment: [poleA.id], spans: [span.id] } })).statusCode).toBe(200);
  });

  it('refuses a restore that would leave a span pointing to nothing', async () => {
    await send({ upserts: { spans: [span] } });
    const response = await app.inject({ method: 'POST', url: api('/restore'), payload: { equipment: [] } });
    expect(response.statusCode).toBe(409);
    expect(response.json().message).toMatch(/broken links/);
  });

  it('keeps old records without the new fields working', async () => {
    const { data } = await getNetwork();
    expect(data.spans).toEqual([]);
    const old = { ...sample.equipment[0] };
    expect((await send({ upserts: { equipment: [old] } })).statusCode).toBe(200);
  });

  describe('fiber checks', () => {
    const fiber = sample.cables.find((c) => c.cableCategory === 'Fiber' && c.fiberCount >= 4)!;
    const other = sample.cables.find((c) => c.cableCategory === 'Fiber' && c.fiberCount >= 4 && c.id !== fiber.id)!;
    const closure = sample.closures[0];
    const splice = (id: string, inputCore: number, outputCore: number) => ({
      id,
      inputCableId: fiber.id,
      inputCableName: fiber.name,
      inputCore,
      outputCableId: other.id,
      outputCableName: other.name,
      outputCore,
      status: 'Spliced',
      technician: '',
      date: '2026-11-07',
    });

    it('refuses a splice that gives one fiber two feeds, in plain words, and writes nothing', async () => {
      const first = await send({ upserts: { closures: [{ ...closure, splices: [splice('SPC-A', 1, 4)] }] } });
      expect(first.statusCode).toBe(200);
      const before = (await getNetwork()).revision;
      const second = await send({ upserts: { closures: [{ ...closure, splices: [splice('SPC-A', 1, 4), splice('SPC-B', 2, 4)] }] } });
      expect(second.statusCode).toBe(409);
      expect(second.json().message).toMatch(/is fed from 2 places[\s\S]*Nothing was saved/);
      expect((await getNetwork()).revision).toBe(before);
    });

    it('refuses a splice to a fiber the cable does not have', async () => {
      const response = await send({ upserts: { closures: [{ ...closure, splices: [splice('SPC-C', 1, other.fiberCount + 1)] }] } });
      expect(response.statusCode).toBe(409);
      expect(response.json().message).toMatch(/has no fiber/);
    });

    it('refuses two active assignments on one core and accepts released history', async () => {
      const assignment = (id: string, releasedAt?: string) => ({ id, kind: 'in_use', use: id, effectiveFrom: '2026-11-07', createdAt: '2026-11-07', ...(releasedAt ? { releasedAt } : {}) });
      const withCore = (assignments: object[]) => ({
        ...fiber,
        cores: fiber.cores.map((c) => (c.coreNumber === 1 ? { ...c, assignments } : c)),
      });
      expect((await send({ upserts: { cables: [withCore([assignment('A'), assignment('B')])] } })).statusCode).toBe(409);
      expect((await send({ upserts: { cables: [withCore([assignment('A', '2026-11-07'), assignment('B')])] } })).statusCode).toBe(200);
    });

    it('refuses a splitter output beyond its ratio', async () => {
      const sp = sample.splitters[0];
      const n = Number(sp.ratio.split(':')[1]);
      const bad = { ...sp, outputPorts: [...sp.outputPorts, { portNumber: n + 1, label: 'extra', status: 'Available' }] };
      const response = await send({ upserts: { splitters: [bad] } });
      expect(response.statusCode).toBe(409);
      expect(response.json().message).toMatch(/outputs/);
    });
  });

  describe('customer connection checks', () => {
    const customer = sample.customers[0];
    const ont = { id: 'ONT-TEST000001', serialNumber: 'ZTEG0000T001', arrangement: 'single', status: 'installed', statusSource: 'person', createdAt: '2026-11-07T10:00:00.000Z' };

    it('stores an ONT, links a customer to it and adds a service in one change set', async () => {
      const service = { id: 'SVC-TEST000001', customerId: customer.id, kind: 'internet', status: 'active', createdAt: '2026-11-07T10:00:00.000Z' };
      const response = await send({ upserts: { onts: [ont], customers: [{ ...customer, ontId: ont.id }], services: [{ ...service, ontId: ont.id }] } });
      expect(response.statusCode).toBe(200);
      const { data } = await getNetwork();
      expect(data.onts).toEqual([ont]);
      expect(data.services).toHaveLength(1);
    });

    it('refuses a customer on a missing ONT, an ONT on a missing splitter, and one serial on two ONTs', async () => {
      const missing = await send({ upserts: { customers: [{ ...customer, ontId: 'ONT-GONE' }] } });
      expect(missing.statusCode).toBe(409);
      expect(missing.json().message).toMatch(/names ONT ONT-GONE, which is not on record[\s\S]*Nothing was saved/);
      expect((await send({ upserts: { onts: [{ ...ont, splitterId: 'SPL-GONE' }] } })).statusCode).toBe(409);
      const twice = await send({ upserts: { onts: [ont, { ...ont, id: 'ONT-TEST000002', serialNumber: 'zteg0000t001' }] } });
      expect(twice.statusCode).toBe(409);
      expect(twice.json().message).toMatch(/recorded on 2 ONTs/);
      expect((await getNetwork()).data.onts).toEqual([]);
    });

    it('refuses two customers on a one-customer ONT', async () => {
      const [a, b] = sample.customers;
      const response = await send({ upserts: { onts: [ont], customers: [{ ...a, ontId: ont.id }, { ...b, ontId: ont.id }] } });
      expect(response.statusCode).toBe(409);
      expect(response.json().message).toMatch(/recorded for one customer/);
      expect((await send({ upserts: { onts: [{ ...ont, arrangement: 'shared' }], customers: [{ ...a, ontId: ont.id }, { ...b, ontId: ont.id }] } })).statusCode).toBe(200);
    });

    it('refuses deleting a pin a building uses as its entry', async () => {
      const pin = sample.equipment.find((e) => e.type.includes('Pole'))!;
      const building = { id: 'BLD-TEST000001', name: 'Lake View', kind: 'apartment', lat: pin.lat, lng: pin.lng, entryEquipmentId: pin.id, floorBoxes: [], units: [], createdAt: '2026-11-07T10:00:00.000Z' };
      expect((await send({ upserts: { buildings: [building] } })).statusCode).toBe(200);
      const alone = await send({ deletes: { equipment: [pin.id] } });
      expect(alone.statusCode).toBe(409);
      expect(alone.json().message).toMatch(/entry point/);
    });
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

describe('per-record version checks (Phase 8)', () => {
  beforeEach(() => start());
  afterEach(async () => {
    await app.close();
    await repository.close();
  });

  const send = (payload: object) => app.inject({ method: 'POST', url: api('/changes'), payload });
  const zone = () => sample.zones[0];

  it('gives every record a version and returns the new one after a write', async () => {
    const before = await getNetwork();
    const v = before.versions?.zones?.[zone().id];
    expect(typeof v).toBe('number');
    const response = await send({ upserts: { zones: [{ ...zone(), name: 'Renamed' }] }, expect: { zones: { [zone().id]: v } } });
    expect(response.statusCode).toBe(200);
    const result = response.json();
    expect(result.versions.zones[zone().id]).toBe(result.revision);
    expect((await getNetwork()).versions?.zones?.[zone().id]).toBe(result.revision);
  });

  it('refuses a stale update with 409 and the current record, and writes nothing', async () => {
    const { versions, revision } = await getNetwork();
    const base = versions!.zones![zone().id];
    expect((await send({ upserts: { zones: [{ ...zone(), name: 'Office edit' }] }, expect: { zones: { [zone().id]: base } } })).statusCode).toBe(200);
    const stale = await send({ upserts: { zones: [{ ...zone(), name: 'Phone edit' }], cables: [sample.cables[0]] }, expect: { zones: { [zone().id]: base } } });
    expect(stale.statusCode).toBe(409);
    const body = stale.json();
    expect(body.error).toBe('version_conflict');
    expect(body.message).toContain('Someone else changed');
    expect(body.conflicts).toEqual([{ collection: 'zones', id: zone().id, expected: base, current: revision + 1, record: expect.objectContaining({ name: 'Office edit' }) }]);
    const after = await getNetwork();
    expect(after.revision).toBe(revision + 1);
    expect(after.data.zones.find((z) => z.id === zone().id)?.name).toBe('Office edit');
  });

  it('reports a record deleted by someone else, and lets a delete of a gone record through', async () => {
    const { versions } = await getNetwork();
    const base = versions!.zones![zone().id];
    expect((await send({ deletes: { zones: [zone().id] } })).statusCode).toBe(200);
    const edit = await send({ upserts: { zones: [{ ...zone(), name: 'Phone edit' }] }, expect: { zones: { [zone().id]: base } } });
    expect(edit.statusCode).toBe(409);
    expect(edit.json().conflicts[0]).toMatchObject({ current: null, record: null });
    expect((await send({ deletes: { zones: [zone().id] }, expect: { zones: { [zone().id]: base } } })).statusCode).toBe(200);
  });

  it('keeps last-write-wins for clients that send no versions', async () => {
    expect((await send({ upserts: { zones: [{ ...zone(), name: 'One' }] } })).statusCode).toBe(200);
    expect((await send({ upserts: { zones: [{ ...zone(), name: 'Two' }] } })).statusCode).toBe(200);
    expect((await getNetwork()).data.zones.find((z) => z.id === zone().id)?.name).toBe('Two');
  });

  it('migrates a database made before versions existed, keeping every record at version 0', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fibergis-v1-'));
    const path = join(dir, 'old.db');
    try {
      const { DatabaseSync } = await import('node:sqlite');
      const old = new DatabaseSync(path);
      old.exec(
        [
          'CREATE TABLE records (collection TEXT NOT NULL, id TEXT NOT NULL, position INTEGER NOT NULL, data TEXT NOT NULL CHECK (json_valid(data)), updated_at TEXT NOT NULL, PRIMARY KEY (collection, id)) WITHOUT ROWID;',
          'CREATE INDEX records_by_position ON records (collection, position);',
          'CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;',
          "INSERT INTO meta (key, value) VALUES ('revision', '7');",
          'PRAGMA user_version = 1;',
        ].join('\n'),
      );
      old.prepare('INSERT INTO records VALUES (?, ?, 0, ?, ?)').run('zones', zone().id, JSON.stringify(zone()), '2026-01-01');
      old.close();
      const repo = new SqliteNetworkRepository(path);
      const network = await repo.getNetwork();
      expect(network.revision).toBe(7);
      expect(network.data.zones).toEqual([zone()]);
      expect(network.versions?.zones?.[zone().id]).toBe(0);
      await expect(repo.applyChanges({ upserts: { zones: [zone()] }, expect: { zones: { [zone().id]: 0 } } })).resolves.toMatchObject({ revision: 8 });
      await repo.close();
      // The schema number is unchanged, so an older server can still open this database.
      const after = new DatabaseSync(path);
      expect((after.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(1);
      // A database a pre-release build numbered 2 is set back to 1 and keeps its versions.
      after.exec('PRAGMA user_version = 2');
      after.close();
      const again = new SqliteNetworkRepository(path);
      expect((await again.getNetwork()).versions?.zones?.[zone().id]).toBe(8);
      await again.close();
      const check = new DatabaseSync(path);
      expect((check.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(1);
      check.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('alarm, fault and work order checks (Phase 8)', () => {
  beforeEach(() => start());
  afterEach(async () => {
    await app.close();
    await repository.close();
  });

  const send = (payload: object) => app.inject({ method: 'POST', url: api('/changes'), payload });
  const customerId = sample.customers[0].id;
  const alarm = (overrides: object = {}) => ({
    id: 'ALM-TEST000001',
    kind: 'ont_los',
    source: 'test',
    isTest: true,
    severity: 'High',
    state: 'active',
    element: { type: 'customer', id: customerId },
    firstSeenAt: '2026-11-07T10:00:00.000Z',
    lastSeenAt: '2026-11-07T10:00:00.000Z',
    occurrences: 1,
    ...overrides,
  });
  const fault = (overrides: object = {}) => ({
    id: 'FLT-TEST000001',
    title: 'TEST: Suspected fault',
    type: 'Customer Disconnection',
    severity: 'High',
    status: 'Reported',
    affectedLocation: { lat: 12.9, lng: 77.6 },
    affectedCustomerIds: [customerId],
    affectedCores: [],
    affectedSplitterPorts: [],
    description: 'TEST',
    reportedAt: '2026-11-07 10:00',
    images: [],
    source: 'test',
    isTest: true,
    alarmIds: ['ALM-TEST000001'],
    ...overrides,
  });

  it('stores a labelled TEST alarm and its fault together', async () => {
    const response = await send({ upserts: { alarms: [alarm({ faultId: 'FLT-TEST000001' })], faults: [fault()] } });
    expect(response.statusCode).toBe(200);
  });

  it('refuses a device alarm while no OLT is connected, and a TEST event not labelled TEST', async () => {
    const device = await send({ upserts: { alarms: [alarm({ source: 'device_adapter', isTest: false })] } });
    expect(device.statusCode).toBe(409);
    expect(device.json().message).toContain('no live connection to the OLT');
    const unlabelled = await send({ upserts: { alarms: [alarm({ isTest: false })] } });
    expect(unlabelled.statusCode).toBe(409);
    expect((await getNetwork()).data.alarms).toEqual([]);
  });

  it('refuses a fault closed without a check, and accepts it with an office check', async () => {
    const closed = await send({ upserts: { alarms: [alarm()], faults: [fault({ status: 'Closed' })] } });
    expect(closed.statusCode).toBe(409);
    expect(closed.json().message).toContain('cannot be closed without a check');
    const verification = { method: 'office_check', at: '2026-11-07T11:00:00.000Z', by: 'Office', note: 'Customer confirmed by phone' };
    const checked = await send({ upserts: { alarms: [alarm()], faults: [fault({ status: 'Closed', verification })] } });
    expect(checked.statusCode).toBe(200);
  });

  it('refuses a work order verified with a reading that was not measured in the field', async () => {
    const order = {
      id: 'WO-TEST000001',
      title: 'Check box',
      type: 'Repair',
      priority: 'High',
      status: 'Verified',
      technicianName: 'Ravi',
      technicianPhone: '',
      scheduledDate: '2026-11-07',
      notes: '',
      photos: [],
      verification: { method: 'field_reading', at: '2026-11-07T11:00:00.000Z', by: 'Ravi', readingDbm: -19.2, photoId: 'PH-1' },
    };
    const response = await send({ upserts: { workOrders: [order] } });
    expect(response.statusCode).toBe(409);
    expect(response.json().message).toContain('measured in the field');
  });
});
