// Workflow G (with I): Phase 7 live readings, end-to-end example B, on the temp server (setup mode, no sample data).
// Customer and ONT → "No live connection" before any source → admin makes a push source and token →
// readings pushed with a device time → customer panel shows measured Rx, status, time and source →
// CSV import with one unmatched row (listed, not guessed) → short stale setting → shown as stale →
// LOS pushed → device_adapter alarm → TEST simulator rows labelled TEST and left out of the counts.
// Ported from the scratch walkthrough mon-walk.mjs. Temp server on 127.0.0.1:5056 only (see e2e/run.mjs).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { api, BASE, finish, log, network, OUT, openApp, post, seed as storeSeed, sleep } from '../lib/harness.mjs';

const ago = (seconds) => new Date(Date.now() - seconds * 1000).toISOString();

// ---------------------------------------------------------------- seed: one OLT, one ONT, one customer
const LAT = 12.9352;
const LNG = 77.6245;
const pon = { id: 'PON-01', portNumber: 1, technology: 'GPON', status: 'Active', connectedCustomersCount: 0, opticsClass: 'GPON B+', opticsClassSource: 'Module label', vendorAddress: 'gpon 0/1/0' };
const olt = { id: 'OLT-1', name: 'OLT Main', type: 'OLT', category: 'Central Office', lat: LAT, lng: LNG, area: '', street: '', status: 'Active', images: [], installedDate: '', locationMethod: 'map_pick', technology: 'GPON', totalPorts: 1, ponPorts: [pon] };
const ADDRESS = 'gpon-onu_1/1/1:3';
const SERIAL = 'ZTEGC0FFEE01';
const ont = { id: 'ONT-1', serialNumber: SERIAL, onuAddress: ADDRESS, oltId: 'OLT-1', ponPortId: 'PON-01', arrangement: 'single', status: 'installed', statusSource: 'person', createdAt: ago(86400) };
const NAME = 'Walk Customer B';
const customer = {
  id: 'CUST-B1', name: NAME, mobile: '', address: 'Test street', area: 'Test Area', lat: LAT + 0.002, lng: LNG + 0.002, locationMethod: 'gps', serviceType: 'Fiber Broadband', plan: '',
  status: 'Active', installationDate: '2026-11-01', oltId: 'OLT-1', ponPort: 'PON-01', feederCableId: '', distributionCableId: '', terminalBoxId: '', splitterId: '', splitterOutputPort: 1,
  dropCableId: '', fiberCore: 1, ontSerialNumber: SERIAL, ontId: 'ONT-1', routerModel: '', ipAddress: '',
};
await storeSeed({ upserts: { equipment: [olt], onts: [ont], customers: [customer] } });

// ---------------------------------------------------------------- browser
const app = await openApp({ uiMode: null, geolocation: null, permissions: [], consoleErrors: true, waitMs: 3500 });
const { p, phone, shot, tapEl, tapId, tapText, closePanels } = app;
const has = (re) => app.hasRaw(re);
const textOf = (id) => app.testText(id);
const visible = (id, timeout = 8000) => p.waitForSelector(`[data-testid="${id}"]`, { visible: true, timeout }).then(() => true, () => false);
async function select(id, value) {
  const ok = await p.evaluate(
    (id, v) => {
      const el = [...document.querySelectorAll(`[data-testid="${id}"]`)].at(-1);
      if (!el) return false;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, v);
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    id,
    value,
  );
  if (!ok) log(`choose ${id}`, false, 'NOT FOUND');
  await sleep(300);
}
async function typeInto(id, value) {
  await p.evaluate((id) => document.querySelector(`[data-testid="${id}"]`)?.focus(), id);
  await p.keyboard.type(value);
  await sleep(200);
}
/** Finds the customer with the top search and opens their panel, as a person would. */
async function openCustomer() {
  await closePanels();
  let input = await p.$('input[aria-label="Search network"]');
  const shown = input && (await p.evaluate((e) => e.getBoundingClientRect().width > 0, input));
  if (!shown) {
    await p.evaluate(() => [...document.querySelectorAll('button')].find((x) => /search/i.test(x.getAttribute('aria-label') ?? ''))?.click());
    await sleep(400);
    input = await p.$('input[aria-label="Search network"]');
  }
  if (!input) return log('search for the customer', false, 'no search box');
  await input.click({ clickCount: 3 });
  await p.keyboard.type(NAME);
  await sleep(600);
  const hit = await tapEl('#global-search-results [role="option"], #global-search-results button, #global-search-results li', 'search result', { text: NAME });
  if (!hit) await p.keyboard.press('Enter');
  await sleep(800);
  const open = await p.evaluate(() => !!document.querySelector('aside[aria-label="Inspector"]'));
  if (phone && !open) await tapText('Details');
  await sleep(500);
  return visible('live-status');
}
/** Opens Live status from the menu (the phone's menu first). */
async function openLive(tab = 'overview') {
  await closePanels();
  if (phone) await tapText('Open menu');
  await tapEl('[aria-label="Primary"] button, [aria-label="Primary"] a', 'menu: Live status', { text: 'Live status' });
  await sleep(500);
  if (tab !== 'overview') await tapId(`mon-tab-${tab}`);
  return visible(`mon-tab-${tab}`);
}
/** Waits until the browser has the server's latest data (the app checks every 30 s; a reload is quicker). */
async function reloadApp() {
  await p.reload({ waitUntil: 'domcontentloaded' });
  await sleep(3500);
}
const count = async (state) => Number((await textOf(`mon-count-${state}`)).match(/\d+/)?.[0] ?? NaN);


