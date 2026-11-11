import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ACCOUNT_ROLE_LABELS, ACCOUNT_ROLES, type AccountRole, API_PREFIX, buildCores, type Customer, CUSTOMER_HIDDEN_TEXT, type NetworkSnapshot } from '@fibergis/shared';
import { createSampleNetwork } from '@fibergis/shared/sample';

import { buildApp } from '../src/app';
import { hashPassword } from '../src/auth/passwords';
import { type AppConfig, loadConfig } from '../src/config';
import { seedSampleNetwork } from '../src/db/seed';
import { SqliteNetworkRepository } from '../src/db/sqliteRepository';

/** Phase 12: customer paths checked against the fibre links, and customers' personal data by role. */

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

let sharedHash: Promise<string> | undefined;
const TECH = `${ACCOUNT_ROLE_LABELS.technician} Person`;

async function team(): Promise<Record<AccountRole, string>> {
  const admin = cookieOf(await send('POST', '/auth/setup', { username: 'owner', displayName: 'Owner', password: 'owner-pass-1' }));
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
const template = sample.customers[0];
const baseCable = sample.cables.find((c) => c.cableCategory === 'Fiber')!;
const baseBox = sample.equipment.find((e) => e.type === 'FAT')!;
const baseOlt = sample.equipment.find((e) => e.type === 'OLT')!;

/** A small path recorded fiber by fiber: P12-OLT PON-01 → P12-FEED 1 → P12-SPL output 2 → P12-DROP 1 → P12-C1. */
function linkedPath() {
  const at = { lat: baseBox.lat + 0.01, lng: baseBox.lng + 0.01 };
  const olt = { ...baseOlt, id: 'P12-OLT', name: 'P12 OLT', ...at, ponPorts: [{ id: 'PON-01', portNumber: 1, status: 'Active' as const, connectedFeederCableId: 'P12-FEED', feederCore: 1, connectedCustomersCount: 1 }] };
  const otherOlt = { ...baseOlt, id: 'P12-OLT-B', name: 'P12 OLT B', lat: at.lat + 0.001, lng: at.lng, ponPorts: [] };
  const box = { ...baseBox, id: 'P12-FAT', name: 'P12 FAT', lat: at.lat + 0.002, lng: at.lng + 0.002, logicalPorts: undefined };
  const cable = (id: string, fiberCount: number) => ({ ...baseCable, id, name: id, fiberCount, coordinates: [], startEquipmentId: undefined, endEquipmentId: undefined, cores: buildCores(fiberCount), tubes: undefined, fibersPerTube: undefined, tubeCount: undefined });
  const splitter = {
    id: 'P12-SPL',
    name: 'P12 splitter',
    terminalBoxId: box.id,
    ratio: '1:8' as const,
    insertionLossDb: 10.5,
    status: 'Active' as const,
    inputPort: { id: 'P12-SPL-IN', connectedCableId: 'P12-FEED', connectedCore: 1 },
    outputPorts: Array.from({ length: 8 }, (_, i) => ({
      portNumber: i + 1,
      label: `OUT-${i + 1}`,
      status: i === 1 ? ('Occupied' as const) : ('Available' as const),
      ...(i === 1 ? { connectedCustomerId: 'P12-C1', connectedCustomerName: 'Asha Rao', connectedDropCableId: 'P12-DROP', connectedCore: 1 } : {}),
    })),
  };
  const customer: Customer = {
    ...template,
    id: 'P12-C1',
    name: 'Asha Rao',
    mobile: '98450 11111',
    address: '12 Lake Road',
    building: 'Lake View',
    lat: at.lat + 0.003,
    lng: at.lng + 0.003,
    oltId: olt.id,
    ponPort: 'PON-01',
    feederCableId: 'P12-FEED',
    distributionCableId: 'P12-FEED',
    terminalBoxId: box.id,
    splitterId: splitter.id,
    splitterOutputPort: 2,
    dropCableId: 'P12-DROP',
    fiberCore: 1,
    ontId: undefined,
    buildingId: undefined,
    unitId: undefined,
  };
  return { olt, otherOlt, box, splitter, customer, cables: [cable('P12-FEED', 12), cable('P12-DROP', 2)] };
}

async function seedPath(admin: string) {
  const p = linkedPath();
  const res = await send('POST', '/changes', { upserts: { equipment: [p.olt, p.otherOlt, p.box], cables: p.cables, splitters: [p.splitter], customers: [p.customer] } }, admin);
  expect(res.statusCode, res.body).toBe(200);
  return p;
}

const customerIn = (data: Partial<NetworkSnapshot>, id: string) => data.customers!.find((c) => c.id === id)!;

describe('a customer path that disagrees with the fibre links is refused (Phase 12)', () => {
  it('refuses the write, through POST /changes and PUT, and says it is broken data', async () => {
    const { admin } = await team();
    const p = await seedPath(admin);
    const wrong = { ...p.customer, oltId: p.otherOlt.id };
    const refused = await send('POST', '/changes', { upserts: { customers: [wrong] } }, admin);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().message).toMatch(/Broken data: Asha Rao is recorded on OLT P12-OLT-B, but the fibre links lead to P12-OLT/);
    const put = await send('PUT', `/customers/${p.customer.id}`, wrong, admin);
    expect(put.statusCode).toBe(409);
    // Blank is "not recorded", never a disagreement.
    expect((await send('POST', '/changes', { upserts: { customers: [{ ...p.customer, feederCableId: '', distributionCableId: '' }] } }, admin)).statusCode).toBe(200);
  });

  it('refuses a splitter output that names a customer its fibre does not reach', async () => {
    const { admin } = await team();
    const p = await seedPath(admin);
    const other = { ...p.customer, id: 'P12-C2', name: 'Ravi', dropCableId: '', fiberCore: 0, splitterId: '', splitterOutputPort: 0, terminalBoxId: '', oltId: '', ponPort: '', feederCableId: '', distributionCableId: '' };
    expect((await send('POST', '/changes', { upserts: { customers: [other] } }, admin)).statusCode).toBe(200);
    const moved = { ...p.splitter, outputPorts: p.splitter.outputPorts.map((o) => (o.portNumber === 2 ? { ...o, connectedCustomerId: 'P12-C2', connectedCustomerName: 'Ravi' } : o)) };
    const refused = await send('POST', '/changes', { upserts: { splitters: [moved] } }, admin);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().message).toMatch(/Output 2 of splitter P12 splitter is recorded for Ravi, but its fibre leads to Asha Rao/);
  });
});

