import type { FastifyInstance } from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { API_PREFIX, type Cable, type CableSegment, type Duct, type NetworkResponse, polylineLengthMeters } from '@fibergis/shared';

import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { seedSampleNetwork } from '../src/db/seed';
import { SqliteNetworkRepository } from '../src/db/sqliteRepository';

/** Network mapping Phase 6: cable stretches on the server, in a temporary in-memory database. */

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

const NOW = '2026-11-11T10:00:00.000Z';

async function drawnCable(): Promise<{ cable: Cable; length: number }> {
  const data = await network();
  const cable = data.cables.find((c) => c.coordinates.length >= 2 && polylineLengthMeters(c.coordinates) > 100)!;
  return { cable, length: polylineLengthMeters(cable.coordinates) };
}

describe('cable stretches on the server', () => {
  it('stores stretches of one cable and refuses an overlap or a stretch off the drawn line', async () => {
    const { cable, length } = await drawnCable();
    const first: CableSegment = { id: 'SEG-S1', cableId: cable.id, fromMeters: 0, toMeters: 40, installMethod: 'Aerial', createdAt: NOW };
    const second: CableSegment = { id: 'SEG-S2', cableId: cable.id, fromMeters: 40, toMeters: 90, installMethod: 'Duct', measuredLengthMeters: 52, createdAt: NOW };
    expect((await send({ upserts: { cableSegments: [first, second] } })).statusCode).toBe(200);
    expect((await network()).cableSegments).toEqual([first, second]);

    const overlap = await send({ upserts: { cableSegments: [{ ...second, id: 'SEG-S3', fromMeters: 20, toMeters: 60 }] } });
    expect(overlap.statusCode).toBe(409);
    expect(overlap.json().message).toMatch(/overlaps stretch/);
    const beyond = await send({ upserts: { cableSegments: [{ ...second, id: 'SEG-S4', fromMeters: 95, toMeters: length + 50 }] } });
    expect(beyond.statusCode).toBe(409);
    expect(beyond.json().message).toMatch(/beyond the end of the drawn line/);
    // An aerial stretch in a duct contradicts itself; a stretch with both ends as a structure and a distance is not valid at all.
    const duct: Duct = { id: 'DCT-S', name: 'Duct', coordinates: cable.coordinates.slice(0, 2), status: 'built', basis: 'office_drawn', cableIds: [], subducts: [], createdAt: NOW };
    const aerialInDuct = await send({ upserts: { ducts: [duct], cableSegments: [{ ...first, id: 'SEG-S5', fromMeters: 95, toMeters: 99, ductId: 'DCT-S' }] } });
    expect(aerialInDuct.statusCode).toBe(409);
    expect((await send({ upserts: { cableSegments: [{ ...first, id: 'SEG-S6', fromStructureId: 'X' }] } })).statusCode).toBe(400);
  });

  it('refuses a stretch naming a missing duct, and deleting a duct a stretch still names', async () => {
    const { cable } = await drawnCable();
    const duct: Duct = { id: 'DCT-S', name: 'Duct', coordinates: cable.coordinates.slice(0, 2), status: 'built', basis: 'office_drawn', cableIds: [cable.id], subducts: [], createdAt: NOW };
    const inDuct: CableSegment = { id: 'SEG-D', cableId: cable.id, fromMeters: 0, toMeters: 30, installMethod: 'Duct', ductId: 'DCT-S', createdAt: NOW };
    expect((await send({ upserts: { cableSegments: [inDuct] } })).statusCode).toBe(409);
    expect((await send({ upserts: { ducts: [duct], cableSegments: [inDuct] } })).statusCode).toBe(200);
    const orphaning = await send({ deletes: { ducts: ['DCT-S'] } });
    expect(orphaning.statusCode).toBe(409);
    expect(orphaning.json().message).toMatch(/its duct "DCT-S"/);
    const { ductId: _gone, ...kept } = inDuct;
    expect((await send({ deletes: { ducts: ['DCT-S'] }, upserts: { cableSegments: [kept] } })).statusCode).toBe(200);
  });

  it('checks a stretch against a cable stored in the same change, and does not blame stored stretches on a route edit', async () => {
    const { cable } = await drawnCable();
    const newCable: Cable = { ...cable, id: 'CBL-SEG-NEW', name: 'New cable', cores: [], fiberCount: 0, startEquipmentId: undefined, endEquipmentId: undefined };
    const stretch: CableSegment = { id: 'SEG-N', cableId: newCable.id, fromMeters: 0, toMeters: 60, createdAt: NOW };
    expect((await send({ upserts: { cables: [newCable], cableSegments: [stretch] } })).statusCode).toBe(200);
    // Shortening the line leaves the stretch beyond its end: reported in the panel, never a refusal of the edit.
    const shorter = { ...newCable, coordinates: [newCable.coordinates[0], [newCable.coordinates[0][0] + 0.0001, newCable.coordinates[0][1]] as [number, number]] };
    expect((await send({ upserts: { cables: [shorter] } })).statusCode).toBe(200);
  });
});
