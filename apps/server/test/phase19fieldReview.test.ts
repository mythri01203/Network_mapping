import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { API_PREFIX, buildCapturedEquipment, checklistSettingId, type Equipment, type NetworkResponse } from '@fibergis/shared';

import { buildApp } from '../src/app';
import { hashPassword } from '../src/auth/passwords';
import { type AppConfig, loadConfig } from '../src/config';
import { seedSampleNetwork } from '../src/db/seed';
import { SqliteNetworkRepository } from '../src/db/sqliteRepository';

/** Phase 19: field captures wait for the office review; checklists are checked like other lists. */

vi.setConfig({ testTimeout: 120_000 });

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
  app.inject({ method, url: `${API_PREFIX}${path}`, ...(payload === undefined ? {} : { payload: payload as object }), headers: cookie ? { cookie } : {} });

async function accounts() {
  const admin = cookieOf(await send('POST', '/auth/setup', { username: 'owner', displayName: 'Owner', password: 'owner-pass-1' }));
  const passwordHash = await hashPassword('team-pass-1');
  const cookies: Record<'admin' | 'technician' | 'office', string> = { admin, technician: '', office: '' };
  for (const role of ['technician', 'office'] as const) {
    repository.auth.create({ username: role, displayName: `${role} person`, role, passwordHash, mustChangePassword: false });
    cookies[role] = cookieOf(await send('POST', '/auth/login', { username: role, password: 'team-pass-1' }));
  }
  return cookies;
}

const capture = (): Equipment =>
  buildCapturedEquipment({
    kind: 'pole',
    id: 'POLE-P19REVIEW1',
    name: 'Pole-91',
    photoId: 'PH-P19REVIEW1',
    location: { lat: 12.9711, lng: 77.5951, method: 'gps_averaged', accuracyMeters: 4, sampleCount: 5, capturedAt: new Date().toISOString(), officeMustPlace: false },
    now: new Date(),
    capturedBy: 'technician person (phone capture)',
    ownerType: 'telecom',
    material: 'concrete',
  });

describe('Phase 19 field review on the server', () => {
  it('stores a capture as awaiting review, and only the office can accept it', async () => {
    const cookies = await accounts();
    const pole = capture();
    const added = await send('POST', '/changes', { upserts: { equipment: [pole] } }, cookies.technician);
    expect(added.statusCode, added.body).toBe(200);
    const stored = (await send('GET', '/network', undefined, cookies.office)).json<NetworkResponse>().data.equipment.find((e) => e.id === pole.id);
    expect(stored).toMatchObject({ reviewStatus: 'awaiting_review', status: 'Planned' });

    const accepted = { ...pole, reviewStatus: 'accepted' as const, status: 'Active' as const, reviewedBy: 'Asha', reviewedAt: new Date().toISOString() };
    const selfAccept = await send('POST', '/changes', { upserts: { equipment: [accepted] } }, cookies.technician);
    expect(selfAccept.statusCode).toBe(403);
    expect(selfAccept.json().message).toMatch(/Only the office accepts/);

    const byOffice = await send('POST', '/changes', { upserts: { equipment: [accepted] } }, cookies.office);
    expect(byOffice.statusCode, byOffice.body).toBe(200);
    // Once decided, the technician can no longer undo it.
    expect((await send('POST', '/changes', { deletes: { equipment: [pole.id] } }, cookies.technician)).statusCode).toBe(403);
  });

  it('checks inspection checklist settings like the other lists', async () => {
    const cookies = await accounts();
    const bad = await send('POST', '/changes', { upserts: { settings: [{ id: checklistSettingId('pole'), value: 'not json' }] } }, cookies.admin);
    expect(bad.statusCode).toBe(409);
    const good = await send(
      'POST',
      '/changes',
      { upserts: { settings: [{ id: checklistSettingId('box'), value: JSON.stringify({ added: [{ id: 'own.earth', label: 'Earth wire connected' }], labels: {}, hidden: ['box.labels'] }) }] } },
      cookies.admin,
    );
    expect(good.statusCode, good.body).toBe(200);
  });
});
