import { describe, expect, it } from 'vitest';

import { applyPatch, type CommandResult, type NetworkData } from '../src/domain/command';
import {
  addOdfPanel,
  assignCore,
  connectSplitterOutput,
  coreUtilization,
  createClosure,
  linkSplitterInput,
  patchOdfPort,
  recordSplice,
  releaseCore,
  resplice,
  retireSplice,
  saveSplitterDetails,
  setCableLayout,
  setOdfPortFeeder,
  updatePonPort,
} from '../src/domain/fiberCommands';
import { traceCoreUpstream, traceCustomerCores, tracePonTree } from '../src/domain/fiberPath';
import { checkChangeSetFiber, findFiberProblems } from '../src/domain/fiberRules';
import { buildOltPonPorts } from '../src/domain/oltConfig';
import { traceOpticalPath } from '../src/domain/opticalPathTrace';
import { createSplitter, provisionCustomer } from '../src/domain/provisioning';
import { coreIdentity, parseColorSchemeSetting, resolveColorSchemes } from '../src/fiber/colors';
import type { Cable } from '../src/model/types';
import { cable, emptyNetwork, equipment, NOW } from './fixtures';

const ctx = { now: NOW, actor: 'Test Engineer' };

function ok<T>(result: CommandResult<T>): { value: T; patch: NetworkData; confirm?: string } {
  if (!result.ok) throw new Error(`${result.error.title}: ${result.error.message}`);
  return { value: result.value, patch: result.patch as NetworkData, confirm: result.confirm };
}

const fiberCable = (id: string, fiberCount: number, from: string, to: string, lengthMeters: number, extra: Partial<Cable> = {}) =>
  cable({
    id,
    name: id,
    fiberCount,
    lengthMeters,
    startEquipmentId: from,
    endEquipmentId: to,
    coordinates: [
      [17.4, 78.4],
      [17.41, 78.41],
    ],
    cores: [],
    ...extra,
  });

/** Example A, built only with the commands people use: OLT → patch → ODF → feeder → closure → distribution → splitter → drop → ONT. */
function exampleA() {
  let data: NetworkData = {
    ...emptyNetwork(),
    equipment: [
      equipment({ id: 'OLT-1', type: 'OLT', category: 'Central Office', technology: 'GPON', totalPorts: 4 }),
      equipment({ id: 'ODF-1', type: 'ODF', category: 'Central Office' }),
      equipment({ id: 'JC-1', type: 'Fiber Joint Closure' }),
      equipment({ id: 'FAT-1', type: 'FAT', totalPorts: 8 }),
    ],
    cables: [
      fiberCable('FDR-1', 24, 'ODF-1', 'JC-1', 3000, { type: 'Main Feeder Fiber' }),
      fiberCable('DST-1', 12, 'JC-1', 'FAT-1', 1500),
    ],
  };
  const step = <T>(result: CommandResult<T>) => {
    const r = ok(result);
    data = applyPatch(data, r.patch);
    return r.value;
  };
  data = { ...data, equipment: data.equipment.map((e) => (e.id === 'OLT-1' ? { ...e, ponPorts: buildOltPonPorts(e) } : e)) };
  step(updatePonPort(data, 'OLT-1', 'PON-01', { opticsClass: 'GPON B+', vendorAddress: 'gpon 0/1/0', txPowerDbm: 3 }, ctx));
  step(setCableLayout(data, 'FDR-1', { colorScheme: 'tia-598', tubeColorScheme: 'tia-598', fibersPerTube: 12 }, ctx));
  step(setCableLayout(data, 'DST-1', { colorScheme: 'tia-598', fibersPerTube: 12 }, ctx));
  const panel = step(addOdfPanel(data, 'ODF-1', { label: 'Panel A', portCount: 24, connectorType: 'SC/APC' }, ctx));
  step(setOdfPortFeeder(data, 'ODF-1', panel.id, 3, { cableId: 'FDR-1', core: 3 }, ctx));
  step(patchOdfPort(data, 'ODF-1', panel.id, 3, { oltId: 'OLT-1', ponPortId: 'PON-01', cordLabel: 'PC-7' }, ctx));
  const closure = step(createClosure(data, { equipmentId: 'JC-1', closureType: 'Dome Splice Closure', trayCount: 2 }, ctx));
  const tray = closure.trays![0];
  const splice = step(
    recordSplice(data, closure.id, { trayId: tray.id, inputCableId: 'FDR-1', inputCore: 3, outputCableId: 'DST-1', outputCore: 3, spliceLossDb: 0.05, lossSource: 'field_measured', otdrRef: 'OTDR-0042' }, ctx),
  );
  const splitter = step(createSplitter(data, { terminalBoxId: 'FAT-1', ratio: '1:8', input: { cableId: 'DST-1', core: 3 } }, ctx));
  const provisioned = step(
    provisionCustomer(data, { terminalBoxId: 'FAT-1', splitterId: splitter.id, splitterOutputPort: 2, name: 'Asha', lat: 17.411, lng: 78.411 }, ctx),
  );
  return { data, panel, closure, tray, splice, splitter, customer: provisioned.customer, drop: provisioned.dropCable };
}