// ---------------------------------------------------------------- 8 (first): no source yet
log('Live status opens from the menu', await openLive());
log('dashboard says "No live connection" before any source exists', (await textOf('mon-no-live')).includes('No live connection') && (await textOf('mon-no-live')).includes('No monitoring source'));
log('no customer is counted online without a source', (await count('online')) === 0 && (await count('no_data')) === 1);
await shot('1-no-source');
log('customer panel opens', await openCustomer());
log('customer panel says "No live connection" before any source', (await textOf('live-status')).includes('No live connection'));
log('ONT section still says online status is not known', await has('No live connection to the OLT, so online status is not known'));

// ---------------------------------------------------------------- 2: admin makes a push source and token
await openLive('sources');
log('Sources tab shows no source yet', await visible('mon-sources-none'));
await typeInto('mon-source-name', 'NMS push');
await select('mon-source-kind', 'push');
await tapId('mon-source-add');
await sleep(1200);
const token = (await textOf('mon-token')).trim();
log('push token shown once, starting fgm_', /^fgm_[A-Za-z0-9_-]{30,}$/.test(token), token ? `${token.slice(0, 6)}…` : 'none');
await shot('2-token');
const net1 = await network();
const pushSource = net1.monitoringSources.find((s) => s.kind === 'push');
log('source stored; the token is not in the network data', !!pushSource && !JSON.stringify(net1).includes(token.slice(4)));
log('the source list never gives the token back', !JSON.stringify((await api('/monitoring/sources')).body).includes(token.slice(4)));
await tapText('I have copied it');

// ---------------------------------------------------------------- 3: push readings with a device time
const ingest = (rows, t = token) => api('/monitoring/ingest', { method: 'POST', headers: { authorization: `Bearer ${t}` }, body: JSON.stringify({ rows }) });
const pushedAt = ago(90);
const first = await ingest([{ onuAddress: ADDRESS, deviceTime: pushedAt, state: 'online', ontRxDbm: -21.4, oltRxDbm: -24.8, unit: 'dBm', rawState: 'working' }]);
log('push accepted and matched by the ONU address', first.status === 200 && first.body?.matched === 1 && first.body?.stored?.readings === 2, JSON.stringify(first.body).slice(0, 120));
log('a wrong token is refused (401)', (await ingest([{ onuAddress: ADDRESS, deviceTime: ago(5), state: 'online' }], 'fgm_not-a-real-token-123456789012345')).status === 401);
const repeat = await ingest([{ onuAddress: ADDRESS, deviceTime: pushedAt, state: 'online', ontRxDbm: -21.4, oltRxDbm: -24.8, unit: 'dBm', rawState: 'working' }]);
log('the same rows again are not stored twice', repeat.body?.duplicates === 3 && repeat.body?.stored?.statuses === 0);
await reloadApp();
await openCustomer();
const live = await textOf('live-status');
log('customer panel: status Online, marked Live, with the source', (await textOf('live-status-state')).startsWith('Online') && /Live · .* · NMS push/.test(await textOf('live-status-note')), (await textOf('live-status-note')).slice(0, 80));
log('customer panel: measured Rx -21.4 dBm with its time and source', (await textOf('live-rx')).includes('-21.4 dBm (Measured)') && (await textOf('live-rx-note')).includes('NMS push'));
log('customer panel: OLT upstream Rx shown apart', live.includes('-24.8 dBm'));
log('customer panel: device time shown', /device time/.test(await textOf('live-status-note')));
log('measured Rx is compared with the records (reconciliation uses the device reading)', (await textOf('rx-check-finding')).includes('-21.4'), (await textOf('rx-check-finding')).slice(0, 90));
log('status history lists the row with the vendor word', (await textOf('live-status-history')).includes('"working"'));
await shot('3-customer-live');
await openLive();
log('dashboard says Live and counts the customer online', (await visible('mon-live')) && (await count('online')) === 1);

