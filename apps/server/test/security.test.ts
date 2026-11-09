import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { API_PREFIX } from '@fibergis/shared';

import { buildApp } from '../src/app';
import { type AppConfig, loadConfig } from '../src/config';
import { seedSampleNetwork } from '../src/db/seed';
import { SqliteNetworkRepository } from '../src/db/sqliteRepository';
import { rowsToPrune } from '../src/monitoring/retention';

/** The fixes from the Phase 1–9 audit: setup mode, login limits, ownership, readings, restore, retention. */

const api = (path: string) => `${API_PREFIX}${path}`;
let app: FastifyInstance;
let repository: SqliteNetworkRepository;

async function start(overrides: Partial<AppConfig> = {}) {
  const config: AppConfig = {
    ...loadConfig({ LOG_LEVEL: 'silent', STATIC_DIR: join(tmpdir(), 'fibergis-no-static') }),
    databasePath: ':memory:',
    photosDir: join(mkdtempSync(join(tmpdir(), 'fibergis-photos-')), 'photos'),
    backupsDir: join(mkdtempSync(join(tmpdir(), 'fibergis-backups-')), 'backups'),
    ...overrides,
  };
  repository = new SqliteNetworkRepository(config.databasePath);
  await seedSampleNetwork(repository);
  app = await buildApp({ config, repository });
}

beforeEach(() => start());
afterEach(async () => {
  await app.close();
  await repository.close();
});

const cookieOf = (response: LightMyRequestResponse) => String([response.headers['set-cookie']].flat()[0] ?? '').split(';')[0];
const send = (method: InjectOptions['method'], path: string, payload?: unknown, headers: Record<string, string> = {}, extra: Partial<InjectOptions> = {}) =>
  app.inject({ method, url: api(path), ...(payload === undefined ? {} : { payload: payload as object }), headers, ...extra });
/** A phone on the office network, reaching the server by its network address. */
const phone = { remoteAddress: '192.168.1.20' } as const;
const phoneHost = { host: '192.168.1.5:5000' };

async function admin() {
  return cookieOf(await send('POST', '/auth/setup', { username: 'owner', displayName: 'Owner', password: 'owner-pass-1' }));
}
async function person(adminCookie: string, username: string, displayName: string, role: string) {
  expect((await send('POST', '/users', { username, displayName, role, password: `${username}-pass-1` }, { cookie: adminCookie })).statusCode).toBe(201);
  const cookie = cookieOf(await send('POST', '/auth/login', { username, password: `${username}-pass-1` }));
  expect((await send('POST', '/auth/password', { currentPassword: `${username}-pass-1`, newPassword: `${username}-pass-2` }, { cookie })).statusCode).toBe(200);
  return cookie;
}

describe('setup mode is for the server computer only', () => {
  it('locks other devices out until the first admin exists, keeping their work', async () => {
    expect((await send('GET', '/network')).statusCode).toBe(200);
    const remote = await send('GET', '/network', undefined, phoneHost, phone);
    expect(remote.statusCode).toBe(401);
    expect(remote.json().error).toBe('login_required');
    expect((await send('GET', '/auth/status', undefined, phoneHost, phone)).json()).toMatchObject({ mode: 'enforced', setupPending: true });
    expect((await send('POST', '/reset', { confirm: 'reset' }, phoneHost, phone)).statusCode).toBe(401);
    expect((await send('POST', '/auth/setup', { username: 'x', displayName: 'X', password: 'x-pass-123' }, phoneHost, phone)).statusCode).toBe(403);
  });

  it('treats a loopback address reached by another name (dev proxy, DNS rebinding) as another device', async () => {
    expect((await send('GET', '/network', undefined, { host: 'evil.example:5000' })).statusCode).toBe(401);
    expect((await send('GET', '/network', undefined, { host: 'localhost:5173' })).statusCode).toBe(200);
  });

  it('lets another device make the first admin only with the setup code', async () => {
    await app.close();
    await repository.close();
    await start({ setupToken: 'code-12345' });
    expect((await send('GET', '/auth/status', undefined, phoneHost, phone)).json()).toMatchObject({ setupPending: true, setupCodeAccepted: true });
    const body = { username: 'owner', displayName: 'Owner', password: 'owner-pass-1' };
    expect((await send('POST', '/auth/setup', { ...body, setupToken: 'wrong-code' }, phoneHost, phone)).statusCode).toBe(403);
    expect((await send('POST', '/auth/setup', { ...body, setupToken: 'code-12345' }, phoneHost, phone)).statusCode).toBe(200);
  });

  it('refuses changes from a sandboxed page (origin "null") and a reset without the confirm word', async () => {
    expect((await send('POST', '/changes', {}, { origin: 'null' })).statusCode).toBe(403);
    expect((await send('POST', '/reset', {})).statusCode).toBe(400);
  });

  it('tells the size of the network only to someone logged in', async () => {
    await admin();
    const health = (await send('GET', '/health')).json();
    expect(health.status).toBe('ok');
    expect(health.counts).toBeUndefined();
    expect(health.revision).toBeUndefined();
  });
});

