import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { API_PREFIX, type ChangeSet, importKml, type NetworkData, type NetworkResponse, planImportRollback, planKmlImport, previewKml } from '@fibergis/shared';

import { buildApp } from '../src/app';
import { hashPassword } from '../src/auth/passwords';
import { loadConfig } from '../src/config';
import { seedSampleNetwork } from '../src/db/seed';
import { SqliteNetworkRepository } from '../src/db/sqliteRepository';

/**
 * Network mapping Phase 21: an import is stored with its import record through `POST /changes`,
 * and undoing it goes through the same path, with the same permissions, links and version checks.
 */

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

const network = async () => (await send('GET', '/network')).json() as NetworkResponse;

/** The change set the app sends for one import: a pole far from the sample, a duct, and the import record. */
async function importChanges(actor = 'Office One', cookie?: string): Promise<{ changes: ChangeSet; poleId: string; ductId: string; importId: string }> {
  const data = (await send('GET', '/network', undefined, cookie)).json<NetworkResponse>().data as unknown as NetworkData;
  const preview = previewKml([
    { index: 0, folderPath: 'Poles', name: 'Imported pole', geometry: { type: 'Point', coordinates: [76.1, 10.1] }, extendedData: {} },
    { index: 1, folderPath: 'Ducts', name: 'Imported duct', geometry: { type: 'LineString', coordinates: [[76.2, 10.2], [76.201, 10.2]] }, extendedData: {} },
  ]);
  const [poles, ducts] = preview.groups;
  const plan = planKmlImport(data, preview, { [poles!.key]: { target: 'Telecom Pole', status: 'existing' }, [ducts!.key]: { target: 'duct', status: 'planned' } }, { fileName: 'route.geojson', format: 'geojson' });
  const result = importKml(data, plan, { actor });
  if (!result.ok) throw new Error(result.error.message);
  const changes: ChangeSet = { upserts: { equipment: plan.equipment, ducts: plan.ducts, imports: result.patch.imports!.slice(-1) } };
  return { changes, poleId: plan.equipment[0]!.id, ductId: plan.ducts[0]!.id, importId: plan.importId };
}

/** The undo as the app sends it, with the versions it last read. */
async function rollbackChanges(importId: string): Promise<ChangeSet> {
  const now = await network();
  const plan = planImportRollback(now.data as unknown as NetworkData, importId, { actor: 'Engineer' });
  if (!plan.ok) throw new Error(plan.message);
  const expect: NonNullable<ChangeSet['expect']> = {};
  for (const [collection, ids] of Object.entries(plan.changes.deletes ?? {})) {
    for (const id of ids as string[]) {
      const version = now.versions?.[collection as keyof NonNullable<ChangeSet['expect']>]?.[id];
      if (version !== undefined) (expect[collection as keyof typeof expect] ??= {})[id] = version;
    }
  }
  return { ...plan.changes, expect };
}

