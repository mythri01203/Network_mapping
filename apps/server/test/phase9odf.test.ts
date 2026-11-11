import type { FastifyInstance } from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { API_PREFIX, type Equipment, type NetworkResponse, type Rack, type Site } from '@fibergis/shared';

import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { seedSampleNetwork } from '../src/db/seed';
import { SqliteNetworkRepository } from '../src/db/sqliteRepository';

/** Phase 9 sites, racks and ODF port rules on the server: a temporary in-memory database, never the real one. */

let app: FastifyInstance;
let repository: SqliteNetworkRepository;

const send = (payload: unknown) => app.inject({ method: 'POST', url: `${API_PREFIX}/changes`, payload: payload as object });
const network = async () => (await app.inject({ method: 'GET', url: `${API_PREFIX}/network` })).json<NetworkResponse>().data;

beforeEach(async () => {
  const config = {
    ...loadConfig({ LOG_LEVEL: 'silent', STATIC_DIR: join(tmpdir(), 'fibergis-no-static') }),
    databasePath: ':memory:',
    photosDir: join(mkdtempSync(join(tmpdir(), 'fibergis-photos-')), 'photos'),
    backupsDir: join(mkdtempSync(join(tmpdir(), 'fibergis-backups-')), 'backups'),
  };
  repository = new SqliteNetworkRepository(config.databasePath);
  await seedSampleNetwork(repository);
  app = await buildApp({ config, repository });
});

afterEach(async () => {
  await app.close();
  await repository.close();
});

const site: Site = { id: 'SITE-P9', name: 'Main exchange' };
const rack: Rack = { id: 'RACK-P9', siteId: 'SITE-P9', name: 'Rack 1', heightUnits: 10 };

describe('Phase 9 sites and racks on the server', () => {
  it('stores sites and racks, and refuses links to records that are not there', async () => {
    expect((await send({ upserts: { racks: [rack] } })).statusCode).toBe(409);
    expect((await send({ upserts: { sites: [site], racks: [rack] } })).statusCode).toBe(200);
    const data = await network();
    expect(data.sites).toEqual([site]);
    expect(data.racks).toEqual([rack]);
    const item = data.equipment[0];
    expect((await send({ upserts: { equipment: [{ ...item, rackId: 'RACK-GONE' }] } })).statusCode).toBe(409);
    const beyond = await send({ upserts: { equipment: [{ ...item, siteId: site.id, rackId: rack.id, rackUnit: 9, rackUnits: 3 }] } });
    expect(beyond.statusCode).toBe(409);
    expect(beyond.json().message).toMatch(/has 10 units/);
    expect((await send({ upserts: { equipment: [{ ...item, siteId: site.id, rackId: rack.id, rackUnit: 8, rackUnits: 3 }] } })).statusCode).toBe(200);
  });

  it('refuses deleting a site or rack that something still names', async () => {
    expect((await send({ upserts: { sites: [site], racks: [rack] } })).statusCode).toBe(200);
    const item = (await network()).equipment[0];
    expect((await send({ upserts: { equipment: [{ ...item, siteId: site.id, rackId: rack.id }] } })).statusCode).toBe(200);
    const rackGone = await send({ deletes: { racks: [rack.id] } });
    expect(rackGone.statusCode).toBe(409);
    expect(rackGone.json().message).toMatch(/names rack RACK-P9, which is not on record/);
    expect((await send({ deletes: { sites: [site.id] } })).statusCode).toBe(409);
    // Once empty, they go.
    const { siteId: _s, rackId: _r, ...free } = item as Equipment;
    expect((await send({ upserts: { equipment: [free] } })).statusCode).toBe(200);
    expect((await send({ deletes: { racks: [rack.id] } })).statusCode).toBe(200);
    expect((await send({ deletes: { sites: [site.id] } })).statusCode).toBe(200);
  });
});

describe('Phase 9 ODF ports on the server', () => {
  it('refuses a patch written onto a faulty port with no reason, and stores one with a reason', async () => {
    const data = await network();
    const olt = data.equipment.find((e) => e.type === 'OLT' && e.ponPorts?.length) ?? data.equipment.find((e) => e.type === 'OLT')!;
    const ponPortId = olt.ponPorts?.[0]?.id;
    expect(ponPortId).toBeDefined();
    const markedAt = '2026-11-01T10:00:00.000Z';
    const odf: Equipment = {
      id: 'ODF-P9',
      name: 'ODF P9',
      type: 'ODF',
      category: 'Central Office',
      lat: olt.lat,
      lng: olt.lng,
      area: '',
      street: '',
      status: 'Active',
      images: [],
      installedDate: '',
      odfPanels: [{ id: 'PA', label: 'Panel A', ports: [{ id: 'PX1', number: 1, status: 'damaged', history: [{ at: markedAt, action: 'MARKED_FAULTY', details: 'Marked faulty: Adapter cracked' }] }] }],
    };
    expect((await send({ upserts: { equipment: [odf] } })).statusCode).toBe(200);
    const patch = { oltId: olt.id, ponPortId: ponPortId!, patchedAt: '2026-11-02T10:00:00.000Z' };
    const withPatch = (extra: object) => ({ ...odf, odfPanels: [{ ...odf.odfPanels![0], ports: [{ ...odf.odfPanels![0].ports[0], patch: { ...patch, ...extra } }] }] });
    const refused = await send({ upserts: { equipment: [withPatch({})] } });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().message).toMatch(/marked faulty and was patched with no reason/);
    const allowed = await send({ upserts: { equipment: [withPatch({ override: { status: 'damaged', reason: 'Temporary until new adapter', at: patch.patchedAt } })] } });
    expect(allowed.statusCode).toBe(200);
  });
});