describe('fiber identity', () => {
  it('names a core by tube and fiber from the recorded layout and scheme', () => {
    const id = coreIdentity({ fiberCount: 96, fibersPerTube: 12, colorScheme: 'tia-598', tubeColorScheme: 'tia-598' }, 49);
    expect(id).toMatchObject({ tubeNumber: 5, fiberInTube: 1, schemeKnown: true });
    expect(id.fiberColor?.name).toBe('Blue');
    expect(id.tubeColor?.name).toBe('Slate');
  });

  it('works for a 96F cable with a non-TIA scheme', () => {
    const id = coreIdentity({ fiberCount: 96, fibersPerTube: 12, colorScheme: 'iec-60304', tubeColorScheme: 'iec-60304' }, 50);
    expect(id).toMatchObject({ tubeNumber: 5, fiberInTube: 2 });
    expect(id.fiberColor?.name).toBe('Green');
    expect(id.tubeColor?.name).toBe('White');
    expect(coreIdentity({ fiberCount: 96, fibersPerTube: 12, colorScheme: 'iec-60304' }, 1).fiberColor?.name).toBe('Red');
  });

  it('gives the same number different tubes in different builds', () => {
    expect(coreIdentity({ fiberCount: 24, fibersPerTube: 12 }, 13)).toMatchObject({ tubeNumber: 2, fiberInTube: 1 });
    expect(coreIdentity({ fiberCount: 24, fibersPerTube: 6 }, 13)).toMatchObject({ tubeNumber: 3, fiberInTube: 1 });
    expect(coreIdentity({ fiberCount: 24, fibersPerTube: 8 }, 13)).toMatchObject({ tubeNumber: 2, fiberInTube: 5 });
  });

  it('never invents a colour for an unknown or missing scheme', () => {
    for (const colorScheme of [undefined, 'unknown']) {
      const id = coreIdentity({ fiberCount: 12, fibersPerTube: 12, colorScheme }, 1);
      expect(id.fiberColor).toBeUndefined();
      expect(id.schemeKnown).toBe(false);
      expect(id.label).toContain('colour not known');
    }
    expect(coreIdentity({ fiberCount: 12, colorScheme: 'tia-598' }, 1).fiberColor).toBeUndefined();
  });

  it('reads an operator scheme from settings and ignores broken ones', () => {
    const scheme = parseColorSchemeSetting('fiber.scheme.stl', 'STL drum | Red, Green, Blue, Yellow', 'Drum sheet');
    expect(scheme).toMatchObject({ id: 'stl', colors: ['Red', 'Green', 'Blue', 'Yellow'], builtIn: false });
    expect(parseColorSchemeSetting('fiber.scheme.bad', 'Only | Red')).toBeNull();
    const schemes = resolveColorSchemes([{ id: 'fiber.scheme.stl', value: 'STL | Red, Green' }]);
    expect(coreIdentity({ fiberCount: 4, fibersPerTube: 2, colorScheme: 'stl' }, 4, schemes).fiberColor?.name).toBe('Green');
  });

  it('refuses a tube layout that does not add up', () => {
    const data = { ...emptyNetwork(), cables: [fiberCable('C-1', 96, 'A', 'B', 100)] };
    expect(setCableLayout(data, 'C-1', { fibersPerTube: 10 }).ok).toBe(false);
    const saved = ok(setCableLayout(data, 'C-1', { fibersPerTube: 12, colorScheme: 'unknown' }));
    expect(saved.value.tubeCount).toBe(8);
    expect(saved.value.cores.every((c) => c.colorName === undefined)).toBe(true);
  });
});

