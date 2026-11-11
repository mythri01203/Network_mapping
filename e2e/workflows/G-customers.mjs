// Workflow G (with H and I): Phase 5 walkthrough: example A on a temp server, two customers, ONT record and two services, an
// MDU with two units and their drop paths, a disconnect that releases fiber and output with history,
// a move that refuses a double allocation, an ONT swap, the logical view with a missing link named,
// and a reconciliation flag for a measured reading far from the prediction.
// Ported from the scratch walkthrough customer-walk.mjs. Temp server on 127.0.0.1:5056 only (see e2e/run.mjs).
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { BASE, finish, network, openApp, pickConnection, post, REPO_ROOT, seed as storeSeed, sleep, log } from '../lib/harness.mjs';

// ---------------------------------------------------------------- seed example A (temp server only)
const LAT = 12.9352;
const LNG = 77.6245;
const NOW = '2026-11-07T09:00:00.000Z';
const eq = (id, name, type, category, lat, lng, extra = {}) => ({
  id, name, type, category, lat, lng, area: '', street: '', status: 'Active', images: [], installedDate: '', locationMethod: 'map_pick', ...extra,
});
const tia = { colorScheme: 'tia-598', tubeColorScheme: 'tia-598', fibersPerTube: 12 };
const cores = (n) => Array.from({ length: n }, (_, i) => ({ coreNumber: i + 1, status: 'Available' }));
const cab = (id, name, type, fiberCount, from, to, coords, lengthMeters, extra = {}) => ({
  id, name, type, fiberCount, lengthMeters, owner: '', installationDate: '', status: 'Active', coordinates: coords, startEquipmentId: from, endEquipmentId: to, cores: cores(fiberCount), cableCategory: 'Fiber', ...extra,
});
const P = {
  olt: [LAT, LNG],
  odf: [LAT, LNG + 0.0004],
  jc: [LAT + 0.0012, LNG + 0.0016],
  fat: [LAT + 0.0016, LNG + 0.0028],
  bep: [LAT + 0.0019, LNG + 0.0031],
  fdb: [LAT + 0.00192, LNG + 0.00312],
  far: [LAT + 0.004, LNG + 0.004],
};
const pon = { id: 'PON-01', portNumber: 1, technology: 'GPON', status: 'Active', connectedCustomersCount: 0, opticsClass: 'GPON B+', opticsClassSource: 'Module label and datasheet', vendorAddress: 'gpon 0/1/0', txPowerDbm: 3 };
const seed = {
  upserts: {
    equipment: [
      eq('OLT-1', 'OLT Main', 'OLT', 'Central Office', ...P.olt, { technology: 'GPON', totalPorts: 1, ponPorts: [pon] }),
      eq('ODF-1', 'ODF Main', 'ODF', 'Central Office', ...P.odf, {
        odfPanels: [{ id: 'ODP-1', label: 'Panel A', ports: [1, 2, 3, 4].map((n) => ({ id: `ODX-${n}`, number: n, status: n === 3 ? 'in_use' : 'available', ...(n === 3 ? { feederCableId: 'FDR-1', feederCore: 3, patch: { oltId: 'OLT-1', ponPortId: 'PON-01', patchedAt: NOW } } : {}) })) }],
      }),
      eq('JC-1', 'Joint 1', 'Fiber Joint Closure', 'Fiber Distribution', ...P.jc),
      eq('FAT-1', 'Box 1', 'FAT', 'Fiber Distribution', ...P.fat, { totalPorts: 8 }),
      eq('BEP-1', 'Lake View entry', 'Building Entry Point', 'Supporting Infrastructure', ...P.bep),
      eq('FDB-3', 'Floor 3 box', 'Fiber Terminal Box', 'Fiber Distribution', ...P.fdb),
      eq('POLE-1', 'Pole 1', 'Telecom Pole', 'Supporting Infrastructure', ...P.far),
    ],
    cables: [
      cab('FDR-1', 'Feeder A', 'Main Feeder Fiber', 24, 'ODF-1', 'JC-1', [P.odf, P.jc], 210, tia),
      cab('DST-1', 'Street B', 'Distribution Fiber', 12, 'JC-1', 'FAT-1', [P.jc, P.fat], 150, tia),
      cab('RSR-1', 'Lake View riser', 'Distribution Fiber', 12, 'BEP-1', 'FDB-3', [P.bep, P.fdb], 12),
      // Drawn about 290 m, sheath marks 1000 to 1300 m (300 m), OTDR 250 m: the OTDR is far too short.
      cab('LEN-1', 'Old route', 'Aerial Fiber', 12, 'FAT-1', 'POLE-1', [P.fat, P.far], 290, { sheathMarkStart: 1000, sheathMarkEnd: 1300, sheathMarkUnit: 'm', opticalLengthMeters: 250 }),
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
        id: 'SPL-1', name: 'Box 1 splitter', terminalBoxId: 'FAT-1', ratio: '1:8', insertionLossDb: 10.4, lossSource: 'Settings default (proposed)', kind: 'PLC', status: 'Active',
        inputPort: { id: 'SPL-1-IN', connectedCableId: 'DST-1', connectedCore: 3, linkedAt: NOW },
        outputPorts: Array.from({ length: 8 }, (_, i) => ({ portNumber: i + 1, label: `OUT-0${i + 1}`, status: 'Available' })),
      },
    ],
  },
};
await storeSeed(seed);

