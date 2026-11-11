// Workflow A (with B and G): follows the fibergis-field-helper guide literally on a fresh, empty network:
// place the main machine (OLT) and a street box, draw a cable that joins both, move the box (its cable
// end follows), add a customer with GPS, open the service path, and find the other jobs. Every tap also
// says whether a finger could really reach the control (not covered, on screen, size).
// Ported from the scratch walkthrough walk.mjs. Temp server on 127.0.0.1:5056 only (see e2e/run.mjs).
import { BASE, finish, H, health, log, openApp, pickConnection, sleep, W } from '../lib/harness.mjs';

const app = await openApp({ uiMode: null, geolocation: { latitude: 12.9352, longitude: 77.6245, accuracy: 8 }, waitMs: 2500 });
const { p, phone, shot, mapTap } = app;
/** This walk taps controls by their words and reports whether each is reachable (see harness tapLabel). */
const tap = app.tapLabel;
const closeAll = async () => { await p.evaluate(() => [...document.querySelectorAll('[aria-label="Close"],[title="Close"],[aria-label="Close panel"],[title="Close panel"]')].forEach((e) => e.click())); await sleep(300); };
const has = (re) => app.hasRaw(re, '');
const check = async (label, re) => log(label, await has(re));

// Close the toolbox if it opened by itself, because it blocks the map.
const area = await p.evaluate(() => {
  const r = document.querySelector('.leaflet-container').getBoundingClientRect();
  return { l: r.left, t: r.top, w: r.width, h: r.height };
});
console.log('map area', JSON.stringify(area), 'viewport', W, H, 'hscroll', await p.evaluate(() => document.documentElement.scrollWidth > innerWidth));
await shot('0-open');

// Zoom in so 30 m is many pixels: the guide says to zoom near the box.
if (await p.evaluate(() => [...document.querySelectorAll('[aria-label="Collapse Toolbox"]')].some((e) => e.getBoundingClientRect().width > 0))) await tap('Collapse Toolbox');
else console.log('toolbox already closed');
await sleep(500);
await p.evaluate(async (ZOOMS) => {
  const z = document.querySelector('[aria-label="Zoom in"]');
  for (let i = 0; z && i < ZOOMS; i += 1) {
    z.click();
    await new Promise((r) => setTimeout(r, 400));
  }
}, +(process.env.E2E_ZOOMS || 3));
await sleep(800);

const free = await p.evaluate(() => {
  // Find map points not covered by any panel.
  const m = document.querySelector('.leaflet-container').getBoundingClientRect();
  const pts = [];
  for (let y = m.top + 40; y < m.bottom - 40; y += 30)
    for (let x = m.left + 20; x < m.right - 20; x += 30) if (document.elementFromPoint(x, y)?.closest('.leaflet-container') && !document.elementFromPoint(x, y)?.closest('.leaflet-control')) pts.push([x, y]);
  return pts;
});
console.log('free map points', free.length);
if (free.length < 4) {
  await shot('covered');
  log('enough free map to work on', false, 'map is almost fully covered');
  await finish({ app });
  process.exit(1);
}
const xs = free.map((q) => q[0]);
const ys = free.map((q) => q[1]);
const midX = (Math.min(...xs) + Math.max(...xs)) / 2;
const oltPt = [midX - 60, Math.min(...ys) + 90];
const boxPt = [midX + 60, Math.min(...ys) + 380];

console.log('--- 1 place main machine');
await tap('Equipment', { exact: true });
await shot('1-equipment');
await tap('OLT');
await mapTap(oltPt[0], oltPt[1], 'OLT');
await check('setup window opens', 'Dynamic OLT Configuration|OLT Configuration');
await shot('2-olt');
await tap('3. PON Ports');
// Phase 10: any PON port count, typed in (no 4/8/16/32 buttons).
await check('PON port count asked, not assumed', 'How many PON ports does this OLT have');
await tap('Save Configuration');
await sleep(800);
let h = await health();
log('OLT saved on server', h.counts.equipment >= 1, `equipment=${h.counts.equipment}`);

