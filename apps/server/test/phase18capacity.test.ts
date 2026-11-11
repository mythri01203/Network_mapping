import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { API_PREFIX, capacityLines, type NetworkResponse, type PlanningScenario } from '@fibergis/shared';

import { buildApp } from '../src/app';
import { hashPassword } from '../src/auth/passwords';
import { loadConfig } from '../src/config';
import { seedSampleNetwork } from '../src/db/seed';
import { SqliteNetworkRepository } from '../src/db/sqliteRepository';

/** Network mapping Phase 18: expansion scenarios are stored apart, and only planners and engineers write them. */

vi.setConfig({ testTimeout: 60_000 });

let app: FastifyInstance;
let repository: SqliteNetworkRepository;

const api = (path: string) => `${API_PREFIX}${path}`;
const cookieOf = (response: LightMyRequestResponse) => String([response.headers['set-cookie']].flat()[0] ?? '').split(';')[0];
const send = (method: InjectOptions['method'], path: string, payload?: unknown, cookie?: string) =>
  app.inject({ method, url: api(path), ...(payload === undefined ? {} : { payload: payload as object }), headers: cookie ? { cookie } : {} });

beforeEach(async () => {
  const config = {
    ...loadConfig({ LOG_LEVEL: 'silent', STATIC_DIR: join(tmpdir(), 'fibergis-no-static') }),
    databasePath: ':memory:',
    photosDir: join(mkdtempSync(join(tmpdir(), 'fibergis-photos-')), 'photos'),
    backupsDir: join(mkdtempSync(join(tmpdir(), 'fibergis-backups-')), 'backups'),
    rateLimitPerMinute: 100_000,
  };
  repository = new SqliteNetworkRepository(config.databasePath);
  await seedSampleNetwork(repository);
  app = await buildApp({ config, repository });
});

afterEach(async () => {
  await app.close();
  await repository.close();
});

const scenario = (extra: Partial<PlanningScenario> = {}): PlanningScenario => ({
  id: 'PLN-S1',
  name: 'Ward 12 next 100 homes',
  status: 'open',
  items: [{ id: 'PLI-1', kind: 'customers', count: 40, boxId: 'FAT-01' }],
  createdAt: new Date().toISOString(),
  ...extra,
});

describe('planning scenarios on the server', () => {
  it('stores a scenario apart without changing a network figure, and checks its shape', async () => {
    const before = (await send('GET', '/network')).json() as NetworkResponse;
    expect((await send('POST', '/changes', { upserts: { planningScenarios: [scenario()] } })).statusCode).toBe(200);
    const after = (await send('GET', '/network')).json() as NetworkResponse;
    expect(after.data.planningScenarios).toHaveLength(1);
    expect(capacityLines(after.data)).toEqual(capacityLines(before.data));
    // Two places for one line, or no name: refused by the schema.
    const bad = scenario({ id: 'PLN-S2', items: [{ id: 'PLI-2', kind: 'customers', count: 4, boxId: 'FAT-01', splitterId: 'SPL-01' }] });
    expect((await send('POST', '/changes', { upserts: { planningScenarios: [bad] } })).statusCode).toBe(400);
    expect((await send('POST', '/changes', { upserts: { planningScenarios: [scenario({ id: 'PLN-S3', name: '' })] } })).statusCode).toBe(400);
  });

  it('planners write and delete scenarios; technicians and look-only accounts cannot', async () => {
    const admin = cookieOf(await send('POST', '/auth/setup', { username: 'owner', displayName: 'Owner', password: 'owner-pass-1' }));
    const passwordHash = await hashPassword('team-pass-1');
    repository.auth.create({ username: 'plan', displayName: 'Planner', role: 'office', passwordHash, mustChangePassword: false });
    repository.auth.create({ username: 'tech', displayName: 'Asha', role: 'technician', passwordHash, mustChangePassword: false });
    repository.auth.create({ username: 'look', displayName: 'Look Only', role: 'viewer', passwordHash, mustChangePassword: false });
    const planner = cookieOf(await send('POST', '/auth/login', { username: 'plan', password: 'team-pass-1' }));
    const tech = cookieOf(await send('POST', '/auth/login', { username: 'tech', password: 'team-pass-1' }));
    const viewer = cookieOf(await send('POST', '/auth/login', { username: 'look', password: 'team-pass-1' }));

    expect((await send('POST', '/changes', { upserts: { planningScenarios: [scenario({ id: 'PLN-T' })] } }, tech)).statusCode).toBe(403);
    expect((await send('POST', '/changes', { upserts: { planningScenarios: [scenario({ id: 'PLN-V' })] } }, viewer)).statusCode).toBe(403);
    expect((await send('POST', '/changes', { upserts: { planningScenarios: [scenario({ id: 'PLN-P' })] } }, planner)).statusCode).toBe(200);
    expect((await send('POST', '/changes', { upserts: { planningScenarios: [scenario({ id: 'PLN-P', status: 'closed' })] } }, planner)).statusCode).toBe(200);
    expect((await send('POST', '/changes', { deletes: { planningScenarios: ['PLN-P'] } }, tech)).statusCode).toBe(403);
    expect((await send('POST', '/changes', { deletes: { planningScenarios: ['PLN-P'] } }, planner)).statusCode).toBe(200);
    expect((await send('POST', '/changes', { upserts: { planningScenarios: [scenario({ id: 'PLN-A' })] } }, admin)).statusCode).toBe(200);
  });
});
