import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { strToU8, zipSync } from 'fflate';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { API_PREFIX, createBackup } from '@fibergis/shared';
import { createSampleNetwork } from '@fibergis/shared/sample';

import { buildApp } from '../src/app';
import { type AppConfig, loadConfig } from '../src/config';
import { seedSampleNetwork } from '../src/db/seed';
import { SqliteNetworkRepository } from '../src/db/sqliteRepository';

const sample = createSampleNetwork();
const api = (path: string) => `${API_PREFIX}${path}`;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6]);

let app: FastifyInstance;
let repository: SqliteNetworkRepository;
let config: AppConfig;

async function start(overrides: Partial<AppConfig> = {}) {
  config = {
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

const cookieOf = (response: LightMyRequestResponse) => {
  const header = response.headers['set-cookie'];
  const first = Array.isArray(header) ? header[0] : header;
  return first ? first.split(';')[0] : '';
};

const post = (path: string, payload: unknown, cookie = '') =>
  app.inject({ method: 'POST', url: api(path), payload: payload as object, headers: cookie ? { cookie } : {} });
const get = (path: string, cookie = '') => app.inject({ method: 'GET', url: api(path), headers: cookie ? { cookie } : {} });

/** Creates the first admin and returns its cookie. */
async function setupAdmin() {
  const response = await post('/auth/setup', { username: 'owner', displayName: 'Owner', password: 'owner-pass-1' });
  expect(response.statusCode).toBe(200);
  return cookieOf(response);
}

async function makeUser(admin: string, username: string, displayName: string, role: string) {
  const created = await post('/users', { username, displayName, role, password: `${username}-pass-1` }, admin);
  expect(created.statusCode).toBe(201);
  const login = await post('/auth/login', { username, password: `${username}-pass-1` });
  expect(login.statusCode).toBe(200);
  const cookie = cookieOf(login);
  // The office gave a temporary password: nothing else works until the person chooses their own.
  expect((await get('/network', cookie)).json()).toMatchObject({ error: 'password_change_required' });
  expect((await post('/auth/password', { currentPassword: `${username}-pass-1`, newPassword: `${username}-pass-2` }, cookie)).statusCode).toBe(200);
  return cookie;
}

beforeEach(() => start());
afterEach(async () => {
  await app.close();
  await repository.close();
});

describe('setup mode and the first admin (Phase 9)', () => {
  it('stays open until the first account exists, then needs a login', async () => {
    expect((await get('/auth/status')).json()).toMatchObject({ mode: 'setup', account: null });
    expect((await get('/network')).statusCode).toBe(200);
    const admin = await setupAdmin();
    expect((await get('/auth/status')).json()).toMatchObject({ mode: 'enforced', account: null });
    const refused = await get('/network');
    expect(refused.statusCode).toBe(401);
    expect(refused.json()).toMatchObject({ error: 'login_required' });
    expect(refused.json().message).toMatch(/kept/);
    expect((await get('/network', admin)).statusCode).toBe(200);
    expect((await get('/health')).statusCode).toBe(200);
  });

  it('makes only one first admin, and asks for the setup code when one is set', async () => {
    await setupAdmin();
    expect((await post('/auth/setup', { username: 'other', displayName: 'Other', password: 'other-pass-1' })).statusCode).toBe(409);
    await app.close();
    await repository.close();
    await start({ setupToken: 'code-1234' });
    expect((await post('/auth/setup', { username: 'owner', displayName: 'Owner', password: 'owner-pass-1' })).statusCode).toBe(403);
    expect((await post('/auth/setup', { username: 'owner', displayName: 'Owner', password: 'owner-pass-1', setupToken: 'code-1234' })).statusCode).toBe(200);
  });

  it('turns login on with AUTH_REQUIRED even before any account', async () => {
    await app.close();
    await repository.close();
    await start({ authRequired: true });
    expect((await get('/network')).statusCode).toBe(401);
    expect((await post('/auth/setup', { username: 'owner', displayName: 'Owner', password: 'owner-pass-1' })).statusCode).toBe(200);
  });

  it('sets an httpOnly SameSite cookie and never returns a password hash', async () => {
    const response = await post('/auth/setup', { username: 'owner', displayName: 'Owner', password: 'owner-pass-1' });
    const header = String(response.headers['set-cookie']);
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/SameSite=Strict/i);
    expect(header).not.toMatch(/Secure/);
    const users = await get('/users', cookieOf(response));
    expect(JSON.stringify(users.json())).not.toMatch(/scrypt|passwordHash|password_hash/i);
  });
});

describe('login, logout and passwords', () => {
  it('logs out, and limits wrong passwords per name and address', async () => {
    const admin = await setupAdmin();
    expect((await post('/auth/logout', {}, admin)).statusCode).toBe(200);
    expect((await get('/network', admin)).statusCode).toBe(401);
    for (let i = 0; i < config.loginMaxFailures; i += 1) {
      const wrong = await post('/auth/login', { username: 'owner', password: 'nope' });
      expect(wrong.statusCode).toBe(401);
      expect(wrong.json().error).toBe('wrong_login');
    }
    const locked = await post('/auth/login', { username: 'owner', password: 'owner-pass-1' });
    expect(locked.statusCode).toBe(429);
    expect(locked.json().message).toMatch(/Wait/);
  });

  it('changes a password and ends the other sessions', async () => {
    const first = await setupAdmin();
    const second = cookieOf(await post('/auth/login', { username: 'owner', password: 'owner-pass-1' }));
    expect((await post('/auth/password', { currentPassword: 'wrong', newPassword: 'owner-pass-2' }, first)).statusCode).toBe(400);
    expect((await post('/auth/password', { currentPassword: 'owner-pass-1', newPassword: 'owner-pass-2' }, first)).statusCode).toBe(200);
    expect((await get('/network', first)).statusCode).toBe(200);
    expect((await get('/network', second)).statusCode).toBe(401);
  });

  it('never leaves the network without an active administrator', async () => {
    const admin = await setupAdmin();
    const me = (await get('/auth/status', admin)).json().account;
    const demote = await app.inject({ method: 'PATCH', url: api(`/users/${me.id}`), payload: { role: 'engineer' }, headers: { cookie: admin } });
    expect(demote.statusCode).toBe(409);
    expect(demote.json().error).toBe('last_admin');
  });

  it('switching an account off ends its sessions', async () => {
    const admin = await setupAdmin();
    const tech = await makeUser(admin, 'ravi', 'Ravi Kumar', 'technician');
    const id = (await get('/auth/status', tech)).json().account.id;
    await app.inject({ method: 'PATCH', url: api(`/users/${id}`), payload: { active: false }, headers: { cookie: admin } });
    expect((await get('/network', tech)).statusCode).toBe(401);
  });
});

describe('roles enforced on the server', () => {
  it('refuses a technician deleting a cable (403, plain words) and lets them do their job', async () => {
    const admin = await setupAdmin();
    const tech = await makeUser(admin, 'ravi', 'Ravi Kumar', 'technician');
    const refused = await post('/changes', { deletes: { cables: [sample.cables[0].id] } }, tech);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().message).toMatch(/Technician accounts cannot delete a cable .*Ask the office/);
    expect((await get('/network', admin)).json().data.cables).toHaveLength(sample.cables.length);

    const job = { ...sample.workOrders[0], id: 'WO-RAVI', technicianName: 'Ravi Kumar', status: 'Assigned' as const, faultId: undefined };
    expect((await post('/changes', { upserts: { workOrders: [job] } }, admin)).statusCode).toBe(200);
    expect((await post('/changes', { upserts: { workOrders: [{ ...job, status: 'In Progress' }] } }, tech)).statusCode).toBe(200);
    const other = { ...job, id: 'WO-ASHA', technicianName: 'Asha' };
    await post('/changes', { upserts: { workOrders: [other] } }, admin);
    expect((await post('/changes', { upserts: { workOrders: [{ ...other, status: 'In Progress' }] } }, tech)).statusCode).toBe(403);
    const photo = await app.inject({ method: 'PUT', url: api('/photos/PH-RAVI000001'), payload: JPEG, headers: { cookie: tech, 'content-type': 'image/jpeg' } });
    expect(photo.statusCode).toBe(201);
  });

  it('lets a technician undo their own capture but not somebody else\'s', async () => {
    const admin = await setupAdmin();
    const tech = await makeUser(admin, 'ravi', 'Ravi Kumar', 'technician');
    const pole = { ...sample.equipment.find((e) => e.type.includes('Pole'))!, id: 'POLE-K7Q2M9XP4A', captureSource: 'field_capture' as const };
    expect((await post('/changes', { upserts: { equipment: [pole] } }, tech)).statusCode).toBe(200);
    expect((await post('/changes', { deletes: { equipment: [pole.id] } }, tech)).statusCode).toBe(200);
    const theirs = { ...pole, id: 'POLE-OFFICE00001' };
    await post('/changes', { upserts: { equipment: [theirs] } }, admin);
    expect((await post('/changes', { deletes: { equipment: [theirs.id] } }, tech)).statusCode).toBe(403);
  });

  it('keeps viewers to looking, and hides phone numbers from them', async () => {
    const admin = await setupAdmin();
    const viewer = await makeUser(admin, 'look', 'Looker', 'viewer');
    const write = await post('/changes', { upserts: { zones: [{ ...sample.zones[0], name: 'X' }] } }, viewer);
    expect(write.statusCode).toBe(403);
    expect(write.json().message).toMatch(/can only look/);
    const customer = (await get('/network', viewer)).json().data.customers[0];
    expect(customer.mobile).toMatch(/Hidden/);
    expect((await get('/network', admin)).json().data.customers[0].mobile).toBe(sample.customers[0].mobile);
    const photo = await app.inject({ method: 'PUT', url: api('/photos/PH-LOOK000001'), payload: JPEG, headers: { cookie: viewer, 'content-type': 'image/jpeg' } });
    expect(photo.statusCode).toBe(403);
  });

  it('keeps reset, restore and backups with the administrator', async () => {
    const admin = await setupAdmin();
    const engineer = await makeUser(admin, 'eng', 'Engineer One', 'engineer');
    expect((await post('/reset', { confirm: 'reset' }, engineer)).statusCode).toBe(403);
    expect((await get('/backup', engineer)).statusCode).toBe(403);
    expect((await post('/reset', {}, admin)).statusCode).toBe(400);
    expect((await post('/reset', { confirm: 'reset' }, admin)).statusCode).toBe(200);
  });

  it('stamps audit entries with the logged-in person and keeps them append-only', async () => {
    const admin = await setupAdmin();
    const tech = await makeUser(admin, 'ravi', 'Ravi Kumar', 'technician');
    const entry = { id: 'LOG-P9-1', timestamp: '2026-11-08 10:00', user: 'Administrator (local session)', role: 'Administrator', action: 'FIELD_CAPTURE_ADDED', details: 'x', assetId: 'X', assetType: 'System' };
    const sent = await post('/changes', { upserts: { auditLogs: [entry] }, deletes: { auditLogs: [sample.auditLogs[0].id] } }, tech);
    expect(sent.statusCode).toBe(200);
    const logs = (await get('/network', admin)).json().data.auditLogs as { id: string; details: string }[];
    expect(logs.find((l) => l.id === 'LOG-P9-1')).toMatchObject({ user: 'Ravi Kumar', role: 'Field Technician' });
    expect(logs.some((l) => l.id === sample.auditLogs[0].id)).toBe(true);
    await post('/changes', { upserts: { auditLogs: [{ ...entry, details: 'rewritten' }] } }, admin);
    const again = (await get('/network', admin)).json().data.auditLogs as { id: string; details: string }[];
    expect(again.find((l) => l.id === 'LOG-P9-1')?.details).toBe('x');
  });

  it('refuses a change sent from another website', async () => {
    const response = await app.inject({ method: 'POST', url: api('/changes'), payload: {}, headers: { origin: 'https://evil.example' } });
    expect(response.statusCode).toBe(403);
  });
});