console.log('--- 2 place street box');
await p.keyboard.press('Escape').catch(() => {});
await tap('Equipment', { exact: true });
const hasFat = await tap('FAT Terminal Box');
if (!hasFat) await tap('FAT');
await mapTap(boxPt[0], boxPt[1], 'box');
await sleep(800);
h = await health();
log('box saved on server', h.counts.equipment >= 2, `equipment=${h.counts.equipment}`);
await shot('3-box');
await p.keyboard.press('Escape').catch(() => {});
await closeAll();
await sleep(400);

console.log('--- 3 draw cable');
const pins = await p.evaluate(() =>
  [...document.querySelectorAll('.gis-marker--equipment')].map((e) => {
    const r = e.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  }),
);
console.log('pins', JSON.stringify(pins));
console.log('scale bar', await p.evaluate(() => document.querySelector('.leaflet-control-scale-line')?.innerText ?? 'none'));
const [olt, box] = pins.sort((a, c) => a.y - c.y);
{
  const n = await (await fetch(BASE + "/api/v1/network")).json();
  const [e1, e2] = n.data.equipment;
  const R = 6371008.8, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(e2.lat - e1.lat), dLng = rad(e2.lng - e1.lng);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(e1.lat)) * Math.cos(rad(e2.lat)) * Math.sin(dLng / 2) ** 2;
  const m = 2 * R * Math.asin(Math.sqrt(a));
  const px = Math.hypot(olt.x - box.x, olt.y - box.y);
  console.log("metres per pixel", (m / px).toFixed(3), "| 30 m =", Math.round(30 / (m / px)), "px | pin half width =", box.w / 2, "px");
}
if (phone) await p.touchscreen.tap(olt.x, olt.y);
else await p.mouse.click(olt.x, olt.y);
await sleep(900);
await shot('4-olt-popup');
const started = await tap('Draw feeder cable');
await shot('5-drawing');
await sleep(700);
const now = await p.evaluate(() => [...document.querySelectorAll(".gis-marker--equipment")].map((e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width }; }));
console.log("pins after popup", JSON.stringify(now));
const liveBox = now.sort((a, c) => a.y - c.y).at(-1);
const liveOlt = now[0];
await mapTap((liveOlt.x + liveBox.x) / 2 + 40, (liveOlt.y + liveBox.y) / 2, "route corner");
await mapTap(liveBox.x, liveBox.y, "exactly on the box pin");
await shot('6-snap');
await check('green join shown (box name in bar)', 'Snap|snap|FAT');
await tap('Finish');
const stepTo = async (key) => { await p.evaluate((k) => document.querySelector(`[data-testid="cable-step-${k}"]`)?.click(), key); await sleep(500); };
// Phase 5: the cable form is a step-by-step wizard; the ends are on step 3.
await check('Save Cable window', 'Save Cable');
await stepTo('ends');
const proposal = await has('Your line touches');
log('proposed ends shown for confirmation', proposal);
if (proposal) await tap('Yes, connect');
await check('Starts at field', 'Starts at');
await check('Ends at field', 'Ends at');
await check('OLT PON port field', 'OLT PON port');
const ends = await p.evaluate(() => [...document.querySelectorAll('select')].filter((s) => s.getBoundingClientRect().width > 0).map((s) => s.options[s.selectedIndex]?.text));
console.log('form selections:', JSON.stringify(ends));
// Since the audit fix nothing is preselected: the person chooses the OLT's PON port.
{
  const value = await p.evaluate(() => {
    const s = [...document.querySelectorAll('select')].find((x) => x.options[0]?.text === 'Choose PON port');
    if (!s) return null;
    s.setAttribute('data-walk', 'pon');
    return [...s.options].find((o) => o.value && o.value !== '__none__')?.value ?? null;
  });
  log('PON port not preselected; chose one', !!value);
  if (value) await p.select('[data-walk="pon"]', value);
}
await shot('7-save-cable');
await stepTo('check');
await tap('Save Cable');
await sleep(600);
// The wizard may ask "same cable?" or about a straight line; say save.
for (const t of ['Save anyway', 'No, it is a different cable', 'Save straight line', 'Save without connecting']) if (await has(t)) await tap(t);
await sleep(900);
h = await health();
log('cable saved on server', h.counts.cables >= 1, `cables=${h.counts.cables}, started=${started}`);
const net1 = await (await fetch(`${BASE}/api/v1/network`)).json();
const c0 = net1.data.cables[0];
log('cable linked both ends', !!(c0?.startEquipmentId && c0?.endEquipmentId), JSON.stringify({ s: c0?.startEquipmentId, e: c0?.endEquipmentId }));

