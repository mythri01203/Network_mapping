import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { API_PREFIX, CUSTOMER_HIDDEN_TEXT, type NetworkSnapshot, type Service } from '@fibergis/shared';
import { createSampleNetwork } from '@fibergis/shared/sample';

import { buildApp } from '../src/app';
import { hashPassword } from '../src/auth/passwords';
import { type AppConfig, loadConfig } from '../src/config';
import { seedSampleNetwork } from '../src/db/seed';
import { SqliteNetworkRepository } from '../src/db/sqliteRepository';

/** Network mapping Phase 14: a service's logical binding (VLANs, profile, IP, circuit id) on the server. */

vi.setConfig({ testTimeout: 120_000 });

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
const send = (method: InjectOptions['method'], path: string, payload?: unknown, cookie?: string) =>
  app.inject({ method, url: api(path), ...(payload === undefined ? {} : { payload: payload as object }), headers: cookie ? { cookie } : {} });

const customer = createSampleNetwork().customers.find((c) => c.status !== 'Disconnected')!;
const binding = (extra: Partial<Service> = {}): Service => ({
  id: 'SVC-P14',
  customerId: customer.id,
  kind: 'internet',
  status: 'active',
  createdAt: new Date().toISOString(),
  vlan: 100,
  sVlan: 200,
  cVlan: 17,
  profileName: 'FTTH-100M',
  ipAddress: 'PPPoE',
  circuitId: 'CKT/77',
  bindingRecordedAt: new Date().toISOString(),
  bindingRecordedBy: 'Owner',
  ...extra,
});

describe('service binding on the server', () => {
  it('stores the binding as written, and refuses a VLAN no network can carry', async () => {
    const admin = cookieOf(await send('POST', '/auth/setup', { username: 'owner', displayName: 'Owner', password: 'owner-pass-1' }));
    expect((await send('POST', '/changes', { upserts: { services: [binding()] } }, admin)).statusCode).toBe(200);
    for (const vlan of [0, 4095]) {
      const refused = await send('POST', '/changes', { upserts: { services: [binding({ id: 'SVC-P14-BAD', vlan })] } }, admin);
      expect(refused.statusCode).toBe(400);
    }
    const network = (await send('GET', '/network', undefined, admin)).json().data as NetworkSnapshot;
    expect(network.services.find((s) => s.id === 'SVC-P14')).toEqual(binding({ createdAt: expect.any(String), bindingRecordedAt: expect.any(String) }));
    expect(network.services.some((s) => s.id === 'SVC-P14-BAD')).toBe(false);
  });

  it('keeps the binding for a Read-only account while the customer name stays hidden (it is not personal data)', async () => {
    const admin = cookieOf(await send('POST', '/auth/setup', { username: 'owner', displayName: 'Owner', password: 'owner-pass-1' }));
    expect((await send('POST', '/changes', { upserts: { services: [binding()] } }, admin)).statusCode).toBe(200);
    repository.auth.create({ username: 'viewer', displayName: 'Viewer', role: 'viewer', passwordHash: await hashPassword('viewer-pass-1'), mustChangePassword: false });
    const viewer = cookieOf(await send('POST', '/auth/login', { username: 'viewer', password: 'viewer-pass-1' }));
    const network = (await send('GET', '/network', undefined, viewer)).json().data as NetworkSnapshot;
    expect(network.customers.find((c) => c.id === customer.id)!.name).toBe(CUSTOMER_HIDDEN_TEXT);
    expect(network.services.find((s) => s.id === 'SVC-P14')).toMatchObject({ vlan: 100, sVlan: 200, cVlan: 17, profileName: 'FTTH-100M', circuitId: 'CKT/77' });
    // Read-only cannot write one.
    expect((await send('POST', '/changes', { upserts: { services: [binding({ vlan: 101 })] } }, viewer)).statusCode).toBe(403);
  });
});