describe('example A, core by core', () => {
  it('traces OLT port, patch, ODF, feeder, splice, distribution, splitter, drop and ONT', () => {
    const { data, customer } = exampleA();
    const path = traceCustomerCores(customer, data);
    expect(path.gaps).toEqual([]);
    expect(path.complete).toBe(true);
    expect(path.steps.map((s) => s.kind)).toEqual(['olt', 'patch', 'odf', 'cable', 'splice', 'cable', 'splitter', 'cable', 'ont']);
    expect(path.steps[3]).toMatchObject({ cableId: 'FDR-1', core: 3 });
    expect(path.steps[3].identity?.fiberColor?.name).toBe('Green');
    expect(path.steps[5]).toMatchObject({ cableId: 'DST-1', core: 3 });
    expect(path.opticsClassRecorded).toBe(true);
    expect(path.directions.map((d) => d.wavelengthNm)).toEqual([1490, 1310]);
    // PON, ODF, FAT output adapter and ONT.
    expect(path.parts.connectorPairs).toBe(4);
    expect(path.parts.spliceLossDb).toBe(0.05);
    expect(path.verdict).toBeDefined();
    const up = path.directions[1].budget.totalLossDb;
    const down = path.directions[0].budget.totalLossDb;
    expect(up).toBeGreaterThan(down);
  });

  it('marks the feeder, distribution and drop fibers it uses during customer setup', () => {
    const { data, drop } = exampleA();
    const feeder = data.cables.find((c) => c.id === 'FDR-1')!;
    const dist = data.cables.find((c) => c.id === 'DST-1')!;
    const active = (c: Cable, n: number) => c.cores.find((k) => k.coreNumber === n)?.assignments?.find((a) => !a.releasedAt);
    expect(active(feeder, 3)).toMatchObject({ kind: 'in_use', oltId: 'OLT-1', ponPortId: 'PON-01' });
    expect(active(dist, 3)).toMatchObject({ kind: 'in_use', oltId: 'OLT-1' });
    expect(active(data.cables.find((c) => c.id === drop.id)!, 1)?.customerId).toBeDefined();
    expect(coreUtilization(feeder)).toMatchObject({ total: 24, inUse: 1, available: 23 });
  });

  it('links the customer to the OLT port the fibers reach, through the ODF patch no cable shows', () => {
    const { data, customer } = exampleA();
    expect(customer).toMatchObject({ oltId: 'OLT-1', ponPort: 'PON-01', feederCableId: 'FDR-1', distributionCableId: 'DST-1', rxSource: 'calculated' });
    expect(data.equipment.find((e) => e.id === 'OLT-1')!.ponPorts!.find((p) => p.id === 'PON-01')!.connectedCustomersCount).toBe(1);
  });

  it('feeds the result into the optical trace and the PON tree', () => {
    const { data, customer } = exampleA();
    const trace = traceOpticalPath(customer.id, data)!;
    expect(trace.level).toBe('core');
    expect(trace.complete).toBe(true);
    const tree = tracePonTree('OLT-1', 'PON-01', data)!;
    expect(tree.customers.map((c) => c.id)).toEqual([customer.id]);
    expect(tree.coreKeys).toEqual(['FDR-1#3', 'DST-1#3', `${customer.dropCableId}#1`]);
  });

  it('names the exact gap when one splice is taken out', () => {
    const { data, closure, splice, customer } = exampleA();
    const broken = applyPatch(data, ok(retireSplice(data, closure.id, splice.id, 'Cut by road work', ctx)).patch);
    const path = traceCustomerCores(customer, broken);
    expect(path.complete).toBe(false);
    expect(path.verdict).toBeUndefined();
    expect(path.gaps[0]).toContain('Fiber 3 (Green, in tube 1) of DST-1 has no recorded link on its OLT side');
    const trace = traceOpticalPath(customer.id, broken)!;
    expect(trace.budget.verdict).toBe('Incomplete');
    expect(trace.warnings.join(' ')).toContain('DST-1');
  });

  it('keeps the old splice as history when re-spliced', () => {
    const { data, closure, splice, tray } = exampleA();
    const next = ok(resplice(data, closure.id, splice.id, { trayId: tray.id, inputCableId: 'FDR-1', inputCore: 3, outputCableId: 'DST-1', outputCore: 3 }, 'Re-made after a high reading', ctx));
    const after = applyPatch(data, next.patch).closures.find((c) => c.id === closure.id)!;
    expect(after.splices).toHaveLength(2);
    expect(after.splices.find((s) => s.id === splice.id)).toMatchObject({ retiredReason: 'Re-made after a high reading', replacedBySpliceId: next.value.id });
  });

  it('refuses a conflicting splice on a fiber that already continues', () => {
    const { data, closure } = exampleA();
    const twoFeeds = recordSplice(data, closure.id, { inputCableId: 'FDR-1', inputCore: 4, outputCableId: 'DST-1', outputCore: 3 }, ctx);
    expect(twoFeeds.ok).toBe(false);
    if (!twoFeeds.ok) expect(twoFeeds.error.message).toContain('is fed from 2 places');
    const twoWays = recordSplice(data, closure.id, { inputCableId: 'FDR-1', inputCore: 3, outputCableId: 'DST-1', outputCore: 7 }, ctx);
    expect(twoWays.ok).toBe(false);
    if (!twoWays.ok) expect(twoWays.error.message).toContain('continues to 2 places');
    expect(recordSplice(data, closure.id, { inputCableId: 'FDR-1', inputCore: 30, outputCableId: 'DST-1', outputCore: 7 }, ctx).ok).toBe(false);
  });

  it('refuses the same conflicting splice on the server', () => {
    const { data, closure } = exampleA();
    const bad = {
      ...closure,
      splices: [
        ...data.closures[0].splices,
        { id: 'X', inputCableId: 'FDR-1', inputCableName: 'FDR-1', inputCore: 9, outputCableId: 'DST-1', outputCableName: 'DST-1', outputCore: 3, status: 'Spliced' as const, technician: '', date: '' },
      ],
    };
    expect(checkChangeSetFiber(data, { upserts: { closures: [bad] } }).map((p) => p.code)).toContain('core_two_sources');
    expect(checkChangeSetFiber(data, { upserts: { closures: [data.closures[0]] } })).toEqual([]);
  });

  it('refuses a double allocation and keeps released history', () => {
    const { data } = exampleA();
    const first = ok(assignCore(data, { cableId: 'FDR-1', coreNumber: 5, kind: 'reserved', use: 'Tower link' }, ctx));
    const after = applyPatch(data, first.patch);
    const second = assignCore(after, { cableId: 'FDR-1', coreNumber: 5, kind: 'in_use', use: 'Customer X' }, ctx);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.message).toContain('already reserved for Tower link');
    expect(assignCore(after, { cableId: 'FDR-1', coreNumber: 3, kind: 'in_use', use: 'Another' }, ctx).ok).toBe(false);
    const released = applyPatch(after, ok(releaseCore(after, 'FDR-1', 5, 'Tower moved', ctx)).patch);
    const core = released.cables.find((c) => c.id === 'FDR-1')!.cores.find((k) => k.coreNumber === 5)!;
    expect(core.status).toBe('Available');
    expect(core.assignments?.[0]).toMatchObject({ releaseReason: 'Tower moved' });
    const bad = { ...released.cables.find((c) => c.id === 'FDR-1')! };
    bad.cores = bad.cores.map((k) =>
      k.coreNumber === 6
        ? { ...k, assignments: [1, 2].map((n) => ({ id: `A${n}`, kind: 'in_use' as const, use: `U${n}`, effectiveFrom: '', createdAt: '' })) }
        : k,
    );
    expect(checkChangeSetFiber(released, { upserts: { cables: [bad] } }).map((p) => p.code)).toContain('core_two_assignments');
  });

  it('refuses a second patch on one PON port and a class that does not fit the technology', () => {
    const { data, panel } = exampleA();
    expect(patchOdfPort(data, 'ODF-1', panel.id, 4, { oltId: 'OLT-1', ponPortId: 'PON-01' }, ctx).ok).toBe(false);
    expect(patchOdfPort(data, 'ODF-1', panel.id, 3, { oltId: 'OLT-1', ponPortId: 'PON-02' }, ctx).ok).toBe(false);
    expect(updatePonPort(data, 'OLT-1', 'PON-01', { opticsClass: 'EPON PX20' }, ctx).ok).toBe(false);
  });
});

