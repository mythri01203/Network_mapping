// Workflow B (with E and F): turn a cable round and open the route editor, a splice entered by mistake
// stays in history, an ODF port marked faulty, sites and racks, and the map-area query and catch-up.
// Ported from the scratch walkthrough w2-walk.mjs. Temp server on 127.0.0.1:5056 only (see e2e/run.mjs).
import { api, BASE, finish, network, openApp, seed as storeSeed, sleep, log } from '../lib/harness.mjs';

// ---------------------------------------------------------------- seed (temp server only)
const LAT = 12.9352;
const LNG = 77.6245;
const eq = (id, name, type, category, lat, lng, extra = {}) => ({ id, name, type, category, lat, lng, area: '', street: '', status: 'Active', images: [], installedDate: '', locationMethod: 'map_pick', ...extra });
const cores = (n) => Array.from({ length: n }, (_, i) => ({ coreNumber: i + 1, status: 'Available' }));
const cab = (id, name, type, from, to, coords) => ({ id, name, type, fiberCount: 12, lengthMeters: 300, owner: '', installationDate: '', status: 'Active', coordinates: coords, startEquipmentId: from, endEquipmentId: to, cores: cores(12), cableCategory: 'Fiber' });
const P = { odf: [LAT, LNG], jc: [LAT + 0.0012, LNG + 0.0016], fat: [LAT + 0.0016, LNG + 0.0028] };
const ports = Array.from({ length: 12 }, (_, i) => ({ id: `X${i + 1}`, number: i + 1, status: 'available' }));
const seed = {
  upserts: {
    equipment: [
      eq('ODF-1', 'ODF Main', 'ODF', 'Central Office', ...P.odf, { odfPanels: [{ id: 'PA', label: 'A', ports }] }),
      eq('JC-1', 'Joint 1', 'Fiber Joint Closure', 'Fiber Distribution', ...P.jc),
      eq('FAT-1', 'Box 1', 'FAT', 'Fiber Distribution', ...P.fat, { totalPorts: 8 }),
    ],
    cables: [
      cab('FDR-1', 'Feeder A', 'Main Feeder Fiber', 'ODF-1', 'JC-1', [P.odf, [LAT + 0.0007, LNG + 0.0004], P.jc]),
      cab('DST-1', 'Street B', 'Distribution Fiber', 'JC-1', 'FAT-1', [P.jc, P.fat]),
    ],
    closures: [
      {
        id: 'CL-1', name: 'Joint 1 closure', closureType: 'Dome Splice Closure', equipmentId: 'JC-1', lat: P.jc[0], lng: P.jc[1], area: '', entryPortsCount: 0, exitPortsCount: 0, installationDate: '', technician: '', images: [],
        cableEntries: [{ cableId: 'FDR-1', role: 'in' }, { cableId: 'DST-1', role: 'out' }],
        splices: [{ id: 'SPC-1', inputCableId: 'FDR-1', inputCableName: 'Feeder A', inputCore: 1, outputCableId: 'DST-1', outputCableName: 'Street B', outputCore: 1, status: 'Spliced', technician: '', date: '' }],
      },
    ],
  },
};
await storeSeed(seed);

// ---------------------------------------------------------------- browser
const app = await openApp({ uiMode: 'pro', printStub: true });
const { p, shot, hasRaw, visibleSel, tapId, tapText, closePanels, find, typeInto } = app;
await app.collapseToolbox();
let data = await network();
const before = data.cables.find((c) => c.id === 'FDR-1');

