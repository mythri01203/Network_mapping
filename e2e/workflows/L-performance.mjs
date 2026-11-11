// Workflow L (Phase 24b): browser-side speed on a big network. `run.mjs` fills the temporary
// database with the server benchmark's synthetic network first (100,000 records by default,
// `E2E_L_RECORDS` for another size), so these are the same records `npm run benchmark` measures.
//
// Measured, each printed as "MEASURE | name | ms":
//  - first map paint and the time until the network is loaded ("Saved"), by map area (the default
//    for a network this big) and with "whole network" chosen on the device;
//  - a pan to a place not loaded yet, until its records are drawn;
//  - an edit (a pole renamed through POST /changes, the server's guarded write) and how long until
//    another open device shows it (its next check, up to 30 s, is not counted: only the catch-up);
//  - a search for a pole outside the loaded area, until it is in the list;
//  - zooming out until the pins are drawn as groups, and back.
// The checks (PASS/FAIL) are about truth, not speed: the area mode says "part loaded", a record
// outside the area is found through the server, and every number is printed.
import { api, BASE, browser, H, log, phone, sleep, W, finish } from '../lib/harness.mjs';

const results = [];
const measure = (name, ms, note = '') => {
  results.push({ name, ms: Math.round(ms) });
  console.log(`MEASURE | ${name} | ${Math.round(ms)} ms${note ? ` | ${note}` : ''}`);
};
const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];

const health = (await api('/health')).body;
const total = Object.values(health.counts ?? {}).reduce((n, v) => n + v, 0);
log('the temporary server holds the benchmark network', total >= 10_000, `${total} records`);

const b = await browser();
async function page({ whole = false } = {}) {
  const ctx = await b.createBrowserContext();
  const p = await ctx.newPage();
  await p.setViewport({ width: W, height: H, isMobile: phone, hasTouch: phone, deviceScaleFactor: 1 });
  await p.evaluateOnNewDocument((whole) => {
    try {
      localStorage.setItem('fiber_gis_ui_prefs', JSON.stringify({ state: { uiMode: 'pro' }, version: 1 }));
      localStorage.setItem('fiber_gis_learning_prefs', JSON.stringify({ state: { welcomeSeen: true, welcomeStep: 0 }, version: 0 }));
      if (whole) localStorage.setItem('fiber_gis_load_preference', 'whole');
    } catch {}
  }, whole);
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('dialog', (d) => d.dismiss());
  return { p, ctx, errors };
}
const frames = (p) => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const pins = (p) => p.evaluate(() => document.querySelectorAll('.leaflet-marker-icon').length);
const saved = (p) => p.evaluate(() => /Sync status: Saved/.test([...document.querySelectorAll('[aria-label^="Sync status"]')].map((e) => e.getAttribute('aria-label')).join(' ')));
const heap = (p) => p.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null));
async function until(test, timeoutMs, stepMs = 50) {
  const t = Date.now();
  while (Date.now() - t < timeoutMs) {
    if (await test()) return Date.now() - t;
    await sleep(stepMs);
  }
  return null;
}

// ------------------------------------------------------------------ first paint, by map area
console.log('--- first map paint, loaded by map area');
const area = await page();
let t = Date.now();
await area.p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
const firstPins = await until(async () => (await pins(area.p)) > 0, 120_000);
const areaSaved = await until(() => saved(area.p), 120_000);
measure('area: first pins drawn', firstPins ?? NaN);
measure('area: network loaded (Saved)', Date.now() - t);
void areaSaved;
log('loaded by map area, and the top bar says only part is loaded', !!(await area.p.$('[data-testid="area-load-notice"]')));
console.log(`   pins on screen ${await pins(area.p)}; JS memory ${await heap(area.p)} MB`);