// ---------------------------------------------------------------- browser
const app = await openApp({ uiMode: null });
const { p, shot, check, tapId, tapText, setField, closePanels, find, toastText, confirmIfAsked } = app;

// ---------------------------------------------------------------- helpers for this walk
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
async function addCustomer(name, serial) {
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
  await typeBy('Subscriber Full Name', name);
  await typeBy('Mobile Contact Phone', '9876543210');
  await tapText('Use my GPS');
  await sleep(1500);
  await typeBy('ONT Serial Number', serial);
  const chosen = await pickConnection(p, { boxText: 'Box 1' });
  log(`${name}: nothing preselected; chose box, splitter and a free output`, !!(chosen.box && chosen.splitter && chosen.port), JSON.stringify(chosen));
  await tapText('Activate Subscriber');
  await sleep(2500);
  await confirmIfAsked();
  await sleep(800);
}
const byName = (data, name) => data.customers.find((c) => c.name === name);
const optionDisabled = (testId, text) =>
  p.evaluate((testId, text) => [...([...document.querySelectorAll(`[data-testid="${testId}"]`)].at(-1)?.options ?? [])].find((o) => o.text.includes(text))?.disabled ?? null, testId, text);
const testText = (testId) => p.evaluate((id) => [...document.querySelectorAll(`[data-testid="${id}"]`)].map((e) => e.innerText).join(' | '), testId);
async function settle() {
  // Let the browser send its changes before the temp server is changed directly.
  for (let i = 0; i < 10; i += 1) {
    const pending = await p.evaluate(() => document.body.innerText.match(/Saved on phone|Sending/) !== null);
    if (!pending) break;
    await sleep(500);
  }
  await sleep(1500);
}

// ---------------------------------------------------------------- setup
if (await p.evaluate(() => [...document.querySelectorAll('[aria-label="Collapse Toolbox"]')].some((e) => e.getBoundingClientRect().width > 0))) {
  await p.evaluate(() => document.querySelector('[aria-label="Collapse Toolbox"]').click());
}
console.log('hscroll', await p.evaluate(() => document.documentElement.scrollWidth > innerWidth));

console.log('--- 1 two customers on the splitter in Box 1');
await addCustomer('Asha Fiber', 'ZTEG0000A001');
await addCustomer('Ravi Kumar', 'HWTC0000B002');
let data = await network();
let asha = byName(data, 'Asha Fiber');
let ravi = byName(data, 'Ravi Kumar');
log('both customers saved on the splitter', asha?.splitterId === 'SPL-1' && ravi?.splitterId === 'SPL-1', `${asha?.splitterOutputPort} / ${ravi?.splitterOutputPort}`);
log('both traced to OLT-1 PON-01 from the fibers', asha?.oltId === 'OLT-1' && asha?.ponPort === 'PON-01' && ravi?.ponPort === 'PON-01');
const ponCountAfterTwo = data.equipment.find((e) => e.id === 'OLT-1').ponPorts[0].connectedCustomersCount;

