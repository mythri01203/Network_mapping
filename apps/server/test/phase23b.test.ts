import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { API_PREFIX, type Equipment } from '@fibergis/shared';
import { createSampleNetwork } from '@fibergis/shared/sample';

import { buildApp } from '../src/app';
import { hashPassword, newSessionToken } from '../src/auth/passwords';
import { type AppConfig, loadConfig } from '../src/config';
import { seedSampleNetwork } from '../src/db/seed';
import { SqliteNetworkRepository } from '../src/db/sqliteRepository';
import { currentTenant, runInTenant, scoped, TenantRegistry } from '../src/db/tenants';
import { newClipId } from '../src/voice/clipStore';

/**
 * Phase 23b: several organisations on one server, one database file each. Every route family is
 * tried from a second organisation against the first one's data: nothing can be read or changed.
 * Everything runs in temporary folders, never in apps/server/data.
 */

// Password hashing is slow on purpose, and the whole suite runs at once.
vi.setConfig({ testTimeout: 60_000 });

const api = (path: string) => `${API_PREFIX}${path}`;
let app: FastifyInstance | undefined;
let tenants: TenantRegistry | undefined;
let config: AppConfig;
let root: string;

async function start(dir = mkdtempSync(join(tmpdir(), 'fibergis-orgs-')), env: Record<string, string> = {}, seed = true) {
  root = dir;
  config = loadConfig({ LOG_LEVEL: 'silent', STATIC_DIR: join(tmpdir(), 'fibergis-no-static'), DATABASE_PATH: join(root, 'fibergis.db'), ...env });
  tenants = TenantRegistry.open({
    controlPath: config.controlDatabasePath,
    organisationsDir: config.organisationsDir,
    host: { name: config.organisationName, databasePath: config.databasePath, photosDir: config.photosDir, voiceDir: config.voiceDir, backupsDir: config.backupsDir },
  });
  if (seed) await seedSampleNetwork(tenants.host().repository);
  app = await buildApp({ config, tenants });
}

async function stop() {
  await app?.close();
  await tenants?.close();
  app = undefined;
  tenants = undefined;
}

afterEach(stop);

const cookieOf = (response: LightMyRequestResponse) => String([response.headers['set-cookie']].flat()[0] ?? '').split(';')[0];
const send = (method: InjectOptions['method'], path: string, payload?: unknown, cookie?: string, headers: Record<string, string> = {}) =>
  app!.inject({ method, url: api(path), ...(payload === undefined ? {} : { payload: payload as object }), headers: { ...(cookie ? { cookie } : {}), ...headers } });
const phone = { remoteAddress: '192.168.1.20' } as const;

async function owner() {
  const res = await send('POST', '/auth/setup', { username: 'owner', displayName: 'Owner', password: 'owner-pass-1' });
  expect(res.statusCode, res.body).toBe(200);
  return cookieOf(res);
}

/** A second organisation with its first administrator logged in (own password chosen). */
async function organisation(ownerCookie: string, name: string, username: string) {
  const made = await send('POST', '/platform/organisations', { name, admin: { username, displayName: `${name} Admin`, password: `${username}-pass-1` } }, ownerCookie);
  expect(made.statusCode, made.body).toBe(201);
  const login = await send('POST', '/auth/login', { username, password: `${username}-pass-1` });
  expect(login.statusCode, login.body).toBe(200);
  const cookie = cookieOf(login);
  expect((await send('POST', '/auth/password', { currentPassword: `${username}-pass-1`, newPassword: `${username}-pass-2` }, cookie)).statusCode).toBe(200);
  return { id: made.json().organisation.id as string, cookie };
}

/** The first organisation (owner, with the sample network) and a second one (bob, empty). */
async function twoOrganisations() {
  await start();
  const ownerCookie = await owner();
  const b = await organisation(ownerCookie, 'Second ISP', 'bob');
  return { owner: ownerCookie, bob: b.cookie, bId: b.id };
}

