// Workflow C (with K): Phase 3 walkthrough: spans, attachments (engineer answers), lengths, pole details, permission,
// duplicate warning, duct with occupancy, KML and KMZ import. (Workflow C, with K.)
// Ported from the scratch walkthrough routes-walk.mjs. Temp server on 127.0.0.1:5056 only (see e2e/run.mjs).
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { BASE, finish, log, network, OUT, openApp, REPO_ROOT, seed as storeSeed, sleep } from '../lib/harness.mjs';

// fflate is already a dependency of the server; nothing is installed for the walk.
const { zipSync, strToU8 } = createRequire(join(REPO_ROOT, 'apps', 'server', 'package.json'))('fflate');

// ---------------------------------------------------------------- seed (temp server only)
const now = '2026-11-07T10:00:00.000Z';
const eq = (id, name, type, lat, lng) => ({
  id, name, type, category: 'Supporting Infrastructure', lat, lng, area: '', street: '', status: 'Active', images: [], installedDate: '', locationMethod: 'map_pick',
});
const LAT = 12.9385;
const seed = {
  upserts: {
    equipment: [
      eq('P-A', 'P-A', 'Telecom Pole', LAT, 77.62705),
      eq('P-B', 'P-B', 'Telecom Pole', LAT, 77.6275),
      eq('P-C', 'P-C', 'Electric Pole', LAT + 0.00003, 77.62796),
      eq('P-FAR', 'P-FAR', 'Telecom Pole', LAT + 0.0009, 77.6275),
      eq('MH-1', 'MH-1', 'Manhole', LAT - 0.0004, 77.6275),
    ],
    cables: [
      {
        id: 'C-1', name: 'C-1', type: 'Aerial Fiber', fiberCount: 12, lengthMeters: 146, owner: '', installationDate: '', status: 'Active',
        coordinates: [[LAT, 77.627], [LAT, 77.62835]], cores: [], cableCategory: 'Fiber',
      },
    ],
    spans: [
      {
        id: 'SPN-SEED000001', name: 'P-A – P-B', fromStructureId: 'P-A', toStructureId: 'P-B', status: 'proposed', basis: 'field_sequence', createdAt: now,
        notes: 'The worker captured these two poles one after the other. That does not prove a cable runs between them.',
      },
    ],
  },
};
// The seed cable needs one core record per core; keep it simple and honest with 0 recorded cores of 12.
seed.upserts.cables[0].fiberCount = 0;
await storeSeed(seed);

// ---------------------------------------------------------------- sample KML and KMZ
const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Route sample</name>
<Style id="pole"><IconStyle><scale>1</scale></IconStyle></Style>
<Folder><name>Route A</name>
 <Folder><name>Poles</name>
  <Placemark><name>KA-1</name><description>Near the temple</description><styleUrl>#pole</styleUrl>
   <ExtendedData><Data name="owner"><value>BESCOM</value></Data><Data name="pole_no"><value>114</value></Data></ExtendedData>
   <Point><coordinates>77.6290,12.9392,0</coordinates></Point></Placemark>
  <Placemark><name>KA-2</name><styleUrl>#pole</styleUrl><Point><coordinates>77.6295,12.9392,0</coordinates></Point></Placemark>
  <Placemark><name>KA-3</name><styleUrl>#pole</styleUrl><Point><coordinates>77.6300,12.9392,0</coordinates></Point></Placemark>
  <Placemark><name>Swapped</name><styleUrl>#pole</styleUrl><Point><coordinates>12.9392,77.6300,0</coordinates></Point></Placemark>
 </Folder>
 <Folder><name>Cable</name>
  <Placemark><name>KA line</name><LineString><coordinates>77.6290,12.9392,0 77.6295,12.9392,0 77.6300,12.9392,0</coordinates></LineString></Placemark>
 </Folder>
 <Placemark><name>Ward boundary</name><Polygon><outerBoundaryIs><LinearRing><coordinates>77.62,12.93 77.63,12.93 77.63,12.94 77.62,12.93</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
