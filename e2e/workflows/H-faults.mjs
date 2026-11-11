// Workflow H (with G): Phase 8 faults, impact from recorded paths and field jobs, on the temp server.
// Example C: a TEST LOS event on 5 of a splitter's 6 customers → suspected splitter with evidence and
// confidence → fault with affected customers from recorded paths (and one "may be affected") →
// closing without a check is refused (screen and server) → work order → technician's job on a
// phone with photos, a step, material and a field light reading → office closes it → history.
// Example E: two browser contexts edit one work order, the phone offline; back online the phone
// shows "Someone else changed this", both versions are kept, the office decides.
// Ported from the scratch walkthrough fault-walk.mjs. Temp server on 127.0.0.1:5056 only (see e2e/run.mjs).
import { join } from 'node:path';

import { BASE, finish, log, makePhoto, MODE, network, OUT, openApp, phone, post, seed as storeSeed, sleep, W, H } from '../lib/harness.mjs';

// ---------------------------------------------------------------- seed (temp server only)
const LAT = 12.9352;
const LNG = 77.6245;
const NOW = '2026-11-07T09:00:00.000Z';
const eq = (id, name, type, category, lat, lng, extra = {}) => ({ id, name, type, category, lat, lng, area: '', street: '', status: 'Active', images: [], installedDate: '', locationMethod: 'map_pick', ...extra });
const cores = (n) => Array.from({ length: n }, (_, i) => ({ coreNumber: i + 1, status: 'Available' }));
const tia = { colorScheme: 'tia-598', tubeColorScheme: 'tia-598', fibersPerTube: 12 };
const cab = (id, name, type, fiberCount, from, to, coords, lengthMeters, extra = {}) => ({ id, name, type, fiberCount, lengthMeters, owner: '', installationDate: '', status: 'Active', coordinates: coords, startEquipmentId: from, endEquipmentId: to, cores: cores(fiberCount), cableCategory: 'Fiber', ...extra });
const P = { olt: [LAT, LNG], odf: [LAT, LNG + 0.0004], jc: [LAT + 0.0012, LNG + 0.0016], fat: [LAT + 0.0016, LNG + 0.0028] };
const pon = { id: 'PON-01', portNumber: 1, technology: 'GPON', status: 'Active', connectedCustomersCount: 0, opticsClass: 'GPON B+', vendorAddress: 'gpon 0/1/0', txPowerDbm: 3 };
const HOMES = [1, 2, 3, 4, 5, 6].map((n) => ({ n, id: `C-${n}`, name: `Home ${n}`, lat: P.fat[0] + 0.0002 * n, lng: P.fat[1] + 0.0003 }));
const customer = (h, extra = {}) => ({
  id: h.id, name: h.name, mobile: '', address: '', area: 'Koramangala', lat: h.lat, lng: h.lng, serviceType: 'Fiber Broadband', plan: '', status: 'Active', installationDate: '',
  oltId: 'OLT-1', ponPort: 'PON-01', feederCableId: 'FDR-1', distributionCableId: 'DST-1', terminalBoxId: 'FAT-1', splitterId: 'SPL-2', splitterOutputPort: h.n,
  dropCableId: `DRP-${h.n}`, fiberCore: 1, ontSerialNumber: '', routerModel: '', ipAddress: '', ...extra,
});
const seed = {
  upserts: {
    equipment: [
      eq('OLT-1', 'OLT Main', 'OLT', 'Central Office', ...P.olt, { technology: 'GPON', totalPorts: 1, ponPorts: [pon] }),
      eq('ODF-1', 'ODF Main', 'ODF', 'Central Office', ...P.odf, {
        odfPanels: [{ id: 'ODP-1', label: 'Panel A', ports: [{ id: 'ODX-3', number: 3, status: 'in_use', feederCableId: 'FDR-1', feederCore: 3, patch: { oltId: 'OLT-1', ponPortId: 'PON-01', patchedAt: NOW } }] }],
      }),
      eq('JC-1', 'Joint 1', 'Fiber Joint Closure', 'Fiber Distribution', ...P.jc),
      eq('FAT-1', 'Box 1', 'FAT', 'Fiber Distribution', ...P.fat, { totalPorts: 8 }),
    ],
    cables: [
      cab('FDR-1', 'Feeder A', 'Main Feeder Fiber', 24, 'ODF-1', 'JC-1', [P.odf, P.jc], 210, tia),
      cab('DST-1', 'Street B', 'Distribution Fiber', 12, 'JC-1', 'FAT-1', [P.jc, P.fat], 150, tia),
      ...HOMES.map((h) => cab(`DRP-${h.n}`, `House wire ${h.n}`, 'Drop Fiber', 2, 'FAT-1', h.id, [P.fat, [h.lat, h.lng]], 40)),
    ],
    closures: [
      {
        id: 'CLO-1', name: 'Joint 1', closureType: 'Dome Splice Closure', lat: P.jc[0], lng: P.jc[1], area: '', entryPortsCount: 1, exitPortsCount: 1, installationDate: '', technician: '', images: [], equipmentId: 'JC-1',
        trays: [{ id: 'TRY-1', label: 'Tray 1' }],
        cableEntries: [{ cableId: 'FDR-1', role: 'in' }, { cableId: 'DST-1', role: 'out' }],
        splices: [{ id: 'SPC-1', inputCableId: 'FDR-1', inputCableName: 'Feeder A', inputCore: 3, outputCableId: 'DST-1', outputCableName: 'Street B', outputCore: 3, status: 'Spliced', technician: '', date: '2026-11-07', trayId: 'TRY-1', spliceType: 'fusion' }],
      },
    ],
    splitters: [
      {
        id: 'SPL-2', name: 'Splitter 2', terminalBoxId: 'FAT-1', ratio: '1:8', insertionLossDb: 10.4, lossSource: 'Settings default (proposed)', kind: 'PLC', status: 'Active',
        inputPort: { id: 'SPL-2-IN', connectedCableId: 'DST-1', connectedCore: 3, linkedAt: NOW },
        outputPorts: Array.from({ length: 8 }, (_, i) => {
          const h = HOMES[i];
          return h ? { portNumber: i + 1, label: `OUT-0${i + 1}`, status: 'Occupied', connectedCustomerId: h.id, connectedDropCableId: `DRP-${h.n}`, connectedCore: 1 } : { portNumber: i + 1, label: `OUT-0${i + 1}`, status: 'Available' };
        }),
      },
    ],
    customers: [
      ...HOMES.map((h) => customer(h)),
      // Recorded on the splitter, but no house wire recorded: "may be affected, path not fully recorded".
      customer({ n: 7, id: 'C-7', name: 'Home 7', lat: P.fat[0] + 0.0016, lng: P.fat[1] + 0.0003 }, { splitterOutputPort: 7, dropCableId: '', fiberCore: 0 }),
    ],
    // A second job for example E.
    workOrders: [
      { id: 'WO-E1', title: 'Inspect Box 1 route', type: 'Inspection', priority: 'Medium', status: 'Assigned', technicianName: 'Ravi Kumar', technicianPhone: '', equipmentId: 'FAT-1', scheduledDate: '2026-11-07', notes: '', photos: [], steps: [{ id: 'STP-E1', label: 'Look at the box and its cables' }], photoRefs: [], materials: [], fieldNotes: [], fieldEvents: [], history: [] },
    ],
  },
};
await storeSeed(seed);