const sample = createSampleNetwork();
const basePole = sample.equipment.find((e) => e.id === 'POLE-01')!;
const pole = (id: string, extra: Partial<Equipment> = {}): Equipment => ({ ...basePole, id, name: `Pole ${id}`, lat: basePole.lat + 0.0003, lng: basePole.lng + 0.0003, ...extra });
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01]);
const counts = async (cookie: string) => (await send('GET', '/health', undefined, cookie)).json().counts as Record<string, number>;
const network = async (cookie: string) => (await send('GET', '/network', undefined, cookie)).json();

describe('upgrade: the existing database becomes the first organisation, in place', () => {
  it('keeps the data, accounts, sessions and photos exactly where they are', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fibergis-upgrade-'));
    // An install from before organisations: one database with the sample network, an account and a login.
    const old = new SqliteNetworkRepository(join(dir, 'fibergis.db'));
    await seedSampleNetwork(old);
    const ravi = old.auth.create({ username: 'ravi', displayName: 'Ravi', role: 'admin', passwordHash: await hashPassword('ravi-pass-1'), mustChangePassword: false });
    const oldToken = newSessionToken();
    old.auth.createSession(ravi.id, oldToken, 30);
    const before = await old.getNetwork();
    await old.close();
    mkdirSync(join(dir, 'photos'));
    writeFileSync(join(dir, 'photos', 'PH-OLDPHOTO1.jpg'), JPEG);
    const filesBefore = readdirSync(dir).filter((n) => !n.endsWith('-wal') && !n.endsWith('-shm'));

    await start(dir, { ORGANISATION_NAME: 'Sri Sai Cable' }, false);
    // Only control.db is new; nothing renamed, moved or copied, and no organisations folder yet.
    expect(readdirSync(dir).filter((n) => !n.endsWith('-wal') && !n.endsWith('-shm')).sort()).toEqual([...filesBefore, 'control.db'].sort());
    expect(existsSync(join(dir, 'organisations'))).toBe(false);
    expect(tenants!.all()).toHaveLength(1);
    expect(tenants!.host()).toMatchObject({ name: 'Sri Sai Cable', status: 'active', host: true, databasePath: join(dir, 'fibergis.db'), photosDir: join(dir, 'photos') });

    // The login made before the upgrade still works (its cookie has no organisation prefix).
    const cookie = `fibergis_session=${oldToken}`;
    const after = await send('GET', '/network', undefined, cookie);
    expect(after.statusCode).toBe(200);
    expect(after.json().revision).toBe(before.revision);
    expect(after.json().data).toEqual(before.data);
    expect((await send('GET', '/photos/PH-OLDPHOTO1', undefined, cookie)).statusCode).toBe(200);
    const status = (await send('GET', '/auth/status', undefined, cookie)).json();
    expect(status).toMatchObject({ mode: 'enforced', account: { username: 'ravi' }, organisation: { name: 'Sri Sai Cable' }, platformAdmin: true });
    expect((await send('POST', '/auth/login', { username: 'ravi', password: 'ravi-pass-1' })).statusCode).toBe(200);

    // A second start finds the same first organisation; it is not registered twice.
    const hostId = tenants!.host().id;
    await stop();
    await start(dir, { ORGANISATION_NAME: 'Another name' }, false);
    expect(tenants!.all()).toHaveLength(1);
    expect(tenants!.host()).toMatchObject({ id: hostId, name: 'Sri Sai Cable' });
  });
});

