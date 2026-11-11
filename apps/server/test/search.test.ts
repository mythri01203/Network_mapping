import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { API_PREFIX, type ChangeSet, type SearchHit } from '@fibergis/shared';
import { createSampleNetwork } from '@fibergis/shared/sample';

import { buildApp } from '../src/app';
import { hashPassword } from '../src/auth/passwords';
import { type AppConfig, loadConfig } from '../src/config';
import { seedSampleNetwork } from '../src/db/seed';
import { TenantRegistry } from '../src/db/tenants';

/**
 * Phase 16: `GET /search` (typed hits, paging, kinds), its login rule, the viewer redaction, the
 * organisation boundary, and a bulk edit through `POST /changes` refused as a whole when one record
 * fails. Everything runs in temporary folders, never in apps/server/data.
 */

vi.setConfig({ testTimeout: 60_000 });

const api = (path: string) => `${API_PREFIX}${path}`;
let app: FastifyInstance | undefined;
let tenants: TenantRegistry | undefined;

async function start() {
  const root = mkdtempSync(join(tmpdir(), 'fibergis-search-'));
  const config: AppConfig = {
    ...loadConfig({ LOG_LEVEL: 'silent', STATIC_DIR: join(tmpdir(), 'fibergis-no-static'), DATABASE_PATH: join(root, 'fibergis.db') }),
    rateLimitPerMinute: 100_000,
  };
  tenants = TenantRegistry.open({
    controlPath: config.controlDatabasePath,
    organisationsDir: config.organisationsDir,
    host: { name: config.organisationName, databasePath: config.databasePath, photosDir: config.photosDir, voiceDir: config.voiceDir, backupsDir: config.backupsDir },
  });
  await seedSampleNetwork(tenants.host().repository);
  app = await buildApp({ config, tenants });
}

afterEach(async () => {
  await app?.close();
  await tenants?.close();
  app = undefined;
  tenants = undefined;
});

const cookieOf = (response: LightMyRequestResponse) => String([response.headers['set-cookie']].flat()[0] ?? '').split(';')[0];
const send = (method: InjectOptions['method'], path: string, payload?: unknown, cookie?: string) =>
  app!.inject({ method, url: api(path), ...(payload === undefined ? {} : { payload: payload as object }), headers: cookie ? { cookie } : {} });

const sample = createSampleNetwork();
const someCustomer = sample.customers.find((c) => c.mobile && c.mobile.replace(/\D/g, '').length >= 6)!;
const someOlt = sample.equipment.find((e) => e.type === 'OLT')!;

