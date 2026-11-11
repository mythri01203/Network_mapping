// Workflow I (with H): the network trace shows the missing link and never fills it, the map check stores
// findings and a decision needs a note, capacity from records, live status, topology from recorded links.
// Ported from the scratch walkthrough w5-walk.mjs. Temp server on 127.0.0.1:5056 only (see e2e/run.mjs).
import { finish, network, openApp, seed as storeSeed, sleep, log } from '../lib/harness.mjs';

// ---------------------------------------------------------------- seed (temp server only)
const LAT = 12.9352;
const LNG = 77.6245;
const eq = (id, name, type, category, lat, lng, extra = {}) => ({ id, name, type, category, lat, lng, area: '', street: '', status: 'Active', images: [], installedDate: '', locationMethod: 'map_pick', ...extra });
const cores = (n) => Array.from({ length: n }, (_, i) => ({ coreNumber: i + 1, status: 'Available' }));
const P = { olt: [LAT, LNG], fat: [LAT + 0.0015, LNG + 0.002], home: [LAT + 0.0019, LNG + 0.0024], home2: [LAT + 0.0017, LNG + 0.0026] };
const outputs = Array.from({ length: 8 }, (_, i) => ({ portNumber: i + 1, label: String(i + 1), status: 'Available' }));
outputs[0] = { ...outputs[0], status: 'Occupied', connectedCustomerId: 'CUST-1', connectedDropCableId: 'DROP-1', connectedCore: 1 };
const blank = { area: '', plan: '', installationDate: '', oltId: '', ponPort: '', feederCableId: '', distributionCableId: '', terminalBoxId: '', splitterId: '', splitterOutputPort: 0, dropCableId: '', fiberCore: 0, ontSerialNumber: '', routerModel: '', ipAddress: '' };
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
    customers: [
      { id: 'CUST-1', name: 'Asha Rao', mobile: '9845012345', address: '12 Temple Road', lat: P.home[0], lng: P.home[1], serviceType: 'Fiber Broadband', status: 'Active', ...blank },
      // A customer waiting for a connection at Box 1 (demand for the capacity screen).
      { id: 'CUST-2', name: 'Ravi Kumar', mobile: '9845099999', address: '14 Temple Road', lat: P.home2[0], lng: P.home2[1], serviceType: 'Fiber Broadband', status: 'Pending Installation', ...blank, terminalBoxId: 'FAT-1' },
    ],
  },
};
await storeSeed(seed);

// ---------------------------------------------------------------- browser
const app = await openApp({ uiMode: 'pro', printStub: true });
const { p, shot, visibleSel, tapId, setField, chooseByText, closePanels, typeInto, textOf, openTool } = app;
await app.collapseToolbox();
let data;

console.log('--- Phase 15: network trace shows the missing link, never fills it');
await openTool('Network Trace');
log('trace screen opens', await visibleSel('[data-testid="network-trace"]'));
await chooseByText('trace-type', 'ustomer');
await typeInto('trace-from', 'CUST-1');
log('trace finds the customer by id', /Found/.test(await textOf('[data-testid="trace-from-found"]')));
await tapId('trace-run');
await sleep(800);
const summary = await textOf('[data-testid="trace-summary"]');
log('trace says it is not complete (no fibres recorded to the OLT)', /Not complete|missing link/i.test(summary) && !/^No missing link/.test(summary), summary.slice(0, 120).replace(/\s+/g, ' '));
log('the gap is shown as its own step', await p.evaluate(() => [...document.querySelectorAll('[data-testid="trace-step"]')].some((e) => e.dataset.kind === 'gap')));
log('no step claims a check that was never made', await p.evaluate(() => ![...document.querySelectorAll('[data-testid="trace-step"]')].some((e) => e.dataset.state === 'ok')));
await tapId('trace-view-diagram');
await sleep(500);
log('diagram view draws', await p.evaluate(() => !!document.querySelector('[data-testid="network-trace"] svg')));
await shot('15-trace');
await closePanels();

