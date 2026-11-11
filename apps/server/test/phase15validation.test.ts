import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { API_PREFIX, type Cable, type NetworkResponse, type ValidationFinding } from '@fibergis/shared';
import { createSampleNetwork } from '@fibergis/shared/sample';

import { buildApp } from '../src/app';
import { hashPassword } from '../src/auth/passwords';
import { loadConfig } from '../src/config';
import { seedSampleNetwork } from '../src/db/seed';
import { SqliteNetworkRepository } from '../src/db/sqliteRepository';
import { operatorLimits } from '../src/lib/mapCheck';

/** Network mapping Phase 15: stored map check findings, and the operator's own limits on the server. */

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

const sample = createSampleNetwork();
const findings = async (): Promise<ValidationFinding[]> => (await send('GET', '/network')).json<NetworkResponse>().data.validationFindings;

/** A cable whose To end is drawn about 2.2 km from the box it says it connects to. */
const farCable = (): Cable => {
  const base = sample.cables.find((c) => c.endEquipmentId && c.coordinates.length >= 2)!;
  const coordinates = [...base.coordinates];
  const [lat, lng] = coordinates[coordinates.length - 1];
  coordinates[coordinates.length - 1] = [lat + 0.02, lng];
  return { ...base, coordinates };
};

describe('stored map check findings', () => {
  it('stores what a run finds, keeps it on a re-run, and marks it no longer found when fixed: never deleted', async () => {
    const cable = farCable();
    expect((await send('POST', '/changes', { upserts: { cables: [cable] } })).statusCode).toBe(200);
    const run = await send('POST', '/reports/validation-run');
    expect(run.statusCode, run.body).toBe(200);
    expect(run.json().summary.opened).toBeGreaterThan(0);
    const stored = await findings();
    const gap = stored.find((f) => f.key === `geometry:cable-end-gap:${cable.id}:end`)!;
    expect(gap).toMatchObject({ state: 'open', presence: 'found', rule: 'cable-end-gap' });
    // Customers are named by id only in what is stored.
    for (const c of sample.customers) expect(JSON.stringify(stored)).not.toContain(`"${c.name}"`);

    const again = (await send('POST', '/reports/validation-run')).json();
    expect(again.written).toBe(0);

    const original = sample.cables.find((c) => c.id === cable.id)!;
    expect((await send('POST', '/changes', { upserts: { cables: [original] } })).statusCode).toBe(200);
    expect((await send('POST', '/reports/validation-run')).json().summary.noLongerFound).toBeGreaterThan(0);
    const after = (await findings()).find((f) => f.id === gap.id)!;
    expect(after.presence).toBe('no_longer_found');
    expect(after.history.map((h) => h.event)).toEqual(['found', 'not_found']);
  });

  it('refuses a delete, a decision with no note, and history rewritten; takes a decision with who, when and a note', async () => {
    await send('POST', '/changes', { upserts: { cables: [farCable()] } });
    await send('POST', '/reports/validation-run');
    const [f] = await findings();
    const del = await send('POST', '/changes', { deletes: { validationFindings: [f.id] } });
    expect(del.statusCode).toBe(409);
    expect(del.json().message).toMatch(/never deleted/);
    const bare = await send('POST', '/changes', { upserts: { validationFindings: [{ ...f, state: 'resolved' }] } });
    expect(bare.statusCode).toBe(409);
    const cut = await send('POST', '/changes', { upserts: { validationFindings: [{ ...f, history: [] }] } });
    expect(cut.statusCode).toBe(409);
    const at = new Date().toISOString();
    const decided: ValidationFinding = { ...f, state: 'acknowledged', stateBy: 'Owner', stateAt: at, stateNote: 'Real loop at the pole.', history: [...f.history, { at, event: 'acknowledged', by: 'Owner', note: 'Real loop at the pole.' }] };
    expect((await send('POST', '/changes', { upserts: { validationFindings: [decided] } })).statusCode).toBe(200);
    expect((await findings()).find((x) => x.id === f.id)!.state).toBe('acknowledged');
  });

  it('only accounts that may change findings can run and store them; everyone signed in can read the summary', async () => {
    const owner = cookieOf(await send('POST', '/auth/setup', { username: 'owner', displayName: 'Owner', password: 'owner-pass-1' }));
    const passwordHash = await hashPassword('team-pass-1');
    repository.auth.create({ username: 'look', displayName: 'Look Only', role: 'viewer', passwordHash, mustChangePassword: false });
    repository.auth.create({ username: 'tech', displayName: 'Asha', role: 'technician', passwordHash, mustChangePassword: false });
    const viewer = cookieOf(await send('POST', '/auth/login', { username: 'look', password: 'team-pass-1' }));
    const tech = cookieOf(await send('POST', '/auth/login', { username: 'tech', password: 'team-pass-1' }));
    expect((await send('POST', '/reports/validation-run', undefined, viewer)).statusCode).toBe(403);
    expect((await send('POST', '/reports/validation-run', undefined, tech)).statusCode).toBe(403);
    expect((await send('POST', '/reports/validation-run')).statusCode).toBe(401);
    expect((await send('POST', '/reports/validation-run', undefined, owner)).statusCode).toBe(200);
    expect((await send('GET', '/reports/data-quality', undefined, viewer)).statusCode).toBe(200);
  });

  it("uses the operator's limits, not the script's defaults", async () => {
    const cable = farCable();
    await send('POST', '/changes', { upserts: { cables: [cable] } });
    const before = (await send('GET', '/reports/data-quality')).json();
    expect(before.rules.some((r: { rule: string }) => r.rule === 'cable-end-gap')).toBe(true);
    const at = new Date().toISOString();
    const settings = [
      { id: 'validation.geometry.cableEndGapMeters', value: 100_000, source: 'Test', updatedAt: at },
      { id: 'optical.rx.sensitivity', value: -30, source: 'Test', updatedAt: at },
    ];
    expect((await send('POST', '/changes', { upserts: { settings } })).statusCode).toBe(200);
    const after = (await send('GET', '/reports/data-quality')).json();
    expect(after.rules.some((r: { rule: string }) => r.rule === 'cable-end-gap')).toBe(false);
    expect(operatorLimits({ settings })).toMatchObject({ cableEndGapMeters: 100_000, rxLowDbm: -30, rxOverloadDbm: -8 });
  });
});