// ---------------------------------------------------------------- browsers (office and technician, two profiles)
const pageOptions = { uiMode: null, newContext: true, goto: false, consoleErrors: true, permissions: ['geolocation', 'camera'], geolocation: { latitude: P.fat[0], longitude: P.fat[1], accuracy: 5 }, launchArgs: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] };
const office = await openApp({ ...pageOptions, tag: 'office', viewport: { width: W, height: H, isMobile: phone, hasTouch: phone } });
const o = office.p;
const PHOTO_FILE = await makePhoto('fault-photo.jpg', { text: 'meter -19.20 dBm' });
const tech = await openApp({ ...pageOptions, tag: 'phone', viewport: { width: 360, height: 740, isMobile: true, hasTouch: true } });
const t = tech.p;

const has = (page, re) => page.evaluate((s) => new RegExp(s, 'i').test(document.body.innerText), re);
const visible = (page, testId, timeout = 15000) => page.waitForSelector(`[data-testid="${testId}"]`, { visible: true, timeout }).then(() => true, () => false);
const textOf = (page, testId) => page.evaluate((id) => [...document.querySelectorAll(`[data-testid="${id}"]`)].map((e) => e.innerText).join(' | '), testId);
const count = (page, testId) => page.evaluate((id) => document.querySelectorAll(`[data-testid="${id}"]`).length, testId);
let shots = 0;
const shot = (page, name) => page.screenshot({ path: join(OUT, `H-faults-${MODE}-${name}.png`) });

