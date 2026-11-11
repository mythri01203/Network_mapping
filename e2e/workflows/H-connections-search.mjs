// Workflow H (with F, G and J): a splitter output marked faulty, the connections of a box and a recorded
// check, a customer path fixed from the links, search by serial and the attribute table, and a
// read-only account that sees no customer names.
// Ported from the scratch walkthrough w4-walk.mjs. Temp server on 127.0.0.1:5056 only (see e2e/run.mjs).
import { BASE, finish, network, openApp, seed as storeSeed, sleep, log } from '../lib/harness.mjs';

// ---------------------------------------------------------------- seed (temp server only)
const LAT = 12.9352;
const LNG = 77.6245;
const eq = (id, name, type, category, lat, lng, extra = {}) => ({ id, name, type, category, lat, lng, area: '', street: '', status: 'Active', images: [], installedDate: '', locationMethod: 'map_pick', ...extra });
const cores = (n) => Array.from({ length: n }, (_, i) => ({ coreNumber: i + 1, status: 'Available' }));
const P = { olt: [LAT, LNG], fat: [LAT + 0.0015, LNG + 0.002], home: [LAT + 0.0019, LNG + 0.0024] };
const outputs = Array.from({ length: 8 }, (_, i) => ({ portNumber: i + 1, label: String(i + 1), status: 'Available' }));
outputs[0] = { ...outputs[0], status: 'Occupied', connectedCustomerId: 'CUST-1', connectedDropCableId: 'DROP-1', connectedCore: 1 };
const seed = {
  upserts: {
    equipment: [
      eq('OLT-1', 'OLT Main', 'OLT', 'Central Office', ...P.olt, { technology: 'GPON', serialNumber: 'ZTE-SN-777' }),
      eq('FAT-1', 'Box 1', 'FAT', 'Fiber Distribution', ...P.fat, { totalPorts: 8 }),
    ],
    cables: [
      { id: 'FDR-1', name: 'Feeder A', type: 'Main Feeder Fiber', fiberCount: 12, lengthMeters: 260, owner: '', installationDate: '', status: 'Active', coordinates: [P.olt, P.fat], startEquipmentId: 'OLT-1', endEquipmentId: 'FAT-1', cores: cores(12), cableCategory: 'Fiber' },
      { id: 'DROP-1', name: 'Drop to Asha', type: 'Drop Fiber', fiberCount: 2, lengthMeters: 60, owner: '', installationDate: '', status: 'Active', coordinates: [P.fat, P.home], startEquipmentId: 'FAT-1', cores: cores(2), cableCategory: 'Fiber' },
    ],
    splitters: [{ id: 'SPL-1', name: 'Splitter 1', terminalBoxId: 'FAT-1', ratio: '1:8', insertionLossDb: 10.5, status: 'Active', inputPort: { id: 'in' }, outputPorts: outputs }],
    // The splitter output names Asha and her drop fibre; her own record does not say yet.
    customers: [
      {
        id: 'CUST-1', name: 'Asha Rao', mobile: '9845012345', address: '12 Temple Road', area: '', lat: P.home[0], lng: P.home[1], serviceType: 'Fiber Broadband', plan: '', status: 'Active', installationDate: '',
        oltId: '', ponPort: '', feederCableId: '', distributionCableId: '', terminalBoxId: '', splitterId: '', splitterOutputPort: 0, dropCableId: '', fiberCore: 0, ontSerialNumber: '', routerModel: '', ipAddress: '',
      },
    ],
  },
};
await storeSeed(seed);

// ---------------------------------------------------------------- browser
const app = await openApp({ uiMode: 'pro', printStub: true });
const { p, phone, shot, hasRaw, revealInTabs, visibleSel, tapId, tapText, setField, chooseByText, closePanels, find, typeInto, tapFirst } = app;
await app.collapseToolbox();
let data;

console.log('--- Phase 11: mark a splitter output faulty');
await find('Box 1', 'Box 1');
await tapId('splitter-out-2');
await tapId('splitter-mark-faulty');
await typeInto('splitter-mark-reason', 'Adapter cracked');
await tapId('splitter-mark-save');
await sleep(1500);
data = await network();
const out2 = data.splitters[0].outputPorts.find((o) => o.portNumber === 2);
log('output 2 marked faulty with the reason in its history', out2?.status === 'Faulty' && /Adapter cracked/.test(JSON.stringify(out2?.history ?? data.splitters[0].history ?? [])), out2?.status);
log('splitter place worked out from records, shown as a suggestion', await visibleSel('[data-testid="splitter-place"]'));
await shot('11-splitter');

console.log('--- Phase 13: connections of the box, and a recorded check');
log('connections panel lists the links', await visibleSel('[data-testid="connections-panel"]') || (await revealInTabs(() => visibleSel('[data-testid="connections-panel"]'))));
await tapFirst('connection-record-check-', 'record a check');
await tapId('link-check-method-visual');
await tapId('link-check-result-pass');
await typeInto('link-check-by', 'Ravi');
await setField('link-check-date', '2026-11-10');
await tapId('link-check-save');
await sleep(800);
// No photo or reading: the app asks first, as it should.
log('a check with no evidence asks before saving', await hasRaw('nobody can see what was checked'));
if (await hasRaw('Save anyway')) await tapText('Save anyway');
await sleep(1200);
data = await network();
const chk = (data.linkVerifications ?? [])[0];
log('check saved with method, result and who', !!chk && chk.method === 'visual' && chk.result === 'pass' && /Ravi/.test(JSON.stringify(chk)), JSON.stringify(chk ?? null).slice(0, 160));
await shot('13-connections');
await closePanels();