describe('setup mode on a fresh install', () => {
  it('works as before: this computer only, then the first administrator manages the organisations', async () => {
    await start();
    expect((await send('GET', '/network')).statusCode).toBe(200);
    expect((await app!.inject({ method: 'GET', url: api('/network'), headers: { host: '192.168.1.5:5000' }, ...phone })).statusCode).toBe(401);
    expect((await send('GET', '/auth/status')).json()).toMatchObject({ mode: 'setup', account: null, organisation: { name: 'My organisation' } });
    expect((await send('GET', '/platform/organisations')).statusCode).toBe(409);
    expect((await send('POST', '/platform/organisations', { name: 'X ISP', admin: { username: 'x', displayName: 'X', password: 'x-pass-123' } })).statusCode).toBe(409);
    const cookie = await owner();
    expect((await send('GET', '/auth/status', undefined, cookie)).json()).toMatchObject({ mode: 'enforced', platformAdmin: true, organisation: { name: 'My organisation' } });
    // Login is now on for every organisation, and a second setup is refused.
    expect((await send('GET', '/network')).statusCode).toBe(401);
    expect((await send('POST', '/auth/setup', { username: 'again', displayName: 'Again', password: 'again-pass-1' })).statusCode).toBe(409);
  });
});

describe('adding and managing organisations', () => {
  it('gives each organisation its own database file (all migrations) and folders, and its own first administrator', async () => {
    const { owner: ownerCookie, bob, bId } = await twoOrganisations();
    const folder = join(config.organisationsDir, bId);
    expect(existsSync(join(folder, 'fibergis.db'))).toBe(true);
    const db = new DatabaseSync(join(folder, 'fibergis.db'));
    expect(Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)).toBeGreaterThanOrEqual(3);
    db.close();
    expect(tenants!.get(bId)).toMatchObject({ photosDir: join(folder, 'photos'), voiceDir: join(folder, 'voice'), backupsDir: join(folder, 'backups') });
    // The new administrator lives in the new database only.
    expect(tenants!.get(bId)!.repository.auth.list().map((u) => u.username)).toEqual(['bob']);
    expect(tenants!.host().repository.auth.list().map((u) => u.username)).toEqual(['owner']);
    expect((await send('GET', '/auth/status', undefined, bob)).json()).toMatchObject({ account: { username: 'bob', role: 'admin' }, organisation: { id: bId, name: 'Second ISP' } });
    expect((await send('GET', '/auth/status', undefined, bob)).json().platformAdmin).toBeUndefined();
    // An organisation's administrator cannot manage organisations.
    expect((await send('GET', '/platform/organisations', undefined, bob)).statusCode).toBe(403);
    expect((await send('POST', '/platform/organisations', { name: 'Third', admin: { username: 'carol', displayName: 'Carol' } }, bob)).statusCode).toBe(403);
    expect((await send('PATCH', `/platform/organisations/${tenants!.host().id}`, { status: 'suspended' }, bob)).statusCode).toBe(403);

    const list = (await send('GET', '/platform/organisations', undefined, ownerCookie)).json();
    expect(list.organisations).toEqual([
      expect.objectContaining({ host: true, name: 'My organisation', status: 'active', activeAccounts: 1 }),
      expect.objectContaining({ id: bId, host: false, name: 'Second ISP', status: 'active', activeAccounts: 1 }),
    ]);
    expect(list.events[0]).toMatchObject({ action: 'ORGANISATION_ADDED', organisationId: bId, actorName: 'Owner' });

    // A temporary password is made when none is given, shown once; names are unique on the server.
    const third = await send('POST', '/platform/organisations', { name: 'Third ISP', admin: { username: 'carol', displayName: 'Carol' } }, ownerCookie);
    expect(third.statusCode).toBe(201);
    expect(third.json().temporaryPassword).toMatch(/^[a-z2-9]{10}$/);
    expect((await send('POST', '/platform/organisations', { name: 'second isp', admin: { username: 'dave', displayName: 'Dave' } }, ownerCookie)).json().error).toBe('name_taken');
    expect((await send('POST', '/platform/organisations', { name: 'Fourth ISP', admin: { username: 'owner', displayName: 'Dave' } }, ownerCookie)).json().error).toBe('username_taken');
    expect(readdirSync(config.organisationsDir)).toHaveLength(2);
  });

  it('switching an organisation off stops its logins, sessions and push tokens, and keeps its data', async () => {
    const { owner: ownerCookie, bob, bId } = await twoOrganisations();
    expect((await send('POST', '/changes', { upserts: { equipment: [pole('POLE-B-1')] } }, bob)).statusCode).toBe(200);
    const made = (await send('POST', '/monitoring/sources', { name: 'B NMS', kind: 'push' }, bob)).json();
    const off = await send('PATCH', `/platform/organisations/${bId}`, { status: 'suspended' }, ownerCookie);
    expect(off.statusCode, off.body).toBe(200);
    expect(off.json().organisation.status).toBe('suspended');
    expect((await send('GET', '/network', undefined, bob)).statusCode).toBe(401);
    const login = await send('POST', '/auth/login', { username: 'bob', password: 'bob-pass-2' });
    expect(login.statusCode).toBe(403);
    expect(login.json().error).toBe('organisation_suspended');
    // A wrong password says nothing about the organisation.
    expect((await send('POST', '/auth/login', { username: 'bob', password: 'wrong-pass-9' })).json().error).toBe('wrong_login');
    const rows = [{ serial: 'ZTEGC0FFEE01', deviceTime: new Date(Date.now() - 60_000).toISOString(), state: 'online' }];
    expect((await send('POST', '/monitoring/ingest', { rows }, undefined, { authorization: `Bearer ${made.token}` })).statusCode).toBe(401);
    // The first organisation cannot be switched off.
    expect((await send('PATCH', `/platform/organisations/${tenants!.host().id}`, { status: 'suspended' }, ownerCookie)).json().error).toBe('host_stays_on');

    expect((await send('PATCH', `/platform/organisations/${bId}`, { status: 'active', name: 'Second ISP Ltd' }, ownerCookie)).statusCode).toBe(200);
    // Logins from before it was switched off ended; a fresh login is needed.
    expect((await send('GET', '/network', undefined, bob)).statusCode).toBe(401);
    const back = cookieOf(await send('POST', '/auth/login', { username: 'bob', password: 'bob-pass-2' }));
    expect((await network(back)).data.equipment.map((e: Equipment) => e.id)).toEqual(['POLE-B-1']);
    expect((await send('GET', '/auth/status', undefined, back)).json().organisation.name).toBe('Second ISP Ltd');
    const events = (await send('GET', '/platform/organisations', undefined, ownerCookie)).json().events.map((e: { action: string }) => e.action);
    expect(events.slice(0, 3)).toEqual(['ORGANISATION_SWITCHED_ON', 'ORGANISATION_SWITCHED_OFF', 'ORGANISATION_ADDED']);
  });

  it('keeps the organisations, logins and data after a restart', async () => {
    const { bId } = await twoOrganisations();
    const bob = cookieOf(await send('POST', '/auth/login', { username: 'bob', password: 'bob-pass-2' }));
    expect((await send('POST', '/changes', { upserts: { equipment: [pole('POLE-B-1')] } }, bob)).statusCode).toBe(200);
    const dir = root;
    await stop();
    await start(dir, {}, false);
    expect(tenants!.all().map((t) => t.id)).toContain(bId);
    // The cookie from before the restart still works, and so does logging in again.
    expect((await network(bob)).data.equipment.map((e: Equipment) => e.id)).toEqual(['POLE-B-1']);
    expect((await send('POST', '/auth/login', { username: 'bob', password: 'bob-pass-2' })).statusCode).toBe(200);
  });
});

