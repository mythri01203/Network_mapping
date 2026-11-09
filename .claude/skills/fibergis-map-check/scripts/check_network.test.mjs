// Run with: node --test .claude/skills/fibergis-map-check/scripts/check_network.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkNetwork, distanceMeters, formatReport } from './check_network.mjs';

const box = (id, extra = {}) => ({
  id,
  name: id,
  type: 'FAT',
  category: 'Fiber Distribution',
  lat: 12.9,
  lng: 77.6,
  ...extra,
});
const cable = (id, extra = {}) => ({
  id,
  name: id,
  cableCategory: 'Fiber',
  fiberCount: 2,
  lengthMeters: 111,
  coordinates: [
    [12.9, 77.6],
    [12.901, 77.6],
  ],
  cores: [{ coreNumber: 1 }, { coreNumber: 2 }],
  startEquipmentId: 'OLT-1',
  endEquipmentId: 'FAT-1',
  ...extra,
});
const splitter = (extra = {}) => ({
  id: 'SPL-1',
  name: 'SPL-1',
  terminalBoxId: 'FAT-1',
  ratio: '1:2',
  insertionLossDb: 3.8,
  inputPort: { id: 'IN', connectedCableId: 'CBL-1' },
  outputPorts: [{ portNumber: 1 }, { portNumber: 2 }],
  ...extra,
});
const customer = (id, extra = {}) => ({
  id,
  name: id,
  lat: 12.901,
  lng: 77.6,
  oltId: 'OLT-1',
  ponPort: 'PON-01',
  terminalBoxId: 'FAT-1',
  splitterId: 'SPL-1',
  splitterOutputPort: 1,
  feederCableId: 'CBL-1',
  distributionCableId: 'CBL-1',
  dropCableId: 'CBL-1',
  fiberCore: 1,
  ontSerialNumber: 'ZTEG12345678',
  rxOpticalPowerDbm: -20,
  ...extra,
});
const healthy = () => ({
  equipment: [
    box('OLT-1', { type: 'OLT', category: 'Central Office', lat: 12.9, ponPorts: [{ id: 'PON-01' }] }),
    box('FAT-1', { lat: 12.901 }),
  ],
  cables: [cable('CBL-1')],
  splitters: [splitter()],
  closures: [],
  customers: [customer('C-1')],
  faults: [],
  workOrders: [],
});
const rules = (data) => checkNetwork(data).map((f) => f.rule);

test('a correct small network has no findings', () => {
  assert.deepEqual(checkNetwork(healthy()), []);
});

test('an empty network has no findings', () => {
  assert.deepEqual(checkNetwork({}), []);
});

test('a cable pointing at missing equipment is an error', () => {
  const data = healthy();
  data.cables[0].endEquipmentId = 'GONE';
  const found = checkNetwork(data).find((f) => f.rule === 'cable-end-missing');
  assert.equal(found.severity, 'error');
});

test('an unconnected cable end is only a warning, so unfinished work is not blocked', () => {
  const data = healthy();
  delete data.cables[0].endEquipmentId;
  const found = checkNetwork(data).find((f) => f.rule === 'cable-end-not-connected');
  assert.equal(found.severity, 'warning');
});

test('a splitter losing less than physics allows is an error', () => {
  const data = healthy();
  data.splitters[0].insertionLossDb = 1;
  assert.ok(rules(data).includes('splitter-loss-impossible'));
});

test('a splitter recorded at its rounded ideal loss is accepted', () => {
  for (const [ratio, loss, ports] of [['1:2', 3.0, 2], ['1:4', 6.0, 4], ['1:8', 9.0, 8], ['1:16', 12.0, 16]]) {
    const data = healthy();
    data.splitters[0].ratio = ratio;
    data.splitters[0].insertionLossDb = loss;
    data.splitters[0].outputPorts = Array.from({ length: ports }, (_, i) => ({ portNumber: i + 1 }));
    assert.ok(!rules(data).includes('splitter-loss-impossible'), `${ratio} at ${loss} dB`);
  }
});

