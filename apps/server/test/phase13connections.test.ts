import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { API_PREFIX, type LinkVerification, type NetworkResponse } from '@fibergis/shared';
import { createSampleNetwork } from '@fibergis/shared/sample';

import { buildApp } from '../src/app';
import { hashPassword } from '../src/auth/passwords';
import { loadConfig } from '../src/config';
import { seedSampleNetwork } from '../src/db/seed';
import { SqliteNetworkRepository } from '../src/db/sqliteRepository';
import { LINK_VERIFICATION_READS } from '../src/lib/targetedReads';

/** Network mapping Phase 13: checks of links and the connection index read on the server. */

vi.setConfig({ testTimeout: 60_000 });

let app: FastifyInstance;
let repository: SqliteNetworkRepository;

const api = (path: string) => `${API_PREFIX}${path}`;
const cookieOf = (response: LightMyRequestResponse) => String([response.headers['set-cookie']].flat()[0] ?? '').split(';')[0];
const send = (method: InjectOptions['method'], path: string, payload?: unknown, cookie?: string) =>
  app.inject({ method, url: api(path), ...(payload === undefined ? {} : { payload: payload as object }), headers: cookie ? { cookie } : {} });

beforeEach(async () => {
  const config = {
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

const sample = createSampleNetwork();
const closure = sample.closures.find((c) => c.splices.length > 0)!;
const spliceRecord = closure.splices[0];
const SPLICE_ID = `splice:${closure.id}:${spliceRecord.id}`;
const today = new Date().toISOString().slice(0, 10);
const CREATED = new Date().toISOString();

const check = (extra: Partial<LinkVerification> = {}): LinkVerification => ({
  id: 'LCK-S1',
  connectionId: SPLICE_ID,
  connectionLabel: 'splice',
  method: 'otdr',
  result: 'pass',
  checkedOn: today,
  technician: 'Asha',
  otdrRef: 'OTDR-0051.sor',
  photoIds: ['PHOTO-OTDR01'],
  createdAt: CREATED,
  ...extra,
});

describe('checks of links on the server', () => {
  it('stores a check with its evidence, and the connection read shows it', async () => {
    expect((await send('POST', '/changes', { upserts: { linkVerifications: [check()] } })).statusCode).toBe(200);
    const network = (await send('GET', '/network')).json<NetworkResponse>().data;
    expect(network.linkVerifications).toEqual([check()]);

    const read = await send('GET', `/connections?element=${encodeURIComponent(closure.id)}`);
    expect(read.statusCode).toBe(200);
    const body = read.json();
    expect(body.connections.length).toBe(closure.splices.length + (closure.terminations?.length ?? 0));
    const splice = body.connections.find((c: { id: string }) => c.id === SPLICE_ID);
    expect(splice).toMatchObject({ kind: 'splice', recordedIn: { collection: 'closures', recordId: closure.id }, check: { state: 'passed', hasEvidence: true, count: 1 } });
    expect(splice.checks[0]).toMatchObject({ otdrRef: 'OTDR-0051.sor', photoIds: ['PHOTO-OTDR01'] });
    // The other splices of the closure say "Not checked", never nothing.
    for (const other of body.connections.filter((c: { id: string }) => c.id !== SPLICE_ID)) expect(other.check.state).toBe('not_checked');

    const fibre = (await send('GET', `/connections?cable=${encodeURIComponent(spliceRecord.inputCableId)}&core=${spliceRecord.inputCore}`)).json();
    expect(fibre.connections.map((c: { id: string }) => c.id)).toContain(SPLICE_ID);
  });

  it('refuses broken checks and keeps a check of a link that is gone', async () => {
    const noReading = await send('POST', '/changes', { upserts: { linkVerifications: [check({ id: 'LCK-S2', method: 'power_reading' })] } });
    expect(noReading.statusCode).toBe(409);
    expect(noReading.json().message).toMatch(/needs the reading/);
    expect((await send('POST', '/changes', { upserts: { linkVerifications: [check({ id: 'LCK-S3', connectionId: 'guess' })] } })).statusCode).toBe(409);
    expect((await send('POST', '/changes', { upserts: { linkVerifications: [check({ id: 'LCK-S4', checkedOn: '2999-01-01' })] } })).statusCode).toBe(409);
    expect((await send('POST', '/changes', { upserts: { linkVerifications: [check({ id: 'LCK-S5', method: 'sniff' as never })] } })).statusCode).toBe(400);

    // Recorded offline before the splice record went: kept, listed apart, and nothing else is blocked.
    const gone = check({ id: 'LCK-S6', connectionId: `splice:${closure.id}:SPC-REMOVED` });
    expect((await send('POST', '/changes', { upserts: { linkVerifications: [gone] } })).statusCode).toBe(200);
    const body = (await send('GET', `/connections?element=${encodeURIComponent(closure.id)}`)).json();
    expect(body.checksOfLinksNotOnRecord.map((v: LinkVerification) => v.id)).toEqual(['LCK-S6']);
    expect(LINK_VERIFICATION_READS).toEqual([]);
  });

  it('asks for one element or one fibre', async () => {
    expect((await send('GET', '/connections')).statusCode).toBe(400);
    expect((await send('GET', '/connections?cable=X')).statusCode).toBe(400);
    expect((await send('GET', '/connections?element=A&cable=B&core=1')).statusCode).toBe(400);
    expect((await send('GET', '/connections?element=NOPE')).json().connections).toEqual([]);
  });

  it('hides customer names a role may not see, and lets a technician add checks but not change others', async () => {
    const admin = cookieOf(await send('POST', '/auth/setup', { username: 'owner', displayName: 'Owner', password: 'owner-pass-1' }));
    const passwordHash = await hashPassword('team-pass-1');
    repository.auth.create({ username: 'look', displayName: 'Look Only', role: 'viewer', passwordHash, mustChangePassword: false });
    repository.auth.create({ username: 'tech', displayName: 'Asha', role: 'technician', passwordHash, mustChangePassword: false });
    const viewer = cookieOf(await send('POST', '/auth/login', { username: 'look', password: 'team-pass-1' }));
    const tech = cookieOf(await send('POST', '/auth/login', { username: 'tech', password: 'team-pass-1' }));

    const named = sample.customers.find((c) => c.dropCableId && c.name)!;
    const forAdmin = (await send('GET', `/connections?element=${encodeURIComponent(named.id)}`, undefined, admin)).json();
    expect(JSON.stringify(forAdmin.connections)).toContain(named.name);
    const forViewer = await send('GET', `/connections?element=${encodeURIComponent(named.id)}`, undefined, viewer);
    expect(forViewer.statusCode).toBe(200);
    expect(forViewer.json().connections.length).toBe(forAdmin.connections.length);
    expect(JSON.stringify(forViewer.json())).not.toContain(named.name);
    expect((await send('GET', '/connections?element=X')).statusCode).toBe(401);

    // A viewer cannot record a check; a technician can, and cannot change one made by someone else.
    expect((await send('POST', '/changes', { upserts: { linkVerifications: [check({ id: 'LCK-V' })] } }, viewer)).statusCode).toBe(403);
    expect((await send('POST', '/changes', { upserts: { linkVerifications: [check({ id: 'LCK-ADMIN' })] } }, admin)).statusCode).toBe(200);
    expect((await send('POST', '/changes', { upserts: { linkVerifications: [check({ id: 'LCK-TECH' })] } }, tech)).statusCode).toBe(200);
    expect((await send('POST', '/changes', { upserts: { linkVerifications: [check({ id: 'LCK-TECH', result: 'fail' })] } }, tech)).statusCode).toBe(200);
    expect((await send('POST', '/changes', { upserts: { linkVerifications: [check({ id: 'LCK-ADMIN', result: 'fail' })] } }, tech)).statusCode).toBe(403);
  });

  it('refuses a restore that holds a broken check', async () => {
    const refused = await send('POST', '/restore', { linkVerifications: [check({ id: 'LCK-R', method: 'power_reading' })] });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ error: 'restore_refused', counts: { checks: 1 } });
  });
});