/** Taps like a finger after checking the target is on screen, not covered and big enough on a phone. */
async function tap(page, testId, { nth = -1, text, minSize = 0, label } = {}) {
  const name = label ?? testId;
  if (!(await visible(page, testId))) {
    log(`tap ${name}`, false, 'NOT FOUND');
    return false;
  }
  const info = await page.evaluate(
    (id, nth, text) => {
      let all = [...document.querySelectorAll(`[data-testid="${id}"]`)].filter((e) => e.getBoundingClientRect().width > 0);
      if (text) all = all.filter((e) => e.innerText.includes(text));
      const e = nth < 0 ? all.at(nth) : all[nth];
      if (!e) return null;
      e.scrollIntoView({ block: 'center', inline: 'center' });
      const r = e.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const top = document.elementFromPoint(x, y);
      return { x, y, w: Math.round(r.width), h: Math.round(r.height), disabled: !!e.disabled, clear: !!top && (e === top || e.contains(top) || top.contains(e)) };
    },
    testId,
    nth,
    text,
  );
  if (!info) {
    log(`tap ${name}`, false, 'no match');
    return false;
  }
  if (info.disabled || !info.clear || info.w < minSize || info.h < minSize) {
    log(`tap ${name} reachable`, false, `${info.w}x${info.h}${info.clear ? '' : ' COVERED'}${info.disabled ? ' DISABLED' : ''}`);
    if (shots < 6) {
      shots += 1;
      await shot(page, `fail-${shots}`);
    }
    if (info.disabled) return false;
  }
  if (page === t || phone) await page.touchscreen.tap(info.x, info.y);
  else await page.mouse.click(info.x, info.y);
  await sleep(400);
  return true;
}
const FIELD = 48; // smallest target for field screens (fibergis-easy-field-ux)
const ttap = (testId, opts = {}) => tap(t, testId, { minSize: FIELD, ...opts });

let fallbacks = 0;
/**
 * Takes a photo on the phone: the live view's shutter, or, when the live view does not start, the
 * app's own fallback ("Open camera", the phone's camera app), given a real JPEG file. Each fallback is reported.
 */
async function takePhoto(label) {
  for (let i = 0; i < 40; i += 1) {
    const state = await t.evaluate(() => (document.querySelector('[data-testid="shutter"]') ? 'live' : document.querySelector('[data-testid="native-camera"]') ? 'native' : 'wait'));
    if (state === 'live') {
      await sleep(1500);
      return ttap('shutter', { label });
    }
    if (state === 'native') {
      fallbacks += 1;
      console.log(`NOTE | ${label}: live camera view did not start; used the app's "Open camera" fallback with a real JPEG`);
      const input = await t.$('[data-testid="native-camera"]');
      await input.uploadFile(PHOTO_FILE);
      await sleep(1500);
      return true;
    }
    await sleep(500);
  }
  log(`photo: ${label}`, false, 'no camera screen');
  return false;
}
async function select(page, testId, value) {
  const ok = await page.evaluate(
    (id, v) => {
      const el = document.querySelector(`[data-testid="${id}"]`);
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setter.call(el, v);
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    testId,
    value,
  );
  await sleep(300);
  return ok;
}
async function typeInto(page, testId, value) {
  await page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    el?.focus();
    if (el) el.select?.();
  }, testId);
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await page.type(`[data-testid="${testId}"]`, value);
}
const toasts = (page) => page.evaluate(() => [...document.querySelectorAll('[role="status"], [role="alert"]')].map((e) => e.innerText).join(' || '));
const chip = () => t.evaluate(() => document.querySelector('[data-testid="sync-chip"]')?.dataset.state ?? 'none');

async function openFaultCenter() {
  await o.goto(`${BASE}/operations`, { waitUntil: 'domcontentloaded' });
  await sleep(2500);
  await tap(o, 'ops-open-faults', { label: 'Faults and alarms' });
  return visible(o, 'fault-center');
}