test('two customers on one splitter port is an error', () => {
  const data = healthy();
  data.customers.push(customer('C-2', { fiberCore: 2 }));
  assert.ok(rules(data).includes('splitter-port-shared'));
});

test('two customers on one house wire core is an error', () => {
  const data = healthy();
  data.customers.push(customer('C-2', { splitterOutputPort: 2 }));
  assert.ok(rules(data).includes('core-shared'));
});

test('a core spliced twice on one side is an error, and a core beyond the cable is caught', () => {
  const data = healthy();
  const splice = (id, inputCore) => ({ id, inputCableId: 'CBL-1', inputCore, outputCableId: 'CBL-1', outputCore: inputCore });
  data.closures = [{ id: 'CL-1', name: 'CL-1', splices: [splice('S1', 1), splice('S2', 1), splice('S3', 9)] }];
  const found = rules(data);
  assert.ok(found.includes('core-spliced-twice'));
  assert.ok(found.includes('splice-core-missing'));
});

test('swapped coordinates are detected', () => {
  const data = healthy();
  data.equipment[1].lat = 77.6;
  data.equipment[1].lng = 12.9;
  assert.ok(rules(data).includes('coordinates-swapped'));
});

test('light level problems, including the fake 0 dBm, are flagged', () => {
  const read = (rx) => {
    const data = healthy();
    data.customers[0].rxOpticalPowerDbm = rx;
    return rules(data);
  };
  assert.ok(read(0).includes('rx-looks-fake'));
  assert.ok(read(-5).includes('rx-too-strong'));
  assert.ok(read(-29).includes('rx-too-weak'));
  assert.ok(!read(-8).includes('rx-too-strong'));
  assert.ok(!read(-27).includes('rx-too-weak'));
});

test('an auto-generated ONT serial is flagged', () => {
  const data = healthy();
  data.customers[0].ontSerialNumber = 'HWTC-ONT-ABC123';
  assert.ok(rules(data).includes('made-up-serial'));
});

test('a long map line against a short saved length is flagged', () => {
  const data = healthy();
  data.cables[0].lengthMeters = 50;
  assert.ok(rules(data).includes('cable-length-mismatch'));
});

test('the same type close together is a possible duplicate, but a box on a pole is fine', () => {
  const data = healthy();
  data.equipment.push(box('FAT-2', { lat: 12.901 }));
  assert.ok(rules(data).includes('possible-duplicate'));

  const onPole = healthy();
  onPole.equipment.push(box('POLE-1', { type: 'Telecom Pole', category: 'Supporting Infrastructure', lat: 12.901 }));
  assert.deepEqual(checkNetwork(onPole), []);
});

test('work orders pointing at deleted items are flagged', () => {
  const data = healthy();
  data.workOrders = [{ id: 'WO-1', equipmentId: 'GONE' }];
  assert.ok(rules(data).includes('points-to-deleted'));
});

test('coaxial cables are not checked for fiber core records', () => {
  const data = healthy();
  data.cables[0].cableCategory = 'Coaxial';
  data.cables[0].fiberCount = 0;
  data.cables[0].cores = [];
  assert.ok(!rules(data).includes('core-count-wrong'));
});

test('distance is about 111 m per 0.001 degrees of latitude', () => {
  assert.ok(Math.abs(distanceMeters(12.9, 77.6, 12.901, 77.6) - 111.2) < 0.5);
});

test('the report limits examples and says what it cannot prove', () => {
  const data = healthy();
  data.cables[0].endEquipmentId = 'GONE';
  const report = formatReport(checkNetwork(data), data, 1);
  assert.match(report, /1 must fix/);
  assert.match(report, /does not prove the map matches the street/);
});

// --- Outside plant (Phase 3) ---
const pole = (id, extra = {}) => box(id, { type: 'Telecom Pole', category: 'Supporting Infrastructure', ...extra });
const withPoles = () => {
  const data = healthy();
  data.equipment.push(pole('P-1', { lat: 12.9002 }), pole('P-2', { lat: 12.9006 }));
  data.spans = [{ id: 'S-1', name: 'P-1 – P-2', fromStructureId: 'P-1', toStructureId: 'P-2', status: 'built', basis: 'office_drawn' }];
  data.attachments = [
    { id: 'A-1', cableId: 'CBL-1', structureId: 'P-1', status: 'built', basis: 'office_confirmed' },
    { id: 'A-2', cableId: 'CBL-1', spanId: 'S-1', status: 'built', basis: 'office_confirmed' },
  ];
  return data;
};