console.log('--- Phase 15: map check stores findings; a decision needs a note');
await openTool('Map Check');
log('map check screen opens', await visibleSel('[data-testid="validation-findings"]'));
await tapId('validation-run');
await sleep(2500);
const nFindings = await p.evaluate(() => document.querySelectorAll('[data-testid="finding"]').length);
log('the check lists findings', nFindings > 0, `${nFindings} findings`);
data = await network();
log('findings are stored on the server', (data.validationFindings ?? []).length > 0, `${(data.validationFindings ?? []).length} stored`);
log('stored findings name no customer', !JSON.stringify(data.validationFindings ?? []).includes('Asha Rao') && !JSON.stringify(data.validationFindings ?? []).includes('Ravi Kumar'));
await tapId('finding-fine');
log('save is off until a note is written', await p.evaluate(() => [...document.querySelectorAll('[data-testid="finding-save"]')].at(-1)?.disabled === true));
await typeInto('finding-note', 'Checked on site, fibres not spliced yet');
await tapId('finding-save');
await sleep(1500);
data = await network();
const decided = (data.validationFindings ?? []).find((f) => f.state === 'acknowledged');
log('decision stored with the note and history', !!decided && /Checked on site/.test(JSON.stringify(decided)), decided?.state);
await shot('15-findings');
await closePanels();

console.log('--- Phase 18: capacity from records; a plan changes nothing real');
await openTool('Capacity');
log('capacity screen opens', await visibleSel('[data-testid="capacity-dashboard"]'));
const totals = await textOf('[data-testid="capacity-totals"]');
log('totals listed from records', totals.length > 0, totals.slice(0, 100).replace(/\s+/g, ' '));
const demand = await textOf('[data-testid="capacity-demand"]');
log('the waiting customer at Box 1 shows as demand', /Box 1|FAT-1/.test(demand) && /1/.test(demand), demand.slice(0, 140).replace(/\s+/g, ' '));
log('the waiting customer is not named', !/Ravi Kumar/.test(demand));
const before = JSON.stringify((await network()).splitters);
await typeInto('scenario-new-name', 'Temple Road next 3 homes');
await tapId('scenario-create');
await sleep(1200);
if (!(await visibleSel('[data-testid="scenario-kind-customers"]'))) {
  const sid = await p.evaluate(() => [...document.querySelectorAll('[data-testid^="scenario-SCN"],[data-testid^="scenario-"]')].map((e) => e.dataset.testid).find((t) => /^scenario-(?!new|create|kind|count|place|target|ratio|box|feed|fibers|duct|add|results|line|toggle|delete)/.test(t)));
  if (sid) await tapId(sid);
}
await tapId('scenario-kind-customers');
await typeInto('scenario-count', '3');
await setField('scenario-place', 'splitter');
await chooseByText('scenario-target', 'Splitter 1');
await tapId('scenario-add-line');
await sleep(1500);
const results = await textOf('[data-testid="scenario-results"]');
log('the plan shows its result on the splitter', /Splitter 1|SPL-1/.test(results) && results.length > 10, results.slice(0, 160).replace(/\s+/g, ' '));
data = await network();
const scn = (data.planningScenarios ?? [])[0];
log('the plan is stored on its own', !!scn && (scn.items ?? []).length === 1, JSON.stringify(scn?.items ?? null).slice(0, 120));
log('the real splitter is unchanged by the plan', JSON.stringify(data.splitters) === before);
await shot('18-capacity');
await closePanels();

console.log('--- Phase 20: live status says there is no live connection');
await openTool('Live status');
await sleep(800);
await tapId('mon-tab-noc');
await sleep(600);
const noc = await textOf('[data-testid="noc-panel"]');
log('OLT and PON ports screen opens', noc.length > 0, noc.slice(0, 100).replace(/\s+/g, ' '));
log('no OLT is shown as live without a reading', !(await visibleSel('[data-testid="noc-live"]')) && /No live connection|not connected|No reading|Not recorded/i.test(noc));
await shot('20-noc');
await closePanels();

console.log('--- Phase 14: topology is built from recorded links');
await openTool('Topology');
await sleep(1500);
log('network tree shows', await visibleSel('[data-testid="service-topology"]'));
const unreached = await textOf('[data-testid="topo-unreached"]');
log('the splitter no PON port reaches is listed apart, with the missing link', /Splitter 1|SPL-1|CUST-1|Customer/.test(unreached), unreached.slice(0, 140).replace(/\s+/g, ' '));
await tapId('topology-tab-compare');
await sleep(800);
log('physical and logical tab opens', await visibleSel('[data-testid="combined-view"]') || (await visibleSel('[data-testid="combined-panel"]')));
await shot('14-topology');

await finish({ app });
