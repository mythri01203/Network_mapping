// Workflow D (with E, F and H): Phase 4 walkthrough: example A built and traced core by core, a broken splice named exactly,
// a conflicting splice and a double allocation refused, a 96F non-TIA cable and an unknown scheme.
// Ported from the scratch walkthrough fiber-walk.mjs. Temp server on 127.0.0.1:5056 only (see e2e/run.mjs).
import { api, BASE, finish, makePhoto, network, openApp, pickConnection, seed as storeSeed, sleep, log } from '../lib/harness.mjs';

// ---------------------------------------------------------------- seed (temp server only)
const LAT = 12.9352;
const LNG = 77.6245;
const eq = (id, name, type, category, lat, lng, extra = {}) => ({
  id, name, type, category, lat, lng, area: '', street: '', status: 'Active', images: [], installedDate: '', locationMethod: 'map_pick', ...extra,
});
const cores = (n) => Array.from({ length: n }, (_, i) => ({ coreNumber: i + 1, status: 'Available' }));
const cab = (id, name, type, fiberCount, from, to, coords, lengthMeters) => ({
  id, name, type, fiberCount, lengthMeters, owner: '', installationDate: '', status: 'Active', coordinates: coords, startEquipmentId: from, endEquipmentId: to, cores: cores(fiberCount), cableCategory: 'Fiber',
});
const pons = [1, 2, 3, 4].map((n) => ({ id: `PON-0${n}`, portNumber: n, technology: 'GPON', status: 'Available', connectedCustomersCount: 0 }));
const P = {
  olt: [LAT, LNG],
  odf: [LAT, LNG + 0.0004],
  jc: [LAT + 0.0012, LNG + 0.0016],
  fat: [LAT + 0.0016, LNG + 0.0028],
  pole: [LAT + 0.0022, LNG + 0.0008],
};
const seed = {
  upserts: {
    equipment: [
      eq('OLT-1', 'OLT Main', 'OLT', 'Central Office', ...P.olt, { technology: 'GPON', totalPorts: 4, ponPorts: pons }),
      eq('ODF-1', 'ODF Main', 'ODF', 'Central Office', ...P.odf),
      eq('JC-1', 'Joint 1', 'Fiber Joint Closure', 'Fiber Distribution', ...P.jc),
      eq('FAT-1', 'Box 1', 'FAT', 'Fiber Distribution', ...P.fat, { totalPorts: 8 }),
      eq('POLE-9', 'Pole 9', 'Telecom Pole', 'Supporting Infrastructure', ...P.pole),
    ],
    cables: [
      cab('FDR-1', 'Feeder A', 'Main Feeder Fiber', 24, 'ODF-1', 'JC-1', [P.odf, P.jc], 210),
      cab('DST-1', 'Street B', 'Distribution Fiber', 12, 'JC-1', 'FAT-1', [P.jc, P.fat], 150),
      cab('C96', 'Trunk 96F', 'Aerial Fiber', 96, 'JC-1', 'POLE-9', [P.jc, P.pole], 120),
      cab('CUNK', 'Old 12F', 'Aerial Fiber', 12, 'POLE-9', 'FAT-1', [P.pole, P.fat], 230),
    ],
  },
};
await storeSeed(seed);

// ---------------------------------------------------------------- browser
const app = await openApp({ uiMode: null });
const { p, shot, has, check, tapId, tapText, setField, chooseByText, openDetails, closePanels, find, toastText, confirmIfAsked } = app;

// ---------------------------------------------------------------- setup
if (await p.evaluate(() => [...document.querySelectorAll('[aria-label="Collapse Toolbox"]')].some((e) => e.getBoundingClientRect().width > 0))) {
  await p.evaluate(() => document.querySelector('[aria-label="Collapse Toolbox"]').click());
}
console.log('hscroll', await p.evaluate(() => document.documentElement.scrollWidth > innerWidth));