describe('import history and undo by import on the server', () => {
  it('stores the import record with what it made, and undoes exactly that', async () => {
    const { changes, poleId, ductId, importId } = await importChanges();
    expect((await send('POST', '/changes', changes)).statusCode).toBe(200);
    const after = await network();
    const record = after.data.imports.find((r) => r.id === importId)!;
    expect(record.created.map((c) => c.id).sort()).toEqual([ductId, poleId].sort());
    expect(record.format).toBe('geojson');

    const undo = await send('POST', '/changes', await rollbackChanges(importId));
    expect(undo.statusCode).toBe(200);
    const done = await network();
    expect(done.data.equipment.some((e) => e.id === poleId)).toBe(false);
    expect(done.data.ducts.some((d) => d.id === ductId)).toBe(false);
    expect(done.data.imports.find((r) => r.id === importId)).toMatchObject({ rolledBackBy: 'Engineer' });
    // The rest of the network is as it was.
    expect(done.data.equipment.length).toBe(after.data.equipment.length - 1);
  });

  it('never lets the history be rewritten, un-undone, or an undone import be deleted', async () => {
    const { changes, importId } = await importChanges();
    expect((await send('POST', '/changes', changes)).statusCode).toBe(200);
    const stored = (await network()).data.imports.find((r) => r.id === importId)!;
    const rewrite = await send('POST', '/changes', { upserts: { imports: [{ ...stored, importedBy: 'Someone else' }] } });
    expect(rewrite.statusCode).toBe(409);
    expect(rewrite.json().message).toMatch(/history/);

    expect((await send('POST', '/changes', await rollbackChanges(importId))).statusCode).toBe(200);
    const undone = (await network()).data.imports.find((r) => r.id === importId)!;
    const back = await send('POST', '/changes', { upserts: { imports: [{ ...stored }] } });
    expect(back.statusCode).toBe(409);
    expect((await send('POST', '/changes', { deletes: { imports: [undone.id] } })).statusCode).toBe(409);
  });

  it('refuses the undo when the pole was changed by someone else since it was read', async () => {
    const { changes, poleId, importId } = await importChanges();
    expect((await send('POST', '/changes', changes)).statusCode).toBe(200);
    const undo = await rollbackChanges(importId);
    const pole = (await network()).data.equipment.find((e) => e.id === poleId)!;
    expect((await send('POST', '/changes', { upserts: { equipment: [{ ...pole, notes: 'Checked in the field' }] } })).statusCode).toBe(200);
    const refused = await send('POST', '/changes', undo);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toBe('version_conflict');
    expect((await network()).data.equipment.some((e) => e.id === poleId)).toBe(true);
  });

  it('refuses deleting an imported pole that a later span uses, even from a direct call', async () => {
    const { changes, poleId, importId } = await importChanges();
    expect((await send('POST', '/changes', changes)).statusCode).toBe(200);
    const undo = await rollbackChanges(importId);
    const other = (await network()).data.equipment.find((e) => /pole/i.test(e.type) && e.id !== poleId)!;
    const span = { id: 'SPN-P21', name: 'Later span', fromStructureId: poleId, toStructureId: other.id, status: 'built', basis: 'office_drawn', createdAt: new Date().toISOString() };
    expect((await send('POST', '/changes', { upserts: { spans: [span] } })).statusCode).toBe(200);
    // The app's own check refuses first, in plain words.
    const plan = planImportRollback((await network()).data as unknown as NetworkData, importId);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.message).toMatch(/Later span/);
    // And the server refuses the same deletes if sent anyway.
    const { expect: _versions, ...unchecked } = undo;
    expect((await send('POST', '/changes', unchecked)).statusCode).toBe(409);
  });

  it('a planner may import; undo needs the right to delete network items', async () => {
    await send('POST', '/auth/setup', { username: 'owner', displayName: 'Owner', password: 'owner-pass-1' });
    const passwordHash = await hashPassword('team-pass-1');
    repository.auth.create({ username: 'plan', displayName: 'Planner', role: 'office', passwordHash, mustChangePassword: false });
    repository.auth.create({ username: 'eng', displayName: 'Engineer', role: 'engineer', passwordHash, mustChangePassword: false });
    repository.auth.create({ username: 'look', displayName: 'Look Only', role: 'viewer', passwordHash, mustChangePassword: false });
    const planner = cookieOf(await send('POST', '/auth/login', { username: 'plan', password: 'team-pass-1' }));
    const engineer = cookieOf(await send('POST', '/auth/login', { username: 'eng', password: 'team-pass-1' }));
    const viewer = cookieOf(await send('POST', '/auth/login', { username: 'look', password: 'team-pass-1' }));

    const first = await importChanges('Planner', planner);
    expect((await send('POST', '/changes', first.changes, viewer)).statusCode).toBe(403);
    expect((await send('POST', '/changes', first.changes, planner)).statusCode).toBe(200);
    const plan = planImportRollback((await send('GET', '/network', undefined, engineer)).json<NetworkResponse>().data as unknown as NetworkData, first.importId, { actor: 'Planner' });
    if (!plan.ok) throw new Error(plan.message);
    expect((await send('POST', '/changes', plan.changes, planner)).statusCode).toBe(403);
    expect((await send('POST', '/changes', plan.changes, engineer)).statusCode).toBe(200);
  });
});
