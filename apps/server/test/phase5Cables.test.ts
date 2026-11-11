import type { FastifyInstance } from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { API_PREFIX, type Cable, type ChangeResult, type NetworkResponse, POSSIBLE_DUPLICATE_ROUTE_KEPT } from '@fibergis/shared';
import { createSampleNetwork } from '@fibergis/shared/sample';

import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { seedSampleNetwork } from '../src/db/seed';
import { SqliteNetworkRepository } from '../src/db/sqliteRepository';

const api = (path: string) => `${API_PREFIX}${path}`;
const sample = createSampleNetwork();

let app: FastifyInstance;
let repository: SqliteNetworkRepository;

beforeEach(async () => {
  const config = {
    ...loadConfig({ LOG_LEVEL: 'silent', STATIC_DIR: join(tmpdir(), 'fibergis-no-static') }),
    databasePath: ':memory:',
    // Never the real data folder.
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

/** A stored cable with both ends and a drawn line, and a new one along the same line between the same ends. */
function twinCable(): { stored: Cable; twin: Cable } {
  const stored = sample.cables.find((c) => c.startEquipmentId && c.endEquipmentId && c.coordinates.length >= 2)!;
  const twin: Cable = {
    ...stored,
    id: 'CBL-PHASE5-TWIN',
    name: 'Second line on the same street',
    cores: stored.cores.map((c) => ({ coreNumber: c.coreNumber, status: 'Available' })),
    startPortName: undefined,
    endPortName: undefined,
  };
  return { stored, twin };
}

describe('Phase 5: duplicate route warning on the server', () => {
  it('saves a cable with the same two ends along the same line and returns a warning, never a refusal', async () => {
    const { stored, twin } = twinCable();
    const response = await app.inject({ method: 'POST', url: api('/changes'), payload: { upserts: { cables: [twin] } } });
    expect(response.statusCode).toBe(200);
    const body = response.json<ChangeResult>();
    expect(body.warnings?.[0]).toMatchObject({ rule: 'possible_duplicate_route', cableId: twin.id, overridden: false });
    expect([stored.id]).toContain((body.warnings?.[0] as { nearId: string }).nearId);
    const network = (await app.inject({ method: 'GET', url: api('/network') })).json<NetworkResponse>();
    expect(network.data.cables.some((c) => c.id === twin.id)).toBe(true);
  });

  it('marks it overridden when the change carries the person\'s "different cable" answer', async () => {
    const { twin } = twinCable();
    const audit = {
      id: 'LOG-PHASE5',
      timestamp: '2026-11-10 10:00:00',
      user: 'Planner',
      role: 'Administrator',
      action: POSSIBLE_DUPLICATE_ROUTE_KEPT,
      details: 'different cable',
      assetId: twin.id,
      assetType: 'Cable',
    };
    const response = await app.inject({ method: 'POST', url: api('/changes'), payload: { upserts: { cables: [twin], auditLogs: [audit] } } });
    expect(response.statusCode).toBe(200);
    expect(response.json<ChangeResult>().warnings?.[0].overridden).toBe(true);
  });

  it('says nothing when a stored cable is saved again unchanged in its line and ends', async () => {
    const { stored } = twinCable();
    const response = await app.inject({ method: 'POST', url: api('/changes'), payload: { upserts: { cables: [{ ...stored, remarks: 'checked' }] } } });
    expect(response.statusCode).toBe(200);
    expect(response.json<ChangeResult>().warnings).toBeUndefined();
  });
});

describe('Phase 5: how a cable is made', () => {
  it('refuses a build that contradicts itself and keeps one that does not', async () => {
    const { stored } = twinCable();
    const bad = await app.inject({ method: 'POST', url: api('/changes'), payload: { upserts: { cables: [{ ...stored, fiberStandard: 'G.652D', fiberMode: 'multi_mode' }] } } });
    expect(bad.statusCode).toBe(409);
    expect(bad.json<{ message: string }>().message).toMatch(/single-mode/);
    const good = await app.inject({ method: 'POST', url: api('/changes'), payload: { upserts: { cables: [{ ...stored, fiberStandard: 'G.657A2', fiberMode: 'single_mode', sheath: 'LSZH', outerDiameterMm: 6.2 }] } } });
    expect(good.statusCode).toBe(200);
    const network = (await app.inject({ method: 'GET', url: api('/network') })).json<NetworkResponse>();
    expect(network.data.cables.find((c) => c.id === stored.id)).toMatchObject({ fiberStandard: 'G.657A2', sheath: 'LSZH' });
  });
});
