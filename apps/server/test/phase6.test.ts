import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { API_PREFIX, defaultRfPorts, type NetworkResponse, type RfElement, type RfLink } from '@fibergis/shared';

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
const post = (path: string, payload: unknown, cookie = '') =>
  app.inject({ method: 'POST', url: api(path), payload: payload as object, headers: cookie ? { cookie } : {} });
const send = (payload: object, cookie = '') => post('/changes', payload, cookie);

const el = (id: string, kind: RfElement['kind'], extra: Partial<RfElement> = {}): RfElement => ({
  id, name: id, kind, status: 'built', ports: defaultRfPorts(kind, { outputs: 2 }), createdAt: '2026-11-08T10:00:00.000Z', ...extra,
});
const link = (id: string, from: [string, string], to: [string, string], extra: Partial<RfLink> = {}): RfLink => ({
  id, from: { elementId: from[0], portId: from[1] }, to: { elementId: to[0], portId: to[1] }, medium: 'coax', status: 'active', createdAt: '2026-11-08T10:00:00.000Z', ...extra,
});

describe('Cable TV checks on the server (Phase 6)', () => {
  const amp = el('RF-AMP', 'rf_amplifier', { gainDb: 20 });
  const tap = el('RF-TAP', 'tap');
  const stb1 = el('RF-STB1', 'stb');
  const stb2 = el('RF-STB2', 'stb');

  it('stores a recorded tree, and refuses a second house wire on one tap port with 409', async () => {
    const ok = await send({ upserts: { rfElements: [amp, tap, stb1, stb2], rfLinks: [link('L1', ['RF-AMP', 'OUT1'], ['RF-TAP', 'IN']), link('L2', ['RF-TAP', 'DROP1'], ['RF-STB1', 'IN'])] } });
    expect(ok.statusCode).toBe(200);
    const twice = await send({ upserts: { rfLinks: [link('L3', ['RF-TAP', 'DROP1'], ['RF-STB2', 'IN'])] } });
    expect(twice.statusCode).toBe(409);
    expect(twice.json().message).toContain('One tap port takes one house wire');
    const network = (await app.inject({ method: 'GET', url: api('/network') })).json<NetworkResponse>();
    expect(network.data.rfLinks.map((l) => l.id)).toEqual(['L1', 'L2']);
  });

  it('refuses light into an RF port, a link from an input, a loop and a measured level with no source', async () => {
    const node = el('RF-NODE', 'mini_node', { powered: true });
    await send({ upserts: { rfElements: [amp, tap, node] } });
    const light = await send({ upserts: { rfLinks: [link('X1', ['RF-NODE', 'OPTIN'], ['RF-AMP', 'IN'], { medium: 'jumper' })] } });
    expect(light.statusCode).toBe(409);
    const loop = await send({ upserts: { rfLinks: [link('X2', ['RF-AMP', 'OUT1'], ['RF-TAP', 'IN']), link('X3', ['RF-TAP', 'OUT'], ['RF-AMP', 'IN'])] } });
    expect(loop.statusCode).toBe(409);
    expect(loop.json().message).toContain('loop');
    const level = { id: 'V1', elementId: 'RF-TAP', portId: 'DROP1', value: 70, unit: 'dBuV', origin: 'field_measured', frequencyMhz: 600, createdAt: '2026-11-08T10:00:00.000Z' };
    expect((await send({ upserts: { rfLevels: [level] } })).statusCode).toBe(409);
    expect((await send({ upserts: { rfLevels: [{ ...level, technician: 'Ravi' }] } })).statusCode).toBe(200);
  });

  it('lets a technician record a measured level with a meter photo, and nothing else', async () => {
    const setup = await post('/auth/setup', { username: 'owner', displayName: 'Owner', password: 'owner-pass-1' });
    const admin = cookieOf(setup);
    await send({ upserts: { rfElements: [tap] } }, admin);
    expect((await post('/users', { username: 'tech', displayName: 'Tech', role: 'technician', password: 'tech-pass-1' }, admin)).statusCode).toBe(201);
    const tech = cookieOf(await post('/auth/login', { username: 'tech', password: 'tech-pass-1' }));
    expect((await post('/auth/password', { currentPassword: 'tech-pass-1', newPassword: 'tech-pass-2' }, tech)).statusCode).toBe(200);
    const level = { id: 'V2', elementId: 'RF-TAP', portId: 'DROP1', value: 70, unit: 'dBuV', origin: 'field_measured', frequencyMhz: 600, technician: 'Tech', createdAt: '2026-11-08T10:00:00.000Z' };
    expect((await send({ upserts: { rfLevels: [level] } }, tech)).statusCode).toBe(403);
    expect((await send({ upserts: { rfLevels: [{ ...level, photoId: 'PHOTO-1' }] } }, tech)).statusCode).toBe(200);
    expect((await send({ upserts: { rfElements: [stb1] } }, tech)).statusCode).toBe(403);
  });
});