console.log('--- 1 OLT port: vendor address and optics class');
await find('OLT Main', 'OLT Main');
await setField('pon-select', 'PON-01');
await setField('pon-vendor-address', 'gpon 0/1/0');
await setField('pon-address-parts', 'Frame 0, Slot 1, Port 0');
await setField('pon-optics-class', 'GPON B+');
await tapId('pon-save');
await sleep(1500);
let data = await network();
let pon = data.equipment.find((e) => e.id === 'OLT-1').ponPorts.find((x) => x.id === 'PON-01');
log('PON-01 optics class and raw vendor address saved', pon.opticsClass === 'GPON B+' && pon.vendorAddress === 'gpon 0/1/0', JSON.stringify(pon.addressParts));
await check('PON screen says No live connection for counts', 'No live connection');
await shot('1-pon');

console.log('--- 2 feeder and street cable layouts (TIA-598, 12 per tube)');
for (const [name, id] of [
  ['Feeder A', 'FDR-1'],
  ['Street B', 'DST-1'],
]) {
  await find(name, name);
  await tapId('layout-edit');
  await chooseByText('layout-scheme', 'TIA-598');
  await chooseByText('layout-tube-scheme', 'TIA-598');
  await setField('layout-fpt', '12');
  await setField('layout-source', 'Drum sheet');
  await tapId('layout-save');
  await sleep(1200);
  const c = (await network()).cables.find((x) => x.id === id);
  log(`${name}: scheme and tube size saved`, c.colorScheme === 'tia-598' && c.fibersPerTube === 12 && c.tubeCount === c.fiberCount / 12);
}
const chip3 = await p.evaluate(() => document.querySelector('[data-testid="core-chip-3"]')?.title ?? '');
log('Street B fiber 3 is tube 1 Green', /tube 1 Blue, fiber 3 Green/.test(chip3) || /fiber 3 Green/.test(chip3), chip3);
await shot('2-layout');

console.log('--- 3 ODF: panel, feeder fiber behind port 3, patch to PON-01');
await find('ODF Main', 'ODF Main');
await setField('odf-panel-label', 'Panel A');
await setField('odf-panel-ports', '24');
await tapId('odf-panel-add');
await sleep(1200);
await tapId('odf-port-3');
await setField('odf-feeder-cable', 'FDR-1');
await setField('odf-feeder-core', '3');
await check('ODF shows the fiber identity before saving', 'Fiber 3: tube 1 Blue, fiber 3 Green');
await tapId('odf-feeder-save');
await sleep(1200);
await setField('odf-patch-olt', 'OLT-1');
await setField('odf-patch-pon', 'PON-01');
await setField('odf-patch-cord', 'PC-7');
await tapId('odf-patch-save');
await sleep(1500);
data = await network();
const odfPort = data.equipment.find((e) => e.id === 'ODF-1').odfPanels?.[0]?.ports.find((x) => x.number === 3);
log('ODF port 3: feeder fiber and patch saved', odfPort?.feederCableId === 'FDR-1' && odfPort.feederCore === 3 && odfPort.patch?.ponPortId === 'PON-01', JSON.stringify(odfPort?.patch));
await shot('3-odf');