// ---------------------------------------------------------------- 4: CSV import with one unmatched row
await openLive('sources');
await typeInto('mon-source-name', 'OLT export file');
await select('mon-source-kind', 'file_import');
await tapId('mon-source-add');
await sleep(1200);
const fileSource = (await network()).monitoringSources.find((s) => s.kind === 'file_import');
log('file import source added', !!fileSource);
const importAt = ago(60);
const csvPath = join(OUT, 'export.csv');
writeFileSync(csvPath, `ONT SN,Read at,Rx (dBm),State\n${SERIAL},${importAt},-21.0,Up\nZTEG99999999,${importAt},-19.5,Up\n${SERIAL},,-20.0,Up\n`);
await openLive('import');
await select('mon-import-source', fileSource?.id ?? '');
const fileInput = await p.$('[data-testid="mon-import-file"]');
if (fileInput) await fileInput.uploadFile(csvPath);
else log('file chooser shown', false, 'NOT FOUND');
await sleep(800);
await select('mon-map-serial', 'ONT SN');
await select('mon-map-deviceTime', 'Read at');
await select('mon-map-ontRx', 'Rx (dBm)');
await select('mon-map-status', 'State');
await tapId('mon-map-dbm');
await select('mon-word-Up', 'online');
await tapId('mon-import-preview');
await sleep(1200);
const summary = await textOf('mon-import-summary');
log('preview: 1 matches, 1 not matched, 1 skipped, nothing stored yet', /Preview/.test(summary) && /1 row\(s\) match/.test(summary) && /1 not matched/.test(summary) && /1 skipped/.test(summary), summary.slice(0, 120));
log('preview lists the unmatched serial with the reason', (await textOf('mon-import-unmatched')).includes('ZTEG99999999') && (await textOf('mon-import-unmatched')).includes('No ONT record'));
log('preview says why a row was skipped', (await textOf('mon-import-skipped')).includes('No device time'));
log('nothing stored by the preview', (await network()).onuReadings.length === 2);
await shot('4-import-preview');
await tapId('mon-import-go');
await sleep(1500);
log('import done', (await textOf('mon-import-summary')).startsWith('Imported'));
const net4 = await network();
const unmatchedRow = net4.onuReadings.find((r) => r.serial === 'ZTEG99999999');
log('unmatched row kept with no ONT (not guessed)', !!unmatchedRow && !unmatchedRow.ontId && unmatchedRow.matchedBy === 'none');
log('the column mapping is saved on the source', net4.monitoringSources.find((s) => s.id === fileSource?.id)?.columnMapping?.serial === 'ONT SN');
await openLive('unmatched');
log('Not matched tab lists the row', (await textOf('mon-unmatched')).includes('ZTEG99999999'));

// ---------------------------------------------------------------- 5: a short stale setting
const setting = (id, value) => ({ id, value, updatedAt: new Date().toISOString(), updatedBy: 'walk' });
await post({ upserts: { settings: [setting('monitoring.statusStaleMinutes', 1), setting('monitoring.readingStaleMinutes', 1)] } });
const wait = 66_000 - (Date.now() - Date.parse(importAt));
if (wait > 0) await sleep(wait);
await reloadApp();
await openCustomer();
log('customer status shown as stale, not current', /stale/i.test(await textOf('live-status-state')) && (await textOf('live-status-note')).startsWith('Stale'), (await textOf('live-status-state')).slice(0, 60));
log('customer Rx shown as stale', (await textOf('live-rx')).includes('Measured, stale'));
await shot('5-stale');
await openLive();
log('dashboard: no longer Live, customer counted stale not online', (await visible('mon-no-live')) && (await count('stale')) === 1 && (await count('online')) === 0);