console.log('--- Phase 5: turn a cable round; the route editor opens');
await find('Feeder A', 'Feeder A');
await tapText('CHANGE THE ROUTE');
await sleep(400);
await tapText('Turn round (swap From and To)');
await sleep(600);
for (const t of ['Turn round', 'Yes, turn it round', 'Confirm']) if (await hasRaw(`^${t}$`)) await tapText(t);
await sleep(1200);
data = await network();
const after = data.cables.find((c) => c.id === 'FDR-1');
log('ends swapped and the line reversed', after.startEquipmentId === 'JC-1' && after.endEquipmentId === 'ODF-1' && JSON.stringify(after.coordinates) === JSON.stringify([...before.coordinates].reverse()), `${after.startEquipmentId} → ${after.endEquipmentId}`);
log('fibres kept', after.cores.length === 12);
if (!(await hasRaw('Change the line'))) await tapText('CHANGE THE ROUTE');
await tapText('Change the line');
await sleep(800);
log('route editor bar shown with its tools', await visibleSel('[data-testid="route-edit-bar"]') && (await p.evaluate(() => document.querySelectorAll('[data-testid^="route-tool-"]').length)) >= 5);
await shot('5-route-edit');
await tapId('route-edit-done');
await sleep(400);
await closePanels();

console.log('--- Phase 8: a splice entered by mistake stays in history');
await find('Joint 1', 'Joint 1');
await tapText('Splice records');
await sleep(1000);
log('splice picture shown', await visibleSel('[data-testid="splice-diagram"]'));
await tapId('splice-mistake-SPC-1');
await typeInto('splice-mistake-SPC-1-reason', 'Wrong fiber chosen');
await tapId('splice-mistake-SPC-1-confirm');
await sleep(1500);
data = await network();
const spc = data.closures[0].splices.find((s) => s.id === 'SPC-1');
log('splice kept, marked as a mistake with the reason', !!spc && spc.enteredInError === true && !!spc.retiredAt && /Wrong fiber/.test(spc.retiredReason ?? ''), JSON.stringify(spc ?? null).slice(0, 160));
await shot('8-splicing');
await p.keyboard.press('Escape');
await closePanels();

console.log('--- Phase 9: mark an ODF port faulty; sites and racks');
await find('ODF Main', 'ODF Main');
await tapId('odf-port-1');
await tapId('odf-mark-faulty');
await typeInto('odf-mark-reason', 'Adapter broken');
await tapId('odf-mark-save');
await sleep(1500);
data = await network();
const port1 = data.equipment.find((e) => e.id === 'ODF-1').odfPanels[0].ports.find((x) => x.number === 1);
log('port 1 marked faulty with the reason in its history', port1.status === 'damaged' && /Adapter broken/.test(JSON.stringify(port1.history ?? [])), port1.status);
await shot('9-odf');
await closePanels();
await p.goto(BASE + '/olt-rack');
await sleep(2500);
await tapText('Sites and racks');
await sleep(600);
await tapId('site-add');
await typeInto('site-name', 'CO-1');
await tapId('site-save-new');
await sleep(1200);
await tapId('rack-add');
await typeInto('rack-name', 'Rack A');
await typeInto('rack-height', '42');
await tapId('rack-save-new');
await sleep(1200);
data = await network();
log('site and rack saved as records', data.sites?.length === 1 && data.racks?.length === 1 && data.racks[0].siteId === data.sites[0].id, JSON.stringify({ sites: data.sites?.length, racks: data.racks?.length }));
await shot('9-sites');

console.log('--- Phase 24a: map-area query and catch-up');
const area = await api(`/network/area?bbox=${LAT - 0.001},${LNG - 0.001},${LAT + 0.0005},${LNG + 0.0005}`);
const areaText = JSON.stringify(area.body ?? '');
log('area query returns what is in the box, not what is outside', area.status === 200 && areaText.includes('ODF-1') && !areaText.includes('FAT-1'), `status ${area.status}`);
const health = await api('/health');
const rev = health.body?.revision ?? 0;
await api('/changes', { method: 'POST', body: JSON.stringify({ upserts: { equipment: [{ ...data.equipment.find((e) => e.id === 'FAT-1'), name: 'Box 1 renamed' }] } }) });
const since = await api(`/changes?since=${rev}`);
log('catch-up returns only what changed since', since.status === 200 && JSON.stringify(since.body).includes('Box 1 renamed') && !JSON.stringify(since.body).includes('Joint 1 closure'), `status ${since.status}`);

await finish({ app });
