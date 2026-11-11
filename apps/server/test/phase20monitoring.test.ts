import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { API_PREFIX } from '@fibergis/shared';

import { buildApp } from '../src/app';
import { type AppConfig, loadConfig } from '../src/config';
import { seedSampleNetwork } from '../src/db/seed';
import { TenantRegistry } from '../src/db/tenants';

/**
 * Network mapping Phase 20: OLT, card and PON port rows on the existing push route. A push token
 * belongs to one organisation: its rows are matched against that organisation's records only and
 * stored there only. Everything runs in temporary folders, never in apps/server/data.
 */

vi.setConfig({ testTimeout: 60_000 });

const api = (path: string) => `${API_PREFIX}${path}`;
let app: FastifyInstance | undefined;
let tenants: TenantRegistry | undefined;

async function start() {
  const root = mkdtempSync(join(tmpdir(), 'fibergis-p20-'));
  const config: AppConfig = loadConfig({ LOG_LEVEL: 'silent', STATIC_DIR: join(tmpdir(), 'fibergis-no-static'), DATABASE_PATH: join(root, 'fibergis.db') });
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
const send = (method: InjectOptions['method'], path: string, payload?: unknown, cookie?: string, headers: Record<string, string> = {}) =>
  app!.inject({ method, url: api(path), ...(payload === undefined ? {} : { payload: payload as object }), headers: { ...(cookie ? { cookie } : {}), ...headers } });

async function twoOrganisations() {
  await start();
  const setup = await send('POST', '/auth/setup', { username: 'owner', displayName: 'Owner', password: 'owner-pass-1' });
  expect(setup.statusCode, setup.body).toBe(200);
  const owner = cookieOf(setup);
  const made = await send('POST', '/platform/organisations', { name: 'Second ISP', admin: { username: 'bob', displayName: 'Bob', password: 'bob-pass-1' } }, owner);
  expect(made.statusCode, made.body).toBe(201);
  const login = await send('POST', '/auth/login', { username: 'bob', password: 'bob-pass-1' });
  const bob = cookieOf(login);
  expect((await send('POST', '/auth/password', { currentPassword: 'bob-pass-1', newPassword: 'bob-pass-2' }, bob)).statusCode).toBe(200);
  return { owner, bob };
}

const network = async (cookie: string) => (await send('GET', '/network', undefined, cookie)).json().data;
const ago = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

describe('OLT, card and PON port rows through the push route (Phase 20)', () => {
  it('stores device rows only in the token\'s organisation, matched against its own records', async () => {
    const { owner, bob } = await twoOrganisations();
    const hostSource = (await send('POST', '/monitoring/sources', { name: 'Host NMS', kind: 'push' }, owner)).json();
    const bSource = (await send('POST', '/monitoring/sources', { name: 'B NMS', kind: 'push' }, bob)).json();
    // The sample OLT-01 (serial HW-OLT-2024-8891) is on the first organisation's records only.
    const devices = [
      { target: 'pon_port', oltSerial: 'HW-OLT-2024-8891', portAddress: 'PON-01', deviceTime: ago(1), state: 'down', rawState: 'LOS', losCount: 12, onuTotal: 16 },
      { target: 'olt', oltSerial: 'HW-OLT-2024-8891', deviceTime: ago(1), state: 'up' },
    ];

    const fromB = await send('POST', '/monitoring/ingest', { devices }, undefined, { authorization: `Bearer ${bSource.token}` });
    expect(fromB.statusCode, fromB.body).toBe(200);
    expect(fromB.json().devices).toMatchObject({ stored: 2, matched: 0 });
    expect(fromB.json().devices.unmatched[0].reason).toMatch(/No OLT record has serial "HW-OLT-2024-8891"/);
    expect(fromB.json().alarmsRaised).toBe(0);
    const bData = await network(bob);
    expect(bData.deviceStatuses).toHaveLength(2);
    expect(bData.deviceStatuses.every((d: { oltId?: string; sourceId: string }) => !d.oltId && d.sourceId === bSource.source.id)).toBe(true);
    expect((await network(owner)).deviceStatuses).toEqual([]);

    const fromHost = await send('POST', '/monitoring/ingest', { devices }, undefined, { authorization: `Bearer ${hostSource.token}` });
    expect(fromHost.statusCode, fromHost.body).toBe(200);
    expect(fromHost.json().devices).toMatchObject({ stored: 2, matched: 2 });
    // A fresh "down" on a recorded PON port raises a device alarm on that port, here only.
    expect(fromHost.json().alarmsRaised).toBe(1);
    const hostData = await network(owner);
    expect(hostData.deviceStatuses.map((d: { ponPortId?: string; target: string }) => d.ponPortId ?? d.target).sort()).toEqual(['PON-01', 'olt']);
    const alarm = hostData.alarms.find((a: { kind: string }) => a.kind === 'pon_port_fault');
    expect(alarm).toMatchObject({ source: 'device_adapter', isTest: false, element: { type: 'pon_port', id: 'OLT-01', ponPortId: 'PON-01' }, monitoringSourceId: hostSource.source.id });
    expect((await network(bob)).alarms.some((a: { kind: string }) => a.kind === 'pon_port_fault')).toBe(false);

    // The same rows again are stored once; a logged-in session does not move a push to its own organisation.
    const again = await send('POST', '/monitoring/ingest', { devices }, bob, { authorization: `Bearer ${hostSource.token}` });
    expect(again.json().devices).toMatchObject({ stored: 0, duplicates: 2 });
    expect((await network(bob)).deviceStatuses).toHaveLength(2);
  });

  it('refuses a push with nothing in it, a bad token, and device rows written as an ordinary change', async () => {
    const { owner } = await twoOrganisations();
    const source = (await send('POST', '/monitoring/sources', { name: 'NMS', kind: 'push' }, owner)).json();
    const auth = { authorization: `Bearer ${source.token}` };
    expect((await send('POST', '/monitoring/ingest', { rows: [], devices: [] }, undefined, auth)).statusCode).toBe(400);
    expect((await send('POST', '/monitoring/ingest', { devices: [{ target: 'olt', oltId: 'OLT-01', deviceTime: ago(1), state: 'up' }] }, undefined, { authorization: 'Bearer fgm_wrong' })).statusCode).toBe(401);
    const skipped = await send('POST', '/monitoring/ingest', { devices: [{ target: 'olt', oltId: 'OLT-01', deviceTime: '2026-11-09 10:00', state: 'up' }] }, undefined, auth);
    expect(skipped.json().devices).toMatchObject({ stored: 0, skipped: [expect.objectContaining({ row: 1, reason: expect.stringContaining('time zone') })] });
    const row = {
      id: 'DV-FAKE',
      target: 'olt',
      oltId: 'OLT-01',
      matchedBy: 'olt_id',
      oltKey: 'OLT-01',
      origin: 'device_reported',
      sourceId: source.source.id,
      isTest: false,
      deviceTime: ago(1),
      receivedAt: ago(1),
      state: 'up',
    };
    const forged = await send('POST', '/changes', { upserts: { deviceStatuses: [row] } }, owner);
    expect(forged.statusCode).toBe(409);
    expect((await network(owner)).deviceStatuses).toEqual([]);
  });
});