console.log('--- 4 closure with trays, and a splice chosen by the person');
await find('Joint 1', 'Joint 1');
await setField('closure-setup-trays', '2');
await tapId('closure-setup');
await sleep(1200);
data = await network();
log('closure record created with 2 trays', data.closures.length === 1 && data.closures[0].trays?.length === 2);
await find('Joint 1', 'Joint 1');
await tapId('closure-open');
await openDetails();
await setField('closure-condition', 'good');
const photoInput = await p.$('[data-testid="closure-photo-input"]');
if (photoInput) await photoInput.uploadFile(await makePhoto('closure.png'));
await sleep(2500);
data = await network();
const photoId = data.closures[0].photoIds?.[0];
const photoRes = photoId ? await fetch(`${BASE}/api/v1/photos/${photoId}`) : null;
log('closure photo stored on the server and condition saved', !!photoRes?.ok && data.closures[0].condition === 'good', photoId ?? 'no photo');
await find('Joint 1', 'Joint 1');
await tapId('closure-open-splices');
await sleep(800);
log('splice form starts empty (nothing preselected)', await p.evaluate(() => document.querySelector('[data-testid="splice-from-cable"]')?.value === '' && document.querySelector('[data-testid="splice-to-cable"]')?.value === ''));
await chooseByText('splice-tray', 'Tray 1');
await setField('splice-from-cable', 'FDR-1');
await setField('splice-from-core', '3');
await setField('splice-to-cable', 'DST-1');
await setField('splice-to-core', '3');
await setField('splice-loss', '0.05');
await setField('splice-loss-source', 'field_measured');
await setField('splice-otdr', 'OTDR-0042');
await tapId('splice-save');
await sleep(1500);
await confirmIfAsked();
data = await network();
const splice = data.closures[0].splices[0];
log('splice saved with tray, loss origin and OTDR ref', splice?.inputCore === 3 && splice.outputCableId === 'DST-1' && splice.lossSource === 'field_measured' && splice.otdrRef === 'OTDR-0042' && !!splice.trayId);
await check('tray diagram shows the joined fibers', 'Feeder A[\\s\\S]*Street B');
await shot('4-splice');
await closePanels();

console.log('--- 5 splitter in the box, input linked to the exact fiber');
await find('Box 1', 'Box 1');
await setField('splitter-add-ratio', '1:8');
await setField('splitter-add-input-cable', 'DST-1');
await setField('splitter-add-input-core', '3');
await tapId('splitter-add');
await sleep(1500);
await confirmIfAsked();
data = await network();
const sp = data.splitters[0];
log('splitter has 8 port records and its input on Street B fiber 3', sp?.outputPorts.length === 8 && sp.inputPort.connectedCableId === 'DST-1' && sp.inputPort.connectedCore === 3);
await shot('5-splitter');

console.log('--- 6 customer setup marks the fibers it uses');
await closePanels();
await find('Box 1', 'Box 1');
await closePanels();
const toolbarButton = await p.evaluate(() => [...document.querySelectorAll('button')].some((b) => /Add customer/.test(b.innerText || b.getAttribute('aria-label') || '') && b.getBoundingClientRect().width > 0));
if (toolbarButton) await tapText('Add customer');
else {
  await tapText('Open menu');
  await p.evaluate(() => document.querySelector('[aria-label="Create"]')?.click());
  await sleep(300);
  await tapText('New customer connection');
}
await sleep(700);
const typeBy = async (label, value) => {
  const ok = await p.evaluate((label) => {
    const l = [...document.querySelectorAll('label')].find((x) => x.innerText.includes(label));
    const i = l?.parentElement?.querySelector('input');
    if (!i) return false;
    i.focus();
    i.select?.();
    return true;
  }, label);
  if (!ok) log(`type into ${label}`, false, 'NOT FOUND');
  else await p.keyboard.type(value);
};
await typeBy('Subscriber Full Name', 'Asha Fiber');
await typeBy('Mobile Contact Phone', '9876543210');
await tapText('Use my GPS');
await sleep(1500);
await typeBy('ONT Serial Number', 'ZTEG0000A001');
{
  const chosen = await pickConnection(p);
  log('nothing preselected; chose box, splitter and a free output', !!(chosen.box && chosen.splitter && chosen.port), JSON.stringify(chosen));
}
log('customer form finds the OLT through the ODF patch', !(await has('No OLT reachable')));
await tapText('Activate Subscriber');
await sleep(2500);
await confirmIfAsked();
data = await network();
const cust = data.customers.find((c) => c.name === 'Asha Fiber');
log('customer saved on the splitter', !!cust && cust.splitterId === sp.id, cust ? `${cust.splitterId} port ${cust.splitterOutputPort}` : 'none');
log('customer linked to OLT-1 PON-01 from the fiber path', cust?.oltId === 'OLT-1' && cust?.ponPort === 'PON-01' && cust?.feederCableId === 'FDR-1' && cust?.distributionCableId === 'DST-1', `${cust?.oltId} ${cust?.ponPort}`);
const assignment = (cableId, n) => data.cables.find((c) => c.id === cableId)?.cores.find((k) => k.coreNumber === n)?.assignments?.find((a) => !a.releasedAt);
log('feeder fiber 3 marked in use for the PON', assignment('FDR-1', 3)?.ponPortId === 'PON-01');
log('street fiber 3 marked in use for the PON', assignment('DST-1', 3)?.ponPortId === 'PON-01');
log('drop fiber 1 marked for the customer', !!cust && assignment(cust.dropCableId, 1)?.customerId === cust.id);
const port = data.splitters[0].outputPorts.find((x) => x.portNumber === cust?.splitterOutputPort);
log('splitter output records the drop fiber', port?.connectedDropCableId === cust?.dropCableId && port?.connectedCore === 1);
await closePanels();

