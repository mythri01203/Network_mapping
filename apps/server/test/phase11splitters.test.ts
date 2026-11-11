import type { FastifyInstance } from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { API_PREFIX, type Cable, type NetworkResponse, type Splitter } from '@fibergis/shared';

import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { seedSampleNetwork } from '../src/db/seed';
import { SqliteNetworkRepository } from '../src/db/sqliteRepository';

/** Phase 11 splitter output rules on the server: a temporary in-memory database, never the real one. */

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

describe('Phase 11 splitter outputs on the server', () => {
  it('refuses a fiber written onto a faulty output with no reason, and stores one with a reason', async () => {
    const data = await network();
    const box = data.equipment.find((e) => e.type === 'FAT') ?? data.equipment[0];
    const lead: Cable = { ...data.cables[0], id: 'CBL-P11', name: 'Lead P11', fiberCount: 2, cores: [], startEquipmentId: box.id, endEquipmentId: undefined, tubes: undefined, fibersPerTube: undefined, tubeCount: undefined };
    const markedAt = '2026-11-01T10:00:00.000Z';
    const splitter: Splitter = {
      id: 'SPL-P11',
      name: 'Splitter P11',
      terminalBoxId: box.id,
      ratio: '1:4',
      insertionLossDb: 7.2,
      status: 'Active',
      inputPort: { id: 'SPL-P11-IN' },
      outputPorts: [1, 2, 3, 4].map((n) => ({
        portNumber: n,
        label: `OUT-0${n}`,
        status: n === 1 ? ('Faulty' as const) : ('Available' as const),
        ...(n === 1 ? { history: [{ at: markedAt, action: 'MARKED_FAULTY', details: 'Marked faulty: No light' }] } : {}),
      })),
    };
    expect((await send({ upserts: { cables: [lead], splitters: [splitter] } })).statusCode).toBe(200);
    const connected = (extra: object) => ({
      ...splitter,
      outputPorts: splitter.outputPorts.map((p) => (p.portNumber === 1 ? { ...p, connectedDropCableId: 'CBL-P11', connectedCore: 1, connectedAt: '2026-11-02T10:00:00.000Z', ...extra } : p)),
    });
    const refused = await send({ upserts: { splitters: [connected({})] } });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().message).toMatch(/marked faulty and was connected with no reason/);
    const allowed = await send({ upserts: { splitters: [connected({ override: { status: 'Faulty', reason: 'Only output left', at: '2026-11-02T10:00:00.000Z' } })] } });
    expect(allowed.statusCode).toBe(200);
    const stored = (await network()).splitters.find((s) => s.id === 'SPL-P11')!;
    expect(stored.outputPorts[0].override?.reason).toBe('Only output left');
  });

  it('keeps a recorded arrangement with its reason', async () => {
    const data = await network();
    const sp = data.splitters[0];
    const architecture = { value: 'centralised' as const, level: 1, reason: 'Seen on site', at: '2026-11-10T08:00:00.000Z', by: 'Ravi' };
    expect((await send({ upserts: { splitters: [{ ...sp, architecture }] } })).statusCode).toBe(200);
    expect((await network()).splitters.find((s) => s.id === sp.id)!.architecture).toEqual(architecture);
  });
});