describe('GET /search', () => {
  it('returns typed hits with the field that matched, and pages with a cursor', async () => {
    await start();
    const res = await send('GET', `/search?q=${encodeURIComponent(someOlt.id)}`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.json();
    expect(typeof body.revision).toBe('number');
    expect(body.hits[0]).toMatchObject({ kind: 'equipment', collection: 'equipment', id: someOlt.id, matched: { field: 'ID' } });

    const first = (await send('GET', '/search?q=a&limit=3')).json();
    expect(first.hits).toHaveLength(3);
    expect(first.total).toBeGreaterThan(3);
    expect(first.nextCursor).toBe('3');
    const second = (await send('GET', `/search?q=a&limit=3&cursor=${first.nextCursor}`)).json();
    expect(second.offset).toBe(3);
    expect(second.hits.map((h: SearchHit) => `${h.kind}:${h.id}:${h.part ?? ''}`)).not.toContain(`${first.hits[0].kind}:${first.hits[0].id}:${first.hits[0].part ?? ''}`);

    const cablesOnly = (await send('GET', '/search?q=a&kinds=cable')).json();
    expect(cablesOnly.hits.length).toBeGreaterThan(0);
    expect(cablesOnly.hits.every((h: SearchHit) => h.kind === 'cable')).toBe(true);
  });

  it('refuses a blank query, an unknown kind and a bad limit in plain words', async () => {
    await start();
    expect((await send('GET', '/search')).statusCode).toBe(400);
    expect((await send('GET', '/search?q=%20%20')).statusCode).toBe(400);
    expect((await send('GET', '/search?q=a&kinds=planets')).json().message).toContain('Unknown kind');
    expect((await send('GET', '/search?q=a&limit=0')).statusCode).toBe(400);
    expect((await send('GET', `/search?q=${'x'.repeat(201)}`)).statusCode).toBe(400);
  });

  it('needs a login once login is on, and never finds a customer by a hidden phone number', async () => {
    await start();
    const owner = cookieOf(await send('POST', '/auth/setup', { username: 'owner', displayName: 'Owner', password: 'owner-pass-1' }));
    expect((await send('GET', '/search?q=a')).statusCode).toBe(401);
    tenants!.host().repository.auth.create({ username: 'look', displayName: 'Look Only', role: 'viewer', passwordHash: await hashPassword('look-pass-1'), mustChangePassword: false });
    const viewer = cookieOf(await send('POST', '/auth/login', { username: 'look', password: 'look-pass-1' }));
    const digits = someCustomer.mobile.replace(/\D/g, '').slice(-6);
    for (const cookie of [owner, viewer]) {
      const hits = (await send('GET', `/search?q=${digits}&kinds=customer`, undefined, cookie)).json().hits as SearchHit[];
      expect(hits.some((h) => h.id === someCustomer.id && h.matched.value.includes(digits))).toBe(false);
    }
    // Phase 12 hides customers' names and addresses from a look-only account: search cannot find
    // them by it either, and never returns the hidden text as a match.
    const byNameViewer = (await send('GET', `/search?q=${encodeURIComponent(someCustomer.name)}&kinds=customer`, undefined, viewer)).json().hits as SearchHit[];
    expect(byNameViewer.some((h) => h.id === someCustomer.id)).toBe(false);
    expect(JSON.stringify(byNameViewer)).not.toContain(someCustomer.name);
    const byHiddenText = (await send('GET', '/search?q=hidden&kinds=customer', undefined, viewer)).json().hits as SearchHit[];
    expect(byHiddenText).toEqual([]);
    // The viewer still finds the customer by its id, labelled by the id, not the name.
    const byId = (await send('GET', `/search?q=${encodeURIComponent(someCustomer.id)}&kinds=customer`, undefined, viewer)).json().hits as SearchHit[];
    expect(byId[0]).toMatchObject({ id: someCustomer.id, label: someCustomer.id });
    expect(JSON.stringify(byId)).not.toContain(someCustomer.name);
    // A role that may see names still finds the customer by name.
    const byNameOwner = (await send('GET', `/search?q=${encodeURIComponent(someCustomer.name)}&kinds=customer`, undefined, owner)).json().hits as SearchHit[];
    expect(byNameOwner.some((h) => h.id === someCustomer.id && h.label === someCustomer.name)).toBe(true);
  });

  it('only searches the organisation of the person asking', async () => {
    await start();
    const owner = cookieOf(await send('POST', '/auth/setup', { username: 'owner', displayName: 'Owner', password: 'owner-pass-1' }));
    const made = await send('POST', '/platform/organisations', { name: 'Second ISP', admin: { username: 'bob', displayName: 'Bob', password: 'bob-pass-1' } }, owner);
    expect(made.statusCode, made.body).toBe(201);
    const bob = cookieOf(await send('POST', '/auth/login', { username: 'bob', password: 'bob-pass-1' }));
    expect((await send('POST', '/auth/password', { currentPassword: 'bob-pass-1', newPassword: 'bob-pass-2' }, bob)).statusCode).toBe(200);
    expect((await send('GET', `/search?q=${encodeURIComponent(someOlt.id)}`, undefined, owner)).json().total).toBeGreaterThan(0);
    const theirs = (await send('GET', `/search?q=${encodeURIComponent(someOlt.id)}`, undefined, bob)).json();
    expect(theirs.total).toBe(0);
  });
});

describe('bulk edit through POST /changes', () => {
  it('is refused as a whole when one record fails, and nothing is stored', async () => {
    await start();
    const [a, b, c] = sample.cables;
    const changes: ChangeSet = {
      upserts: {
        cables: [
          { ...a, status: 'Maintenance' },
          // One record the schema refuses (an impossible fibre count).
          { ...b, status: 'Maintenance', fiberCount: -4 },
          { ...c, status: 'Maintenance' },
        ],
      },
    };
    const res = await send('POST', '/changes', changes);
    expect(res.statusCode).toBe(400);
    expect(res.json().issues[0].path).toContain('cables');
    const stored = (await send('GET', `/cables?ids=${a.id},${c.id}`)).json() as { id: string; status: string }[];
    expect(stored.map((r) => r.status)).toEqual([a.status, c.status]);
  });
});