{
  const c = (await (await fetch(BASE + '/api/v1/network')).json()).data.cables[0];
  log('cable has no invented owner or maker', c && c.owner === '' && !c.manufacturer && !c.model, JSON.stringify({ owner: c?.owner, m: c?.manufacturer, model: c?.model, inst: c?.installationType }));
}
if (!phone) {
  console.log('--- 3b move the box: its cable end follows');
  await p.keyboard.press('Escape');
  await sleep(300);
  await closeAll();
  const pinsNow = await p.evaluate(() => [...document.querySelectorAll('.gis-marker--equipment')].map((e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }));
  const boxPin = pinsNow.sort((a, c) => a.y - c.y).at(-1);
  const before = (await (await fetch(BASE + '/api/v1/network')).json()).data;
  const startDrag = await p.evaluate(() => document.elementFromPoint(0,0) && true);
  await p.mouse.click(boxPin.x, boxPin.y);
  await sleep(700);
  const moved = await tap('Move this item');
  if (moved) {
    await p.mouse.move(boxPin.x, boxPin.y);
    await p.mouse.down();
    await p.mouse.move(boxPin.x + 30, boxPin.y + 20, { steps: 8 });
    await p.mouse.move(boxPin.x + 60, boxPin.y + 40, { steps: 8 });
    await p.mouse.up();
    await sleep(1500);
    const after = (await (await fetch(BASE + '/api/v1/network')).json()).data;
    const boxId = before.cables[0].endEquipmentId;
    const b0 = before.equipment.find((e) => e.id === boxId), b1 = after.equipment.find((e) => e.id === boxId);
    const c1 = after.cables[0];
    const end = c1.coordinates.at(-1);
    log('box moved by drag', b1 && (b1.lat !== b0.lat || b1.lng !== b0.lng));
    log('cable end followed the box', !!end && end[0] === b1.lat && end[1] === b1.lng, 'length ' + before.cables[0].lengthMeters + ' -> ' + c1.lengthMeters);
    log('pin fixed again after the drop', !(await has('Drag .* to its new place')));
  }
  void startDrag;
}