</Folder></Document></kml>`;
const kmzDoc = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<Folder><name>Route B</name>
 <Folder><name>Poles</name>
  <Placemark><name>KB-same-as-P-A</name><Point><coordinates>77.62705,12.9385,0</coordinates></Point></Placemark>
  <Placemark><name>KB-2</name><Point><coordinates>77.6262,12.9380,0</coordinates></Point></Placemark>
 </Folder>
 <Folder><name>Ducts</name>
  <Placemark><name>KB duct</name><LineString><coordinates>77.6262,12.9380,0 77.6268,12.9380,0</coordinates></LineString></Placemark>
 </Folder>
</Folder></Document></kml>`;
const kmlPath = join(OUT, 'sample-route.kml');
const kmzPath = join(OUT, 'sample-route.kmz');
writeFileSync(kmlPath, kml);
writeFileSync(kmzPath, zipSync({ 'doc.kml': strToU8(kmzDoc), 'files/icon.png': new Uint8Array([137, 80, 78, 71]) }));

// ---------------------------------------------------------------- browser
const app = await openApp({ uiMode: null, geolocation: null, permissions: [] });
const { p, phone, shot, check, tapEl, tapId, setField, chooseByText } = app;
const tapText = (text) => tapEl('button,a,[role=button],[role=radio],label,summary', `"${text}"`, { text });
const markerAt = (label) =>
  p.evaluate((label) => {
    const e = document.querySelector(`[aria-label="${label}"]`);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, label);
async function tapMap(x, y) {
  if (phone) await p.touchscreen.tap(x, y);
  else await p.mouse.click(x, y);
  await sleep(700);
}
/** On a phone a selected item shows a small bar with Details; when the inspector is already open there is none. */
async function openDetails() {
  const open = await p.evaluate(() => !!document.querySelector('aside[aria-label="Inspector"]'));
  if (phone && !open) await tapText('Details');
  await sleep(500);
}
async function closePanel() {
  if (!phone) return;
  await p.evaluate(() => document.querySelector('aside[aria-label="Inspector"] [aria-label="Close"]')?.click());
  await sleep(400);
}
async function selectMarker(label) {
  const at = await markerAt(label);
  if (!at) return log(`marker ${label} on the map`, false, 'NOT FOUND');
  await tapMap(at.x, at.y);
  await openDetails();
}

// ---------------------------------------------------------------- map setup
if (await p.evaluate(() => [...document.querySelectorAll('[aria-label="Collapse Toolbox"]')].some((e) => e.getBoundingClientRect().width > 0))) {
  await p.evaluate(() => document.querySelector('[aria-label="Collapse Toolbox"]').click());
}
await p.evaluate(async (z) => {
  const zin = document.querySelector('[aria-label="Zoom in"]');
  for (let i = 0; zin && i < z; i += 1) {
    zin.click();
    await new Promise((r) => setTimeout(r, 450));
  }
}, phone ? 2 : 3);
await sleep(1200);
console.log('hscroll', await p.evaluate(() => document.documentElement.scrollWidth > innerWidth));

console.log('--- 1 proposed span from the field order is dashed');
const dash = await p.evaluate(() => [...document.querySelectorAll('path.osp-span')].map((e) => e.getAttribute('stroke-dasharray')));
log('proposed span drawn dashed', dash.length === 1 && dash[0] === '6 7', JSON.stringify(dash));
await shot('1-dashed-span');

console.log('--- 2 pole inspector: nothing recorded yet');
await selectMarker('Telecom Pole P-A');
await check('pole says no cables recorded', 'No cables are recorded on this pole');
await check('pole lists the proposed span', 'Proposed, not confirmed');
await check('pole details show Not recorded', 'Not recorded');

console.log('--- 3 confirm the proposed span');
await tapText('To P-B');
await openDetails();
await check('span asks to confirm', 'Proposed span: please confirm');
await shot('3-span-confirm');
await tapId('span-confirm-built');
await sleep(2500);
let data = await network();
log('span confirmed as built on the server', data.spans[0]?.status === 'built' && data.spans[0]?.basis === 'field_sequence');
const dashAfter = await p.evaluate(() => document.querySelector('path.osp-span')?.getAttribute('stroke-dasharray'));
log('confirmed span drawn solid', dashAfter === null, String(dashAfter));

console.log('--- 4 record the cable on the span');
await setField('span-cable-select', 'C-1');
await tapId('span-cable-status-built');
await tapId('span-cable-save');
await sleep(2500);
data = await network();
log('attachment on the span saved', data.attachments.length === 1 && data.attachments[0].spanId === 'SPN-SEED000001');

console.log('--- 5 engineer answer: cables on this pole');
await tapEl('[title="Select P-A"]', 'P-A link');
await openDetails();
await check('P-A lists C-1 as a cable on this pole', 'C-1[\\s\\S]*On span');

console.log('--- 6 engineer answer: poles supporting this route, with confirmed suggestions');
await tapEl('[title="Select C-1"]', 'C-1 link');
await openDetails();
await check('cable lists poles supporting the route', 'Poles supporting this route[\\s\\S]*P-A[\\s\\S]*P-B');
await tapId('suggest-poles');
await check('suggestion warns that near is not attached', 'Being near the line does not mean the cable is on the pole');
const suggested = await p.evaluate(() => [...document.querySelectorAll('[data-testid^="suggest-tick-"]')].map((e) => e.dataset.testid.slice(13)));
log('only the unrecorded near pole is suggested, none ticked', JSON.stringify(suggested) === '["P-C"]' && !(await p.evaluate(() => [...document.querySelectorAll('[data-testid^="suggest-tick-"]')].some((e) => e.checked))), JSON.stringify(suggested));
data = await network();
log('suggesting saved nothing', data.attachments.length === 1);
await tapId('suggest-tick-P-C');
await tapId('suggest-status-built');
await shot('6-suggestions');
await tapId('suggest-save');
await sleep(2500);
data = await network();
const onC = data.attachments.find((a) => a.structureId === 'P-C');
log('ticked pole saved as a confirmed attachment', !!onC && onC.basis === 'route_proposal_confirmed' && onC.status === 'built');
await check('route now lists P-C', 'Poles supporting this route[\\s\\S]*P-C');

console.log('--- 7 lengths kept apart');
await tapId('lengths-edit');
await setField('sheath-start', '1000');
await setField('sheath-end', '1160');
await setField('optical-length', '155');
await tapId('lengths-save');
await sleep(2500);
data = await network();
const cable = data.cables.find((c) => c.id === 'C-1');
log('sheath marks and optical length saved, drawn length untouched', cable.sheathMarkStart === 1000 && cable.sheathMarkEnd === 1160 && cable.opticalLengthMeters === 155 && cable.lengthMeters === 146);
await check('optical shorter than sheath is flagged', 'Optical length is 3.1% shorter');
await check('drawn length shown from the line', 'Drawn on the map');
await shot('7-lengths');

console.log('--- 8 pole details and permission on P-C');
await tapEl('[title="Select P-C"]', 'P-C link');
await openDetails();
await check('P-C answers cables on this pole', 'Cables on this pole[\\s\\S]*C-1');
await tapId('pole-details-edit');
await setField('pole-owner', 'BESCOM');
await setField('pole-height', '9');
await tapId('pole-details-save');
await sleep(1500);
await check('owner shown, material still Not recorded', 'BESCOM[\\s\\S]*|Material');
await tapId('permission-add');
await setField('permission-number', 'BES/RW/2026/14');
await setField('permission-from', '2026-01-01');
await setField('permission-until', '2026-12-31');
await setField('permission-rent', '300');
await setField('permission-rent-terms', 'per pole per year');
await tapId('permission-save');
await sleep(2500);
data = await network();
const pc = data.equipment.find((e) => e.id === 'P-C');
log('pole details saved without invented values', pc.ownerName === 'BESCOM' && pc.heightMeters === 9 && pc.material === undefined);
const perm = data.permissions[0];
log('permission saved as entered', perm?.authority === 'BESCOM' && perm.permitNumber === 'BES/RW/2026/14' && perm.rentAmount === 300 && perm.rentTerms === 'per pole per year' && perm.structureIds[0] === 'P-C');
await check('permission shown with rent as entered', '₹300 per pole per year');
await shot('8-permission');
await closePanel();

console.log('--- 9 duplicate warning before creating a pole');
const before = (await network()).equipment.length;
await p.evaluate(() => document.querySelector('[title="Open Equipment Toolbox"]')?.click());
await sleep(500);
await p.evaluate(() => document.querySelector('[title="Click or drag to place Fiber Pole (Telecom Pole)"]')?.click());
await sleep(500);
await p.evaluate(() => document.querySelector('[aria-label="Collapse Toolbox"]')?.click());
await sleep(500);
let pa = await markerAt('Telecom Pole P-A');
await tapMap(pa.x + 4, pa.y + 4);
await check('asks "Is this the same one?"', 'Is this the same one\\?');
await check('names the existing pole and distance', 'P-A \\(Telecom Pole\\) is already on the map about');
await shot('9-same-one');
await tapText('Same one: show it');
await sleep(1500);
log('"same one" added nothing', (await network()).equipment.length === before);
log('"same one" shows the existing pole', await p.evaluate(() => /P-A/.test(document.body.innerText)));
// "Show it" flies the map to the pole; wait for the move to end before tapping again.
await sleep(2500);
pa = await markerAt('Telecom Pole P-A');
await tapMap(pa.x + 1, pa.y + 1);
await shot('9b-second-tap');
await tapText('No, add a new one');
await sleep(2500);
data = await network();
log('"new one" is never blocked', data.equipment.length === before + 1);
log('the choice is in the audit trail', data.auditLogs.some((l) => l.action === 'POSSIBLE_DUPLICATE_KEPT'));
await tapText('Done');
await sleep(500);
await closePanel();

console.log('--- 10 duct with sub-ducts and occupancy');
await selectMarker('Manhole MH-1');
await tapId('start-duct');
await sleep(500);
const mh = await markerAt('Manhole MH-1');
await tapMap(mh.x - (phone ? 70 : 140), mh.y + 30);
await tapMap(mh.x - (phone ? 140 : 280), mh.y + 30);
await tapText('Finish');
await check('duct form opens', 'Save duct');
await check('duct form says a duct is not a cable', 'A duct is a structure');
await tapId('duct-status-built');
await setField('duct-subducts', 'Blue, Orange');
await tapId('duct-save');
await sleep(2500);
await openDetails();
await check('new duct says no cables recorded', 'No cables are recorded in this duct');
await setField('duct-cable-select', 'C-1');
await chooseByText('duct-cable-place', 'Sub-duct Blue');
await tapId('duct-cable-save');
await sleep(2500);
data = await network();
const duct = data.ducts[0];
log('duct saved from MH-1 with sub-ducts', duct?.fromStructureId === 'MH-1' && duct.subducts.map((s) => s.label).join() === 'Blue,Orange' && duct.coordinates.length === 3);
log('occupancy recorded in sub-duct Blue', duct?.subducts[0].cableIds[0] === 'C-1' && duct.cableIds.length === 0);
log('duct drawn on the map', (await p.evaluate(() => document.querySelectorAll('path.osp-duct').length)) === 1);
await shot('10-duct');
await closePanel();

console.log('--- 11 KML import: preview, person chooses, nothing assumed');
const counts0 = await network();
await p.goto(BASE + '/admin');
await sleep(2500);
await tapText('Backup & KML');
await tapId('admin-kml-import');
let input = await p.$('[data-testid="kml-file"]');
if (input) await input.uploadFile(kmlPath);
else log('file picker shown for KML', false, 'NOT FOUND');
await sleep(1500);
await check('preview counts placemarks', '6 placemark\\(s\\) found: 4 can be imported in 2 group\\(s\\), 2 cannot');
await tapEl('[data-testid="kml-skipped"] summary', 'skipped list');
await check('swapped point is skipped with its reason', 'Swapped[\\s\\S]*look swapped');
await check('area is skipped with its reason', 'Ward boundary[\\s\\S]*Areas \\(shapes\\) are not imported');
await check('extra data names are shown', 'Extra data kept: owner, pole_no');
log('import waits for a choice', await p.evaluate(() => document.querySelector('[data-testid="kml-import"]')?.disabled === true));
await shot('11-kml-preview');
await setField('kml-target-point-route-a-poles', 'Electric Pole');
await tapId('kml-status-point-route-a-poles-existing');
await setField('kml-target-line-route-a-cable', 'cable:Distribution Fiber');
await tapId('kml-status-line-route-a-cable-planned');
await check('import button counts items', 'Import 4 item\\(s\\)');
await tapId('kml-import');
await sleep(2500);
await check('result says nothing was connected', 'Nothing was connected');
data = await network();
const imported = data.equipment.filter((e) => e.importInfo?.fileName === 'sample-route.kml');
const ka1 = imported.find((e) => e.name === 'KA-1');
log('3 poles imported as electricity poles, accuracy unknown', imported.length === 3 && imported.every((e) => e.type === 'Electric Pole' && e.locationMethod === 'imported' && e.locationAccuracyMeters === undefined));
log('name, description and ExtendedData kept as written', ka1?.importInfo.description === 'Near the temple' && ka1.importInfo.extendedData.owner === 'BESCOM' && ka1.importInfo.folderPath === 'Route A / Poles' && ka1.ownerName === undefined);
const kaLine = data.cables.find((c) => c.importInfo?.fileName === 'sample-route.kml');
log('line imported as a planned cable with no ends connected', kaLine?.status === 'Planned' && !kaLine.startEquipmentId && !kaLine.endEquipmentId && kaLine.fiberCount === 0);
log('no spans or attachments inferred', data.spans.length === counts0.spans.length && data.attachments.length === counts0.attachments.length);
await tapId('kml-close');

console.log('--- 12 KMZ import with a point on an existing pole');
await tapId('admin-kml-import');
input = await p.$('[data-testid="kml-file"]');
if (input) await input.uploadFile(kmzPath);
else log('file picker shown for KMZ', false, 'NOT FOUND');
await sleep(1500);
await check('KMZ preview reads doc.kml', '3 placemark\\(s\\) found');
await setField('kml-target-point-route-b-poles', 'Telecom Pole');
await tapId('kml-status-point-route-b-poles-existing');
await setField('kml-target-line-route-b-ducts', 'duct');
await tapId('kml-status-line-route-b-ducts-existing');
await check('possible duplicate shown before import', '1 point\\(s\\) look like items already on the map[\\s\\S]*KB-same-as-P-A: 0 m from P-A');
await check('duplicate held back unless ticked', 'Import 2 item\\(s\\)');
await shot('12-kmz-duplicates');
await tapId('kml-import');
await sleep(2500);
data = await network();
log('KMZ added 1 new pole and 1 duct; the duplicate was not imported', data.equipment.filter((e) => e.importInfo?.fileName === 'sample-route.kmz').map((e) => e.name).join() === 'KB-2' && data.ducts.some((d) => d.basis === 'imported' && d.cableIds.length === 0));
await tapId('kml-close');

console.log('--- 13 office list of spans to confirm');
await p.goto(BASE + '/operations');
await sleep(2000);
await tapText('Field captures');
await check('operations lists proposed spans section', 'Spans to confirm');
await check('no proposed spans left after confirming', 'No proposed spans');

await finish({ app });