test('correct spans and attachments add no findings', () => {
  assert.deepEqual(checkNetwork(withPoles()), []);
});

test('a span or attachment pointing to nothing is an error', () => {
  const data = withPoles();
  data.spans[0].toStructureId = 'GONE';
  data.attachments.push({ id: 'A-3', cableId: 'CBL-GONE', spanId: 'S-GONE', status: 'built', basis: 'office_confirmed' });
  const found = rules(data);
  assert.ok(found.includes('span-end-missing'));
  assert.ok(found.includes('attachment-cable-missing'));
  assert.ok(found.includes('attachment-host-missing'));
});

test('proposed field spans and a span recorded twice are to check, not errors', () => {
  const data = withPoles();
  data.spans.push({ id: 'S-2', name: 'again', fromStructureId: 'P-2', toStructureId: 'P-1', status: 'proposed', basis: 'field_sequence' });
  const findings = checkNetwork(data);
  assert.deepEqual(
    findings.filter((f) => f.severity === 'warning').map((f) => f.rule).sort(),
    ['span-proposed', 'span-repeated'],
  );
  assert.ok(!findings.some((f) => f.severity === 'error'));
});

test('a pole recorded on a cable far from its drawn line is flagged', () => {
  const data = withPoles();
  data.equipment.push(pole('P-FAR', { lng: 77.601 }));
  data.attachments.push({ id: 'A-4', cableId: 'CBL-1', structureId: 'P-FAR', status: 'built', basis: 'office_confirmed' });
  assert.ok(rules(data).includes('attachment-far-from-route'));
});

test('duct occupancy must name real cables, once each', () => {
  const data = healthy();
  data.ducts = [
    {
      id: 'D-1',
      name: 'D-1',
      coordinates: [
        [12.9, 77.6],
        [12.901, 77.6],
      ],
      cableIds: ['CBL-1'],
      subducts: [{ id: 'SD-1', label: 'Blue', cableIds: ['CBL-1', 'CBL-GONE'] }],
    },
  ];
  const found = rules(data);
  assert.ok(found.includes('duct-cable-missing'));
  assert.ok(found.includes('duct-cable-repeated'));
});

test('slack loops and permissions must point to real records; an ended permission is flagged', () => {
  const data = withPoles();
  data.slackLoops = [{ id: 'L-1', name: 'L-1', cableId: 'CBL-GONE', structureId: 'P-GONE', lengthMeters: 0 }];
  data.permissions = [
    { id: 'PR-1', authority: 'BESCOM', permitNumber: 'B-1', structureIds: ['P-1', 'P-GONE'], validUntil: '2025-12-31' },
  ];
  const found = checkNetwork(data, undefined, '2026-11-07').map((f) => f.rule);
  for (const rule of ['slack-cable-missing', 'slack-place-missing', 'slack-length-invalid', 'permission-item-missing', 'permission-expired']) {
    assert.ok(found.includes(rule), rule);
  }
});

test('an electricity pole and a telecom pole on one spot are a possible duplicate', () => {
  const data = healthy();
  data.equipment.push(pole('P-1', { lat: 12.9003 }), pole('P-2', { lat: 12.9003, type: 'Electric Pole' }));
  assert.ok(rules(data).includes('possible-duplicate'));
});

test('an aerial cable with no poles recorded is a note', () => {
  const data = healthy();
  data.cables[0].installationType = 'Aerial';
  const findings = checkNetwork(data);
  assert.deepEqual(findings.map((f) => [f.severity, f.rule]), [['note', 'aerial-no-poles']]);
});

// --- Phase 4: fiber by fiber ------------------------------------------------------------------

