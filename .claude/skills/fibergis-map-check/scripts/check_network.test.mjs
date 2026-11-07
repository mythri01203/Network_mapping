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
