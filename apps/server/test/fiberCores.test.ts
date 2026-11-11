import type { FastifyInstance } from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { API_PREFIX, type Cable, type NetworkResponse } from '@fibergis/shared';
import { createSampleNetwork } from '@fibergis/shared/sample';

import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { seedSampleNetwork } from '../src/db/seed';
import { SqliteNetworkRepository } from '../src/db/sqliteRepository';

/** Phase 7: tube records and core condition through the API, on a temporary in-memory database. */

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
const fiberCable = () => sample.cables.find((c) => c.cableCategory === 'Fiber' && c.fiberCount >= 12 && c.fiberCount % 4 === 0)!;

describe('tube and core records (Phase 7)', () => {
  it('stores tubes of different sizes and refuses sizes that do not add up', async () => {
    const cable = fiberCable();
    const n = cable.fiberCount;
    const good: Cable = { ...cable, fibersPerTube: undefined, tubeCount: 2, tubes: [{ number: 1, fiberCount: n - 4, colorName: 'Blue' }, { number: 2, fiberCount: 4 }] };
    expect((await send({ upserts: { cables: [good] } })).statusCode).toBe(200);
    expect((await getNetwork()).data.cables.find((c) => c.id === cable.id)?.tubes).toEqual(good.tubes);

    const bad = { ...good, tubeCount: undefined, tubes: [{ number: 1, fiberCount: n - 4 }, { number: 2, fiberCount: 2 }] };
    const refused = await send({ upserts: { cables: [bad] } });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().message).toMatch(/tubes hold .* fibers in all[\s\S]*Nothing was saved/);
  });

  it('accepts a faulty core given with no override (a warning, never a block) and keeps an override when sent', async () => {
    const cable = fiberCable();
    const history = [{ at: '2026-11-01T08:00:00.000Z', by: 'Asha', action: 'marked_faulty', fromStatus: 'Available', toStatus: 'Faulty', reason: 'OTDR break at 420 m', otdrRef: 'OTDR-0042' }];
    const assignment = { id: 'CA-TEST000001', kind: 'in_use', use: 'Tower link', effectiveFrom: '2026-11-02', createdAt: '2026-11-02T08:00:00.000Z' };
    const withCore = (extra: object) => ({ ...cable, cores: [...cable.cores.filter((c) => c.coreNumber !== 1), { coreNumber: 1, status: 'Faulty', history, ...extra }] });

    expect((await send({ upserts: { cables: [withCore({ assignments: [assignment] })] } })).statusCode).toBe(200);
    const override = { status: 'Faulty', reason: 'Re-tested OK on site', at: '2026-11-02T08:00:00.000Z', by: 'Asha' };
    expect((await send({ upserts: { cables: [withCore({ assignments: [{ ...assignment, override }] })] } })).statusCode).toBe(200);
    const stored = (await getNetwork()).data.cables.find((c) => c.id === cable.id)!.cores.find((c) => c.coreNumber === 1)!;
    expect(stored.status).toBe('Faulty');
    expect(stored.history).toEqual(history);
    expect(stored.assignments?.[0].override).toEqual(override);
  });

  it('refuses an override with no reason, and a core status that does not exist', async () => {
    const cable = fiberCable();
    const assignment = { id: 'CA-TEST000002', kind: 'in_use', use: 'Tower link', effectiveFrom: '2026-11-02', createdAt: '2026-11-02T08:00:00.000Z', override: { status: 'Faulty', reason: '  ', at: '2026-11-02' } };
    const noReason = { ...cable, cores: [{ coreNumber: 1, status: 'Faulty', assignments: [assignment] }] };
    expect((await send({ upserts: { cables: [noReason] } })).statusCode).toBe(400);
    const badStatus = { ...cable, cores: [{ coreNumber: 1, status: 'Broken' }] };
    expect((await send({ upserts: { cables: [badStatus] } })).statusCode).toBe(400);
  });
});
