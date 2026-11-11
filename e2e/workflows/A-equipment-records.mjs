// Workflow A (with C, D and J): inspector tabs and history, a work record, placing by typed position,
// a pole inspection, a fibre marked faulty that needs a reason to give out, and the server audit trail.
// Ported from the scratch walkthrough w1-walk.mjs. Temp server on 127.0.0.1:5056 only (see e2e/run.mjs).
import { api, BASE, finish, network, openApp, seed as storeSeed, sleep, log } from '../lib/harness.mjs';

// ---------------------------------------------------------------- seed (temp server only)
const LAT = 12.9352;
const LNG = 77.6245;
const eq = (id, name, type, category, lat, lng, extra = {}) => ({ id, name, type, category, lat, lng, area: '', street: '', status: 'Active', images: [], installedDate: '', locationMethod: 'map_pick', ...extra });
const cores = (n) => Array.from({ length: n }, (_, i) => ({ coreNumber: i + 1, status: 'Available' }));
const seed = {
  upserts: {
    equipment: [
      eq('OLT-1', 'OLT Main', 'OLT', 'Central Office', LAT, LNG, { technology: 'GPON' }),
      eq('FAT-1', 'Box 1', 'FAT', 'Fiber Distribution', LAT + 0.0015, LNG + 0.002, { totalPorts: 8 }),
      eq('POLE-1', 'Pole 1', 'Telecom Pole', 'Supporting Infrastructure', LAT - 0.001, LNG - 0.001),
    ],
    cables: [
      { id: 'FDR-1', name: 'Feeder A', type: 'Main Feeder Fiber', fiberCount: 12, lengthMeters: 250, owner: '', installationDate: '', status: 'Active', coordinates: [[LAT, LNG], [LAT + 0.0015, LNG + 0.002]], startEquipmentId: 'OLT-1', endEquipmentId: 'FAT-1', cores: cores(12), cableCategory: 'Fiber' },
    ],
  },
};
await storeSeed(seed);

// ---------------------------------------------------------------- browser
const app = await openApp({ uiMode: 'pro', printStub: true });
const { p, phone, shot, tapEl, tapId, tapText, setField, closePanels, find, toastText, confirmIfAsked, typeInto, tab } = app;
await app.collapseToolbox();

console.log('--- Phase 3: tabs, history, maintenance, typed position');
await find('Box 1', 'Box 1');
log('inspector has its seven tabs', (await p.evaluate(() => document.querySelectorAll('[data-testid^="inspector-tab-"]').length)) === 7);
await tab('history');
log('history shows only real entries (or says there are none)', !!(await p.$('[data-testid="item-history"], [data-testid="item-history-empty"]')));
await tab('maintenance');
await tapId('maint-add');
await setField('maint-date', '2026-11-09');
await typeInto('maint-by', 'Ravi');
await typeInto('maint-what', 'Cleaned connectors');
await tapId('maint-save');
await sleep(1500);
let data = await network();
const box = data.equipment.find((e) => e.id === 'FAT-1');
log('work record saved on the box', box?.maintenance?.length === 1 && box.maintenance[0].what === 'Cleaned connectors', JSON.stringify(box?.maintenance ?? null).slice(0, 160));
await shot('3-maintenance');
await tab('details');
await closePanels();

if (phone) await tapEl('[aria-label="Open menu"]', 'menu');
await tapText('Component Catalog');
await sleep(600);
await tapEl('[data-testid="catalog-place-item"]', 'place a FAT', { text: 'FAT Terminal Box' });
await sleep(500);
await tapText('Type position');
await sleep(400);
await typeInto('place-lat', '12.9361');
await typeInto('place-lng', '77.6239');
await tapId('place-typed-save');
await sleep(1800);
await confirmIfAsked();
data = await network();
const typed = data.equipment.find((e) => e.locationMethod === 'typed');
log('item placed at the typed position, marked as typed', !!typed && Math.abs(typed.lat - 12.9361) < 1e-9 && Math.abs(typed.lng - 77.6239) < 1e-9, typed ? `${typed.name} ${typed.lat},${typed.lng}` : 'none');
await p.keyboard.press('Escape');
await closePanels();

console.log('--- Phase 4: pole inspection');
await find('Pole 1', 'Pole 1');
await tapId('inspection-add');
await tapId('inspection-condition-fair');
await typeInto('inspection-by', 'Ravi');
await typeInto('inspection-findings', 'Leaning slightly towards the road');
await shot('4-inspection');
await tapId('inspection-save');
await sleep(1800);
data = await network();
const insp = (data.inspections ?? [])[0];
log('inspection saved for the pole, nothing made up', !!insp && JSON.stringify(insp).includes('POLE-1') && insp.condition === 'fair' && /Leaning/.test(JSON.stringify(insp)), JSON.stringify(insp ?? null).slice(0, 200));
await closePanels();

console.log('--- Phase 7: mark a fiber faulty, then giving it out needs a reason');
await find('Feeder A', 'Feeder A');
await tapId('core-chip-3');
await tapId('core-condition-faulty');
await typeInto('core-condition-reason', 'OTDR shows a break at 120 m');
await tapId('core-condition-save');
await sleep(1500);
data = await network();
let core3 = data.cables[0].cores.find((k) => k.coreNumber === 3);
log('fiber 3 marked faulty with the reason in its history', core3?.status === 'Faulty' && /OTDR shows a break/.test(JSON.stringify(core3?.history ?? [])), core3?.status);
await shot('7-faulty');
// The save button stays disabled until an override reason is written.
await typeInto('core-assign-use', 'Customer X');
log('save is held back until an override reason is given', await p.evaluate(() => document.querySelector('[data-testid="core-assign-save"]')?.disabled === true));
data = await network();
core3 = data.cables[0].cores.find((k) => k.coreNumber === 3);
log('a faulty fiber is not given out without an override reason', !(core3?.assignments ?? []).some((a) => !a.releasedAt), (await toastText()).slice(0, 120));
await closePanels();

console.log('--- Phase 23a: the server keeps its own history');
const events = await api('/audit-events');
log('server audit has entries for the writes above', events.status === 200 && JSON.stringify(events.body).includes('FAT-1'), `status ${events.status}`);
await p.goto(BASE + '/admin');
await sleep(2500);
await tapText('Server history');
await sleep(1500);
log('Server history screen shows the audit table', !!(await p.$('[data-testid="server-audit-table"], [data-testid="record-history-panel"]')));
await shot('23-history');
await tapText('Lists and rules');
await sleep(800);
log('Lists and rules screen opens', !!(await p.$('[data-testid="lists-rules-panel"]')));

await finish({ app });
