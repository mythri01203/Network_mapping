import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { API_PREFIX, CUSTOMER_HIDDEN_TEXT, type NetworkResponse, type RecordsResponse } from '@fibergis/shared';
import { createSampleNetwork } from '@fibergis/shared/sample';

import { buildApp } from '../src/app';
import { hashPassword } from '../src/auth/passwords';
import { type AppConfig, loadConfig } from '../src/config';
import { seedSampleNetwork } from '../src/db/seed';
import { SqliteNetworkRepository } from '../src/db/sqliteRepository';

/** Phase 24b: what a device loading by map area reads besides the area: the other collections, and records by id. */

vi.setConfig({ testTimeout: 60_000 });

const api = (path: string) => `${API_PREFIX}${path}`;
let app: FastifyInstance;
let repository: SqliteNetworkRepository;

beforeEach(async () => {
  const config: AppConfig = {
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

const cookieOf = (response: LightMyRequestResponse) => String([response.headers['set-cookie']].flat()[0] ?? '').split(';')[0];
const send = (method: InjectOptions['method'], path: string, cookie?: string) => app.inject({ method, url: api(path), headers: cookie ? { cookie } : {} });
const sample = createSampleNetwork();

describe('GET /network?except=', () => {
  it('gives every other collection in full, with versions, at the same revision as the whole load', async () => {
    const whole = (await send('GET', '/network')).json() as NetworkResponse;
    const res = await send('GET', '/network?except=equipment,cables,customers');
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toContain('no-store');
    const part = res.json() as RecordsResponse;
    expect(part.revision).toBe(whole.revision);
    expect(part.data.equipment).toBeUndefined();
    expect(part.data.cables).toBeUndefined();
    expect(part.versions.equipment).toBeUndefined();
    expect(part.data.splitters).toEqual(whole.data.splitters);
    expect(part.data.closures).toEqual(whole.data.closures);
    expect(part.versions.splitters).toEqual(whole.versions?.splitters);
    // Every collection not named is there, even an empty one (absent means "not asked for").
    for (const name of Object.keys(whole.data)) if (!['equipment', 'cables', 'customers'].includes(name)) expect(part.data).toHaveProperty(name);
  });

  it('refuses an unknown collection, and without except answers as before', async () => {
    expect((await send('GET', '/network?except=equipment,bogus')).statusCode).toBe(400);
    const whole = (await send('GET', '/network')).json() as NetworkResponse;
    expect(whole.data.equipment.length).toBe(sample.equipment.length);
  });
});

describe('GET /network/records?ids=', () => {
  it('gives the records with those ids in those collections, with versions, and skips missing ids', async () => {
    const pole = sample.equipment[0];
    const cable = sample.cables[0];
    const res = await send('GET', `/network/records?ids=${pole.id},${cable.id},NOT-THERE&collections=equipment,cables`);
    expect(res.statusCode).toBe(200);
    const found = res.json() as RecordsResponse;
    expect(found.data.equipment).toEqual([pole]);
    expect(found.data.cables).toEqual([cable]);
    expect(Object.keys(found.versions.equipment ?? {})).toEqual([pole.id]);
    expect(found.revision).toBe((await send('GET', '/network')).json().revision);
    // Only the collections asked for are searched.
    const only = (await send('GET', `/network/records?ids=${pole.id},${cable.id}&collections=cables`)).json() as RecordsResponse;
    expect(only.data.equipment).toBeUndefined();
    expect(only.data.cables).toEqual([cable]);
  });

  it('refuses no ids, too many ids and an unknown collection', async () => {
    expect((await send('GET', '/network/records')).statusCode).toBe(400);
    const many = Array.from({ length: 1001 }, (_, i) => `X-${i}`).join(',');
    expect((await send('GET', `/network/records?ids=${many}`)).statusCode).toBe(400);
    expect((await send('GET', '/network/records?ids=A&collections=bogus')).statusCode).toBe(400);
  });

  it("hides customers' personal data from a look-only account, as the whole load does", async () => {
    const admin = cookieOf(await app.inject({ method: 'POST', url: api('/auth/setup'), payload: { username: 'owner', displayName: 'Owner', password: 'owner-pass-1' } }));
    expect(admin).not.toBe('');
    repository.auth.create({ username: 'look', displayName: 'Look Only', role: 'viewer', passwordHash: await hashPassword('look-pass-1'), mustChangePassword: false });
    const viewer = cookieOf(await app.inject({ method: 'POST', url: api('/auth/login'), payload: { username: 'look', password: 'look-pass-1' } }));
    const [customer] = sample.customers;
    const byId = (await send('GET', `/network/records?ids=${customer.id}&collections=customers`, viewer)).json() as RecordsResponse;
    expect(byId.data.customers?.[0]).toMatchObject({ name: CUSTOMER_HIDDEN_TEXT, mobile: CUSTOMER_HIDDEN_TEXT });
    const rest = (await send('GET', '/network?except=equipment', viewer)).json() as RecordsResponse;
    expect(rest.data.customers?.find((c) => c.id === customer.id)).toMatchObject({ name: CUSTOMER_HIDDEN_TEXT, mobile: CUSTOMER_HIDDEN_TEXT });
    // Without a login the routes are closed like every other.
    expect((await send('GET', `/network/records?ids=${customer.id}`)).statusCode).toBe(401);
  });
});
