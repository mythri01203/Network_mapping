import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { API_PREFIX, type NetworkResponse, type Ont } from '@fibergis/shared';

import { buildApp } from '../src/app';
import { type AppConfig, loadConfig } from '../src/config';
import { SqliteNetworkRepository } from '../src/db/sqliteRepository';

const api = (path: string) => `${API_PREFIX}${path}`;

let app: FastifyInstance;
let repository: SqliteNetworkRepository;

beforeEach(async () => {
  const config: AppConfig = {
    ...loadConfig({ LOG_LEVEL: 'silent', STATIC_DIR: join(tmpdir(), 'fibergis-no-static') }),
    databasePath: ':memory:',
    photosDir: join(mkdtempSync(join(tmpdir(), 'fibergis-photos-')), 'photos'),
    backupsDir: join(mkdtempSync(join(tmpdir(), 'fibergis-backups-')), 'backups'),
  };
  repository = new SqliteNetworkRepository(config.databasePath);
  app = await buildApp({ config, repository });
});
afterEach(async () => {
  await app.close();
  await repository.close();
});

const cookieOf = (response: LightMyRequestResponse) => {
  const header = response.headers['set-cookie'];
  const first = Array.isArray(header) ? header[0] : header;
  return first ? first.split(';')[0] : '';
};
const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, payload?: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method, url: api(path), ...(payload === undefined ? {} : { payload: payload as object }), headers });
const as = (cookie: string) => ({ cookie });
const network = async (cookie: string) => (await call('GET', '/network', undefined, as(cookie))).json() as NetworkResponse;

async function people() {
  const admin = cookieOf(await call('POST', '/auth/setup', { username: 'owner', displayName: 'Owner', password: 'owner-pass-1' }));
  const user = async (username: string, role: string) => {
    expect((await call('POST', '/users', { username, displayName: username, role, password: `${username}-pass-1` }, as(admin))).statusCode).toBe(201);
    const cookie = cookieOf(await call('POST', '/auth/login', { username, password: `${username}-pass-1` }));
    // A temporary password from the office is replaced first.
    expect((await call('POST', '/auth/password', { currentPassword: `${username}-pass-1`, newPassword: `${username}-pass-2` }, as(cookie))).statusCode).toBe(200);
    return cookie;
  };
  return { admin, engineer: await user('eng', 'engineer'), viewer: await user('view', 'viewer') };
}

const ont: Ont = { id: 'ONT-1', serialNumber: 'ZTEGC0FFEE01', onuAddress: 'gpon-onu_1/2/3:5', arrangement: 'single', status: 'installed', statusSource: 'person', createdAt: '2026-11-01T00:00:00.000Z' };
const now = () => new Date(Date.now() - 60_000).toISOString();