describe('PUT version check (Phase 9)', () => {
  it('refuses a stale PUT with version_conflict and the current record, like /changes', async () => {
    const zone = sample.zones[0];
    const first = await get(`/zones/${zone.id}`);
    const version = Number(first.headers['x-record-version']);
    const put = (name: string, ifMatch: string) => app.inject({ method: 'PUT', url: api(`/zones/${zone.id}`), payload: { ...zone, name }, headers: { 'if-match': ifMatch } });
    expect((await put('A', String(version))).statusCode).toBe(200);
    const stale = await put('B', String(version));
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: 'version_conflict', conflicts: [{ id: zone.id, record: { name: 'A' } }] });
    expect((await get(`/zones/${zone.id}`)).json().name).toBe('A');
    expect((await put('C', 'abc')).statusCode).toBe(400);
  });
});

describe('protected restore with photos (Phase 9)', () => {
  it('restores a zip with photos after a safety copy, skipping files that are not pictures', async () => {
    const json = JSON.stringify(createBackup(sample, new Date().toISOString()));
    const zip = zipSync({
      'backup.json': strToU8(json),
      'photos/PH-ZIP0000001.jpg': new Uint8Array(JPEG),
      'photos/PH-BAD0000001.png': strToU8('not a png'),
      'notes.txt': strToU8('x'),
    });
    const response = await app.inject({ method: 'POST', url: api('/restore'), payload: Buffer.from(zip), headers: { 'content-type': 'application/zip' } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ photosAdded: 1, photosSkipped: 1 });
    expect(readdirSync(config.photosDir)).toContain('PH-ZIP0000001.jpg');
    expect(readdirSync(config.backupsDir).some((n) => n.startsWith('fibergis-before-restore-'))).toBe(true);
    const backup = await app.inject({ method: 'GET', url: api('/backup?photos=1') });
    expect(backup.headers['content-type']).toBe('application/zip');
    expect(backup.headers['x-backup-photos']).toBe('1');
  });

  it('refuses a broken backup with a report, and restores it only when the problems are accepted', async () => {
    const broken = { ...sample, spans: [{ id: 'SPN-BROKEN0001', name: 'S', fromStructureId: 'NOPE-1', toStructureId: 'NOPE-2', status: 'built', basis: 'field_sequence', createdAt: '2026-11-08' }] };
    const refused = await post('/restore', createBackup(broken as never, new Date().toISOString()));
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ error: 'restore_refused', counts: { links: 2 } });
    expect(refused.json().problems[0].refs).toContain('SPN-BROKEN0001');
    expect((await get('/network')).json().data.spans).toEqual([]);
    const accepted = await post('/restore?accept=problems', createBackup(broken as never, new Date().toISOString()));
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().acceptedProblems).toBe(2);
  });
});

describe('request hardening (Phase 9)', () => {
  it('sends security headers and a content security policy', async () => {
    const response = await get('/health');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(String(response.headers['content-security-policy'])).toMatch(/script-src 'self'/);
    expect(response.headers['strict-transport-security']).toBeUndefined();
  });

  it('limits body size per route and answers too many requests plainly', async () => {
    const big = await post('/auth/login', { username: 'x', password: 'y'.repeat(20_000) });
    expect(big.statusCode).toBe(413);
    await app.close();
    await repository.close();
    await start({ rateLimitPerMinute: 10 });
    let last = 0;
    for (let i = 0; i < 12; i += 1) last = (await get('/network')).statusCode;
    expect(last).toBe(429);
    expect((await get('/health')).statusCode).toBe(200);
  });

  it('gives a data-quality summary from the map-check rules, ids only', async () => {
    const response = await get('/reports/data-quality');
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(Array.isArray(body.rules)).toBe(true);
    expect(JSON.stringify(body)).not.toContain(sample.customers[0].name);
  });
});
