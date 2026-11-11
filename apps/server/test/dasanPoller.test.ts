import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { API_PREFIX, type NetworkResponse } from '@fibergis/shared';
import { createVijayawadaNetwork, vijayawadaRecordIds } from '@fibergis/shared/sample';

import { buildApp } from '../src/app';
import { type AppConfig, loadConfig } from '../src/config';
import { SqliteNetworkRepository } from '../src/db/sqliteRepository';
import { changeSetGuard } from '../src/lib/linkGuard';
import { decodeSerial, decodeTenthDbm, indexOf, onuRows, onuState, ponPortRows, SLE_GPON_OIDS } from '../src/monitoring/dasan/sleGpon';

describe('DASAN SLE-GPON-MIB mapping', () => {
  it('reads the OLT and ONU numbers from the SNMP index', () => {
    expect(indexOf(`${SLE_GPON_OIDS.onuRxPower}.3.17`, SLE_GPON_OIDS.onuRxPower)).toEqual([3, 17]);
    expect(indexOf(`${SLE_GPON_OIDS.onuStatus}.3.17`, SLE_GPON_OIDS.onuRxPower)).toBeUndefined();
  });

  it('writes the serial as show onu info prints it', () => {
    expect(decodeSerial(Buffer.from([0x43, 0x49, 0x47, 0x47, 0xb3, 0x19, 0x00, 0x15]))).toBe('CIGGb3190015');
    expect(decodeSerial('DSNW3a1f0001')).toBe('DSNW3a1f0001');
    expect(decodeSerial(undefined)).toBeUndefined();
  });

  it('turns 0.1 dBm values into dBm and never invents a level', () => {
    expect(decodeTenthDbm(65351)).toBe(-18.5);
    expect(decodeTenthDbm(-185, 'signed')).toBe(-18.5);
    expect(decodeTenthDbm('-21.3 dBm')).toBe(-21.3);
    expect(decodeTenthDbm(0)).toBeUndefined();
    expect(decodeTenthDbm(65535)).toBeUndefined();
    expect(decodeTenthDbm('')).toBeUndefined();
  });

  it('maps only what the OLT said', () => {
    expect(onuState(3, 1)).toBe('online');
    expect(onuState(1, 2)).toBe('dying_gasp');
    expect(onuState(1, 100)).toBe('los');
    expect(onuState(1, 3)).toBe('los');
    expect(onuState(7, 1)).toBe('offline');
    expect(onuState(255, undefined)).toBe('unknown');
    expect(onuState(undefined, undefined)).toBe('unknown');
  });

  it('sends no level for an ONU that is not running', () => {
    const at = new Date('2026-11-11T10:00:00Z');
    const [row] = onuRows([{ oltId: 1, onuId: 4, status: 1, reason: 100, rx: 65351, serial: 'DSNW00000001' }], at);
    expect(row).toMatchObject({ onuAddress: '1/4', state: 'los', rawState: 'inactive (los)' });
    expect(row.ontRxDbm).toBeUndefined();
    expect(row.unit).toBeUndefined();
    expect(row.deviceTime).toMatch(/[+-]\d\d:\d\d$/);
  });
});

describe('DASAN poller rows reach the Vijayawada demo ONTs', () => {
  let app: FastifyInstance;
  let repository: SqliteNetworkRepository;
  const call = (method: 'GET' | 'POST', path: string, payload?: unknown, headers: Record<string, string> = {}) =>
    app.inject({ method, url: `${API_PREFIX}${path}`, ...(payload === undefined ? {} : { payload: payload as object }), headers });
  const cookieOf = (r: LightMyRequestResponse) => String([r.headers['set-cookie']].flat()[0] ?? '').split(';')[0];

  beforeAll(async () => {
    const config: AppConfig = {
      ...loadConfig({ LOG_LEVEL: 'silent', STATIC_DIR: join(tmpdir(), 'fibergis-no-static'), SEED_SAMPLE_DATA: 'false' }),
      databasePath: ':memory:',
      photosDir: join(mkdtempSync(join(tmpdir(), 'fibergis-photos-')), 'photos'),
      backupsDir: join(mkdtempSync(join(tmpdir(), 'fibergis-backups-')), 'backups'),
    };
    repository = new SqliteNetworkRepository(config.databasePath);
    app = await buildApp({ config, repository });
  }, 60_000);
  afterAll(async () => {
    await app.close();
    await repository.close();
  });

  it('stores the demo through the server checks, matches polled rows, and removes it again', async () => {
    const built = createVijayawadaNetwork();
    const changes = { upserts: built.records };
    await repository.applyChanges(changes, changeSetGuard(changes));

    const admin = cookieOf(await call('POST', '/auth/setup', { username: 'owner', displayName: 'Owner', password: 'owner-pass-1' }));
    const made = (await call('POST', '/monitoring/sources', { name: 'DASAN V5808 poller', kind: 'push' }, { cookie: admin })).json() as { token: string };

    const net = (await call('GET', '/network', undefined, { cookie: admin })).json() as NetworkResponse;
    const onts = net.data.onts.filter((o) => o.onuAddress?.startsWith('1/')).slice(0, 3);
    expect(onts).toHaveLength(3);
    const polled = onts.map((o) => {
      const [oltId, onuId] = o.onuAddress!.split('/').map(Number);
      const hex = o.serialNumber!.slice(4);
      return { oltId, onuId, status: 3, reason: 1, serial: Buffer.concat([Buffer.from('DSNW'), Buffer.from(hex, 'hex')]), rx: 65351, oltRx: 65323 };
    });
    const at = new Date(Date.now() - 60_000);
    const rows = onuRows(polled, at);
    const devices = ponPortRows([{ oltId: 1, status: 3, active: 63, inactive: 0 }], at, { oltIp: '10.20.0.11' });
    const pushed = await call('POST', '/monitoring/ingest', { rows, devices }, { authorization: `Bearer ${made.token}` });
    expect(pushed.statusCode).toBe(200);
    expect(pushed.json()).toMatchObject({ matched: 3, unmatched: [] });

    const after = (await call('GET', '/network', undefined, { cookie: admin })).json() as NetworkResponse;
    const readings = after.data.onuReadings.filter((r) => onts.some((o) => o.id === r.ontId));
    expect(readings.find((r) => r.direction === 'ont_rx')).toMatchObject({ valueDbm: -18.5 });
    expect(after.data.deviceStatuses.find((d) => d.portAddress === 'gpon-olt 1')).toMatchObject({ state: 'up', onuOnline: 63, oltId: 'VJA-OLT-01' });

    const deletes = vijayawadaRecordIds(after.data);
    const removal = { deletes };
    await repository.applyChanges(removal, changeSetGuard(removal));
    const left = (await call('GET', '/network', undefined, { cookie: admin })).json() as NetworkResponse;
    expect(left.data.customers).toHaveLength(0);
    expect(left.data.equipment).toHaveLength(0);
    expect(left.data.cables).toHaveLength(0);
  }, 120_000);
});