console.log('--- 2 ONT record made from the serial on the customer, then details as written');
await find('Asha Fiber', 'Asha Fiber');
await check('ONT section says the serial is only on the customer record', 'written on the customer record only');
await tapId('ont-make-record');
await sleep(1500);
data = await network();
asha = byName(data, 'Asha Fiber');
let ont = data.onts.find((o) => o.id === asha.ontId);
log('ONT record has the serial exactly as entered, vendor left blank', ont?.serialNumber === 'ZTEG0000A001' && ont.vendor === undefined && ont.statusSource === 'customer_record', JSON.stringify({ s: ont?.serialNumber, v: ont?.vendor }));
log('ONT record carries the splitter output and drop fiber it uses', ont?.splitterId === 'SPL-1' && ont.splitterOutputPort === asha.splitterOutputPort && ont.dropCableId === asha.dropCableId && ont.dropCore === 1);
await tapId('ont-edit');
await setField('ont-form-vendor', 'ZTE');
await setField('ont-form-model', 'F660');
await setField('ont-form-address', 'gpon-onu_1/1/1:1');
await tapId('ont-form-save');
await sleep(1500);
data = await network();
ont = data.onts.find((o) => o.id === asha.ontId);
log('vendor, model and OLT address saved as typed', ont?.vendor === 'ZTE' && ont.model === 'F660' && ont.onuAddress === 'gpon-onu_1/1/1:1');
await check('screen says online status is not known (no live connection)', 'No live connection to the OLT');
await shot('1-ont');

console.log('--- 3 two services over the same fiber');
await setField('svc-kind', 'internet');
await setField('svc-plan', 'Home 100');
await setField('svc-ont-port', 'LAN 1');
await tapId('svc-add');
await sleep(1200);
await setField('svc-kind', 'rf_video');
await setField('svc-plan', '');
await setField('svc-ont-port', 'CATV');
await tapId('svc-add');
await sleep(1500);
data = await network();
const svcs = data.services.filter((s) => s.customerId === asha.id);
log('two services stored for Asha on her ONT', svcs.length === 2 && svcs.every((s) => s.ontId === ont.id), svcs.map((s) => s.kind).join(','));
log('plan kept only as written; none invented for the second', svcs.find((s) => s.kind === 'internet')?.planName === 'Home 100' && svcs.find((s) => s.kind === 'rf_video')?.planName === undefined);
await check('screen says both services share the drop fiber', 'share fiber 1 of');
await shot('2-services');

console.log('--- 4 MDU building with a floor box and two units');
await find('Lake View entry', 'Lake View entry');
await setField('bld-name', 'Lake View Apartments');
await setField('bld-kind', 'apartment');
await setField('bld-floors', '4');
await tapId('bld-setup');
await sleep(1500);
data = await network();
let building = data.buildings[0];
log('building record set up from its entry pin', building?.entryEquipmentId === 'BEP-1' && building.kind === 'apartment' && building.floorsAbove === 4);
await setField('flb-label', 'Floor 3 box');
await setField('flb-floor', '3');
await setField('flb-splitter', 'SPL-1');
await tapId('flb-add');
await sleep(1200);
await setField('unit-label', '302');
await setField('unit-floor', '3');
data = await network();
await setField('unit-box', data.buildings[0].floorBoxes[0]?.id ?? '');
await tapId('unit-add');
await sleep(1200);
await setField('unit-label', '303');
await setField('unit-floor', '3');
await setField('unit-box', '');
await tapId('unit-add');
await sleep(1500);
data = await network();
building = data.buildings[0];
log('floor box and two units recorded', building.floorBoxes.length === 1 && building.units.map((u) => u.label).join(',') === '302,303' && building.units[0].floorBoxId === building.floorBoxes[0].id);
for (const [name, unit] of [
  ['Asha Fiber', building.units[0]],
  ['Ravi Kumar', building.units[1]],
]) {
  await find(name, name);
  await setField('cust-building', building.id);
  await setField('cust-unit', unit.id);
  await tapId('cust-place-save');
  await sleep(1200);
}
data = await network();
log('customers placed in units 302 and 303', byName(data, 'Asha Fiber').unitId === building.units[0].id && byName(data, 'Ravi Kumar').unitId === building.units[1].id && byName(data, 'Asha Fiber').flatNumber === '302');
await find('Lake View entry', 'Lake View entry');
let u302 = await testText('unit-path-302');
log('unit 302 path names the missing riser', /Missing: Riser cable not recorded/.test(u302), u302.replace(/\s+/g, ' ').slice(0, 160));
await setField('bld-riser', 'RSR-1');
await tapId('bld-riser-save');
await sleep(1500);
u302 = await testText('unit-path-302');
const u303 = await testText('unit-path-303');
log('unit 302: every link recorded, street to flat', /Every link recorded/.test(u302) && /OLT Main PON-01/.test(u302) && /Lake View riser/.test(u302) && /Floor 3 box/.test(u302) && /Asha Fiber/.test(u302), u302.replace(/\s+/g, ' ').slice(0, 220));
log('unit 303 names its missing floor box', /Missing: No floor box recorded for 303/.test(u303));
await shot('3-building');