// ---------------------------------------------------------------- 6: LOS raises a device_adapter alarm
const losRow = { serial: SERIAL, deviceTime: ago(5), state: 'los', rawState: 'LOS' };
const los = await ingest([losRow]);
log('LOS pushed, one alarm raised', los.status === 200 && los.body?.alarmsRaised === 1);
const alarms = (await network()).alarms;
const a = alarms.find((x) => x.kind === 'ont_los');
log('alarm is device_adapter, real, on the customer, naming the source and row', a?.source === 'device_adapter' && !a.isTest && a.element?.id === 'CUST-B1' && a.monitoringSourceId === pushSource?.id && a.evidenceIds?.length === 1);
const losAgain = await ingest([losRow]);
const alarmsAgain = (await network()).alarms;
log('the same LOS row sent again adds no row and no alarm', losAgain.body?.duplicates === 1 && losAgain.body?.alarmsRaised === 0 && alarmsAgain.length === alarms.length);
const losLater = await ingest([{ ...losRow, deviceTime: ago(2) }]);
const counted = (await network()).alarms.find((x) => x.id === a?.id);
log('a later LOS while the alarm is open counts it again, no second alarm', losLater.body?.stored?.statuses === 1 && counted?.occurrences === 2 && (await network()).alarms.length === alarms.length);
await reloadApp();
await openCustomer();
log('customer panel shows LOS, Live', (await textOf('live-status-state')).startsWith('LOS') && (await textOf('live-status-note')).startsWith('Live'));
await p.goto(`${BASE}/operations`, { waitUntil: 'domcontentloaded' });
await sleep(2500);
await tapId('ops-open-faults');
await visible('alarm-row');
const row = await textOf('alarm-row');
log('fault center lists the LOS alarm from the monitoring source', row.includes('LOS') && row.includes('Reported by a monitoring source'), row.slice(0, 100));
log('fault center no longer claims no device connection', (await visible('monitoring-source-note', 4000)) && !(await has('None comes from a device')));
await shot('6-alarm');
await closePanels();

// ---------------------------------------------------------------- 7: TEST simulator, apart from counts
await post({ deletes: { settings: ['monitoring.statusStaleMinutes', 'monitoring.readingStaleMinutes'] } });
await reloadApp();
await openLive();
const before = { los: await count('los'), offline: await count('offline'), online: await count('online') };
log('before TEST: the real LOS is counted', before.los === 1, JSON.stringify(before));
await openLive('test');
log('TEST simulator is off until the administrator adds it', await visible('mon-sim-none'));
await tapId('mon-tab-sources');
await typeInto('mon-source-name', 'simulator');
await select('mon-source-kind', 'test_simulator');
await tapId('mon-source-add');
await sleep(1200);
const sim = (await network()).monitoringSources.find((s) => s.kind === 'test_simulator');
log('TEST source is named TEST and starts switched off', !!sim && sim.isTest && !sim.enabled && /TEST/.test(sim.name));
log('the simulator refuses while off', (await api('/monitoring/simulate', { method: 'POST', body: JSON.stringify({ sourceId: sim?.id, rows: [{ serial: SERIAL, deviceTime: ago(2), state: 'offline' }] }) })).status === 409);
await tapId(`mon-source-toggle-${sim?.id}`);
await sleep(1200);
await tapId('mon-tab-test');
await select('mon-sim-ont', 'ONT-1');
await select('mon-sim-state', 'offline');
await typeInto('mon-sim-rx', '-30.5');
await tapId('mon-sim-send');
await sleep(1500);
const net7 = await network();
const testRows = [...net7.onuStatuses, ...net7.onuReadings].filter((r) => r.isTest);
log('TEST rows stored as TEST, from the simulator only', testRows.length === 2 && testRows.every((r) => r.sourceId === sim?.id && r.origin === 'device_reported'));
const testAlarms = net7.alarms.filter((x) => x.isTest);
log('TEST rows raise only TEST alarms', testAlarms.length >= 1 && testAlarms.every((x) => x.source === 'test') && net7.alarms.filter((x) => x.source === 'device_adapter').every((x) => !x.isTest));
await reloadApp();
await openLive();
const after = { los: await count('los'), offline: await count('offline'), online: await count('online') };
log('TEST data is left out of the dashboard counts', JSON.stringify(after) === JSON.stringify(before), JSON.stringify(after));
log('dashboard says how many TEST rows were kept apart', /2 TEST row\(s\) kept apart/.test(await textOf('mon-test-note')));
log('TEST rows do not make the dashboard Live on their own (real LOS is)', await visible('mon-live'));
await openCustomer();
log('customer panel shows the TEST status apart, marked TEST', (await textOf('live-test-status')).includes('TEST: Offline') && (await textOf('live-status-state')).startsWith('LOS'));
log('status history marks the TEST row', (await textOf('live-status-history')).includes('TEST · Offline'));
await shot('7-test');

// ---------------------------------------------------------------- done
await finish({ app, errorsAreFailures: true });