/** OLT PON-01 → ODF port 1 → CBL-1 fiber 1 → splice → CBL-2 fiber 1 → splitter → drop CBL-3 fiber 1 → customer. */
const fiberNetwork = () => {
  const data = healthy();
  data.equipment.push(box('ODF-1', { type: 'ODF', odfPanels: [{ id: 'P', label: 'Panel A', ports: [{ id: 'X1', number: 1, status: 'in_use', feederCableId: 'CBL-1', feederCore: 1, patch: { oltId: 'OLT-1', ponPortId: 'PON-01', patchedAt: '' } }] }] }));
  data.equipment[0].ponPorts[0].opticsClass = 'GPON B+';
  data.cables = [
    cable('CBL-1', { colorScheme: 'tia-598', fibersPerTube: 2 }),
    cable('CBL-2', { colorScheme: 'tia-598', fibersPerTube: 2 }),
    cable('CBL-3', { colorScheme: 'tia-598', fibersPerTube: 2 }),
  ];
  data.closures = [{ id: 'CL-1', name: 'CL-1', splices: [{ id: 'S1', inputCableId: 'CBL-1', inputCore: 1, outputCableId: 'CBL-2', outputCore: 1, status: 'Spliced' }] }];
  data.splitters[0].inputPort = { id: 'IN', connectedCableId: 'CBL-2', connectedCore: 1 };
  data.splitters[0].outputPorts[0] = { portNumber: 1, connectedDropCableId: 'CBL-3', connectedCore: 1, connectedCustomerId: 'C-1' };
  data.customers = [customer('C-1', { dropCableId: 'CBL-3', feederCableId: 'CBL-1', distributionCableId: 'CBL-2' })];
  return data;
};
const fiberRules = (data) => checkNetwork(data).filter((f) => f.severity !== 'note').map((f) => f.rule);

test('a fiber path recorded end to end adds no errors or warnings', () => {
  assert.deepEqual(fiberRules(fiberNetwork()), []);
});

test('a fiber fed from two places, or going two ways, is an error', () => {
  const twoFeeds = fiberNetwork();
  twoFeeds.closures[0].splices.push({ id: 'S2', inputCableId: 'CBL-1', inputCore: 2, outputCableId: 'CBL-2', outputCore: 1, status: 'Spliced' });
  assert.ok(fiberRules(twoFeeds).includes('core-two-feeds'));
  const twoWays = fiberNetwork();
  twoWays.closures[0].splices.push({ id: 'S2', inputCableId: 'CBL-1', inputCore: 1, outputCableId: 'CBL-2', outputCore: 2, status: 'Spliced' });
  assert.ok(fiberRules(twoWays).includes('core-two-continuations'));
});

test('a splice taken out of service is history, not a live join', () => {
  const data = fiberNetwork();
  data.closures[0].splices.push({ id: 'S0', inputCableId: 'CBL-1', inputCore: 2, outputCableId: 'CBL-2', outputCore: 1, status: 'Spliced', retiredAt: '2026-11-01' });
  assert.deepEqual(fiberRules(data), []);
});

test('two active assignments on one fiber and a tube layout that does not add up are errors', () => {
  const data = fiberNetwork();
  data.cables[0].cores[1].assignments = [{ id: 'A', use: 'X' }, { id: 'B', use: 'Y' }];
  data.cables[1].fibersPerTube = 3;
  const found = fiberRules(data);
  assert.ok(found.includes('core-two-assignments'));
  assert.ok(found.includes('tube-layout-wrong'));
});

test('splitter outputs beyond the ratio, ODF ports naming missing fibers and two patches on one PON port are errors', () => {
  const data = fiberNetwork();
  data.splitters[0].outputPorts.push({ portNumber: 3 });
  data.equipment[2].odfPanels[0].ports.push({ id: 'X2', number: 2, status: 'in_use', feederCableId: 'CBL-1', feederCore: 9, patch: { oltId: 'OLT-1', ponPortId: 'PON-01', patchedAt: '' } });
  const found = fiberRules(data);
  assert.ok(found.includes('splitter-output-overflow'));
  assert.ok(found.includes('odf-port-core-missing'));
  assert.ok(found.includes('pon-two-patches'));
});