console.log('--- 5 disconnect Ravi: fiber, output and box port released with history');
data = await network();
ravi = byName(data, 'Ravi Kumar');
const raviDrop = ravi.dropCableId;
const raviPort = ravi.splitterOutputPort;
await find('Ravi Kumar', 'Ravi Kumar');
await tapId('cust-disconnect-open');
await check('disconnect says what it frees', `fiber 1 of ${raviDrop}`);
await setField('cust-disconnect-reason', 'Moved away');
await tapId('cust-disconnect-confirm');
await sleep(2000);
await confirmIfAsked();
data = await network();
ravi = byName(data, 'Ravi Kumar');
const raviCore = data.cables.find((c) => c.id === raviDrop)?.cores.find((k) => k.coreNumber === 1);
const raviOut = data.splitters[0].outputPorts.find((x) => x.portNumber === raviPort);
log('Ravi is disconnected with the reason, old connection in his history', ravi.status === 'Disconnected' && ravi.disconnectReason === 'Moved away' && ravi.connectionHistory?.[0]?.splitterOutputPort === raviPort && ravi.connectionHistory[0].dropCableId === raviDrop);
log('his drop fiber is free again, its assignment kept as history with the reason', raviCore?.status === 'Available' && raviCore.assignments?.length === 1 && !!raviCore.assignments[0].releasedAt && /Moved away/.test(raviCore.assignments[0].releaseReason ?? ''));
log('his splitter output is free, with a history line', raviOut?.status === 'Available' && !raviOut.connectedCustomerId && raviOut.history?.at(-1)?.action === 'OUTPUT_FREED');
log('box port and PON count released; drop cable record kept', !data.equipment.find((e) => e.id === 'FAT-1').logicalPorts?.some((x) => x.customerId === ravi.id) && data.equipment.find((e) => e.id === 'OLT-1').ponPorts[0].connectedCustomersCount === ponCountAfterTwo - 1 && !!data.cables.find((c) => c.id === raviDrop));
await check('Ravi shows as disconnected with the reason', 'Reason: Moved away');
await shot('4-disconnect');

