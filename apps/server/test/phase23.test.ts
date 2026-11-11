import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { mkdtempSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ACCOUNT_ROLE_LABELS, ACCOUNT_ROLES, type AccountRole, API_PREFIX, type Equipment, listSettingId, type PermissionAction } from '@fibergis/shared';
import { createSampleNetwork } from '@fibergis/shared/sample';

import { buildApp } from '../src/app';
import { hashPassword } from '../src/auth/passwords';
import { type AppConfig, loadConfig } from '../src/config';
import { seedSampleNetwork } from '../src/db/seed';
import { SqliteNetworkRepository } from '../src/db/sqliteRepository';

/** Phase 23: eight roles, action permissions, the server's audit events, revisions, change requests, editable lists. */

// Logins hash passwords on purpose slowly, and the role matrix makes many requests.
vi.setConfig({ testTimeout: 120_000 });

const api = (path: string) => `${API_PREFIX}${path}`;
let app: FastifyInstance;
let repository: SqliteNetworkRepository;

async function start(overrides: Partial<AppConfig> = {}, databasePath = ':memory:') {
  const config: AppConfig = {
    ...loadConfig({ LOG_LEVEL: 'silent', STATIC_DIR: join(tmpdir(), 'fibergis-no-static') }),
    databasePath,
    photosDir: join(mkdtempSync(join(tmpdir(), 'fibergis-photos-')), 'photos'),
    backupsDir: join(mkdtempSync(join(tmpdir(), 'fibergis-backups-')), 'backups'),
    rateLimitPerMinute: 100_000,
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
const send = (method: InjectOptions['method'], path: string, payload?: unknown, cookie?: string) =>
  app.inject({ method, url: api(path), ...(payload === undefined ? {} : { payload: payload as object }), headers: cookie ? { cookie } : {} });

async function owner() {
  return cookieOf(await send('POST', '/auth/setup', { username: 'owner', displayName: 'Owner', password: 'owner-pass-1' }));
}
async function person(adminCookie: string, username: string, displayName: string, role: string) {
  const made = await send('POST', '/users', { username, displayName, role, password: `${username}-pass-1` }, adminCookie);
  expect(made.statusCode, made.body).toBe(201);
  const cookie = cookieOf(await send('POST', '/auth/login', { username, password: `${username}-pass-1` }));
  expect((await send('POST', '/auth/password', { currentPassword: `${username}-pass-1`, newPassword: `${username}-pass-2` }, cookie)).statusCode).toBe(200);
  return cookie;
}

/** One password hash for every test account: hashing is slow on purpose. */
let sharedHash: Promise<string> | undefined;

/**
 * One logged-in person per role. The Super Admin is the first account; the others are put straight
 * in the account store (with one shared password hash), then log in through the API as usual.
 */
async function team(): Promise<Record<AccountRole, string>> {
  const admin = await owner();
  const cookies = { admin } as Record<AccountRole, string>;
  const passwordHash = await (sharedHash ??= hashPassword('team-pass-1'));
  for (const role of ACCOUNT_ROLES) {
    if (role === 'admin') continue;
    const username = role.replace(/_/g, '-');
    repository.auth.create({ username, displayName: `${ACCOUNT_ROLE_LABELS[role]} Person`, role, passwordHash, mustChangePassword: false });
    cookies[role] = cookieOf(await send('POST', '/auth/login', { username, password: 'team-pass-1' }));
  }
  return cookies;
}

const sample = createSampleNetwork();
const basePole = sample.equipment.find((e) => e.id === 'POLE-01')!;
let poleCount = 0;
const newPole = (extra: Partial<Equipment> = {}): Equipment => {
  poleCount += 1;
  return { ...basePole, id: `POLE-P23-${poleCount}`, name: `Phase 23 pole ${poleCount}`, lat: basePole.lat + poleCount * 0.0005, lng: basePole.lng + 0.002, ...extra };
};
const ok = (status: number) => status >= 200 && status < 300;

async function addAsAdmin(admin: string, pole: Equipment) {
  const res = await send('POST', '/changes', { upserts: { equipment: [pole] } }, admin);
  expect(res.statusCode, res.body).toBe(200);
  return pole;
}
async function current<T>(path: string, cookie: string): Promise<T> {
  const res = await send('GET', path, undefined, cookie);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as T;
}

describe('roles and old accounts', () => {
  it('keeps the five older role names working and accepts the new spellings', async () => {
    const admin = await owner();
    expect((await send('GET', '/auth/status', undefined, admin)).json().account.role).toBe('admin');
    for (const [spelling, stored] of [
      ['office', 'office'],
      ['Network Planner', 'office'],
      ['gis_engineer', 'engineer'],
      ['NOC Operator', 'noc'],
      ['read-only', 'viewer'],
      ['supervisor', 'supervisor'],
    ] as const) {
      const username = `u${Math.random().toString(36).slice(2, 8)}`;
      const res = await send('POST', '/users', { username, displayName: `Person ${username}`, role: spelling }, admin);
      expect(res.statusCode, res.body).toBe(201);
      expect(res.json().user.role).toBe(stored);
    }
    expect((await send('POST', '/users', { username: 'nobody1', displayName: 'Nobody', role: 'king' }, admin)).statusCode).toBe(400);
  });

  it('reads a stored role it does not know as Read-only (least rights)', async () => {
    const admin = await owner();
    await person(admin, 'odd', 'Odd Person', 'technician');
    const db = (repository as unknown as { db: DatabaseSync }).db;
    db.prepare("UPDATE users SET role = 'field_technician' WHERE username = 'odd'").run();
    expect(repository.auth.byUsername('odd')?.role).toBe('technician');
    db.prepare("UPDATE users SET role = 'emperor' WHERE username = 'odd'").run();
    expect(repository.auth.byUsername('odd')?.role).toBe('viewer');
  });
});

describe('every action for every role (Workflow J)', () => {
  /** Which roles may take each action in the test's own form of it. Written out, not read from the table under test. */
  const EXPECTED: Record<PermissionAction, AccountRole[]> = {
    view: [...ACCOUNT_ROLES],
    create: ['admin', 'network_admin', 'engineer', 'office'],
    edit: ['admin', 'network_admin', 'engineer', 'office'],
    move: ['admin', 'network_admin', 'engineer', 'office'],
    delete: ['admin', 'network_admin', 'engineer'],
    connect: ['admin', 'network_admin', 'engineer', 'office'],
    disconnect: ['admin', 'network_admin', 'engineer', 'office'],
    allocate: ['admin', 'network_admin', 'engineer', 'office'],
    deallocate: ['admin', 'network_admin', 'engineer', 'office'],
    approve: ['admin', 'network_admin', 'supervisor'],
    export: ['admin', 'network_admin', 'engineer', 'office', 'noc', 'supervisor'],
    configure: ['admin', 'network_admin', 'engineer'],
  };

  it('allows and refuses each action on the server exactly as the role table says', async () => {
    const cookies = await team();
    const admin = cookies.admin;
    const setPonStatus = async (cookie: string, status: 'Available' | 'Reserved') => {
      const olt = await current<Equipment>('/equipment/OLT-01', admin);
      const ponPorts = olt.ponPorts!.map((p) => (p.id === 'PON-04' ? { ...p, status } : p));
      return (await send('POST', '/changes', { upserts: { equipment: [{ ...olt, ponPorts }] } }, cookie)).statusCode;
    };
    const request = await send(
      'POST',
      '/change-requests',
      { title: 'Rename pole 3', changes: { upserts: { equipment: [{ ...sample.equipment.find((e) => e.id === 'POLE-03')!, name: 'Pole 3 renamed' }] } } },
      cookies.office,
    );
    expect(request.statusCode, request.body).toBe(201);

    const run: Record<PermissionAction, (role: AccountRole, cookie: string) => Promise<number>> = {
      view: async (_r, c) => (await send('GET', '/network', undefined, c)).statusCode,
      create: async (_r, c) => (await send('POST', '/changes', { upserts: { equipment: [newPole()] } }, c)).statusCode,
      edit: async (r, c) => {
        const pole = await addAsAdmin(admin, newPole());
        return (await send('POST', '/changes', { upserts: { equipment: [{ ...pole, name: `Renamed by ${r}` }] } }, c)).statusCode;
      },
      move: async (_r, c) => {
        const pole = await addAsAdmin(admin, newPole());
        return (await send('POST', '/changes', { upserts: { equipment: [{ ...pole, lat: pole.lat + 0.0001 }] } }, c)).statusCode;
      },
      delete: async (_r, c) => {
        const pole = await addAsAdmin(admin, newPole());
        return (await send('POST', '/changes', { deletes: { equipment: [pole.id] } }, c)).statusCode;
      },
      connect: async (_r, c) => {
        const pole = await addAsAdmin(admin, newPole());
        return (await send('POST', '/changes', { upserts: { equipment: [{ ...pole, customerId: 'CUST-001' }] } }, c)).statusCode;
      },
      disconnect: async (_r, c) => {
        const { customerId: _gone, ...pole } = await addAsAdmin(admin, newPole({ customerId: 'CUST-001' }));
        return (await send('POST', '/changes', { upserts: { equipment: [pole] } }, c)).statusCode;
      },
      allocate: async (_r, c) => {
        expect(await setPonStatus(admin, 'Available')).toBe(200);
        return setPonStatus(c, 'Reserved');
      },
      deallocate: async (_r, c) => {
        expect(await setPonStatus(admin, 'Reserved')).toBe(200);
        return setPonStatus(c, 'Available');
      },
      approve: async (_r, c) => {
        const made = await send('POST', '/change-requests', { title: 'Rename pole 4', changes: { upserts: { equipment: [{ ...sample.equipment.find((e) => e.id === 'POLE-04')!, name: 'Pole 4 renamed' }] } } }, cookies.office);
        return (await send('POST', `/change-requests/${made.json().id}/review`, { decision: 'approve' }, c)).statusCode;
      },
      export: async (_r, c) => (await send('GET', '/audit-events?format=csv', undefined, c)).statusCode,
      configure: async (r, c) => (await send('POST', '/changes', { upserts: { settings: [{ id: `test.p23.${r}`, value: 1 }] } }, c)).statusCode,
    };

    const outcome: string[] = [];
    for (const action of Object.keys(run) as PermissionAction[]) {
      for (const role of ACCOUNT_ROLES) {
        const status = await run[action](role, cookies[role]);
        const allowed = ok(status);
        if (allowed !== EXPECTED[action].includes(role)) outcome.push(`${role} ${action}: got HTTP ${status}`);
        if (!allowed) expect([401, 403], `${role} ${action}`).toContain(status);
      }
    }
    expect(outcome).toEqual([]);
  });

  it('lets the NOC and supervisor work on faults and jobs but not network items', async () => {
    const cookies = await team();
    // The sample fault names a job that is not in the sample; a new fault does not.
    const { workOrderId: _job, ...sampleFault } = sample.faults.find((f) => f.id === 'FLT-2026-002')!;
    const fault = { ...sampleFault, id: 'FLT-P23-NOC' };
    const byNoc = await send('POST', '/changes', { upserts: { faults: [fault] } }, cookies.noc);
    expect(byNoc.statusCode, byNoc.body).toBe(200);
    const bySupervisor = await send('POST', '/changes', { upserts: { faults: [{ ...fault, id: 'FLT-P23-SUP' }] } }, cookies.supervisor);
    expect(bySupervisor.statusCode, bySupervisor.body).toBe(200);
    const job = sample.workOrders.find((w) => w.id === 'WO-2026-105')!;
    for (const role of ['noc', 'supervisor'] as const) {
      expect((await send('POST', '/changes', { upserts: { workOrders: [{ ...job, notes: `Checked by ${role}` }] } }, cookies[role])).statusCode).toBe(200);
    }
    expect((await send('POST', '/changes', { upserts: { faults: [{ ...fault, id: 'FLT-P23-TECH' }] } }, cookies.technician)).statusCode).toBe(403);
    expect((await send('POST', '/changes', { upserts: { workOrders: [{ ...job, notes: 'Not mine' }] } }, cookies.technician)).statusCode).toBe(403);
  });

  it('lets a field technician move their own capture, and names the missing right when refused', async () => {
    const cookies = await team();
    const capture = newPole({ captureSource: 'field_capture' });
    expect((await send('POST', '/changes', { upserts: { equipment: [capture] } }, cookies.technician)).statusCode).toBe(200);
    expect((await send('POST', '/changes', { upserts: { equipment: [{ ...capture, lat: capture.lat + 0.0002 }] } }, cookies.technician)).statusCode).toBe(200);
    const refused = await send('POST', '/changes', { upserts: { settings: [{ id: 'test.p23.x', value: 2 }] } }, cookies.office);
    expect(refused.statusCode).toBe(403);
    const pole = await addAsAdmin(cookies.admin, newPole());
    const noDelete = await send('POST', '/changes', { deletes: { equipment: [pole.id] } }, cookies.office);
    expect(noDelete.json().message).toMatch(/Network Planner accounts cannot delete/);
  });

  it('keeps setup mode (no accounts) working as before', async () => {
    expect((await send('POST', '/changes', { upserts: { equipment: [newPole()] } })).statusCode).toBe(200);
    expect((await send('GET', '/audit-events?format=csv')).statusCode).toBe(200);
  });
});

describe('the server writes its own audit trail', () => {
  it('records a direct API write that sent no audit entry, with who, what and the changed fields', async () => {
    const cookies = await team();
    const pole = await addAsAdmin(cookies.admin, newPole());
    const put = await app.inject({ method: 'PUT', url: api(`/equipment/${pole.id}`), payload: { ...pole, name: 'Changed by a script', lat: pole.lat + 0.001 }, headers: { cookie: cookies.engineer } });
    expect(put.statusCode, put.body).toBe(200);
    const events = (await current<{ events: { actorName: string; actorRole: string; source: string; op: string; actions: string[]; diff: { field: string; before?: string; after?: string }[] }[] }>(`/audit-events?collection=equipment&id=${pole.id}`, cookies.admin)).events;
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ actorName: 'GIS Engineer Person', actorRole: 'engineer', source: 'record', op: 'update', actions: ['edit', 'move'] });
    expect(events[0].diff.map((d) => d.field).sort()).toEqual(['lat', 'name']);
    expect(events[0].diff.find((d) => d.field === 'name')).toMatchObject({ before: JSON.stringify(pole.name), after: '"Changed by a script"' });
    expect(events[1]).toMatchObject({ op: 'create', source: 'changes', actorName: 'Owner' });

    const del = await app.inject({ method: 'DELETE', url: api(`/equipment/${pole.id}`), headers: { cookie: cookies.admin } });
    expect(del.statusCode).toBe(204);
    const after = (await current<{ events: { op: string }[] }>(`/audit-events?collection=equipment&id=${pole.id}`, cookies.admin)).events;
    expect(after[0].op).toBe('delete');
  });

  it('records setup-mode writes too, and leaves no event for a resend of the same record', async () => {
    const pole = newPole();
    await send('POST', '/changes', { upserts: { equipment: [pole] } });
    await send('POST', '/changes', { upserts: { equipment: [pole] } });
    const events = (await send('GET', `/audit-events?collection=equipment&id=${pole.id}`)).json().events;
    expect(events).toHaveLength(1);
    expect(events[0].actorName).toBe('Setup mode (login off)');
  });

  it('hides changed values from Read-only accounts and keeps the events append-only', async () => {
    const cookies = await team();
    const pole = await addAsAdmin(cookies.admin, newPole());
    await send('POST', '/changes', { upserts: { equipment: [{ ...pole, name: 'Secret name' }] } }, cookies.admin);
    const seen = (await send('GET', `/audit-events?collection=equipment&id=${pole.id}`, undefined, cookies.viewer)).json().events;
    expect(seen[0].diff).toEqual([{ field: 'name' }]);
    const db = (repository as unknown as { db: DatabaseSync }).db;
    expect(() => db.prepare('DELETE FROM audit_events').run()).toThrow(/cannot be deleted/);
    expect(() => db.prepare("UPDATE audit_events SET actor_name = 'someone else'").run()).toThrow(/cannot be changed/);
  });

  it('writes one summary line per list for a reset, with who did it', async () => {
    await send('POST', '/reset', { confirm: 'reset' });
    const events = (await send('GET', '/audit-events?collection=equipment')).json().events as { source: string; op: string; note?: string }[];
    expect(events.some((e) => e.source === 'reset' && e.op === 'summary' && /Whole list replaced/.test(e.note ?? ''))).toBe(true);
  });
});