console.log('--- 7 trace core by core');
async function openTrace() {
  await closePanels();
  await find('Box 1', 'Box 1');
  await tapText('Trace path');
  await sleep(800);
  const box = await p.$('form input[placeholder*="Search customer"]');
  if (!box) return log('trace search box', false, 'NOT FOUND');
  await box.click({ clickCount: 3 });
  await p.keyboard.type('Asha Fiber');
  await p.keyboard.press('Enter');
  await sleep(1200);
}
await openTrace();
await check('trace says every fiber is recorded', 'Every fiber recorded');
const steps = await p.evaluate(() => [...document.querySelectorAll('[data-testid^="core-step-"]')].map((e) => e.dataset.testid.replace('core-step-', '')));
log('steps: OLT, patch, ODF, feeder fiber, splice, street fiber, splitter, drop fiber, ONT', steps.join(',') === 'olt,patch,odf,cable,splice,cable,splitter,cable,ont', steps.join(','));
await check('downstream verdict at 1490 nm shown', 'Down at 1490 nm');
await check('upstream verdict at 1310 nm shown', 'Up at 1310 nm');
await check('verdict is one of the four, for GPON B+', '(Too little loss|Fits with margin|Fits, but under|Over budget)[\\s\\S]*GPON B\\+');
await shot('7-trace');
await closePanels();

console.log('--- 8 break the splice: the exact gap is named');
await find('Joint 1', 'Joint 1');
await tapId('closure-open-splices');
await sleep(600);
await tapId(`splice-retire-${splice.id}`);
await setField(`splice-retire-${splice.id}-reason`, 'Cut by road work');
await tapId(`splice-retire-${splice.id}-confirm`);
await sleep(1500);
data = await network();
log('splice kept as history, out of service', !!data.closures[0].splices[0].retiredAt && data.closures[0].splices[0].retiredReason === 'Cut by road work');
await openTrace();
await check('trace names the exact gap', 'Fiber 3 \\(Green, in tube 1\\) of Street B \\(DST-1\\) has no recorded link on its OLT side');
await check('no verdict on a broken path', 'Fiber path is broken');
log('no pass verdict shown while broken', !(await has('Down at 1490 nm')));
await shot('8-gap');
await closePanels();

console.log('--- 9 re-splice, then a conflicting splice is refused');
await find('Joint 1', 'Joint 1');
await tapId('closure-open-splices');
await sleep(600);
await setField('splice-from-cable', 'FDR-1');
await setField('splice-from-core', '3');
await setField('splice-to-cable', 'DST-1');
await setField('splice-to-core', '3');
await tapId('splice-save');
await sleep(1500);
await confirmIfAsked();
data = await network();
log('new splice recorded beside the history', data.closures[0].splices.length === 2 && data.closures[0].splices.filter((s) => !s.retiredAt).length === 1);
const before = JSON.stringify(data.closures[0].splices);
await setField('splice-from-cable', 'FDR-1');
await setField('splice-from-core', '4');
await setField('splice-to-cable', 'DST-1');
await setField('splice-to-core', '3');
await tapId('splice-save');
await sleep(1200);
const refusal = await toastText();
log('conflicting splice refused in plain words', /fed from 2 places/i.test(refusal), (refusal.split(' | ').find((t) => /fed from/.test(t)) ?? refusal).slice(0, 200));
await sleep(1500);
data = await network();
log('nothing changed on the server', JSON.stringify(data.closures[0].splices) === before);
const sneaky = { ...data.closures[0], splices: [...data.closures[0].splices, { ...data.closures[0].splices[1], id: 'SPC-SNEAK', inputCore: 5 }] };
const direct = await api('/changes', { method: 'POST', body: JSON.stringify({ upserts: { closures: [sneaky] } }) });
log('the server refuses the same conflict sent directly', direct.status === 409 && /fed from 2 places/.test(direct.body?.message ?? ''), String(direct.body?.message).slice(0, 120));
await closePanels();