test('an unknown colour scheme on a spliced cable and a missing optics class are notes', () => {
  const data = fiberNetwork();
  delete data.cables[1].colorScheme;
  delete data.equipment[0].ponPorts[0].opticsClass;
  const notes = checkNetwork(data).filter((f) => f.severity === 'note').map((f) => f.rule);
  assert.ok(notes.includes('cable-scheme-unknown'));
  assert.ok(notes.includes('pon-class-not-recorded'));
});

// --- Customers and connections (Phase 5) ---
const ont = (id, extra = {}) => ({ id, serialNumber: `SN-${id}`, arrangement: 'single', status: 'installed', statusSource: 'person', createdAt: '', ...extra });
const withConnections = () => {
  const data = healthy();
  data.onts = [ont('ONT-1', { oltId: 'OLT-1', ponPortId: 'PON-01', splitterId: 'SPL-1', splitterOutputPort: 1, dropCableId: 'CBL-1', dropCore: 1 })];
  data.customers[0].ontId = 'ONT-1';
  data.services = [{ id: 'SVC-1', customerId: 'C-1', kind: 'internet', status: 'active', ontId: 'ONT-1', createdAt: '' }];
  data.equipment.push(box('BEP-1', { type: 'Building Entry Point', category: 'Supporting Infrastructure', lat: 12.9015 }));
  data.buildings = [{ id: 'B-1', name: 'Lake View', kind: 'apartment', lat: 12.9015, lng: 77.6, entryEquipmentId: 'BEP-1', riserCableId: 'CBL-1', floorBoxes: [{ id: 'F-1', label: 'Floor 3' }], units: [{ id: 'U-1', label: '302', floorBoxId: 'F-1' }], createdAt: '' }];
  data.customers[0].buildingId = 'B-1';
  data.customers[0].unitId = 'U-1';
  return data;
};

test('ONT, service and building records that agree add no findings', () => {
  assert.deepEqual(checkNetwork(withConnections()), []);
});

test('ONTs naming missing records, one serial on two ONTs and two customers on a one-customer ONT are errors', () => {
  const data = withConnections();
  data.onts[0].splitterId = 'GONE';
  data.onts.push(ont('ONT-2', { serialNumber: 'sn-ont-1' }));
  data.customers.push(customer('C-2', { ontId: 'ONT-1', splitterOutputPort: 2, fiberCore: 2 }));
  const found = rules(data);
  assert.ok(found.includes('ont-link-missing'));
  assert.ok(found.includes('ont-serial-twice'));
  assert.ok(found.includes('ont-one-customer-shared'));
  data.onts[0].arrangement = 'shared';
  assert.ok(!rules(data).includes('ont-one-customer-shared'));
});

test('a removed ONT is history: not checked, but a customer still on it is an error', () => {
  const data = withConnections();
  data.onts[0] = { ...data.onts[0], status: 'removed', splitterId: 'GONE' };
  const found = rules(data);
  assert.ok(!found.includes('ont-link-missing'));
  assert.ok(found.includes('customer-on-removed-ont'));
});

test('a disconnected customer still holding an output or fiber is flagged, and has no path warnings', () => {
  const data = withConnections();
  const c = data.customers[0];
  Object.assign(c, { status: 'Disconnected', oltId: '', ponPort: '', terminalBoxId: '', splitterId: '', splitterOutputPort: 0, dropCableId: '', fiberCore: 0, ontId: undefined });
  data.services[0].status = 'active';
  data.splitters[0].outputPorts[0].connectedCustomerId = 'C-1';
  data.cables[0].cores[0].assignments = [{ id: 'A', use: 'Customer C-1', customerId: 'C-1' }];
  const found = checkNetwork(data);
  const ids = found.map((f) => f.rule);
  assert.ok(ids.includes('disconnected-holds-port'));
  assert.ok(ids.includes('disconnected-holds-fiber'));
  assert.ok(ids.includes('service-on-disconnected'));
  assert.ok(ids.includes('disconnect-no-history'));
  assert.ok(!ids.includes('customer-path-incomplete'));
  // No customer name or phone number in these messages: ids only.
  data.customers[0].name = 'Asha Rao';
  assert.ok(checkNetwork(data).filter((f) => /disconnected|service-on/.test(f.rule)).every((f) => !f.message.includes('Asha')));
});