describe('logins', () => {
  it('limits wrong passwords sent all at once', async () => {
    await admin();
    const tries = await Promise.all(Array.from({ length: 12 }, () => send('POST', '/auth/login', { username: 'owner', password: 'wrong-guess' })));
    expect(tries.filter((r) => r.statusCode === 401).length).toBeLessThanOrEqual(5);
    expect(tries.filter((r) => r.statusCode === 429).length).toBeGreaterThanOrEqual(7);
  });

  it('keeps a temporary password from being used for anything but choosing a new one', async () => {
    const owner = await admin();
    await send('POST', '/users', { username: 'ravi', displayName: 'Ravi', role: 'technician', password: 'ravi-pass-1' }, { cookie: owner });
    const ravi = cookieOf(await send('POST', '/auth/login', { username: 'ravi', password: 'ravi-pass-1' }));
    expect((await send('GET', '/network', undefined, { cookie: ravi })).json().error).toBe('password_change_required');
    expect((await send('GET', '/auth/status', undefined, { cookie: ravi })).json()).toMatchObject({ mustChangePassword: true });
  });

  it('refuses two accounts with the same shown name', async () => {
    const owner = await admin();
    await person(owner, 'ravi', 'Ravi Kumar', 'technician');
    const again = await send('POST', '/users', { username: 'ravi2', displayName: ' ravi kumar ', role: 'technician' }, { cookie: owner });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe('name_taken');
  });
});

describe('who may write what', () => {
  it('keeps "reported by the device" readings for the OLT connection only', async () => {
    const owner = await admin();
    const tech = await person(owner, 'ravi', 'Ravi', 'technician');
    const customer = (await send('GET', '/network', undefined, { cookie: owner })).json().data.customers[0];
    const typed = { ...customer, rxOpticalPowerDbm: -18.5, rxSource: 'device_reported', rxMeasuredAt: '2026-11-09T10:00:00.000Z' };
    for (const cookie of [tech, owner]) {
      const refused = await send('POST', '/changes', { upserts: { customers: [typed] } }, { cookie });
      expect(refused.statusCode).toBe(403);
      expect(refused.json().message).toMatch(/OLT connection/);
    }
    const measured = { ...typed, rxSource: 'field_measured' };
    expect((await send('POST', '/changes', { upserts: { customers: [measured] } }, { cookie: tech })).statusCode).toBe(200);
  });

  it("does not let a technician change someone else's conflict record, and hides conflicts from viewers", async () => {
    const owner = await admin();
    const a = await person(owner, 'ravi', 'Ravi', 'technician');
    const b = await person(owner, 'sita', 'Sita', 'technician');
    const viewer = await person(owner, 'view', 'Viewer', 'viewer');
    const conflict = {
      id: 'SC-1', collection: 'equipment', recordId: 'OLT-01', label: 'OLT-01', status: 'office_decides', changedFields: ['name'], baseVersion: 1, theirVersion: 2,
      mine: { id: 'OLT-01', name: 'Mine' }, theirs: { id: 'OLT-01', name: 'Theirs' }, detectedAt: '2026-11-09T10:00:00.000Z', detectedBy: 'Ravi',
    };
    const made = await send('POST', '/changes', { upserts: { syncConflicts: [conflict] } }, { cookie: a });
    expect(made.statusCode).toBe(200);
    const tampered = { ...conflict, mine: { id: 'OLT-01', name: 'Mine', status: 'Decommissioned' } };
    expect((await send('POST', '/changes', { upserts: { syncConflicts: [tampered] } }, { cookie: b })).statusCode).toBe(403);
    expect((await send('GET', '/network', undefined, { cookie: viewer })).json().data.syncConflicts).toEqual([]);
  });
});

describe('restore and monitoring history', () => {
  it('never rewinds the audit trail on a restore', async () => {
    const owner = await admin();
    const before = (await send('GET', '/network', undefined, { cookie: owner })).json().data.auditLogs.length;
    const restored = await send('POST', '/restore', { data: { auditLogs: [] } }, { cookie: owner });
    expect(restored.statusCode).toBe(200);
    const after = (await send('GET', '/network', undefined, { cookie: owner })).json().data.auditLogs;
    expect(after.length).toBe(before + 1);
    expect(after.at(-1).action).toBe('BACKUP_RESTORED');
  });

  it('removes old device rows but always keeps the newest per ONT', () => {
    const row = (id: string, ontId: string, receivedAt: string) => ({ id, ontId, sourceId: 'MON-1', receivedAt });
    const now = new Date('2026-11-09T00:00:00.000Z');
    const rows = [row('a1', 'A', '2026-01-01T00:00:00.000Z'), row('a2', 'A', '2026-11-08T00:00:00.000Z'), row('b1', 'B', '2026-01-01T00:00:00.000Z')];
    expect(rowsToPrune(rows, (r) => r.ontId, { keepDays: 90, maxRows: 1000 }, now)).toEqual(['a1']);
    const many = Array.from({ length: 10 }, (_, i) => row(`r${i}`, `O${i % 2}`, `2026-11-0${(i % 8) + 1}T0${i}:00:00.000Z`));
    expect(many.length - rowsToPrune(many, (r) => r.ontId, { keepDays: 90, maxRows: 4 }, now).length).toBe(4);
  });
});
