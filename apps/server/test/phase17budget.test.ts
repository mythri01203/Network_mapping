import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { API_PREFIX, BUDGET_FORMULA, BUDGET_METHOD, type NetworkResponse, type OpticalBudgetRun } from '@fibergis/shared';

import { buildApp } from '../src/app';
import { hashPassword } from '../src/auth/passwords';
import { loadConfig } from '../src/config';
import { seedSampleNetwork } from '../src/db/seed';
import { SqliteNetworkRepository } from '../src/db/sqliteRepository';

/** Network mapping Phase 17: stored optical budget runs are history; never changed, never deleted, never a guessed verdict. */

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

const run = (extra: Partial<OpticalBudgetRun> = {}): OpticalBudgetRun => ({
  id: 'OBR-1',
  ranAt: new Date().toISOString(),
  ranBy: 'Engineer',
  target: { kind: 'customer', id: 'CUST-001', label: 'Customer CUST-001' },
  oltId: 'OLT-01',
  ponPortId: 'PON-01',
  opticsClass: 'GPON B+',
  opticsClassRecorded: true,
  inputs: [{ key: 'opticsClass', label: 'Optics class', value: 'GPON B+', origin: 'record', source: 'Recorded on OLT-01 PON-01.' }],
  directions: [
    {
      direction: 'downstream', wavelengthNm: 1490, fiberLossDb: 1, splitterLossDb: 10.4, spliceLossDb: 0.1, connectorLossDb: 1.2, totalLossDb: 12.7,
      classMinLossDb: 13, classMaxLossDb: 28, remainingDb: 15.3, afterMarginDb: 12.3, marginDb: 3, outcome: 'too_little_loss', formula: 'Loss at 1490 nm = ... = 12.70 dB.',
    },
  ],
  formula: BUDGET_FORMULA,
  method: BUDGET_METHOD,
  ...extra,
});

describe('optical budget runs on the server', () => {
  it('stores a run without changing a network record, and never changes or deletes it', async () => {
    const before = (await send('GET', '/network')).json() as NetworkResponse;
    expect((await send('POST', '/changes', { upserts: { opticalBudgetRuns: [run()] } })).statusCode).toBe(200);
    const after = (await send('GET', '/network')).json() as NetworkResponse;
    expect(after.data.opticalBudgetRuns).toHaveLength(1);
    expect(after.data.customers).toEqual(before.data.customers);
    expect(after.data.equipment).toEqual(before.data.equipment);
    // The same run again changes nothing and is fine (an offline resend).
    expect((await send('POST', '/changes', { upserts: { opticalBudgetRuns: [run({ ranAt: after.data.opticalBudgetRuns![0].ranAt })] } })).statusCode).toBe(200);
    // A changed run and a delete are refused, even with login off.
    const changed = await send('POST', '/changes', { upserts: { opticalBudgetRuns: [run({ ranBy: 'Someone else' })] } });
    expect(changed.statusCode).toBe(409);
    expect(changed.body).toContain('never changed');
    const deleted = await send('POST', '/changes', { deletes: { opticalBudgetRuns: ['OBR-1'] } });
    expect(deleted.statusCode).toBe(409);
    expect(((await send('GET', '/network')).json() as NetworkResponse).data.opticalBudgetRuns).toHaveLength(1);
  });

  it('refuses a pass or fail with an assumed optics class', async () => {
    const guessed = await send('POST', '/changes', { upserts: { opticalBudgetRuns: [run({ id: 'OBR-2', opticsClassRecorded: false })] } });
    expect(guessed.statusCode).toBe(400);
    const honest = run({
      id: 'OBR-3',
      opticsClassRecorded: false,
      directions: [{ ...run().directions[0], outcome: 'estimated_default_class' }],
    });
    expect((await send('POST', '/changes', { upserts: { opticalBudgetRuns: [honest] } })).statusCode).toBe(200);
  });

  it('engineers and planners store runs; technicians and look-only accounts cannot', async () => {
    const admin = cookieOf(await send('POST', '/auth/setup', { username: 'owner', displayName: 'Owner', password: 'owner-pass-1' }));
    const passwordHash = await hashPassword('team-pass-1');
    repository.auth.create({ username: 'plan', displayName: 'Planner', role: 'office', passwordHash, mustChangePassword: false });
    repository.auth.create({ username: 'tech', displayName: 'Asha', role: 'technician', passwordHash, mustChangePassword: false });
    repository.auth.create({ username: 'look', displayName: 'Look Only', role: 'viewer', passwordHash, mustChangePassword: false });
    const planner = cookieOf(await send('POST', '/auth/login', { username: 'plan', password: 'team-pass-1' }));
    const tech = cookieOf(await send('POST', '/auth/login', { username: 'tech', password: 'team-pass-1' }));
    const viewer = cookieOf(await send('POST', '/auth/login', { username: 'look', password: 'team-pass-1' }));

    expect((await send('POST', '/changes', { upserts: { opticalBudgetRuns: [run({ id: 'OBR-T' })] } }, tech)).statusCode).toBe(403);
    expect((await send('POST', '/changes', { upserts: { opticalBudgetRuns: [run({ id: 'OBR-V' })] } }, viewer)).statusCode).toBe(403);
    expect((await send('POST', '/changes', { upserts: { opticalBudgetRuns: [run({ id: 'OBR-P' })] } }, planner)).statusCode).toBe(200);
    expect((await send('POST', '/changes', { deletes: { opticalBudgetRuns: ['OBR-P'] } }, planner)).statusCode).toBe(403);
    expect((await send('POST', '/changes', { upserts: { opticalBudgetRuns: [run({ id: 'OBR-A' })] } }, admin)).statusCode).toBe(200);
    expect((await send('POST', '/changes', { deletes: { opticalBudgetRuns: ['OBR-A'] } }, admin)).statusCode).toBe(409);
  });
});
