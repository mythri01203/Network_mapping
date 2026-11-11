/* eslint-disable no-console -- a command-line tool: printing to the terminal is its job. */
/**
 * DASAN V5808 poller: reads ONU status and light levels from the OLT by SNMP (SLE-GPON-MIB) and
 * pushes them to FiberGIS through the token-protected push endpoint. Run it on a computer that can
 * reach the OLT's management IP.
 *
 *   npm run poll:dasan -w @fibergis/server -- --check     read once and print, push nothing
 *   npm run poll:dasan -w @fibergis/server -- --once      read once and push
 *   npm run poll:dasan -w @fibergis/server                 keep polling every POLL_SECONDS
 *
 * Settings (environment):
 *   DASAN_HOST           OLT management IP (required)
 *   DASAN_COMMUNITY      SNMP read community (required; never printed)
 *   DASAN_SNMP_PORT      default 161
 *   DASAN_SNMP_VERSION   2c (default) or 1
 *   DASAN_RX_ENCODING    signed16 (default) or signed: how the OLT writes negative 0.1 dBm values
 *   DASAN_PON_STATUS     on: also send PON port status and ONU counts (column numbers less certain)
 *   FIBERGIS_URL         default http://127.0.0.1:5000
 *   FIBERGIS_TOKEN       push token from Live status, Sources (fgm_…; required unless --check)
 *   POLL_SECONDS         default 300
 */
import snmp, { type Session, type Varbind } from 'net-snmp';

import {
  indexOf,
  onuRows,
  type OnuValues,
  ponPortRows,
  type PushDeviceRow,
  type PushRow,
  type RxEncoding,
  SLE_GPON_OIDS,
} from './sleGpon';

const MAX_ROWS_PER_PUSH = 2000;

const env = process.env;
const args = new Set(process.argv.slice(2));
const check = args.has('--check');
const once = check || args.has('--once');

function need(name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    console.error(`Set ${name} first. See the top of src/monitoring/dasan/poller.ts.`);
    process.exit(2);
  }
  return value;
}

const host = need('DASAN_HOST');
const community = need('DASAN_COMMUNITY');
const token = check ? '' : need('FIBERGIS_TOKEN');
const baseUrl = (env.FIBERGIS_URL ?? 'http://127.0.0.1:5000').replace(/\/+$/, '');
const encoding: RxEncoding = env.DASAN_RX_ENCODING === 'signed' ? 'signed' : 'signed16';
const withPorts = env.DASAN_PON_STATUS === 'on';
const pollSeconds = Math.max(30, Number(env.POLL_SECONDS ?? 300) || 300);

function walk(session: Session, oid: string): Promise<Varbind[]> {
  return new Promise((resolve, reject) => {
    const found: Varbind[] = [];
    session.subtree(
      oid,
      20,
      (varbinds) => {
        for (const vb of varbinds) if (!snmp.isVarbindError(vb)) found.push(vb);
      },
      (error) => (error ? reject(error) : resolve(found)),
    );
  });
}