// ================================================================= Example C (office)
log('fault center opens from Operations', await openFaultCenter());
log('says "No live connection": no device alarms', await visible(o, 'no-live-connection'));
await tap(o, 'open-test-event', { label: 'Make a TEST event' });
await select(o, 'test-splitter', 'SPL-2');
await sleep(500);
const listed = await count(o, 'test-customer');
log('TEST form lists the 6 customers on recorded paths through Splitter 2 (not Home 7)', listed === 6, `listed ${listed}`);
for (let i = 0; i < 5; i += 1) await tap(o, 'test-customer', { nth: i, label: `tick customer ${i + 1}` });
await tap(o, 'make-test-event', { label: 'Make TEST event (5)' });
await sleep(800);
const alarmRows = await count(o, 'alarm-row');
const testBadges = await o.evaluate(() => document.querySelectorAll('[data-testid="alarm-row"] [data-testid="test-badge"]').length);
log('5 TEST alarms listed, each labelled TEST', alarmRows === 5 && testBadges === 5, `${alarmRows} rows, ${testBadges} TEST badges`);
await shot(o, '1-test-alarms');

await tap(o, 'fault-tab-suspected', { label: 'Suspected causes tab' });
await sleep(600);
const susLabel = (await textOf(o, 'suspicion-label')).split(' | ')[0] ?? '';
log('best suspicion is Splitter 2, worded "Suspected"', /^Suspected: splitter Splitter 2 \(SPL-2\)/.test(susLabel), susLabel);
const evidence = (await textOf(o, 'evidence')).split(' | ')[0] ?? '';
log('evidence: "5 of 6 customers recorded on splitter … are reported down (1 have no alarm)"', /5 of 6 customers recorded on splitter Splitter 2 \(SPL-2\) are reported down \(1 have no alarm\)/.test(evidence), evidence.slice(0, 160));
log('evidence says TEST and that no alarm is not proof of working', /TEST events/.test(evidence) && /not proven to be working/.test(evidence));
const conf = (await textOf(o, 'confidence')).split(' | ')[0];
const missing = (await textOf(o, 'missing')).split(' | ')[0] ?? '';
log('missing link lowers the confidence and is named (Home 7 has no house wire recorded)', /medium confidence/.test(conf) && /may be on splitter Splitter 2/.test(missing) && /no drop cable/i.test(missing), `${conf} / ${missing.slice(0, 140)}`);
log('never claims a cut: "not proof of a physical cut"', await has(o, 'not proof of a physical cut'));
await shot(o, '2-suspected');
await tap(o, 'open-fault', { nth: 0, label: 'Open a fault for this' });
await sleep(800);
log('fault opened and shown, labelled TEST', (await visible(o, 'fault-detail')) && (await o.evaluate(() => !!document.querySelector('[data-testid="fault-detail"] [data-testid="test-badge"]'))));
const affected = await textOf(o, 'fault-affected');
log('affected list from recorded paths: Home 1 to 6; Home 7 apart as "may be affected"', [1, 2, 3, 4, 5, 6].every((n) => affected.includes(`Home ${n} (C-${n})`)) && /May be affected, path not fully recorded: Home 7 \(C-7\)/.test(affected), affected.slice(0, 200));
let data = await network();
const fault = data.faults[0];
log('stored: TEST, source test, element SPL-2, 6 affected, 1 may be, suspicion kept', !!fault && fault.isTest === true && fault.source === 'test' && fault.element?.id === 'SPL-2' && fault.affectedCustomerIds.length === 6 && fault.mayBeAffectedCustomerIds?.[0] === 'C-7' && fault.suspected?.confidence === 'medium', JSON.stringify({ id: fault?.id, n: fault?.affectedCustomerIds?.length }));
await shot(o, '3-fault');

// Closing without a check is refused: on screen and by the server.
await tap(o, 'fault-close-button', { label: 'Close the fault (no check yet)' });
await sleep(700);
const refusal = await toasts(o);
log('closing without a check is refused on screen, in plain words', /cannot be closed yet/.test(refusal) && (await textOf(o, 'fault-status')) === 'Raised', refusal.slice(0, 160));
const serverRefusal = await post({ upserts: { faults: [{ ...fault, status: 'Closed' }] } });
log('the server refuses it too (409, nothing written)', serverRefusal.status === 409 && /without a check/.test(serverRefusal.body?.message ?? ''), serverRefusal.body?.message?.slice(0, 120));