describe('splitters', () => {
  it('refuses an output beyond the ratio and a loss below physics', () => {
    const { data, splitter } = exampleA();
    expect(connectSplitterOutput(data, splitter.id, 9, { cableId: 'DST-1', core: 9 }, ctx).ok).toBe(false);
    expect(saveSplitterDetails(data, splitter.id, { insertionLossDb: 8.5 }, ctx).ok).toBe(false);
    expect(saveSplitterDetails(data, splitter.id, { insertionLossDb: 9.2, lossSource: 'Datasheet' }, ctx).ok).toBe(true);
  });

  it('adds cascaded split losses stage by stage (1:4 then 1:8)', () => {
    let data: NetworkData = {
      ...emptyNetwork(),
      equipment: [
        equipment({ id: 'OLT-1', type: 'OLT', technology: 'GPON', ponPorts: [{ id: 'PON-01', portNumber: 1, status: 'Active', connectedCustomersCount: 0, connectedFeederCableId: 'F', feederCore: 1, opticsClass: 'GPON B+' }] }),
        equipment({ id: 'FDT-1', type: 'FDT' }),
        equipment({ id: 'FAT-1', type: 'FAT' }),
      ],
      cables: [fiberCable('F', 12, 'OLT-1', 'FDT-1', 2000), fiberCable('L', 12, 'FDT-1', 'FAT-1', 500)],
    };
    const s1 = ok(createSplitter(data, { terminalBoxId: 'FDT-1', ratio: '1:4', input: { cableId: 'F', core: 1 } }, ctx));
    data = applyPatch(data, s1.patch);
    data = applyPatch(data, ok(connectSplitterOutput(data, s1.value.id, 2, { cableId: 'L', core: 1 }, ctx)).patch);
    const s2 = ok(createSplitter(data, { terminalBoxId: 'FAT-1', ratio: '1:8', input: { cableId: 'L', core: 1 } }, ctx));
    data = applyPatch(data, s2.patch);
    const p = ok(provisionCustomer(data, { terminalBoxId: 'FAT-1', splitterId: s2.value.id, splitterOutputPort: 1, name: 'Ravi', lat: 17.4105, lng: 78.4105 }, ctx));
    data = applyPatch(data, p.patch);
    const path = traceCustomerCores(p.value.customer, data);
    expect(path.complete).toBe(true);
    expect(path.parts.splitters.map((s) => s.lossDb)).toEqual([10.4, 7.1]);
    expect(path.parts.splitProduct).toBe(32);
  });

  it('keeps a loss per output for an unequal coupler', () => {
    const data = { ...emptyNetwork(), equipment: [equipment({ id: 'FDT-1', type: 'FDT' })] };
    const coupler = ok(createSplitter(data, { terminalBoxId: 'FDT-1', ratio: '1:2', couplerRatio: '90/10' }, ctx)).value;
    expect(coupler.outputPorts.map((p) => [p.label, p.lossDb])).toEqual([
      ['90% leg', 0.6],
      ['10% leg', 11.3],
    ]);
  });

  it('names a splitter input that is not linked to a fiber', () => {
    const { data, splitter, customer } = exampleA();
    const unlinked = applyPatch(data, ok(linkSplitterInput(data, splitter.id, null, ctx)).patch);
    expect(traceCustomerCores(customer, unlinked).gaps[0]).toContain(`input of splitter ${splitter.name} is not linked to a cable fiber`);
  });
});