console.log('--- 10 a double allocation is refused');
await find('Feeder A', 'Feeder A');
await tapId('core-chip-3');
await check('fiber 3 shows who uses it, with release, not a second assignment', 'In use for[\\s\\S]*PON OLT-1 / PON-01');
log('no assign form on an occupied fiber', !(await p.evaluate(() => !!document.querySelector('[data-testid="core-assign-save"]'))));
await tapId('core-chip-5');
await setField('core-assign-kind', 'reserved');
await setField('core-assign-use', 'Tower link');
await tapId('core-assign-save');
await sleep(1500);
data = await network();
const feeder = data.cables.find((c) => c.id === 'FDR-1');
log('fiber 5 reserved for the tower link', feeder.cores.find((k) => k.coreNumber === 5)?.assignments?.[0]?.use === 'Tower link');
await check('utilization counted from the records', '1 in use, 1 reserved, 22 free');
const twice = { ...feeder, cores: feeder.cores.map((k) => (k.coreNumber === 5 ? { ...k, assignments: [...k.assignments, { id: 'CA-SNEAK', kind: 'in_use', use: 'Someone else', effectiveFrom: '2026-11-07', createdAt: '2026-11-07' }] } : k)) };
const dbl = await api('/changes', { method: 'POST', body: JSON.stringify({ upserts: { cables: [twice] } }) });
log('a second active assignment on fiber 5 is refused by the server', dbl.status === 409 && /active assignments/.test(dbl.body?.message ?? ''), String(dbl.body?.message).slice(0, 120));
await shot('10-cores');

console.log('--- 11 96F cable with a non-TIA scheme');
await find('Trunk 96F', 'Trunk 96F');
await tapId('layout-edit');
await chooseByText('layout-scheme', 'IEC 60304');
await chooseByText('layout-tube-scheme', 'IEC 60304');
await setField('layout-fpt', '12');
await tapId('layout-save');
await sleep(1500);
const t49 = await p.evaluate(() => document.querySelector('[data-testid="core-chip-49"]')?.title ?? '');
const t50 = await p.evaluate(() => document.querySelector('[data-testid="core-chip-50"]')?.title ?? '');
log('96F fiber 49 is tube 5 White, fiber 1 Red', /tube 5 White, fiber 1 Red/.test(t49), t49);
log('96F fiber 50 is fiber 2 Green', /fiber 2 Green/.test(t50), t50);
const tubes = await p.evaluate(() => document.querySelectorAll('[data-testid^="tube-"]').length);
log('96F shows 8 tubes of 12', tubes === 8, String(tubes));
await shot('11-96f');

console.log('--- 12 unknown scheme: no invented colours');
await find('Old 12F', 'Old 12F');
await check('says the colour is not known', 'Blue may not be fiber 1');
const unknown = await p.evaluate(() => {
  const chips = [...document.querySelectorAll('[data-testid^="core-chip-"]')];
  return { chips: chips.length, unknown: chips.filter((c) => c.querySelector('[aria-label="Colour not known"]')).length, coloured: chips.filter((c) => [...c.querySelectorAll('span')].some((s) => s.style.backgroundColor)).length };
});
log('all 12 fibers shown by number with no colour', unknown.chips === 12 && unknown.unknown === 12 && unknown.coloured === 0, JSON.stringify(unknown));
await shot('12-unknown');

await finish({ app });