test('services and buildings naming missing records are errors; missing riser and floor boxes are notes', () => {
  const data = withConnections();
  data.services.push({ id: 'SVC-2', customerId: 'NOBODY', kind: 'internet', status: 'active', createdAt: '' });
  data.buildings[0].riserCableId = 'GONE';
  data.buildings[0].units.push({ id: 'U-2', label: '302' }, { id: 'U-3', label: '303', floorBoxId: 'NOPE' });
  const found = rules(data);
  assert.ok(found.includes('service-customer-missing'));
  assert.ok(found.includes('building-link-missing'));
  assert.ok(found.includes('unit-label-repeated'));
  assert.ok(found.includes('unit-box-missing'));
  const plain = withConnections();
  delete plain.buildings[0].riserCableId;
  delete plain.buildings[0].units[0].floorBoxId;
  const notes = checkNetwork(plain).filter((f) => f.severity === 'note').map((f) => f.rule);
  assert.ok(notes.includes('building-riser-not-recorded'));
  assert.ok(notes.includes('unit-box-not-recorded'));
});

test('customers on one shared ONT may use one drop fiber', () => {
  const data = withConnections();
  data.onts[0].arrangement = 'shared';
  data.customers.push(customer('C-2', { ontId: 'ONT-1', splitterOutputPort: 2 }));
  assert.ok(!rules(data).includes('core-shared'));
  delete data.customers[1].ontId;
  assert.ok(rules(data).includes('core-shared'));
});

// --- Phase 8: alarms, faults, work orders, conflicts ---
const alarm = (id, extra = {}) => ({ id, kind: 'ont_los', source: 'test', isTest: true, severity: 'High', state: 'active', element: { type: 'customer', id: 'C-1' }, firstSeenAt: '', lastSeenAt: '', occurrences: 1, ...extra });
const fault = (id, extra = {}) => ({ id, title: id, type: 'Customer Disconnection', severity: 'High', status: 'Reported', affectedLocation: { lat: 12.9, lng: 77.6 }, affectedCustomerIds: ['C-1'], affectedCores: [], affectedSplitterPorts: [], description: '', reportedAt: '', images: [], isTest: true, source: 'test', alarmIds: ['A-1'], ...extra });
const job = (id, extra = {}) => ({ id, title: id, type: 'Repair', priority: 'High', status: 'Assigned', technicianName: 'T', technicianPhone: '', faultId: 'F-1', scheduledDate: '', notes: '', photos: [], isTest: true, ...extra });
const withFaults = () => ({ ...healthy(), alarms: [alarm('A-1', { faultId: 'F-1' })], faults: [fault('F-1')], workOrders: [job('W-1')] });
const reading = { method: 'field_reading', at: '', by: 'T', readingDbm: -19, readingOrigin: 'field_measured', photoId: 'PH-1' };

test('a labelled TEST alarm, its fault and job add no findings', () => {
  assert.deepEqual(checkNetwork(withFaults()), []);
});

test('a device alarm with no OLT connected, and a TEST label that does not match, are errors', () => {
  const data = withFaults();
  data.alarms.push(alarm('A-2', { source: 'device_adapter', isTest: false }), alarm('A-3', { source: 'manual', isTest: true }));
  const found = rules(data);
  assert.ok(found.includes('alarm-device-not-connected'));
  assert.equal(found.filter((r) => r === 'alarm-test-label').length, 1);
});

test('a fault or job closed without a check is an error; a field reading not measured does not count', () => {
  const data = withFaults();
  data.faults[0].status = 'Closed';
  data.workOrders[0] = job('W-1', { status: 'Verified', verification: { ...reading, readingOrigin: 'calculated' } });
  const found = rules(data);
  assert.ok(found.includes('fault-closed-unverified'));
  assert.ok(found.includes('work-order-closed-unverified'));
  data.workOrders[0].verification = reading;
  const after = rules(data);
  assert.ok(!after.includes('fault-closed-unverified'));
  assert.ok(!after.includes('work-order-closed-unverified'));
});