async function readOlt(): Promise<{
  onus: OnuValues[];
  ports: { oltId: number; status?: number; active?: number; inactive?: number }[];
}> {
  const session = snmp.createSession(host, community, {
    port: Number(env.DASAN_SNMP_PORT ?? 161) || 161,
    version: env.DASAN_SNMP_VERSION === '1' ? snmp.Version1 : snmp.Version2c,
    timeout: 5000,
    retries: 1,
  });
  session.on('error', (error) => console.error(`SNMP error: ${error.message}`));
  try {
    const onus = new Map<string, OnuValues>();
    const onuColumn = async (column: string, set: (o: OnuValues, v: Varbind['value']) => void) => {
      for (const vb of await walk(session, column)) {
        const idx = indexOf(vb.oid, column);
        if (!idx || idx.length < 2 || vb.value === null) continue;
        const key = `${idx[0]}.${idx[1]}`;
        const o = onus.get(key) ?? { oltId: idx[0], onuId: idx[1] };
        set(o, vb.value);
        onus.set(key, o);
      }
    };
    await onuColumn(SLE_GPON_OIDS.onuStatus, (o, v) => (o.status = typeof v === 'number' ? v : undefined));
    await onuColumn(
      SLE_GPON_OIDS.onuSerial,
      (o, v) => (o.serial = typeof v === 'number' || v === null ? undefined : v),
    );
    await onuColumn(SLE_GPON_OIDS.onuDeactiveReason, (o, v) => (o.reason = typeof v === 'number' ? v : undefined));
    await onuColumn(SLE_GPON_OIDS.onuRxPower, (o, v) => (o.rx = v ?? undefined));
    await onuColumn(SLE_GPON_OIDS.onuOltRxPower, (o, v) => (o.oltRx = v ?? undefined));

    const ports = new Map<number, { oltId: number; status?: number; active?: number; inactive?: number }>();
    if (withPorts) {
      const portColumn = async (column: string, key: 'status' | 'active' | 'inactive') => {
        for (const vb of await walk(session, column)) {
          const idx = indexOf(vb.oid, column);
          if (!idx || idx.length !== 1 || typeof vb.value !== 'number') continue;
          const p = ports.get(idx[0]) ?? { oltId: idx[0] };
          p[key] = vb.value;
          ports.set(idx[0], p);
        }
      };
      await portColumn(SLE_GPON_OIDS.oltStatus, 'status');
      await portColumn(SLE_GPON_OIDS.oltActiveOnus, 'active');
      await portColumn(SLE_GPON_OIDS.oltInactiveOnus, 'inactive');
    }
    return { onus: [...onus.values()], ports: [...ports.values()] };
  } finally {
    session.close();
  }
}

async function push(rows: PushRow[], devices: PushDeviceRow[]): Promise<void> {
  for (let i = 0; i < Math.max(rows.length, devices.length); i += MAX_ROWS_PER_PUSH) {
    const body = { rows: rows.slice(i, i + MAX_ROWS_PER_PUSH), devices: devices.slice(i, i + MAX_ROWS_PER_PUSH) };
    if (!body.rows.length && !body.devices.length) continue;
    const response = await fetch(`${baseUrl}/api/v1/monitoring/ingest`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        ...(body.rows.length ? { rows: body.rows } : {}),
        ...(body.devices.length ? { devices: body.devices } : {}),
      }),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`FiberGIS refused the push (HTTP ${response.status}): ${text.slice(0, 500)}`);
    console.log(`Pushed ${body.rows.length} ONU row(s) and ${body.devices.length} port row(s): ${text.slice(0, 400)}`);
  }
}

async function pollOnce(): Promise<void> {
  const polledAt = new Date();
  const { onus, ports } = await readOlt();
  const rows = onuRows(onus, polledAt, encoding);
  const devices = ponPortRows(ports, polledAt, { oltIp: host });
  const online = rows.filter((r) => r.state === 'online').length;
  console.log(
    `${polledAt.toISOString()} ${host}: ${rows.length} ONU(s), ${online} online${withPorts ? `, ${devices.length} PON port(s)` : ''}.`,
  );
  if (check) {
    console.log('Compare these with "show onu info" on the OLT before pushing (address, serial, Rx):');
    for (const r of rows.slice(0, 40))
      console.log(
        `  ${r.onuAddress}\t${r.serial ?? '-'}\t${r.rawState}\tONT Rx ${r.ontRxDbm ?? '-'}\tOLT Rx ${r.oltRxDbm ?? '-'}`,
      );
    if (rows.length > 40) console.log(`  … and ${rows.length - 40} more`);
    for (const d of devices)
      console.log(`  ${d.portAddress}\t${d.rawState}\t${d.onuOnline ?? '-'} of ${d.onuTotal ?? '-'} online`);
    if (rows.length === 0)
      console.log(
        'No ONUs read. Check the community, that SNMP is enabled on the OLT, and that this computer is allowed.',
      );
    return;
  }
  await push(rows, devices);
}

async function main(): Promise<void> {
  for (;;) {
    try {
      await pollOnce();
    } catch (error) {
      console.error(`Poll failed: ${(error as Error).message}`);
      if (once) process.exitCode = 1;
    }
    if (once) return;
    await new Promise((resolve) => setTimeout(resolve, pollSeconds * 1000));
  }
}

await main();