await tap(o, 'fault-ack', { label: 'Acknowledge' });
await tap(o, 'new-job', { label: 'Make a work order' });
await typeInto(o, 'job-technician', 'Ravi Kumar');
await tap(o, 'make-job', { label: 'Make the work order' });
await sleep(800);
data = await network();
const job = data.workOrders.find((w) => w.faultId === fault.id);
log('work order made for the fault: TEST, assigned to Ravi Kumar, steps from the checks, sent to the box', !!job && job.isTest === true && job.status === 'Assigned' && job.technicianName === 'Ravi Kumar' && job.equipmentId === 'FAT-1' && (job.steps?.length ?? 0) >= 2 && /^TEST: /.test(job.title), JSON.stringify({ id: job?.id, status: job?.status, steps: job?.steps?.length }));
log('fault moved to Assigned', data.faults.find((f) => f.id === fault.id)?.status === 'Assigned');
await o.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await sleep(2500);
const bell = await o.evaluate(() => [...document.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label')).filter((l) => /open faults/i.test(l)));
log('the open TEST fault is not counted as an outage in the menu bar', bell.length > 0 && bell.every((l) => /No open faults/.test(l)), bell.join(','));

// ================================================================= Example C (technician phone)
await t.goto(`${BASE}/jobs`, { waitUntil: 'domcontentloaded' });
await sleep(3000);
log('job flow asks "Who are you?" with names from the jobs', (await visible(t, 'jobs-who')) && (await has(t, 'Ravi Kumar')));
await ttap('jobs-name', { text: 'Ravi Kumar', label: 'Ravi Kumar' });
log('job list shows the TEST job, labelled TEST', (await visible(t, 'job-card')) && (await has(t, 'TEST job. Not real.')));
await shot(t, '4-phone-list');
await ttap('job-card', { text: 'TEST:', label: 'open the TEST job' });
log('job screen: TEST banner, title, place, Show the way', (await visible(t, 'job-test')) && (await has(t, 'Go to: Box 1')) && (await visible(t, 'job-navigate')));
await ttap('job-start', { label: 'Start job' });
log('Start job opens the camera for the photo before', await t.waitForFunction(() => document.querySelector('[data-testid="shutter"], [data-testid="native-camera"]'), { timeout: 20000 }).then(() => true, () => false));
await takePhoto('Take photo (before)');
log('back on the job with "Saved" and Undo', (await visible(t, 'job-saved', 15000)) && (await visible(t, 'job-undo')));
log('status shows Started', (await t.evaluate(() => document.querySelector('[data-testid="job-status"]')?.dataset.status)) === 'In Progress');
await ttap('job-step', { nth: 0, label: 'tick step 1' });
await ttap('job-material', { label: 'Material used' });
await ttap('material-sleeve', { label: 'Splice sleeve' });
await ttap('count-2', { label: 'digit 2' });
log('count pad reads back "2 pieces" (digits only)', /2\s*pieces/.test(await textOf(t, 'count-readback')));
await ttap('count-save', { label: 'Save material' });
await visible(t, 'job-screen');
await ttap('job-photo-after', { label: 'Photo after' });
await takePhoto('Take photo (after)');
await visible(t, 'job-repair-done', 15000);
await shot(t, '5-phone-job');
await ttap('job-repair-done', { label: 'Repair done' });
log('repair done asks how to check the repair', await visible(t, 'job-check-how'));
await ttap('check-reading', { label: 'Light level reading' });
if (await visible(t, 'customer-option', 4000)) await ttap('customer-option', { nth: 0, label: 'which house' });
await takePhoto('Photo of the meter');
await visible(t, 'pad-readback', 15000);
for (const d of '1920') await ttap(`pad-${d}`, { label: `pad ${d}` });
log('pad reads back -19.20 dBm (sign supplied, not typed)', /[-−]19\.20\s*dBm/.test(await textOf(t, 'pad-readback')), await textOf(t, 'pad-readback'));
await ttap('save', { label: 'Save reading' });
await visible(t, 'job-screen');
log('job shows Done and "the office will close the job"', (await has(t, 'Check saved. The office will close the job.')) && (await t.evaluate(() => document.querySelector('[data-testid="job-status"]')?.dataset.status)) === 'Verified');
let sent = false;
for (let i = 0; i < 40 && !sent; i += 1) {
  await sleep(1000);
  sent = (await chip()) === 'sent';
}
log('phone chip reaches "Sent to office" (records and photos)', sent, await chip());
await shot(t, '6-phone-done');
data = await network();
const doneJob = data.workOrders.find((w) => w.id === job?.id);
const v = doneJob?.verification;
log('stored job: Verified, before and after photos, step, material, field_measured reading with meter photo', doneJob?.status === 'Verified' && doneJob.photoRefs?.some((p) => p.kind === 'before') && doneJob.photoRefs?.some((p) => p.kind === 'after') && !!doneJob.steps?.[0]?.doneAt && doneJob.materials?.[0]?.item === 'Splice sleeve' && doneJob.materials?.[0]?.quantity === 2 && v?.method === 'field_reading' && v.readingOrigin === 'field_measured' && v.readingDbm === -19.2 && !!v.photoId, JSON.stringify(v));
const photoIds = [...(doneJob?.photoRefs ?? []).map((p) => p.photoId), v?.photoId].filter(Boolean);
const photoStatus = await Promise.all(photoIds.map((id) => fetch(`${BASE}/api/v1/photos/${id}`).then((r) => r.status)));
log('every job photo reached the server (from the phone queue, not localStorage)', photoIds.length === 3 && photoStatus.every((s) => s === 200), photoStatus.join(','));
log('the phone did not change the fault (office closes it)', data.faults.find((f) => f.id === fault.id)?.status === 'Assigned');

// ================================================================= Example C (office closes)
log('fault center opens again', await openFaultCenter());
await tap(o, 'fault-tab-faults', { label: 'Faults tab' });
await sleep(600);
const ver = await textOf(o, 'fault-verification');
log('office sees the check from the job: light reading measured in the field', /Light reading -19\.2 dBm measured in the field/.test(ver), ver.slice(0, 160));
log('office sees the before and after photos', (await o.evaluate(() => document.querySelectorAll('[data-testid="fault-detail"] [data-testid="job-photos"] img').length)) >= 2);
await typeInto(o, 'fault-resolution', 'Splitter input splice redone in Box 1');
await tap(o, 'fault-close-button', { label: 'Close the fault' });
await sleep(800);
await tap(o, 'fault-tab-faults', { label: 'Faults tab' });
await o.evaluate(() => [...document.querySelectorAll('input[type=checkbox]')].find((c) => c.parentElement?.innerText.includes('Show closed'))?.click());
await sleep(500);
data = await network();
const closed = data.faults.find((f) => f.id === fault.id);
log('fault closed with resolution and the field reading as its check', closed?.status === 'Closed' && closed.resolution === 'Splitter input splice redone in Box 1' && closed.verification?.readingOrigin === 'field_measured' && closed.verification?.workOrderId === job?.id);
log('closing cleared its TEST alarms and closed the verified job', data.alarms.every((a) => a.state === 'cleared') && data.workOrders.find((w) => w.id === job?.id)?.status === 'Closed');
const timeline = await textOf(o, 'fault-timeline');
log('history on the fault: raised, assigned, phone events, verified, closed', /Opened for splitter Splitter 2/.test(timeline) && /Started the job/.test(timeline) && /Repair done/.test(timeline) && /Light reading -19\.2 dBm/.test(timeline) && /Closed/.test(timeline), timeline.slice(0, 220));
await shot(o, '7-closed-history');

// ================================================================= Example E (offline clash)
await ttap('job-back-list', { label: 'All my jobs' }).catch(() => undefined);
await t.goto(`${BASE}/jobs`, { waitUntil: 'domcontentloaded' });
await sleep(3000);
await ttap('job-card', { text: 'Inspect Box 1 route', label: 'open job WO-E1' });
await visible(t, 'job-start');
await t.setOfflineMode(true);
await t.evaluate(() => window.dispatchEvent(new Event('offline')));
await sleep(500);
// Offline on the phone: start the job and write a note.
await ttap('job-start', { label: 'Start job (offline)' });
await takePhoto('photo before (offline)');
await visible(t, 'job-note');
await ttap('job-note', { label: 'Add a note (offline)' });
await t.type('[data-testid="job-note-text"]', 'Box door broken, cables fine');
await ttap('job-note-save', { label: 'Save note (offline)' });
await sleep(800);
log('offline: phone chip says "Saved on phone"', (await chip()) === 'saved', await chip());

// Meanwhile the office changes the same job (new phone number for Ravi).
log('fault center opens (office)', await openFaultCenter());
await tap(o, 'fault-tab-jobs', { label: 'Work orders tab' });
await tap(o, 'work-order-row', { text: 'Inspect Box 1 route', label: 'WO-E1' });
await typeInto(o, 'job-assign-phone', '+91 90000 11111');
const assigned = await tap(o, 'job-assign', { label: 'Assign (new phone number)' });
await sleep(1500);
data = await network();
const officeVersion = data.workOrders.find((w) => w.id === 'WO-E1');
log('office edit reached the server first', assigned && /90000 11111/.test(officeVersion?.technicianPhone ?? ''), officeVersion?.technicianPhone);

// Phone back online: the clash is found and the choice appears.
await t.setOfflineMode(false);
await t.evaluate(() => window.dispatchEvent(new Event('online')));
const shown = await visible(t, 'conflict-choice', 45000);
log('back online: "Someone else changed this" appears on the phone', shown && (await has(t, 'Someone else changed this')));
log('both versions shown: theirs (office) and mine (this phone)', (await visible(t, 'conflict-theirs', 2000)) && (await visible(t, 'conflict-mine', 2000)) && /90000 11111/.test(await textOf(t, 'conflict-theirs')));
await shot(t, '8-conflict');
data = await network();
const conflict = data.syncConflicts.find((c) => c.recordId === 'WO-E1');
log('both versions kept on the server in a conflict record', !!conflict && conflict.status === 'open' && /90000 11111/.test(JSON.stringify(conflict.theirs)) && /Box door broken/.test(JSON.stringify(conflict.mine)), conflict ? conflict.changedFields.join(',') : 'none');
log('the office version was not overwritten', /90000 11111/.test(data.workOrders.find((w) => w.id === 'WO-E1')?.technicianPhone ?? '') && !/Box door broken/.test(JSON.stringify(data.workOrders.find((w) => w.id === 'WO-E1'))));
await ttap('conflict-office', { label: 'Office decides' });
await sleep(1500);
log('choice made: the dialog closes', !(await visible(t, 'conflict-choice', 1500)));
let synced = false;
for (let i = 0; i < 30 && !synced; i += 1) {
  await sleep(1000);
  synced = (await network()).syncConflicts.find((c) => c.recordId === 'WO-E1')?.status === 'office_decides';
}
log('conflict sent to the office to decide', synced);

// The office decides: use the phone's version, checked against the office version.
await o.goto(`${BASE}/operations`, { waitUntil: 'domcontentloaded' });
await sleep(2500);
await tap(o, 'ops-conflicts', { label: 'Changed twice' });
log('office list shows the conflict with both versions', (await visible(o, 'sync-conflict')) && /Sent to the office to decide/.test(await textOf(o, 'sync-conflict-status')));
await shot(o, '9-office-conflicts');
await tap(o, 'office-use-field', { label: 'Use the phone version' });
let final;
for (let i = 0; i < 20; i += 1) {
  await sleep(1000);
  data = await network();
  final = data.workOrders.find((w) => w.id === 'WO-E1');
  if (/Box door broken/.test(JSON.stringify(final))) break;
}
const decided = data.syncConflicts.find((c) => c.recordId === 'WO-E1');
log('verified record: the phone version is stored, and the conflict keeps both', /Box door broken/.test(JSON.stringify(final?.fieldNotes)) && final?.status === 'In Progress' && decided?.status === 'office_used_field' && /90000 11111/.test(JSON.stringify(decided?.theirs)));
log('audit trail records the choices', data.auditLogs.some((a) => a.action === 'SYNC_CONFLICT_CHOICE') && data.auditLogs.some((a) => a.action === 'SYNC_CONFLICT_DECIDED'));

// Horizontal scroll check on the office screen.
const hscroll = await o.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
log('no horizontal page scroll on the office screen', !hscroll);

console.log(`CAMERA FALLBACKS ${fallbacks}`);
await finish();