describe('personal data by role, in every answer that carries customers (Phase 12)', () => {
  async function setUp() {
    const cookies = await team();
    const p = await seedPath(cookies.admin);
    const job = { ...sample.workOrders[0], id: 'P12-WO', technicianName: TECH, customerId: sample.customers[1].id, status: 'Assigned' as const };
    expect((await send('POST', '/changes', { upserts: { workOrders: [job] } }, cookies.admin)).statusCode).toBe(200);
    return { cookies, p, ownJobCustomer: sample.customers[1] };
  }

  it('the snapshot: Read-only sees none, a technician only their own job customers, an engineer no phone numbers', async () => {
    const { cookies, p, ownJobCustomer } = await setUp();
    const as = async (role: AccountRole) => (await send('GET', '/network', undefined, cookies[role])).json().data as NetworkSnapshot;
    const admin = customerIn(await as('admin'), p.customer.id);
    expect(admin).toMatchObject({ name: 'Asha Rao', mobile: '98450 11111', address: '12 Lake Road' });
    expect(admin.hiddenFields).toBeUndefined();

    const viewer = await as('viewer');
    expect(customerIn(viewer, p.customer.id)).toMatchObject({ name: CUSTOMER_HIDDEN_TEXT, mobile: CUSTOMER_HIDDEN_TEXT, address: CUSTOMER_HIDDEN_TEXT, building: CUSTOMER_HIDDEN_TEXT, lat: 0, lng: 0 });
    expect(customerIn(viewer, p.customer.id).hiddenFields).toEqual(['name', 'address', 'mobile', 'gps']);
    // Links are not personal and stay; the name copied on the output does not.
    expect(customerIn(viewer, p.customer.id).splitterId).toBe('P12-SPL');
    expect(viewer.splitters.find((s) => s.id === 'P12-SPL')!.outputPorts[1].connectedCustomerName).toBe(CUSTOMER_HIDDEN_TEXT);
    expect(viewer.customers.some((c) => c.name !== CUSTOMER_HIDDEN_TEXT)).toBe(false);

    const tech = await as('technician');
    expect(customerIn(tech, p.customer.id)).toMatchObject({ name: CUSTOMER_HIDDEN_TEXT, mobile: CUSTOMER_HIDDEN_TEXT, lat: p.customer.lat });
    expect(customerIn(tech, ownJobCustomer.id)).toMatchObject({ name: ownJobCustomer.name, mobile: ownJobCustomer.mobile, address: ownJobCustomer.address });

    const engineer = customerIn(await as('engineer'), p.customer.id);
    expect(engineer).toMatchObject({ name: 'Asha Rao', address: '12 Lake Road', mobile: CUSTOMER_HIDDEN_TEXT });
    for (const role of ['office', 'noc', 'supervisor', 'network_admin'] as const) {
      expect(customerIn(await as(role), p.customer.id).mobile).toBe('98450 11111');
    }
  });

  it('the map area, the changes feed, and the collection routes', async () => {
    const { cookies, p, ownJobCustomer } = await setUp();
    const box = [p.customer.lat - 0.01, p.customer.lng - 0.01, p.customer.lat + 0.01, p.customer.lng + 0.01].join(',');
    const area = (await send('GET', `/network/area?bbox=${box}&collections=customers`, undefined, cookies.technician)).json();
    expect(customerIn(area.data, p.customer.id).name).toBe(CUSTOMER_HIDDEN_TEXT);
    const viewerArea = (await send('GET', `/network/area?bbox=${box}&collections=customers`, undefined, cookies.admin)).json();
    expect(customerIn(viewerArea.data, p.customer.id).name).toBe('Asha Rao');

    const feed = (await send('GET', '/changes?since=0', undefined, cookies.viewer)).json();
    if (!feed.reload) expect(customerIn(feed.upserts, p.customer.id).mobile).toBe(CUSTOMER_HIDDEN_TEXT);
    const revision = (await send('GET', '/network', undefined, cookies.admin)).json().revision as number;
    expect((await send('POST', '/changes', { upserts: { customers: [{ ...p.customer, plan: 'New plan' }] } }, cookies.admin)).statusCode).toBe(200);
    const recent = (await send('GET', `/changes?since=${revision}`, undefined, cookies.technician)).json();
    expect(recent.reload).toBeFalsy();
    expect(customerIn(recent.upserts, p.customer.id)).toMatchObject({ plan: 'New plan', name: CUSTOMER_HIDDEN_TEXT });

    const list = (await send('GET', '/customers', undefined, cookies.viewer)).json() as Customer[];
    expect(list.every((c) => c.name === CUSTOMER_HIDDEN_TEXT)).toBe(true);
    const paged = (await send('GET', '/customers?limit=5', undefined, cookies.technician)).json() as Customer[];
    expect(paged.filter((c) => c.id !== ownJobCustomer.id).every((c) => c.name === CUSTOMER_HIDDEN_TEXT)).toBe(true);
    const one = (await send('GET', `/customers/${ownJobCustomer.id}`, undefined, cookies.technician)).json() as Customer;
    expect(one.name).toBe(ownJobCustomer.name);
    expect(((await send('GET', `/customers/${p.customer.id}`, undefined, cookies.engineer)).json() as Customer).mobile).toBe(CUSTOMER_HIDDEN_TEXT);
    const splitter = (await send('GET', '/splitters/P12-SPL', undefined, cookies.technician)).json();
    expect(splitter.outputPorts[1].connectedCustomerName).toBe(CUSTOMER_HIDDEN_TEXT);
  });

  it('record revisions, the server audit events and change requests', async () => {
    const { cookies, p } = await setUp();
    expect((await send('POST', '/changes', { upserts: { customers: [{ ...p.customer, mobile: '98450 22222' }] } }, cookies.admin)).statusCode).toBe(200);
    const list = (await send('GET', `/revisions/customers/${p.customer.id}`, undefined, cookies.technician)).json();
    const version = (await send('GET', `/revisions/customers/${p.customer.id}/${list.revisions[0].seq}`, undefined, cookies.technician)).json();
    expect(version.data).toMatchObject({ name: CUSTOMER_HIDDEN_TEXT, mobile: CUSTOMER_HIDDEN_TEXT });
    const compare = (await send('GET', `/revisions/customers/${p.customer.id}/compare?from=${list.revisions[1].seq}&to=current`, undefined, cookies.viewer)).json();
    expect(JSON.stringify(compare)).not.toContain('98450');
    expect(JSON.stringify(compare)).not.toContain('Asha');

    const events = (await send('GET', `/audit-events?collection=customers&id=${p.customer.id}`, undefined, cookies.technician)).json().events as { diff: { field: string; before?: string; after?: string }[] }[];
    const mobileDiff = events.flatMap((e) => e.diff).find((d) => d.field === 'mobile')!;
    expect(mobileDiff).toEqual({ field: 'mobile' });
    const adminEvents = (await send('GET', `/audit-events?collection=customers&id=${p.customer.id}`, undefined, cookies.admin)).json().events as { diff: { field: string; after?: string }[] }[];
    expect(adminEvents.flatMap((e) => e.diff).find((d) => d.field === 'mobile')!.after).toContain('98450 22222');
    const engineerEvents = (await send('GET', `/audit-events?collection=customers&id=${p.customer.id}`, undefined, cookies.engineer)).json();
    expect(JSON.stringify(engineerEvents)).not.toContain('98450');

    const asked = await send('POST', '/change-requests', { title: 'Fix the plan', changes: { upserts: { customers: [{ ...p.customer, plan: 'Asked' }] } } }, cookies.office);
    expect(asked.statusCode, asked.body).toBe(201);
    const seen = (await send('GET', `/change-requests/${asked.json().id}`, undefined, cookies.technician)).json();
    expect(seen.changes.upserts.customers[0]).toMatchObject({ plan: 'Asked', name: CUSTOMER_HIDDEN_TEXT, mobile: CUSTOMER_HIDDEN_TEXT });
    expect((await send('GET', `/change-requests/${asked.json().id}`, undefined, cookies.office)).json().changes.upserts.customers[0].name).toBe('Asha Rao');
  });

  it('a hidden value sent back is never stored: a technician records a light reading on a redacted copy', async () => {
    const { cookies, p } = await setUp();
    const copy = customerIn((await send('GET', '/network', undefined, cookies.technician)).json().data, p.customer.id);
    expect(copy.name).toBe(CUSTOMER_HIDDEN_TEXT);
    const saved = await send('POST', '/changes', { upserts: { customers: [{ ...copy, rxOpticalPowerDbm: -19.5, rxSource: 'field_measured', rxMeasuredAt: '2026-11-11T09:00:00.000Z' }] } }, cookies.technician);
    expect(saved.statusCode, saved.body).toBe(200);
    const stored = (await repository.get('customers', p.customer.id))!;
    expect(stored).toMatchObject({ name: 'Asha Rao', mobile: '98450 11111', address: '12 Lake Road', building: 'Lake View', rxOpticalPowerDbm: -19.5 });
    expect(stored.hiddenFields).toBeUndefined();
    // PUT answers with what the role may see, never the restored values.
    const put = await send('PUT', `/customers/${p.customer.id}`, { ...copy, rxOpticalPowerDbm: -20.1, rxSource: 'field_measured' }, cookies.technician);
    expect(put.statusCode, put.body).toBe(200);
    expect(put.json().name).toBe(CUSTOMER_HIDDEN_TEXT);
    expect((await repository.get('customers', p.customer.id))!.name).toBe('Asha Rao');
    // A redacted splitter sent back keeps the real name on its output.
    const sp = (await send('GET', '/splitters/P12-SPL', undefined, cookies.viewer)).json();
    expect((await send('POST', '/changes', { upserts: { splitters: [{ ...sp, name: 'Renamed' }] } }, cookies.admin)).statusCode).toBe(200);
    expect((await repository.get('splitters', 'P12-SPL'))!.outputPorts[1].connectedCustomerName).toBe('Asha Rao');
  });
});