describe('budget against the worked example', () => {
  it('reproduces 12 km, 1:4 + 1:16, 8 splices, 4 pairs: 25.6 dB down and 26.8 dB up', () => {
    // OLT → ODF → C1 … splices … → 1:4 in a closure → C → 1:16 in the box → drop → ONT.
    const lengths = [3000, 2000, 2000, 1000, 1000, 1000, 1000, 500, 300];
    const ids = lengths.map((_, i) => `C${i + 1}`);
    const opt = (id: string, m: number) => fiberCable(id, 12, 'X', 'Y', m, { opticalLengthMeters: m });
    const cables = [...lengths.map((m, i) => opt(ids[i], m)), opt('C10', 100), opt('DROP', 100)];
    // 12 000 m in all: 11 800 above plus two 100 m stretches.
    const splices = [
      ['C1', 'C2'],
      ['C2', 'C3'],
      ['C3', 'C4'],
      ['C4', 'C5'],
      ['C5', 'C6'],
      ['C6', 'C7'],
      ['C7', 'C8'],
      ['C9', 'C10'],
    ].map(([a, b], i) => ({ id: `S${i}`, inputCableId: a, inputCableName: a, inputCore: 1, outputCableId: b, outputCableName: b, outputCore: 1, spliceLossDb: 0.1, lossSource: 'field_measured' as const, status: 'Spliced' as const, technician: '', date: '' }));
    const data: NetworkData = {
      ...emptyNetwork(),
      equipment: [
        equipment({ id: 'OLT', type: 'OLT', technology: 'GPON', ponPorts: [{ id: 'P1', portNumber: 1, status: 'Active', connectedCustomersCount: 1, opticsClass: 'GPON B+' }] }),
        equipment({
          id: 'ODF',
          type: 'ODF',
          odfPanels: [{ id: 'PA', label: 'A', ports: [{ id: 'X1', number: 1, status: 'in_use', feederCableId: 'C1', feederCore: 1, patch: { oltId: 'OLT', ponPortId: 'P1', patchedAt: '' } }] }],
        }),
        equipment({ id: 'JC', type: 'Splice Closure' }),
        equipment({ id: 'FAT', type: 'FAT' }),
      ],
      cables,
      closures: [{ id: 'JC-R', name: 'Joints', closureType: 'Dome Splice Closure', lat: 0, lng: 0, area: '', entryPortsCount: 0, exitPortsCount: 0, installationDate: '', technician: '', splices, images: [] }],
      splitters: [
        { id: 'S4', name: 'S4', terminalBoxId: 'JC', ratio: '1:4', insertionLossDb: 7.1, status: 'Active', inputPort: { id: 'i', connectedCableId: 'C8', connectedCore: 1 }, outputPorts: [{ portNumber: 1, label: '1', status: 'Occupied', connectedDropCableId: 'C9', connectedCore: 1 }] },
        { id: 'S16', name: 'S16', terminalBoxId: 'FAT', ratio: '1:16', insertionLossDb: 13.5, status: 'Active', inputPort: { id: 'i', connectedCableId: 'C10', connectedCore: 1 }, outputPorts: [{ portNumber: 1, label: '1', status: 'Occupied', connectedDropCableId: 'DROP', connectedCore: 1 }] },
      ],
      customers: [
        {
          id: 'CU', name: 'CU', mobile: '', address: '', area: '', lat: 0, lng: 0, serviceType: 'Fiber Broadband', plan: '', status: 'Active', installationDate: '',
          oltId: 'OLT', ponPort: 'P1', feederCableId: '', distributionCableId: '', terminalBoxId: 'FAT', splitterId: 'S16', splitterOutputPort: 1, dropCableId: 'DROP', fiberCore: 1,
          ontSerialNumber: '', routerModel: '', ipAddress: '',
        },
      ],
    };
    const path = traceCustomerCores(data.customers[0], data);
    expect(path.gaps).toEqual([]);
    expect(path.parts).toMatchObject({ distanceMeters: 12000, connectorPairs: 4, spliceLossDb: 0.8 });
    expect(path.directions[0].budget.totalLossDb).toBe(25.6);
    expect(path.directions[1].budget.totalLossDb).toBe(26.8);
    expect(path.verdict).toBe('fits_under_margin');
    expect(findFiberProblems(data).filter((p) => p.severity === 'error')).toEqual([]);
    expect(traceCoreUpstream('C10', 1, data).complete).toBe(true);
  });
});

describe('placing a splitter', () => {
  it('creates its port records when the ratio is given, and none when it is not', async () => {
    const { createEquipment } = await import('../src/domain/equipment');
    const placed = createEquipment(emptyNetwork(), { name: 'S', type: 'Fiber Splitter', lat: 17.4, lng: 78.4, splitterConfig: { ratio: '1:8', splitterCount: 1 } });
    if (!placed.ok) throw new Error('not placed');
    expect(placed.patch.splitters?.[0]).toMatchObject({ terminalBoxId: placed.value.id, ratio: '1:8' });
    expect(placed.patch.splitters?.[0].outputPorts).toHaveLength(8);
    const bare = createEquipment(emptyNetwork(), { name: 'S', type: 'Fiber Splitter', lat: 17.4, lng: 78.4 });
    expect(bare.ok && bare.patch.splitters).toBeFalsy();
  });
});