console.log('--- 6 move Asha to another output; a double allocation is refused');
data = await network();
asha = byName(data, 'Asha Fiber');
const ashaDrop = asha.dropCableId;
const ashaFrom = asha.splitterOutputPort;
await find('Asha Fiber', 'Asha Fiber');
await tapId('cust-move-open');
await setField('cust-move-splitter', 'SPL-1');
await setField('cust-move-port', '5');
await setField('cust-move-reason', 'Output faulty');
await tapId('cust-move-save');
await sleep(2000);
await confirmIfAsked();
data = await network();
asha = byName(data, 'Asha Fiber');
const outs = data.splitters[0].outputPorts;
const ashaCore = data.cables.find((c) => c.id === ashaDrop)?.cores.find((k) => k.coreNumber === 1);
log('Asha is on output 5 with the same drop fiber, still traced to OLT-1 PON-01', asha.splitterOutputPort === 5 && asha.dropCableId === ashaDrop && asha.oltId === 'OLT-1' && asha.ponPort === 'PON-01');
log('old output freed with history; new output records her drop fiber', outs.find((x) => x.portNumber === ashaFrom)?.status === 'Available' && outs.find((x) => x.portNumber === ashaFrom)?.history?.at(-1)?.action === 'OUTPUT_FREED' && outs.find((x) => x.portNumber === 5)?.connectedDropCableId === ashaDrop);
log('drop fiber: one released assignment kept, one active', ashaCore?.assignments?.filter((a) => a.releasedAt).length === 1 && ashaCore.assignments.filter((a) => !a.releasedAt).length === 1);
log('her ONT record and history follow the move', data.onts.find((o) => o.id === asha.ontId)?.splitterOutputPort === 5 && asha.connectionHistory?.at(-1)?.kind === 'moved');
const before = JSON.stringify(data.splitters[0]);
await tapId('cust-move-open');
await setField('cust-move-splitter', 'SPL-1');
log('output 5 is shown as hers and cannot be chosen again', (await optionDisabled('cust-move-port', 'Output 5')) === true);
await setField('cust-move-port', '6');
await setField('cust-move-drop-mode', 'other');
await setField('cust-move-drop-cable', 'DST-1');
await setField('cust-move-drop-core', '3');
await setField('cust-move-reason', 'Try the street fiber');
await tapId('cust-move-save');
await sleep(1200);
const refusal = await toastText();
log('a fiber already in use is refused in plain words', /already in use for PON OLT-1 \/ PON-01/.test(refusal), (refusal.split(' | ').find((t) => /already/.test(t)) ?? refusal).slice(0, 200));
await sleep(1500);
data = await network();
log('nothing changed on the server', JSON.stringify(data.splitters[0]) === before);
const twoFeeds = { ...data.splitters[0], outputPorts: data.splitters[0].outputPorts.map((x) => (x.portNumber === 6 ? { ...x, status: 'Occupied', connectedDropCableId: ashaDrop, connectedCore: 1 } : x)) };
const direct = await post({ upserts: { splitters: [twoFeeds] } });
log('the server refuses a second output on her drop fiber', direct.status === 409 && /fed from 2 places/.test(direct.body?.message ?? ''), String(direct.body?.message).slice(0, 140));
const sharedSingle = await post({ upserts: { customers: [{ ...byName(data, 'Ravi Kumar'), status: 'Active', ontId: asha.ontId }] } });
log('the server refuses a second customer on a one-customer ONT', sharedSingle.status === 409 && /recorded for one customer/.test(sharedSingle.body?.message ?? ''), String(sharedSingle.body?.message).slice(0, 140));
await closePanels();
await find('Ravi Kumar', 'Ravi Kumar');
await tapId('cust-reconnect-open');
await setField('cust-move-splitter', 'SPL-1');
log("reconnecting Ravi cannot pick Asha's output", (await optionDisabled('cust-move-port', 'Output 5')) === true);
await shot('5-move');

console.log('--- 7 swap Asha\'s ONT, keeping the old one as history');
await find('Asha Fiber', 'Asha Fiber');
await tapId('ont-swap');
await setField('ont-form-serial', 'ZTEG0000A777');
await setField('ont-form-vendor', 'ZTE');
await setField('ont-form-reason', 'No light, power LED off');
await tapId('ont-form-save');
await sleep(1800);
data = await network();
asha = byName(data, 'Asha Fiber');
const oldOnt = data.onts.find((o) => o.id === ont.id);
const newOnt = data.onts.find((o) => o.id === asha.ontId);
log('old ONT kept as removed, with the reason and what replaced it', oldOnt?.status === 'removed' && oldOnt.removedReason === 'No light, power LED off' && oldOnt.replacedByOntId === newOnt?.id);
log('new ONT installed on the same output and fiber; customer serial follows', newOnt?.serialNumber === 'ZTEG0000A777' && newOnt.splitterOutputPort === 5 && newOnt.dropCore === 1 && asha.ontSerialNumber === 'ZTEG0000A777');
log('both services moved to the new ONT', data.services.filter((s) => s.customerId === asha.id).every((s) => s.ontId === newOnt?.id));
await shot('6-swap');
await closePanels();