describe('record revisions', () => {
  it('keeps each version, compares two, and keeps a deleted record', async () => {
    const pole = newPole();
    await send('POST', '/changes', { upserts: { equipment: [pole] } });
    await send('POST', '/changes', { upserts: { equipment: [{ ...pole, name: 'Second name' }] } });
    await send('POST', '/changes', { deletes: { equipment: [pole.id] } });
    const list = (await send('GET', `/revisions/equipment/${pole.id}`)).json();
    expect(list.currentVersion).toBeNull();
    expect(list.revisions.map((r: { op: string }) => r.op)).toEqual(['delete', 'update', 'create']);
    const [deleted, updated, created] = list.revisions as { seq: number }[];
    const compare = (await send('GET', `/revisions/equipment/${pole.id}/compare?from=${created.seq}&to=${updated.seq}`)).json();
    expect(compare.fields).toEqual([{ field: 'name', before: JSON.stringify(pole.name), after: '"Second name"' }]);
    const gone = (await send('GET', `/revisions/equipment/${pole.id}/compare?from=${updated.seq}&to=${deleted.seq}`)).json();
    expect(gone.after.data).toBeNull();
    expect((await send('GET', `/revisions/equipment/${pole.id}/${deleted.seq}`)).json().data.name).toBe('Second name');
  });

  it('keeps only as many versions per record as the retention says', async () => {
    await app.close();
    await repository.close();
    await start({ revisionKeepPerRecord: 2 });
    const pole = newPole();
    for (const name of ['A', 'B', 'C', 'D']) await send('POST', '/changes', { upserts: { equipment: [{ ...pole, name }] } });
    const list = (await send('GET', `/revisions/equipment/${pole.id}`)).json();
    expect(list.revisions).toHaveLength(2);
    expect(list.retention.keepPerRecord).toBe(2);
    // The audit events are never removed by the retention.
    expect((await send('GET', `/audit-events?collection=equipment&id=${pole.id}`)).json().events).toHaveLength(4);
  });

  it('hides a phone number in a stored customer version from Read-only accounts', async () => {
    const cookies = await team();
    const customer = sample.customers[0];
    await send('POST', '/changes', { upserts: { customers: [{ ...customer, address: 'New address' }] } }, cookies.admin);
    const list = (await send('GET', `/revisions/customers/${customer.id}`, undefined, cookies.viewer)).json();
    const revision = (await send('GET', `/revisions/customers/${customer.id}/${list.revisions[0].seq}`, undefined, cookies.viewer)).json();
    expect(revision.data.mobile).toMatch(/Hidden/);
  });
});