test('an open fault listing customers whose path is now broken or gone is flagged, by id only', () => {
  const data = withFaults();
  data.customers[0].name = 'Asha Rao';
  data.customers[0].dropCableId = '';
  data.faults[0].affectedCustomerIds = ['C-1', 'C-GONE'];
  const found = checkNetwork(data);
  const ids = found.map((f) => f.rule);
  assert.ok(ids.includes('fault-affected-broken-path'));
  assert.ok(ids.includes('fault-affected-missing'));
  // The Phase 8 rules name customers by id only (older customer rules still print names).
  assert.ok(found.filter((f) => /^fault-|^alarm-|^work-order-/.test(f.rule)).every((f) => !f.message.includes('Asha')));
});

test('TEST and real mixed in one fault, a real job on a TEST fault, and an open job on a closed fault are flagged', () => {
  const data = withFaults();
  data.alarms[0].isTest = false;
  data.alarms[0].source = 'manual';
  data.workOrders[0].isTest = false;
  data.faults.push(fault('F-2', { status: 'Closed', verification: { method: 'office_check', at: '', by: 'O', note: 'ok' }, alarmIds: [], isTest: false, source: 'manual' }));
  data.workOrders.push(job('W-2', { faultId: 'F-2', isTest: false, status: 'In Progress' }));
  const found = rules(data);
  assert.ok(found.filter((r) => r === 'fault-test-mixed').length >= 2);
  assert.ok(found.includes('work-order-open-on-closed-fault'));
});

test('older resolved faults, jobs waiting for a check and conflicts waiting are notes', () => {
  const data = withFaults();
  data.faults.push(fault('F-OLD', { status: 'Resolved', isTest: false, source: undefined, alarmIds: [] }));
  data.workOrders[0].status = 'Completed';
  data.syncConflicts = [{ id: 'CNF-1', status: 'office_decides' }, { id: 'CNF-2', status: 'kept_mine' }];
  const notes = checkNetwork(data).filter((f) => f.severity === 'note').map((f) => f.rule);
  assert.ok(notes.includes('fault-resolved-before-checks'));
  assert.ok(notes.includes('work-order-awaiting-check'));
  assert.ok(notes.includes('sync-conflicts-waiting'));
});

// --- Phase 6: Cable TV / HFC -------------------------------------------------------------------
const rfPort = (id, direction, extra = {}) => ({ id, label: id, direction, signal: 'rf', ...extra });
const rfItem = (id, kind, ports, extra = {}) => ({ id, name: `Name of ${id}`, kind, status: 'built', ports, createdAt: '2026-11-01', ...extra });
const rfLink = (id, from, to, extra = {}) => ({
  id,
  from: { elementId: from[0], portId: from[1] },
  to: { elementId: to[0], portId: to[1] },
  medium: 'coax',
  status: 'active',
  createdAt: '2026-11-01',
  ...extra,
});
const withCableTv = () => ({
  customers: [{ id: 'C-TV', name: 'Asha Rao', status: 'Active', accessNetwork: 'hfc' }],
  rfElements: [
    rfItem('HE-1', 'headend', [rfPort('out', 'out')]),
    rfItem('AMP-1', 'rf_amplifier', [rfPort('in', 'in'), rfPort('out', 'out', { role: 'main' })], { powerFeed: 'local', gainDb: 30 }),
    rfItem('TAP-1', 'tap', [rfPort('in', 'in'), rfPort('d1', 'out', { role: 'drop' }), rfPort('d2', 'out', { role: 'drop' })]),
    rfItem('STB-1', 'stb', [rfPort('in', 'in')], { customerId: 'C-TV' }),
  ],
  rfLinks: [
    rfLink('L-1', ['HE-1', 'out'], ['AMP-1', 'in']),
    rfLink('L-2', ['AMP-1', 'out'], ['TAP-1', 'in']),
    rfLink('L-3', ['TAP-1', 'd1'], ['STB-1', 'in']),
  ],
  rfLevels: [{ id: 'LV-1', elementId: 'TAP-1', portId: 'd1', value: 65, unit: 'dBuV', origin: 'field_measured', technician: 'T', createdAt: '2026-11-01' }],
});