// ------------------------------------------------------------------ pan to a new place
console.log('--- pan to a place not loaded yet');
const centre = await area.p.$eval('.leaflet-container', (e) => {
  const r = e.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
const pans = [];
for (let i = 0; i < 3; i += 1) {
  const waitArea = area.p.waitForResponse((r) => r.url().includes('/network/area'), { timeout: 30_000 }).catch(() => null);
  await area.p.mouse.move(centre.x, centre.y);
  await area.p.mouse.down();
  await area.p.mouse.move(centre.x - W * 0.8, centre.y - H * 0.6, { steps: 8 });
  await area.p.mouse.up();
  t = Date.now();
  const res = await waitArea;
  if (res) await res.buffer().catch(() => undefined);
  await until(async () => !(await area.p.evaluate(() => !!document.querySelector('[data-testid="area-load-notice"] .animate-spin'))), 30_000);
  await frames(area.p);
  pans.push(Date.now() - t);
  await sleep(600);
}
measure('area: pan to a new place, until drawn (median of 3)', median(pans), `each ${pans.join(', ')} ms, from the end of the drag (the app waits 0.4 s for the map to stop)`);

// ------------------------------------------------------------------ search outside the loaded area
console.log('--- search for a pole far away');
const far = `Bench pole ${Math.floor((health.counts?.equipment ?? 40000) * 0.37)}`;
t = Date.now();
await area.p.evaluate(() => {
  const input = document.querySelector('input[aria-label="Search network"]');
  input?.focus();
});
await area.p.keyboard.type(far);
const typed = Date.now() - t;
t = Date.now();
const foundIn = await until(() => area.p.evaluate((label) => [...document.querySelectorAll('#global-search-results [role="option"]')].some((e) => e.innerText.includes(label)), far), 30_000, 100);
measure('area: search for a pole outside the loaded area, until listed', foundIn ?? NaN, `after typing (${typed} ms); asks the server after 0.5 s`);
log('a pole outside the loaded area is found through the server', foundIn !== null);
log('the search list says only part of the network is on the device', !!(await area.p.$('[data-testid="area-search-note"]')));
await area.p.keyboard.press('Escape');

// ------------------------------------------------------------------ an edit
console.log('--- an edit');
const edits = [];
for (let i = 0; i < 3; i += 1) {
  const pole = (await api(`/equipment/BP-${100 + i}`)).body;
  const s = Date.now();
  const res = await api('/changes', { method: 'POST', body: JSON.stringify({ upserts: { equipment: [{ ...pole, name: `Renamed pole ${i}` }] } }) });
  edits.push(Date.now() - s);
  if (res.status !== 200) log('the pole edit was stored', false, `status ${res.status}`);
}
measure('server: pole renamed, POST /changes round trip (median of 3)', median(edits), edits.join(', '));
const moves = [];
for (let i = 0; i < 2; i += 1) {
  const pole = (await api(`/equipment/BP-${200 + i}`)).body;
  const s = Date.now();
  await api('/changes', { method: 'POST', body: JSON.stringify({ upserts: { equipment: [{ ...pole, lat: pole.lat + 0.00001 }] } }) });
  moves.push(Date.now() - s);
}
measure('server: pole moved, POST /changes round trip (median of 2)', median(moves), `${moves.join(', ')} (still the whole-network fibre check)`);
// The open device catches up: the sync menu's next check is forced by a focus change.
t = Date.now();
const catchUp = area.p.waitForResponse((r) => r.url().includes('/changes?since='), { timeout: 40_000 }).catch(() => null);
await area.p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
const caught = await catchUp;
if (caught) await caught.buffer().catch(() => undefined);
await frames(area.p);
measure('area: another device catches up with those edits', caught ? Date.now() - t : NaN);

// ------------------------------------------------------------------ zoom out: groups
console.log('--- zoom out until the pins are groups, and back');
const zoom = async (label, n) => {
  const s = Date.now();
  await area.p.evaluate(async (label, n) => {
    for (let i = 0; i < n; i += 1) {
      document.querySelector(`[aria-label="${label}"]`)?.click();
      await new Promise((r) => setTimeout(r, 350));
    }
  }, label, n);
  await sleep(500);
  await until(async () => !(await area.p.evaluate(() => !!document.querySelector('[data-testid="area-load-notice"] .animate-spin'))), 60_000);
  await frames(area.p);
  return Date.now() - s - 500 - n * 350;
};
const outMs = await zoom('Zoom out', 3);
const groups = await area.p.evaluate(() => [...document.querySelectorAll('.leaflet-marker-icon')].filter((e) => /network items here|customers here/.test(e.getAttribute('aria-label') ?? e.title ?? '')).length);
measure('area: zoom out 3 steps, load and draw groups', outMs, `${await pins(area.p)} markers, ${groups} groups; truncated note ${!!(await area.p.$('[data-testid="area-load-notice"]'))}`);
const inMs = await zoom('Zoom in', 3);
measure('area: zoom back in 3 steps', inMs);
console.log(`   JS memory after the walk ${await heap(area.p)} MB`);
const areaErrors = area.errors.length;
await area.ctx.close();

// ------------------------------------------------------------------ whole network on the device
if (process.env.E2E_L_WHOLE !== '0') {
  console.log('--- first map paint, whole network on the device (for comparison)');
  const whole = await page({ whole: true });
  t = Date.now();
  await whole.p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  const wholePins = await until(async () => (await pins(whole.p)) > 0, 240_000, 200);
  const wholeSaved = await until(() => saved(whole.p), 240_000, 200);
  measure('whole: first pins drawn', wholePins ?? NaN);
  measure('whole: network loaded (Saved)', wholeSaved === null ? NaN : Date.now() - t);
  log('with "whole network" chosen, nothing says part loaded', !(await whole.p.$('[data-testid="area-load-notice"]')));
  console.log(`   JS memory ${await heap(whole.p)} MB`);
  t = Date.now();
  const sel = 'input[aria-label="Search network"]';
  await whole.p.evaluate((s) => document.querySelector(s)?.focus(), sel);
  await whole.p.keyboard.type(far);
  const wholeFound = await until(() => whole.p.evaluate((label) => [...document.querySelectorAll('#global-search-results [role="option"]')].some((e) => e.innerText.includes(label)), far), 30_000, 50);
  measure('whole: search on the device, until listed (includes typing)', wholeFound === null ? NaN : Date.now() - t);
  await whole.p.keyboard.press('Escape');
  const wholeOut = await (async () => {
    const s = Date.now();
    for (let i = 0; i < 3; i += 1) {
      await whole.p.evaluate(() => document.querySelector('[aria-label="Zoom out"]')?.click());
      await sleep(350);
    }
    await frames(whole.p);
    return Date.now() - s - 3 * 350;
  })();
  measure('whole: zoom out 3 steps and draw groups', wholeOut, `${await pins(whole.p)} markers`);
  if (whole.errors.length) console.log('   whole-network page errors:', whole.errors.slice(0, 2).join(' | '));
  await whole.ctx.close();
}

console.log('RESULTS', JSON.stringify(results));
log('no browser errors on the area page', areaErrors === 0, String(areaErrors));
await finish();