describe('the database migration', () => {
  it('adds the new tables to an older database without touching its records, and can run twice', async () => {
    await app.close();
    await repository.close();
    const path = join(mkdtempSync(join(tmpdir(), 'fibergis-p23-')), 'old.db');
    await start({}, path);
    await app.close();
    await repository.close();
    // Make it look like a Phase 9 database: schema 1, none of the Phase 23 tables.
    const raw = new DatabaseSync(path);
    raw.exec('DROP TABLE audit_events; DROP TABLE record_revisions; DROP TABLE change_requests; PRAGMA user_version = 1;');
    const before = Number((raw.prepare('SELECT COUNT(*) AS n FROM records').get() as { n: number }).n);
    raw.close();
    await start({}, path);
    const db = (repository as unknown as { db: DatabaseSync }).db;
    // Phase 24 adds migration 3 (spatial index, change log) on top.
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(3);
    expect(Number((db.prepare('SELECT COUNT(*) AS n FROM records').get() as { n: number }).n)).toBe(before);
    expect((await send('POST', '/changes', { upserts: { equipment: [newPole()] } })).statusCode).toBe(200);
    await app.close();
    await repository.close();
    await start({}, path);
    expect(((repository as unknown as { db: DatabaseSync }).db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(3);
    expect((await send('GET', '/audit-events')).json().events.length).toBeGreaterThan(0);
  });
});

describe('change requests', () => {
  it('goes from asked to approved, made (with the applier’s rights), checked and closed', async () => {
    const cookies = await team();
    const pole = await addAsAdmin(cookies.admin, newPole());
    const moved = { ...pole, lat: pole.lat + 0.0003 };
    const asked = await send('POST', '/change-requests', { title: 'Pole is 30 m further north', reason: 'Seen on site', changes: { upserts: { equipment: [moved] } } }, cookies.technician);
    expect(asked.statusCode, asked.body).toBe(201);
    const id = asked.json().id as string;
    expect(asked.json()).toMatchObject({ status: 'requested', requestedBy: { name: 'Field Technician Person' } });

    // Read-only accounts cannot ask; the asker cannot approve; a role without approve cannot approve.
    expect((await send('POST', '/change-requests', { title: 'x', changes: { upserts: { equipment: [moved] } } }, cookies.viewer)).statusCode).toBe(403);
    expect((await send('POST', `/change-requests/${id}/review`, { decision: 'approve' }, cookies.engineer)).statusCode).toBe(403);
    // Read-only accounts do not see requests (they can hold phone numbers); people at work do.
    expect((await send('GET', `/change-requests/${id}`, undefined, cookies.viewer)).statusCode).toBe(403);
    expect((await send('GET', '/change-requests', undefined, cookies.viewer)).json().requests).toEqual([]);
    expect((await send('GET', `/change-requests/${id}`, undefined, cookies.office)).statusCode).toBe(200);
    // Not approved yet, so it cannot be made.
    expect((await send('POST', `/change-requests/${id}/apply`, {}, cookies.engineer)).statusCode).toBe(409);

    const approved = await send('POST', `/change-requests/${id}/review`, { decision: 'approve', note: 'Matches the photo' }, cookies.supervisor);
    expect(approved.statusCode, approved.body).toBe(200);
    expect(approved.json().status).toBe('approved');

    // A supervisor may approve but has no right to move network items, so making it is refused.
    const supervisorApply = await send('POST', `/change-requests/${id}/apply`, {}, cookies.supervisor);
    expect(supervisorApply.statusCode).toBe(403);
    const applied = await send('POST', `/change-requests/${id}/apply`, {}, cookies.network_admin);
    expect(applied.statusCode, applied.body).toBe(200);
    expect(applied.json().request.status).toBe('applied');
    expect((await current<Equipment>(`/equipment/${pole.id}`, cookies.admin)).lat).toBeCloseTo(moved.lat, 8);
    const events = (await current<{ events: { source: string; changeRequestId?: string; actorName: string; actions: string[] }[] }>(`/audit-events?collection=equipment&id=${pole.id}`, cookies.admin)).events;
    expect(events[0]).toMatchObject({ source: 'change_request', changeRequestId: id, actorName: 'Network Admin Person', actions: ['edit', 'move'] });

    expect((await send('POST', `/change-requests/${id}/verify`, { note: 'Checked on site' }, cookies.engineer)).statusCode).toBe(403);
    expect((await send('POST', `/change-requests/${id}/verify`, { note: 'Checked on site' }, cookies.supervisor)).json().status).toBe('verified');
    expect((await send('POST', `/change-requests/${id}/comments`, { text: 'Thanks' }, cookies.technician)).statusCode).toBe(200);
    const closed = await send('POST', `/change-requests/${id}/close`, {}, cookies.technician);
    expect(closed.json().status).toBe('closed');
    // The supervisor's refused try is kept as a step too.
    expect(closed.json().events.map((e: { kind: string }) => e.kind)).toEqual(['created', 'approved', 'apply_failed', 'applied', 'verified', 'comment', 'closed']);
    expect((await send('POST', `/change-requests/${id}/apply`, {}, cookies.admin)).statusCode).toBe(409);
  });

  it('refuses to make a request whose record changed since, writing nothing', async () => {
    const cookies = await team();
    const pole = await addAsAdmin(cookies.admin, newPole());
    const id = (await send('POST', '/change-requests', { title: 'Rename', changes: { upserts: { equipment: [{ ...pole, name: 'From the request' }] } } }, cookies.office)).json().id;
    await send('POST', `/change-requests/${id}/review`, { decision: 'approve' }, cookies.supervisor);
    await send('POST', '/changes', { upserts: { equipment: [{ ...pole, name: 'Changed meanwhile' }] } }, cookies.engineer);
    const apply = await send('POST', `/change-requests/${id}/apply`, {}, cookies.engineer);
    expect(apply.statusCode).toBe(409);
    expect(apply.json().error).toBe('version_conflict');
    expect((await current<Equipment>(`/equipment/${pole.id}`, cookies.admin)).name).toBe('Changed meanwhile');
    const cr = (await send('GET', `/change-requests/${id}`, undefined, cookies.supervisor)).json();
    expect(cr.status).toBe('approved');
    expect(cr.events.at(-1).kind).toBe('apply_failed');
  });

  it('refuses to approve your own request, and shows approvers every request', async () => {
    const cookies = await team();
    const id = (await send('POST', '/change-requests', { title: 'Mine', changes: { deletes: { equipment: ['POLE-04'] } } }, cookies.supervisor)).json().id;
    const self = await send('POST', `/change-requests/${id}/review`, { decision: 'approve' }, cookies.supervisor);
    expect(self.statusCode).toBe(403);
    expect(self.json().message).toMatch(/Someone else/);
    const list = (await send('GET', '/change-requests', undefined, cookies.network_admin)).json().requests;
    expect(list.map((r: { id: string }) => r.id)).toContain(id);
    expect(list[0].summary).toEqual([{ collection: 'equipment', upserts: 0, deletes: 1 }]);
    expect(list[0].changes).toBeUndefined();
  });
});

describe('editable lists, naming rules and custom fields', () => {
  const setting = (id: string, value: unknown) => ({ id, value: JSON.stringify(value) });

  it('adds an equipment type, hides a built-in one, and refuses a new value for a fixed list', async () => {
    const cookies = await team();
    const types = setting(listSettingId('equipmentTypes'), { added: [{ value: 'Wall box', group: 'Fiber Distribution' }], labels: {}, hidden: ['FDMS'] });
    expect((await send('POST', '/changes', { upserts: { settings: [types] } }, cookies.engineer)).statusCode).toBe(200);
    expect((await send('POST', '/changes', { upserts: { settings: [types] } }, cookies.office)).statusCode).toBe(200); // unchanged: allowed
    expect((await send('POST', '/changes', { upserts: { settings: [{ ...types, value: JSON.stringify({ added: [], labels: {}, hidden: [] }) }] } }, cookies.office)).statusCode).toBe(403);
    const ratios = await send('POST', '/changes', { upserts: { settings: [setting(listSettingId('splitterRatios'), { added: [{ value: '1:3' }] })] } }, cookies.engineer);
    expect(ratios.statusCode).toBe(409);
    expect(ratios.json().message).toMatch(/fixed list/);
  });

  it('refuses to remove a value records use, but lets it be hidden', async () => {
    const cookies = await team();
    const id = listSettingId('equipmentTypes');
    await send('POST', '/changes', { upserts: { settings: [setting(id, { added: [{ value: 'Wall box', group: 'Fiber Distribution' }] })] } }, cookies.engineer);
    await addAsAdmin(cookies.admin, newPole({ type: 'Wall box' as Equipment['type'] }));
    const removed = await send('POST', '/changes', { upserts: { settings: [setting(id, { added: [] })] } }, cookies.engineer);
    expect(removed.statusCode).toBe(409);
    expect(removed.json().message).toMatch(/used by records/);
    expect((await send('POST', '/changes', { deletes: { settings: [id] } }, cookies.engineer)).statusCode).toBe(409);
    expect((await send('POST', '/changes', { upserts: { settings: [setting(id, { added: [{ value: 'Wall box', group: 'Fiber Distribution' }], hidden: ['Wall box'] })] } }, cookies.engineer)).statusCode).toBe(200);
  });

  it('checks naming rules and custom field values on the server', async () => {
    const cookies = await team();
    expect((await send('POST', '/changes', { upserts: { settings: [setting('naming.equipment', { pattern: 'FAT-{area}' })] } }, cookies.engineer)).statusCode).toBe(409);
    expect((await send('POST', '/changes', { upserts: { settings: [setting('naming.equipment', { pattern: 'FAT-{area}-{n:3}' })] } }, cookies.engineer)).statusCode).toBe(200);
    const field = setting('attr.equipment.heightClass', { label: 'Height class', type: 'choice', choices: ['A', 'B'] });
    expect((await send('POST', '/changes', { upserts: { settings: [field] } }, cookies.engineer)).statusCode).toBe(200);
    const wrong = await send('POST', '/changes', { upserts: { equipment: [newPole({ customAttributes: { heightClass: 'Z' } })] } }, cookies.engineer);
    expect(wrong.statusCode).toBe(409);
    expect(wrong.json().message).toMatch(/Height class/);
    expect((await send('POST', '/changes', { upserts: { equipment: [newPole({ customAttributes: { heightClass: 'B' } })] } }, cookies.engineer)).statusCode).toBe(200);
  });
});