test('a clean Cable TV tree gives no findings, and no PON or fiber rule runs on the hfc customer', () => {
  assert.deepEqual(checkNetwork(withCableTv()), []);
});

test('Cable TV links naming a missing item or port are errors', () => {
  const data = withCableTv();
  data.rfLinks.push(rfLink('L-9', ['TAP-1', 'd2'], ['GONE-1', 'in']), rfLink('L-10', ['TAP-1', 'd9'], ['STB-1', 'in']));
  const found = rules(data);
  assert.ok(found.includes('rf-link-missing-item'));
  assert.ok(found.includes('rf-link-missing-port'));
});

test('a tap port used twice is an error, and removed links do not count', () => {
  const data = withCableTv();
  data.rfElements.push(rfItem('STB-2', 'stb', [rfPort('in', 'in')], { customerId: 'C-TV' }));
  data.rfLinks.push(rfLink('L-4', ['TAP-1', 'd1'], ['STB-2', 'in']));
  assert.ok(rules(data).includes('rf-tap-port-used-twice'));
  data.rfLinks[3].status = 'removed';
  assert.ok(!rules(data).includes('rf-tap-port-used-twice'));
});

test('a customer device on a tap with no recorded path to a headend is flagged', () => {
  const data = withCableTv();
  data.rfLinks = data.rfLinks.filter((l) => l.id !== 'L-1');
  assert.ok(rules(data).includes('rf-customer-no-headend'));
  data.rfLinks.push(rfLink('L-P', ['HE-1', 'out'], ['AMP-1', 'in'], { medium: 'power' }));
  assert.ok(rules(data).includes('rf-customer-no-headend'), 'a power-only link is not a signal path');
});

test('a level with no unit or an unknown unit is an error, and so is dBuV on a light port', () => {
  const data = withCableTv();
  data.rfElements.push(rfItem('NODE-1', 'optical_node', [rfPort('opt', 'in', { signal: 'optical' })], { powered: true }));
  data.rfLevels.push(
    { id: 'LV-2', elementId: 'TAP-1', portId: 'd2', value: 60, origin: 'designed', createdAt: '' },
    { id: 'LV-3', elementId: 'TAP-1', portId: 'd2', value: 60, unit: 'dB', origin: 'designed', createdAt: '' },
    { id: 'LV-4', elementId: 'NODE-1', portId: 'opt', value: 60, unit: 'dBuV', origin: 'designed', createdAt: '' },
  );
  const found = checkNetwork(data);
  assert.deepEqual(found.filter((f) => f.rule === 'rf-level-unit-unknown').map((f) => f.id), ['LV-2', 'LV-3']);
  assert.ok(found.some((f) => f.rule === 'rf-level-unit-mismatch' && f.id === 'LV-4'));
});

test('an amplifier with no power source recorded is a warning', () => {
  const data = withCableTv();
  delete data.rfElements[1].powerFeed;
  assert.ok(rules(data).includes('rf-amp-no-power'));
  data.rfElements[1].powerFeed = 'unknown';
  assert.ok(rules(data).includes('rf-amp-no-power'));
});

test('Cable TV messages use ids only, never customer or item names', () => {
  const data = withCableTv();
  data.rfLinks = [rfLink('L-X', ['TAP-1', 'd1'], ['MISSING', 'in'])];
  data.rfElements.push(rfItem('STB-9', 'stb', [rfPort('in', 'in')], { customerId: 'C-GONE' }));
  const found = checkNetwork(data).filter((f) => f.rule.startsWith('rf-'));
  assert.ok(found.length >= 3);
  assert.ok(found.every((f) => !f.message.includes('Asha') && !f.message.includes('Name of')));
});