console.log('--- 8 logical view from recorded links');
await settle();
await p.goto(BASE + '/topology');
await sleep(2500);
// Phase 14: the tree folds, and services are shown with 'Show services and VLANs'.
await p.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Open all' && b.getBoundingClientRect().width > 0)?.click());
await sleep(400);
await p.evaluate(() => document.querySelector('[data-testid="topo-logical-toggle"]')?.click());
await sleep(600);
let tree = await testText('service-topology');
log('service tree: OLT, PON with its vendor address, splitter, output 5, new ONT, Asha, two services', /OLT Main/.test(tree) && /gpon 0\/1\/0/.test(tree) && /Splitter Box 1 splitter/.test(tree) && /Output 5/.test(tree) && /ONT ZTEG0000A777/.test(tree) && /Asha Fiber/.test(tree) && /Internet/.test(tree) && /1550 nm overlay/.test(tree), tree.replace(/\s+/g, ' ').slice(0, 260));
log('disconnected Ravi is not in the tree and nothing is missing', !/Ravi Kumar/.test(tree) && /0 missing links/.test(tree));
await shot('7-logical');
data = await network();
const closure = data.closures[0];
const cut = await post({ upserts: { closures: [{ ...closure, splices: closure.splices.map((s) => ({ ...s, retiredAt: '2026-11-07T11:00:00.000Z', retiredReason: 'Walkthrough: cut on purpose' })) }] } });
log('temp server: splice taken out on purpose', cut.status === 200);
await p.goto(BASE + '/topology');
for (let i = 0; i < 20; i += 1) {
  await sleep(500);
  tree = await testText('service-topology');
  if (/has no recorded link on its customer side/.test(tree)) break;
}
log('the missing link is named in the tree', /Fiber 3 \(Green, in tube 1\) of Feeder A \(FDR-1\) has no recorded link on its customer side/.test(tree));
log('Asha is listed as not reached, with the exact gap', /Not reached from any PON port[\s\S]*Asha Fiber[\s\S]*Fiber 3 \(Green, in tube 1\) of Street B \(DST-1\) has no recorded link on its OLT side/i.test(tree));
await shot('8-logical-gap');
data = await network();
const fixed = await post({ upserts: { closures: [{ ...data.closures[0], splices: [...data.closures[0].splices, { ...data.closures[0].splices[0], id: 'SPC-2', retiredAt: undefined, retiredReason: undefined }] }] } });
log('temp server: splice put back', fixed.status === 200);

console.log('--- 9 reconciliation: a meter reading far below the prediction');
data = await network();
asha = byName(data, 'Asha Fiber');
const metered = await post({ upserts: { customers: [{ ...asha, rxOpticalPowerDbm: -27.5, rxSource: 'field_measured', rxMeasuredAt: '2026-11-07T11:30:00.000Z' }] } });
log('temp server: meter reading -27.5 dBm stored as field measured', metered.status === 200);
await p.goto(BASE + '/topology');
await sleep(2500);
await tapText('Readings and lengths');
await sleep(800);
const rxLine = await testText(`recon-rx-${asha.id}`);
log('reading flagged: below what the records predict, with the next action', /below the -?\d+\.\d dBm the records predict/.test(rxLine) && /connector at the box/.test(rxLine), rxLine.replace(/\s+/g, ' ').slice(0, 220));
const lenLine = await testText('recon-len-LEN-1');
log('cable length flagged: OTDR shorter than sheath, with the next action', /shorter than the sheath/.test(lenLine) && /OTDR test was on this cable/.test(lenLine), lenLine.replace(/\s+/g, ' ').slice(0, 200));
await check('settings and their meaning are stated', 'dB below and 3 dB above expected');
await shot('9-reconcile');
await p.goto(BASE + '/');
await sleep(2500);
await find('Asha Fiber', 'Asha Fiber');
const inspectorCheck = await testText('rx-check');
log('the customer panel shows the same check and action', /records predict/.test(inspectorCheck) && /connector at the box/.test(inspectorCheck));

console.log('--- 10 map check on the temp server');
let mapCheck = [];
try {
  const out = execFileSync(process.execPath, [join(REPO_ROOT, '.claude', 'skills', 'fibergis-map-check', 'scripts', 'check_network.mjs'), `${BASE}/api/v1/network`, '--json'], { encoding: 'utf8' });
  mapCheck = JSON.parse(out);
} catch (e) {
  mapCheck = JSON.parse(e.stdout || '[]');
}
const errorsFound = mapCheck.filter((f) => f.severity === 'error');
log('map check finds nothing to fix in the Phase 5 records', errorsFound.length === 0, errorsFound.map((f) => f.rule).join(','));
log('Phase 5 map-check lines carry no customer names', mapCheck.filter((f) => /^(ont|service|disconnect|building|unit|customer-ont|customer-building)/.test(f.rule)).every((f) => !/Asha|Ravi/.test(f.message)));

await finish({ app });