console.log('--- Phase 12: fix a customer path from the links');
await p.goto(BASE + '/customers');
await sleep(2500);
await tapText('Check customer paths');
await sleep(900);
log('path check lists the customer', /Asha|CUST-1/.test(await p.evaluate(() => document.querySelector('[data-testid="path-check"]')?.innerText ?? '')));
await shot('12-path-check');
if (await hasRaw('Choose all')) await tapText('Choose all');
await tapId('fix-paths');
await sleep(600);
if (await hasRaw('Fix them')) await tapText('Fix them');
await sleep(1500);
data = await network();
const asha = data.customers.find((c) => c.id === 'CUST-1');
log('customer path filled in from the links', asha?.terminalBoxId === 'FAT-1' && asha?.splitterId === 'SPL-1' && asha?.dropCableId === 'DROP-1', JSON.stringify({ box: asha?.terminalBoxId, spl: asha?.splitterId, drop: asha?.dropCableId }));
await p.keyboard.press('Escape');
await p.goto(BASE + '/');
await sleep(2500);

console.log('--- Phase 16: search by serial, attribute table');
{
  let input = await p.$('input[aria-label="Search network"]');
  if (!(input && (await p.evaluate((e) => e.getBoundingClientRect().width > 0, input)))) {
    await p.evaluate(() => [...document.querySelectorAll('button')].find((x) => /search/i.test(x.getAttribute('aria-label') ?? ''))?.click());
    await sleep(400);
    input = await p.$('input[aria-label="Search network"]');
  }
  await input.click({ clickCount: 3 });
  await p.keyboard.type('ZTE-SN-777');
  await sleep(700);
  log('search by serial finds the OLT', /OLT Main/.test(await p.evaluate(() => document.querySelector('#global-search-results')?.innerText ?? '')));
  await p.keyboard.press('Escape');
}
await closePanels();
// On a phone the table opens from the selection bar only (noted as a gap); checked on desktop.
if (!phone) {
if (!(await visibleSel('[data-testid="attribute-table"]'))) {
  await p.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Attribute table' && b.getBoundingClientRect().width > 0)?.click());
  await sleep(800);
}
if (!(await visibleSel('[data-testid="attribute-table"]'))) {
  await p.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Attribute table/.test(b.innerText) && b.getBoundingClientRect().width > 0)?.click());
  await sleep(800);
}
log('attribute table opens', await visibleSel('[data-testid="attribute-table"]'));
await chooseByText('table-layer', 'Cables');
await sleep(500);
log('table counts the cables from the records', /\b2\b/.test(await p.evaluate(() => document.querySelector('[data-testid="table-count"]')?.innerText ?? '')), await p.evaluate(() => document.querySelector('[data-testid="table-count"]')?.innerText ?? ''));
await p.evaluate(() => document.querySelector('[data-testid="table-choose-shown"]')?.click());
await sleep(600);
log('choosing rows fills the map selection', /2/.test(await p.evaluate(() => document.querySelector('[data-testid="selection-count"]')?.innerText ?? '')), await p.evaluate(() => document.querySelector('[data-testid="selection-count"]')?.innerText ?? ''));
await shot('16-table');
}

console.log('--- Phase 12: a Read-only account sees no customer names');
const raw = async (path, init = {}, cookie) => {
  const res = await fetch(`${BASE}/api/v1${path}`, { ...init, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) } });
  return { status: res.status, cookie: (res.headers.get('set-cookie') ?? '').split(';')[0], body: await res.json().catch(() => null) };
};
const owner = (await raw('/auth/setup', { method: 'POST', body: JSON.stringify({ username: 'owner', displayName: 'Owner', password: 'owner-pass-123' }) })).cookie;
await raw('/users', { method: 'POST', body: JSON.stringify({ username: 'look', displayName: 'Looker', role: 'viewer', password: 'look-pass-123' }) }, owner);
const vLogin = await raw('/auth/login', { method: 'POST', body: JSON.stringify({ username: 'look', password: 'look-pass-123' }) });
const vChanged = await raw('/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword: 'look-pass-123', newPassword: 'look-pass-456' }) }, vLogin.cookie);
const viewer = vChanged.cookie || vLogin.cookie;
const seen = await raw('/network', {}, viewer);
const text = JSON.stringify(seen.body ?? '');
log('viewer gets the network without the name, address or mobile', seen.status === 200 && !text.includes('Asha Rao') && !text.includes('9845012345') && !text.includes('Temple Road') && text.includes('CUST-1'), `status ${seen.status}`);
const ownerSees = await raw('/network', {}, owner);
log('the owner still sees the name', JSON.stringify(ownerSees.body ?? '').includes('Asha Rao'));

await finish({ app });