describe('live monitoring (Phase 7)', () => {
  it('lets only the administrator make sources and tokens, and the token only ingest', async () => {
    const { admin, engineer, viewer } = await people();
    expect((await call('POST', '/changes', { upserts: { onts: [ont] } }, as(admin))).statusCode).toBe(200);
    expect((await call('POST', '/monitoring/sources', { name: 'NMS', kind: 'push' }, as(viewer))).statusCode).toBe(403);
    expect((await call('POST', '/monitoring/sources', { name: 'NMS', kind: 'push' }, as(engineer))).statusCode).toBe(403);
    const made = await call('POST', '/monitoring/sources', { name: 'NMS', kind: 'push' }, as(admin));
    expect(made.statusCode).toBe(200);
    const { token, source } = made.json() as { token: string; source: { id: string } };
    expect(token).toMatch(/^fgm_/);

    const auth = { authorization: `Bearer ${token}` };
    expect((await call('POST', '/monitoring/ingest', { rows: [] }, { authorization: 'Bearer fgm_wrong' })).statusCode).toBe(401);
    expect((await call('GET', '/network', undefined, auth)).statusCode).toBe(401);
    expect((await call('POST', '/changes', { upserts: {} }, auth)).statusCode).toBe(401);

    const rows = [
      { onuAddress: 'gpon-onu_1/2/3:5', deviceTime: now(), state: 'los', ontRxDbm: -31.5, unit: 'dBm' },
      { serial: 'NOT-ON-RECORD', deviceTime: now(), state: 'online' },
      { serial: 'ZTEGC0FFEE01', deviceTime: now(), ontRxDbm: -20, unit: 'mW' },
      { serial: 'ZTEGC0FFEE01', deviceTime: '2026-11-09 10:00', state: 'online' },
    ];
    const first = await call('POST', '/monitoring/ingest', { rows }, auth);
    expect(first.statusCode).toBe(200);
    const result = first.json();
    expect(result).toMatchObject({ matched: 1, stored: { readings: 1, statuses: 2 }, alarmsRaised: 2, isTest: false });
    expect(result.unmatched).toEqual([expect.objectContaining({ row: 2, key: 'NOT-ON-RECORD' })]);
    expect(result.skipped.map((s: { reason: string }) => s.reason).join(' ')).toMatch(/mW.*time zone|time zone.*mW/);

    const again = (await call('POST', '/monitoring/ingest', { rows }, auth)).json();
    expect(again).toMatchObject({ duplicates: 3, stored: { readings: 0, statuses: 0 }, alarmsRaised: 0 });

    const net = await network(admin);
    expect(net.data.onuStatuses).toHaveLength(2);
    expect(net.data.onuStatuses.find((s) => !s.ontId)).toMatchObject({ matchedBy: 'none', unmatchedReason: expect.stringContaining('NOT-ON-RECORD') });
    const alarms = net.data.alarms;
    expect(alarms.map((a) => a.kind).sort()).toEqual(['low_power', 'ont_los']);
    expect(alarms.every((a) => a.source === 'device_adapter' && !a.isTest && a.monitoringSourceId === source.id && a.occurrences === 1)).toBe(true);
    expect(JSON.stringify(net)).not.toContain(token.slice(4));
    expect(JSON.stringify(await network(viewer))).not.toContain(token.slice(4));

    // Ordinary edits cannot write rows or make device alarms, but may acknowledge one.
    const fake = { ...net.data.onuStatuses[0], id: 'ST-FAKE' };
    expect((await call('POST', '/changes', { upserts: { onuStatuses: [fake] } }, as(admin))).statusCode).toBe(409);
    expect((await call('POST', '/changes', { upserts: { alarms: [{ ...alarms[0], id: 'ALM-FAKE' }] } }, as(admin))).statusCode).toBe(409);
    expect((await call('POST', '/changes', { upserts: { alarms: [{ ...alarms[0], source: 'manual' }] } }, as(admin))).statusCode).toBe(409);
    expect((await call('POST', '/changes', { upserts: { alarms: [{ ...alarms[0], state: 'acknowledged' }] } }, as(admin))).statusCode).toBe(200);

    expect((await call('DELETE', `/monitoring/sources/${source.id}/token`, undefined, as(admin))).statusCode).toBe(200);
    expect((await call('POST', '/monitoring/ingest', { rows }, auth)).statusCode).toBe(401);
  });

  it('keeps the TEST simulator off by default, TEST only, and apart from real counts', async () => {
    const { admin, engineer } = await people();
    await call('POST', '/changes', { upserts: { onts: [ont] } }, as(admin));
    const sim = (await call('POST', '/monitoring/sources', { name: 'simulator', kind: 'test_simulator' }, as(admin))).json().source;
    expect(sim).toMatchObject({ isTest: true, enabled: false, name: 'TEST simulator' });
    const row = { rows: [{ onuAddress: 'gpon-onu_1/2/3:5', deviceTime: now(), state: 'offline' }], sourceId: sim.id };
    expect((await call('POST', '/monitoring/simulate', row, as(admin))).statusCode).toBe(409);
    expect((await call('PATCH', `/monitoring/sources/${sim.id}`, { enabled: true }, as(engineer))).statusCode).toBe(403);
    expect((await call('PATCH', `/monitoring/sources/${sim.id}`, { enabled: true }, as(admin))).statusCode).toBe(200);
    expect((await call('POST', '/monitoring/simulate', row, as(engineer))).statusCode).toBe(403);
    const made = (await call('POST', '/monitoring/simulate', row, as(admin))).json();
    expect(made).toMatchObject({ isTest: true, alarmsRaised: 1 });
    const net = await network(admin);
    expect(net.data.onuStatuses[0]).toMatchObject({ isTest: true, origin: 'device_reported' });
    expect(net.data.alarms[0]).toMatchObject({ source: 'test', isTest: true, kind: 'ont_offline' });
  });

  it('imports a mapped file for engineers, with a dry run that stores nothing', async () => {
    const { admin, engineer, viewer } = await people();
    await call('POST', '/changes', { upserts: { onts: [ont] } }, as(admin));
    const file = (await call('POST', '/monitoring/sources', { name: 'OLT export', kind: 'file_import' }, as(admin))).json().source;
    const body = { sourceId: file.id, rows: [{ serial: 'ZTEGC0FFEE01', deviceTime: now(), ontRxDbm: '-19.4', unit: 'dBm' }], columnMapping: { serial: 'SN', deviceTime: 'Time', ontRx: 'Rx', defaultUnit: 'dBm' } };
    expect((await call('POST', '/monitoring/import', body, as(viewer))).statusCode).toBe(403);
    const dry = (await call('POST', '/monitoring/import', { ...body, dryRun: true }, as(engineer))).json();
    expect(dry).toMatchObject({ dryRun: true, matched: 1 });
    expect((await network(admin)).data.onuReadings).toHaveLength(0);
    expect((await call('POST', '/monitoring/import', body, as(engineer))).json()).toMatchObject({ dryRun: false, stored: { readings: 1 } });
    const net = await network(admin);
    expect(net.data.onuReadings[0]).toMatchObject({ ontId: 'ONT-1', matchedBy: 'serial', valueDbm: -19.4, rawValue: '-19.4' });
    expect(net.data.monitoringSources.find((s) => s.id === file.id)?.columnMapping).toMatchObject({ serial: 'SN' });
  });
});
