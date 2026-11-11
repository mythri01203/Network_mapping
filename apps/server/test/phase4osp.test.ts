import type { FastifyInstance } from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { API_PREFIX, type Duct, type Inspection, type NetworkResponse } from '@fibergis/shared';

import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { seedSampleNetwork } from '../src/db/seed';
import { SqliteNetworkRepository } from '../src/db/sqliteRepository';

/** Phase 4 outside-plant rules on the server: a temporary in-memory database, never the real one. */

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

describe('Phase 4 outside plant on the server', () => {
  it('refuses a new cable in a blocked way, and allows it once the way is marked clear', async () => {
    const data = await network();
    const cableId = data.cables[0].id;
    const duct: Duct = {
      id: 'DCT-P4',
      name: 'Main road duct',
      coordinates: [
        [12.97, 77.59],
        [12.971, 77.591],
      ],
      status: 'built',
      basis: 'office_drawn',
      cableIds: [],
      subducts: [{ id: 'SUB-1', label: 'Blue', cableIds: [], condition: 'blocked' }],
      createdAt: new Date().toISOString(),
    };
    expect((await send({ upserts: { ducts: [duct] } })).statusCode).toBe(200);
    const withCable = { ...duct, subducts: [{ ...duct.subducts[0], cableIds: [cableId] }] };
    const refused = await send({ upserts: { ducts: [withCable] } });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().message).toMatch(/blocked/);
    const cleared = { ...withCable, subducts: [{ ...withCable.subducts[0], condition: 'clear' as const }] };
    expect((await send({ upserts: { ducts: [cleared] } })).statusCode).toBe(200);
  });

  it('stores inspections, refuses one of a missing record, and refuses deleting its target alone', async () => {
    const data = await network();
    const pole = data.equipment[0];
    const inspection: Inspection = {
      id: 'INS-P4',
      targetType: 'pole',
      targetId: pole.id,
      inspectedOn: '2026-11-03',
      inspectedBy: 'Ravi',
      condition: 'fair',
      createdAt: new Date().toISOString(),
    };
    expect((await send({ upserts: { inspections: [{ ...inspection, id: 'INS-BAD', targetId: 'GONE' }] } })).statusCode).toBe(409);
    expect((await send({ upserts: { inspections: [{ ...inspection, condition: 'excellent' }] } })).statusCode).toBe(400);
    expect((await send({ upserts: { inspections: [inspection] } })).statusCode).toBe(200);
    expect((await network()).inspections).toEqual([inspection]);
    // Deleting the pole alone would leave the inspection pointing to nothing.
    const alone = await send({ deletes: { equipment: [pole.id] } });
    expect(alone.statusCode).toBe(409);
  });

  it('accepts a building outline of three corners or more and refuses fewer', async () => {
    const building = {
      id: 'BLD-P4',
      name: 'Sai Residency',
      kind: 'apartment',
      lat: 12.9,
      lng: 77.6,
      floorBoxes: [],
      units: [],
      createdAt: new Date().toISOString(),
    };
    const corners = [
      [12.9, 77.6],
      [12.9, 77.6003],
      [12.9002, 77.6003],
    ];
    expect((await send({ upserts: { buildings: [{ ...building, footprint: corners.slice(0, 2) }] } })).statusCode).toBe(400);
    expect((await send({ upserts: { buildings: [{ ...building, footprint: corners }] } })).statusCode).toBe(200);
  });
});