describe('isolation: one organisation can never read or change another', () => {
  it('network, changes, health, reports and the changes feed', async () => {
    const { owner: ownerCookie, bob } = await twoOrganisations();
    const hostCounts = await counts(ownerCookie);
    expect(hostCounts.equipment).toBeGreaterThan(0);
    expect(Object.values(await counts(bob)).every((n) => n === 0)).toBe(true);
    expect((await network(bob)).data.equipment).toEqual([]);

    expect((await send('POST', '/changes', { upserts: { equipment: [pole('POLE-B-1')] } }, bob)).statusCode).toBe(200);
    expect((await network(bob)).data.equipment.map((e: Equipment) => e.id)).toEqual(['POLE-B-1']);
    expect((await network(ownerCookie)).data.equipment.some((e: Equipment) => e.id === 'POLE-B-1')).toBe(false);
    // Deleting the first organisation's record from the second deletes nothing there.
    expect((await send('POST', '/changes', { deletes: { equipment: ['POLE-01'] } }, bob)).statusCode).toBe(200);
    expect((await network(ownerCookie)).data.equipment.some((e: Equipment) => e.id === 'POLE-01')).toBe(true);
    expect(await counts(ownerCookie)).toEqual(hostCounts);

    const feed = (await send('GET', '/changes?since=0', undefined, bob)).json();
    expect(Object.keys(feed.upserts)).toEqual(['equipment']);
    expect(feed.upserts.equipment.map((e: Equipment) => e.id)).toEqual(['POLE-B-1']);
    const hostFeed = (await send('GET', `/changes?since=${(await network(ownerCookie)).revision - 1}`, undefined, ownerCookie)).json();
    expect(JSON.stringify(hostFeed)).not.toContain('POLE-B-1');

    const reportB = (await send('GET', '/reports/data-quality', undefined, bob)).json();
    expect(reportB.revision).toBe((await network(bob)).revision);
  });

  it('single records and the map area', async () => {
    const { owner: ownerCookie, bob } = await twoOrganisations();
    expect((await send('GET', '/equipment/POLE-01', undefined, bob)).statusCode).toBe(404);
    expect((await send('GET', '/equipment', undefined, bob)).json()).toEqual([]);
    const put = await send('PUT', '/equipment/POLE-01', { ...basePole, name: 'Taken over by B' }, bob);
    expect(put.statusCode, put.body).toBeLessThan(300);
    expect((await send('GET', '/equipment/POLE-01', undefined, ownerCookie)).json().name).toBe(basePole.name);
    expect((await send('GET', '/equipment/POLE-01', undefined, bob)).json().name).toBe('Taken over by B');
    await send('DELETE', '/equipment/POLE-02', undefined, bob);
    expect((await send('GET', '/equipment/POLE-02', undefined, ownerCookie)).statusCode).toBe(200);

    const box = [basePole.lat - 0.01, basePole.lng - 0.01, basePole.lat + 0.01, basePole.lng + 0.01].join(',');
    const areaB = (await send('GET', `/network/area?bbox=${box}`, undefined, bob)).json();
    expect(areaB.data.equipment.map((e: Equipment) => e.id)).toEqual(['POLE-01']);
    const areaHost = (await send('GET', `/network/area?bbox=${box}`, undefined, ownerCookie)).json();
    expect(areaHost.data.equipment.length).toBeGreaterThan(1);
    expect(areaHost.data.equipment.find((e: Equipment) => e.id === 'POLE-01').name).toBe(basePole.name);
  });

  it('audit events, revisions and change requests', async () => {
    const { owner: ownerCookie, bob } = await twoOrganisations();
    expect((await send('POST', '/changes', { upserts: { equipment: [pole('POLE-HOST-1')] } }, ownerCookie)).statusCode).toBe(200);
    expect((await send('POST', '/changes', { upserts: { equipment: [pole('POLE-B-1')] } }, bob)).statusCode).toBe(200);

    const bobEvents = (await send('GET', '/audit-events', undefined, bob)).json().events as { recordId: string | null }[];
    expect(bobEvents.length).toBeGreaterThan(0);
    expect(bobEvents.some((e) => e.recordId === 'POLE-HOST-1' || e.recordId === 'POLE-01')).toBe(false);
    expect((await send('GET', '/audit-events?collection=equipment&id=POLE-HOST-1', undefined, bob)).json().events).toEqual([]);
    expect((await send('GET', '/audit-events?collection=equipment&id=POLE-B-1', undefined, ownerCookie)).json().events).toEqual([]);
    expect((await send('GET', '/revisions/equipment/POLE-HOST-1', undefined, bob)).json()).toMatchObject({ currentVersion: null, revisions: [] });
    expect((await send('GET', '/revisions/equipment/POLE-HOST-1', undefined, ownerCookie)).json().revisions.length).toBeGreaterThan(0);

    const asked = await send('POST', '/change-requests', { title: 'Rename pole 3', changes: { upserts: { equipment: [{ ...sample.equipment.find((e) => e.id === 'POLE-03')!, name: 'Pole 3 renamed' }] } } }, ownerCookie);
    expect(asked.statusCode, asked.body).toBe(201);
    const id = asked.json().id as string;
    expect((await send('GET', '/change-requests', undefined, bob)).json().requests).toEqual([]);
    expect((await send('GET', `/change-requests/${id}`, undefined, bob)).statusCode).toBe(404);
    expect((await send('POST', `/change-requests/${id}/review`, { decision: 'approve' }, bob)).statusCode).toBe(404);
    expect((await send('POST', `/change-requests/${id}/comments`, { text: 'from B' }, bob)).statusCode).toBe(404);
    expect((await send('GET', '/change-requests', undefined, ownerCookie)).json().requests.map((r: { id: string }) => r.id)).toEqual([id]);
  });

  it('photos, backups, restore and reset', async () => {
    const { owner: ownerCookie, bob, bId } = await twoOrganisations();
    const put = (cookie: string) => app!.inject({ method: 'PUT', url: api('/photos/PH-SHARED001'), payload: JPEG, headers: { cookie, 'content-type': 'image/jpeg' } });
    expect((await put(ownerCookie)).statusCode).toBe(201);
    expect((await send('GET', '/photos/PH-SHARED001', undefined, bob)).statusCode).toBe(404);
    // The same id in the second organisation is its own photo, in its own folder.
    expect((await put(bob)).statusCode).toBe(201);
    expect(existsSync(join(config.photosDir, 'PH-SHARED001.jpg'))).toBe(true);
    expect(existsSync(join(config.organisationsDir, bId, 'photos', 'PH-SHARED001.jpg'))).toBe(true);

    // B's backup holds B's network only, and no photo of the first organisation.
    expect((await send('POST', '/changes', { upserts: { equipment: [pole('POLE-B-1')] } }, bob)).statusCode).toBe(200);
    const backupB = (await send('GET', '/backup', undefined, bob)).json();
    expect(JSON.stringify(backupB)).not.toContain('POLE-01');
    expect(JSON.stringify(backupB)).toContain('POLE-B-1');
    const zip = await send('GET', '/backup?photos=1', undefined, bob);
    expect(zip.headers['x-backup-photos']).toBe('1');

    // Restoring the first organisation's backup into B changes B only; the safety copy is in B's folder.
    const hostBefore = await network(ownerCookie);
    const hostBackup = (await send('GET', '/backup', undefined, ownerCookie)).json();
    const restored = await send('POST', '/restore?accept=problems', hostBackup, bob);
    expect(restored.statusCode, restored.body).toBe(200);
    expect(readdirSync(join(config.organisationsDir, bId, 'backups')).some((n) => n.startsWith('fibergis-before-restore-'))).toBe(true);
    expect(existsSync(config.backupsDir)).toBe(false);
    expect((await network(ownerCookie)).revision).toBe(hostBefore.revision);

    // A reset in B leaves the first organisation as it was.
    expect((await send('POST', '/changes', { upserts: { equipment: [pole('POLE-HOST-1')] } }, ownerCookie)).statusCode).toBe(200);
    const hostNow = await network(ownerCookie);
    expect((await send('POST', '/reset', { confirm: 'reset' }, bob)).statusCode).toBe(200);
    expect((await network(ownerCookie)).revision).toBe(hostNow.revision);
    expect((await network(ownerCookie)).data.equipment.some((e: Equipment) => e.id === 'POLE-HOST-1')).toBe(true);
    expect(existsSync(config.backupsDir)).toBe(false);
  });

  it('monitoring sources and push tokens', async () => {
    const { owner: ownerCookie, bob, bId } = await twoOrganisations();
    // B loads the sample (it has the ONT with serial ZTEGC0FFEE01) through its own reset.
    expect((await send('POST', '/reset', { confirm: 'reset' }, bob)).statusCode).toBe(200);
    const hostSource = (await send('POST', '/monitoring/sources', { name: 'Host NMS', kind: 'push' }, ownerCookie)).json();
    const bSource = (await send('POST', '/monitoring/sources', { name: 'B NMS', kind: 'push' }, bob)).json();
    expect(hostSource.token).toMatch(/^fgm_[A-Za-z0-9_-]+$/);
    expect(bSource.token.startsWith(`fgm_${bId}.`)).toBe(true);

    const names = async (cookie: string) => (await send('GET', '/monitoring/sources', undefined, cookie)).json().sources.map((s: { name: string }) => s.name);
    expect(await names(bob)).toContain('B NMS');
    expect(await names(bob)).not.toContain('Host NMS');
    expect(await names(ownerCookie)).not.toContain('B NMS');
    // B cannot touch the first organisation's source or its token.
    expect((await send('POST', `/monitoring/sources/${hostSource.source.id}/token`, {}, bob)).statusCode).toBe(404);
    expect((await send('DELETE', `/monitoring/sources/${hostSource.source.id}/token`, undefined, bob)).statusCode).toBe(404);

    const rows = [{ serial: 'ZTEGC0FFEE01', deviceTime: new Date(Date.now() - 60_000).toISOString(), ontRxDbm: -20, unit: 'dBm' }];
    const hostReadings = (await counts(ownerCookie)).onuReadings;
    const pushed = await send('POST', '/monitoring/ingest', { rows }, undefined, { authorization: `Bearer ${bSource.token}` });
    expect(pushed.statusCode, pushed.body).toBe(200);
    expect(pushed.json().stored.readings).toBe(1);
    expect((await counts(bob)).onuReadings).toBe(1);
    expect((await counts(ownerCookie)).onuReadings).toBe(hostReadings);

    // The token's secret moved to another organisation (or its prefix removed) is not a token there.
    const secret = bSource.token.slice(`fgm_${bId}.`.length);
    const refused = async (token: string) => (await send('POST', '/monitoring/ingest', { rows }, undefined, { authorization: `Bearer ${token}` })).statusCode;
    expect(await refused(`fgm_${secret}`)).toBe(401);
    expect(await refused(`fgm_${tenants!.host().id}.${secret}`)).toBe(401);
    expect(await refused(`fgm_${bId}.${hostSource.token.slice(4)}`)).toBe(401);
    expect(await refused(`fgm_ORG-NOTANORG00.${secret}`)).toBe(401);
    // A logged-in session of the first organisation does not move a push into it.
    expect((await send('POST', '/monitoring/ingest', { rows }, ownerCookie, { authorization: `Bearer ${bSource.token}` })).json().stored.readings).toBe(0);
    expect((await counts(ownerCookie)).onuReadings).toBe(hostReadings);
  });

  it('voice clips and their audio', async () => {
    const { owner: ownerCookie, bob } = await twoOrganisations();
    const host = tenants!.host();
    const id = newClipId();
    host.repository.voiceClips.add({ id, lessonKey: 'welcome.intro', language: 'en', scriptHash: 'x'.repeat(32), model: 'bulbul:v4-flash', voice: 'v', characters: 10, bytes: 4, format: 'mp3', createdBy: null });
    mkdirSync(config.voiceDir, { recursive: true });
    writeFileSync(join(config.voiceDir, `${id}.mp3`), Buffer.from([1, 2, 3, 4]));
    expect((await send('GET', '/voice/clips', undefined, ownerCookie)).json().clips.map((c: { id: string }) => c.id)).toEqual([id]);
    expect((await send('GET', '/voice/clips', undefined, bob)).json().clips).toEqual([]);
    expect((await send('GET', `/voice/audio/${id}`, undefined, ownerCookie)).statusCode).toBe(200);
    expect((await send('GET', `/voice/audio/${id}`, undefined, bob)).statusCode).toBe(404);
    expect((await send('POST', `/voice/clips/${id}/review`, { status: 'rejected', reviewer: 'Bob B' }, bob)).statusCode).toBe(404);
    expect(host.repository.voiceClips.get(id)!.status).toBe('draft');
  });

  it('accounts: each administrator manages only their own; login names are unique on the server', async () => {
    const { owner: ownerCookie, bob, bId } = await twoOrganisations();
    const ownerId = tenants!.host().repository.auth.byUsername('owner')!.id;
    const bobId = tenants!.get(bId)!.repository.auth.byUsername('bob')!.id;
    expect((await send('GET', '/users', undefined, bob)).json().map((u: { username: string }) => u.username)).toEqual(['bob']);
    expect((await send('GET', '/users', undefined, ownerCookie)).json().map((u: { username: string }) => u.username)).toEqual(['owner']);
    expect((await send('PATCH', `/users/${ownerId}`, { active: false }, bob)).statusCode).toBe(404);
    expect((await send('POST', `/users/${ownerId}/password`, {}, bob)).statusCode).toBe(404);
    expect((await send('PATCH', `/users/${bobId}`, { role: 'viewer' }, ownerCookie)).statusCode).toBe(404);
    expect((await send('POST', '/users', { username: 'owner', displayName: 'Someone', role: 'technician' }, bob)).json().error).toBe('username_taken');
    expect((await send('POST', '/users', { username: 'bob', displayName: 'Someone', role: 'technician' }, ownerCookie)).json().error).toBe('username_taken');

    const tech = await send('POST', '/users', { username: 'bob-tech', displayName: 'Bob Tech', role: 'technician', password: 'tech-pass-1' }, bob);
    expect(tech.statusCode).toBe(201);
    expect(tenants!.get(bId)!.repository.auth.byUsername('bob-tech')).toBeDefined();
    expect(tenants!.host().repository.auth.byUsername('bob-tech')).toBeUndefined();
    expect((await send('GET', '/auth/technicians', undefined, bob)).json()).toEqual([{ displayName: 'Bob Tech' }]);
    expect((await send('GET', '/auth/technicians', undefined, ownerCookie)).json()).toEqual([]);
    // The new account logs in to its own organisation from the one login screen.
    const techLogin = await send('POST', '/auth/login', { username: 'bob-tech', password: 'tech-pass-1' });
    expect(techLogin.json().organisation).toMatchObject({ id: bId });
  });

  it('a session cookie cannot be moved to another organisation', async () => {
    const { owner: ownerCookie, bob, bId } = await twoOrganisations();
    const bobToken = bob.split('=')[1];
    expect(bobToken.startsWith(`${bId}.`)).toBe(true);
    const bare = bobToken.slice(bId.length + 1);
    expect((await send('GET', '/network', undefined, `fibergis_session=${bare}`)).statusCode).toBe(401);
    expect((await send('GET', '/network', undefined, `fibergis_session=${tenants!.host().id}.${bare}`)).statusCode).toBe(401);
    const ownerToken = ownerCookie.split('=')[1];
    expect((await send('GET', '/network', undefined, `fibergis_session=${bId}.${ownerToken}`)).statusCode).toBe(401);
    expect((await send('GET', '/network', undefined, `fibergis_session=ORG-NOTANORG00.${ownerToken}`)).statusCode).toBe(401);
  });
});

describe('the scoped stores', () => {
  it('refuse when no organisation is known, and never fall back to another', async () => {
    await start();
    const repository = scoped((t) => t.repository);
    expect(() => repository.getRevision()).toThrow(/outside a request/);
    expect(() => runInTenant(null, () => repository.getRevision())).toThrow(/log in/i);
    expect(() => runInTenant(null, () => currentTenant())).toThrow(/log in/i);
    expect(await runInTenant(tenants!.host(), () => repository.getRevision())).toBeGreaterThan(0);
  });
});
