import type { FastifyInstance } from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { API_PREFIX, type Cable, type JointClosure, type NetworkResponse } from '@fibergis/shared';
import { createSampleNetwork } from '@fibergis/shared/sample';

import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { seedSampleNetwork } from '../src/db/seed';
import { SqliteNetworkRepository } from '../src/db/sqliteRepository';

/** Phase 8: tray positions, pigtails and "entered by mistake" through the API, on a temporary in-memory database. */

const sample = createSampleNetwork();
const api = (path: string) => `${API_PREFIX}${path}`;

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

const send = (payload: object) => app.inject({ method: 'POST', url: api('/changes'), payload });
const getNetwork = async () => (await app.inject({ method: 'GET', url: api('/network') })).json<NetworkResponse>();

const template = sample.cables.find((c) => c.cableCategory === 'Fiber' && c.fiberCount >= 12)!;
const testCable = (id: string): Cable => ({ ...template, id, name: id, fiberCount: 12, cores: [], startEquipmentId: undefined, endEquipmentId: undefined, coordinates: [], tubes: undefined, fibersPerTube: undefined, tubeCount: undefined });

const splice = (id: string, core: number, extra: object = {}) => ({
  id,
  inputCableId: 'P8-IN',
  inputCableName: 'P8-IN',
  inputCore: core,
  outputCableId: 'P8-OUT',
  outputCableName: 'P8-OUT',
  outputCore: core,
  status: 'Spliced',
  technician: 'Asha',
  date: '2026-11-10',
  trayId: 'TRY-P8',
  ...extra,
});

const closure = (extra: Partial<JointClosure> = {}): JointClosure => ({
  id: 'CLO-P8',
  name: 'Phase 8 joint',
  closureType: 'Horizontal In-line',
  lat: 17.4,
  lng: 78.4,
  area: '',
  entryPortsCount: 1,
  exitPortsCount: 1,
  installationDate: '',
  technician: '',
  splices: [],
  images: [],
  trays: [{ id: 'TRY-P8', label: 'Tray 1', capacity: 1 }],
  cableEntries: [
    { cableId: 'P8-IN', role: 'in' },
    { cableId: 'P8-OUT', role: 'out' },
  ],
  ...extra,
});

describe('splicing and closures (Phase 8)', () => {
  it('refuses two splices in one tray position (409) but accepts a full tray (a warning only)', async () => {
    expect((await send({ upserts: { cables: [testCable('P8-IN'), testCable('P8-OUT')] } })).statusCode).toBe(200);
    const clash = await send({ upserts: { closures: [closure({ splices: [splice('SPC-1', 1, { position: 1 }), splice('SPC-2', 2, { position: 1 })] as JointClosure['splices'] })] } });
    expect(clash.statusCode).toBe(409);
    expect(clash.json().message).toMatch(/position 1 holds 2/);
    // Two splices on a tray of one position, in different positions: over capacity is not refused.
    const full = await send({ upserts: { closures: [closure({ splices: [splice('SPC-1', 1, { position: 1 }), splice('SPC-2', 2, { position: 2 })] as JointClosure['splices'] })] } });
    expect(full.statusCode).toBe(200);
  });

  it('keeps a splice struck out as entered by mistake, and a pigtail with its connector', async () => {
    expect((await send({ upserts: { cables: [testCable('P8-IN'), testCable('P8-OUT')] } })).statusCode).toBe(200);
    const mistake = splice('SPC-3', 3, { retiredAt: '2026-11-10T09:00:00.000Z', retiredBy: 'Asha', retiredReason: 'Wrong fiber', enteredInError: true, cassette: 'A', position: 1, lossMeter: 'Splicer 9', reportRef: 'JOB-1' });
    const pigtail = { id: 'PGT-1', cableId: 'P8-IN', cableName: 'P8-IN', core: 7, connectorType: 'SC/APC', pigtailLabel: 'P7', technician: 'Asha', date: '2026-11-10' };
    const response = await send({ upserts: { closures: [closure({ splices: [mistake] as JointClosure['splices'], terminations: [pigtail] })] } });
    expect(response.statusCode).toBe(200);
    const stored = (await getNetwork()).data.closures.find((c) => c.id === 'CLO-P8')!;
    expect(stored.splices[0]).toMatchObject({ enteredInError: true, retiredReason: 'Wrong fiber', cassette: 'A', position: 1, lossMeter: 'Splicer 9', reportRef: 'JOB-1' });
    expect(stored.terminations).toEqual([pigtail]);

    const badPigtail = { ...pigtail, id: 'PGT-2', core: 40 };
    expect((await send({ upserts: { closures: [closure({ terminations: [pigtail, badPigtail] })] } })).statusCode).toBe(409);
  });
});