console.log('--- 4 add customer');
await closeAll();
await tap('Add customer');
await sleep(500);
await shot('8-customer');
await check('Subscriber Full Name', 'Subscriber Full Name');
await check('Access Terminal', 'Access Terminal');
const typeBy = async (label, value) => {
  const ok = await p.evaluate((label) => {
    const l = [...document.querySelectorAll('label')].find((x) => x.innerText.includes(label));
    const i = l?.parentElement?.querySelector('input');
    if (!i) return false;
    i.focus();
    i.select?.();
    return true;
  }, label);
  log(`type into ${label}`, ok);
  if (ok) await p.keyboard.type(value);
};
await typeBy('Subscriber Full Name', 'Walk Test');
await typeBy('Mobile Contact Phone', '9876543210');
{
  const chosen = await pickConnection(p);
  log('nothing preselected; chose box, splitter (ratio picked) and a free output', !!(chosen.box && chosen.splitter && chosen.port), JSON.stringify(chosen));
}
// Phase 12: the wizard shows the path from the fibre links before saving (missing parts say Not recorded).
await check('path from the fibre links shown before saving', 'Path from the fibre links');
console.log('path panel:', (await p.evaluate(() => [...document.querySelectorAll('div')].find((d) => d.innerText?.startsWith('Path from the fibre links'))?.parentElement?.innerText ?? '')).replace(/s+/g,' ').slice(0,300));
log('No OLT reachable NOT shown', !(await has('No OLT reachable')));
await tap('Use my GPS');
await sleep(1200);
log('house location filled from GPS', await p.evaluate(() => { const l = [...document.querySelectorAll('label')].find((x) => x.innerText.includes('Latitude')); return !!l?.parentElement?.querySelector('input')?.value; }));
log('no generated ONT serial', await p.evaluate(() => { const l = [...document.querySelectorAll('label')].find((x) => x.innerText.includes('ONT Serial')); return l?.parentElement?.querySelector('input')?.value === ''; }));
await typeBy('ONT Serial Number', 'ZTEG00000001');
await shot('9-customer-filled');
await tap('Activate Subscriber');
await sleep(1000);
{
  // The fiber path from this new box is not recorded, so the app says so and asks first.
  const asked = await p.evaluate(() => {
    const d = [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].find((x) => x.getBoundingClientRect().width > 0);
    return d ? d.innerText.slice(0, 300) : null;
  });
  console.log('asked before saving:', JSON.stringify(asked));
  if (asked) {
    await p.evaluate(() => {
      const b = [...document.querySelectorAll('[role="dialog"] button,[role="alertdialog"] button')].find((x) => /save|anyway|yes|continue/i.test(x.innerText));
      b?.click();
    });
    await sleep(1200);
  }
}
h = await health();
log('customer saved', h.counts.customers >= 1, `customers=${h.counts.customers}`);

console.log('--- 5 check');
await p.keyboard.press('Escape').catch(() => {});
const search = await p.$("input[placeholder*=\"Search boxes\"]");
log("search bar present", !!search);
if (search) { await search.click(); await p.keyboard.type("Walk Test"); await sleep(700); await shot("10a-search"); await tap("Walk Test"); await sleep(900); if (phone) { await tap("Details", { exact: true }); await sleep(700); } }
await shot('10-customer-panel');
log("Service path shown", await p.evaluate(() => /service path/i.test(document.body.innerText)));
console.log("service path text:", await p.evaluate(() => { const s = document.body.innerText; const i = s.toLowerCase().indexOf("service path"); return i < 0 ? "none" : s.slice(i, i + 260).replace(/s+/g, " "); }));
await tap('Trace service path', { noForce: false });
await sleep(800);
await p.keyboard.press('Escape').catch(() => {});

console.log('--- other jobs');
await p.evaluate(() => [...document.querySelectorAll('[aria-label="Close"]')].forEach((e) => e.click()));
await sleep(300);
if (phone) await tap('Open menu');
await p.evaluate(() => document.querySelector('[aria-label="Create"]')?.click());
await sleep(300);
console.log('plus menu buttons', await p.evaluate(() => [...document.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') || b.title).filter(Boolean).slice(0, 30).join('; ')));
const fault = await tap('Report a fault', { noForce: true });
if (fault) {
  await check('Report Outage in window', 'Report Outage');
}
await p.keyboard.press('Escape').catch(() => {});
await p.evaluate(() => [...document.querySelectorAll('[aria-label="Close"]')].forEach((e) => e.click()));
await p.goto(BASE + '/operations');
await sleep(1200);
await check('Create Work Order on Operations', 'Create Work Order');
log('Report Outage NOT on Operations (guide corrected)', !(await has('Report Outage')));
await p.goto(BASE + '/agent-tracking');
await sleep(1000);
await check('Start Duty on Agent Tracking', 'Start Duty');
await p.goto(BASE + '/field-work');
await sleep(1000);
await check('Open Biker Mode on Field Work', 'Open Biker Mode');

console.log('final', JSON.stringify((await health()).counts));
await finish();
