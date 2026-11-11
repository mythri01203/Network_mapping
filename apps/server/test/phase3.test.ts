import type { FastifyInstance } from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { API_PREFIX, type ChangeResult, type Equipment, hasPlacedPosition, type NetworkResponse } from '@fibergis/shared';
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

/** A stored FAT with a real position, and a new one about 2 m north of it. */
function nearTwin(): { stored: Equipment; twin: Equipment } {
  const stored = sample.equipment.find((e) => e.type === 'FAT' && hasPlacedPosition(e) && e.lat !== 0)!;
  const twin: Equipment = {
    id: 'FAT-PHASE3TWIN',
    name: 'FAT-99',
    type: 'FAT',
    category: stored.category,
    lat: stored.lat + 0.00002,
    lng: stored.lng,
    area: '',
    street: '',
    status: 'Active',
    images: [],
    installedDate: '',
  };
  return { stored, twin };
}

describe('Phase 3: server duplicate warning for new points', () => {
  it('saves a new point beside one of the same kind and returns a warning, never a refusal', async () => {
    const { stored, twin } = nearTwin();
    const response = await app.inject({ method: 'POST', url: api('/changes'), payload: { upserts: { equipment: [twin] } } });
    expect(response.statusCode).toBe(200);
    const body = response.json<ChangeResult>();
    expect(body.upserted).toBe(1);
    expect(body.warnings).toHaveLength(1);
    expect(body.warnings![0]).toMatchObject({ rule: 'possible_duplicate', equipmentId: twin.id, nearId: stored.id, overridden: false });
    const network = (await app.inject({ method: 'GET', url: api('/network') })).json<NetworkResponse>();
    expect(network.data.equipment.some((e) => e.id === twin.id)).toBe(true);
  });

  it('marks it overridden when the change carries the person\'s "add a new one" choice', async () => {
    const { twin } = nearTwin();
    const audit = {
      id: 'LOG-PHASE3',
      timestamp: '2026-11-10 10:00:00',
      user: 'Planner',
      role: 'Administrator',
      action: 'POSSIBLE_DUPLICATE_KEPT',
      details: 'kept',
      assetId: twin.id,
      assetType: 'Equipment',
    };
    const response = await app.inject({ method: 'POST', url: api('/changes'), payload: { upserts: { equipment: [twin], auditLogs: [audit] } } });
    expect(response.statusCode).toBe(200);
    expect(response.json<ChangeResult>().warnings?.[0].overridden).toBe(true);
  });

  it('says nothing for an edit of a stored item or a point far from others', async () => {
    const { stored, twin } = nearTwin();
    const edit = await app.inject({ method: 'POST', url: api('/changes'), payload: { upserts: { equipment: [{ ...stored, notes: 'checked' }] } } });
    expect(edit.statusCode).toBe(200);
    expect(edit.json<ChangeResult>()).not.toHaveProperty('warnings');
    const far = await app.inject({ method: 'POST', url: api('/changes'), payload: { upserts: { equipment: [{ ...twin, lat: twin.lat + 0.01 }] } } });
    expect(far.statusCode).toBe(200);
    expect(far.json<ChangeResult>()).not.toHaveProperty('warnings');
  });

  it('follows the operator\'s radius setting', async () => {
    const { twin } = nearTwin();
    const setting = { id: 'osp.duplicate.radiusMeters', value: 1, source: 'Test', updatedAt: '2026-11-10' };
    const saved = await app.inject({ method: 'POST', url: api('/changes'), payload: { upserts: { settings: [setting] } } });
    expect(saved.statusCode).toBe(200);
    const response = await app.inject({ method: 'POST', url: api('/changes'), payload: { upserts: { equipment: [twin] } } });
    expect(response.json<ChangeResult>()).not.toHaveProperty('warnings');
  });
});
