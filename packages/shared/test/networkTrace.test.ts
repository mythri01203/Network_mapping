import { describe, expect, it } from 'vitest';

import { applyPatch, type CommandResult, type NetworkData } from '../src/domain/command';
import { addOdfPanel, createClosure, linkSplitterInput, patchOdfPort, recordSplice, setCableLayout, setOdfPortFeeder, updatePonPort } from '../src/domain/fiberCommands';
import { traceCoreUpstream, traceCustomerCores } from '../src/domain/fiberPath';
import { buildTraceGraph, runNetworkTrace, traceNetwork, tracePointFromId, type TraceStep, traceSteps } from '../src/domain/networkTrace';
import { buildOltPonPorts } from '../src/domain/oltConfig';
import { createSplitter, provisionCustomer } from '../src/domain/provisioning';
import { traceCustomer } from '../src/domain/trace';
import type { LinkVerification } from '../src/model/linkVerificationSchemas';
import type { Cable } from '../src/model/types';
import { createSampleNetwork } from '../src/sample';
import { cable, emptyNetwork, equipment, fault, NOW } from './fixtures';

const ctx = { now: NOW, actor: 'Test Engineer' };

function ok<T>(result: CommandResult<T>): { value: T; patch: NetworkData } {
  if (!result.ok) throw new Error(`${result.error.title}: ${result.error.message}`);
  return { value: result.value, patch: result.patch as NetworkData };
}

const fiberCable = (id: string, fiberCount: number, from: string, to: string, lengthMeters: number, extra: Partial<Cable> = {}) =>
  cable({ id, name: id, fiberCount, lengthMeters, startEquipmentId: from, endEquipmentId: to, coordinates: [[17.4, 78.4], [17.41, 78.41]], cores: [], ...extra });

/** OLT → patch → ODF → feeder → closure → distribution → splitter → two drops, built with the commands people use. */
function network() {
  let data: NetworkData = {
    ...emptyNetwork(),
    equipment: [
      equipment({ id: 'OLT-1', type: 'OLT', category: 'Central Office', technology: 'GPON', totalPorts: 4 }),
      equipment({ id: 'ODF-1', type: 'ODF', category: 'Central Office' }),
      equipment({ id: 'JC-1', type: 'Fiber Joint Closure' }),
      equipment({ id: 'FAT-1', type: 'FAT', totalPorts: 8 }),
      equipment({ id: 'FAT-9', type: 'FAT', totalPorts: 8 }),
    ],
    cables: [fiberCable('FDR-1', 24, 'ODF-1', 'JC-1', 3000, { type: 'Main Feeder Fiber' }), fiberCable('DST-1', 12, 'JC-1', 'FAT-1', 1500), fiberCable('LOOSE', 12, 'JC-1', 'FAT-9', 400)],
  };
  const step = <T>(result: CommandResult<T>) => {
    const r = ok(result);
    data = applyPatch(data, r.patch);
    return r.value;
  };
  data = { ...data, equipment: data.equipment.map((e) => (e.id === 'OLT-1' ? { ...e, ponPorts: buildOltPonPorts(e) } : e)) };
  step(updatePonPort(data, 'OLT-1', 'PON-01', { opticsClass: 'GPON B+', vendorAddress: 'gpon 0/1/0', txPowerDbm: 3 }, ctx));
  step(setCableLayout(data, 'FDR-1', { colorScheme: 'tia-598', tubeColorScheme: 'tia-598', fibersPerTube: 12 }, ctx));
  const panel = step(addOdfPanel(data, 'ODF-1', { label: 'Panel A', portCount: 24, connectorType: 'SC/APC' }, ctx));
  step(setOdfPortFeeder(data, 'ODF-1', panel.id, 3, { cableId: 'FDR-1', core: 3 }, ctx));
  step(patchOdfPort(data, 'ODF-1', panel.id, 3, { oltId: 'OLT-1', ponPortId: 'PON-01', cordLabel: 'PC-7' }, ctx));
  const closure = step(createClosure(data, { equipmentId: 'JC-1', closureType: 'Dome Splice Closure', trayCount: 2 }, ctx));
  const splice = step(recordSplice(data, closure.id, { trayId: closure.trays![0].id, inputCableId: 'FDR-1', inputCore: 3, outputCableId: 'DST-1', outputCore: 3, spliceLossDb: 0.05, lossSource: 'field_measured' }, ctx));
  const splitter = step(createSplitter(data, { terminalBoxId: 'FAT-1', ratio: '1:8', input: { cableId: 'DST-1', core: 3 } }, ctx));
  const asha = step(provisionCustomer(data, { terminalBoxId: 'FAT-1', splitterId: splitter.id, splitterOutputPort: 2, name: 'Asha', lat: 17.411, lng: 78.411 }, ctx)).customer;
  const ravi = step(provisionCustomer(data, { terminalBoxId: 'FAT-1', splitterId: splitter.id, splitterOutputPort: 3, name: 'Ravi', lat: 17.412, lng: 78.412 }, ctx)).customer;
  return { data, panel, closure, splice, splitter, asha, ravi };
}

const coreSeq = (steps: readonly TraceStep[]) => steps.filter((s) => s.kind === 'core').map((s) => `${s.cableId}#${s.core}`);

/** The two engines agree: same fibres in the same order, same port, and complete in the same cases. */
function expectSameAsFiberPath(data: NetworkData) {
  const g = buildTraceGraph(data);
  let compared = 0;
  let completeCustomers = 0;
  for (const c of data.customers) {
    if (c.status === 'Disconnected') continue;
    const old = traceCustomerCores(c, data);
    const now = runNetworkTrace(g, { type: 'customer_to_olt', from: { type: 'customer', id: c.id } });
    const path = now.paths[0];
    const oldSeq = old.steps.filter((s) => s.kind === 'cable').map((s) => `${s.cableId}#${s.core}`);
    if (old.complete) {
      expect(coreSeq(path.steps), c.id).toEqual(oldSeq);
      expect(path.complete, c.id).toBe(true);
      expect(path.reaches, c.id).toEqual({ oltId: old.olt!.id, ponPortId: old.pon!.id });
      // The cable-level trace (trace.ts) gives the same cables when the fibres are recorded end to end.
      expect([...now.cableIds].sort(), c.id).toEqual([...traceCustomer(c, data).cableIds].sort());
      completeCustomers += 1;
    } else {
      // The new engine follows a faulty step on (the record says it is joined), and never fills a gap.
      const stoppedHere = !path.complete || path.steps.some((s) => s.state === 'faulty' || s.state === 'planned');
      expect(stoppedHere, c.id).toBe(true);
      expect(coreSeq(path.steps).slice(0, oldSeq.length), c.id).toEqual(oldSeq.slice(0, coreSeq(path.steps).length));
    }
    compared += 1;
  }
  for (const cab of data.cables) {
    for (let n = 1; n <= cab.fiberCount; n += 1) {
      const old = traceCoreUpstream(cab.id, n, data);
      if (old.steps.length <= 2 && !old.complete) continue;
      const now = runNetworkTrace(g, { type: 'upstream', from: { type: 'core', cableId: cab.id, core: n } }).paths[0];
      if (old.complete) {
        expect(coreSeq(now.steps)).toEqual(old.steps.filter((s) => s.kind === 'cable').map((s) => `${s.cableId}#${s.core}`));
        expect(now.complete).toBe(true);
      }
      compared += 1;
    }
  }
  return { compared, completeCustomers };
}

describe('one trace engine on the connection index', () => {
  it('agrees with the fibre-by-fibre trace and the cable-level trace on the sample network', () => {
    const sample = createSampleNetwork() as unknown as NetworkData;
    const { compared } = expectSameAsFiberPath(sample);
    expect(compared).toBeGreaterThanOrEqual(sample.customers.filter((c) => c.status !== 'Disconnected').length);
    // The sample records no fibre end to end, so its physical route is the cable-level one, labelled so,
    // with exactly the cables the cable-level trace follows.
    const g = buildTraceGraph(sample);
    for (const c of sample.customers) {
      const route = runNetworkTrace(g, { type: 'physical_route', from: { type: 'customer', id: c.id } });
      const legacy = traceCustomer(c, sample);
      if (route.level === 'cable') expect([...route.cableIds].sort(), c.id).toEqual([...legacy.cableIds].sort());
      expect(route.complete, c.id).toBe(legacy.summary.level === 'core' && legacy.summary.pathComplete);
    }
  });

  it('agrees with them on a network built with the commands people use', () => {
    const { data } = network();
    const { compared, completeCustomers } = expectSameAsFiberPath(data);
    expect(completeCustomers).toBe(2);
    expect(compared).toBeGreaterThan(2);
  });

  it('traces a customer to the OLT in order, with each step kind and its own state', () => {
    const { data, asha } = network();
    const result = traceNetwork(data, { type: 'customer_to_olt', from: { type: 'customer', id: asha.id } });
    const kinds = result.paths[0].steps.map((s) => s.kind);
    expect(kinds[0]).toBe('equipment');
    expect(kinds).toEqual(expect.arrayContaining(['port', 'odf', 'cable', 'tube', 'core', 'splice', 'splitter', 'customer']));
    expect(kinds.indexOf('port')).toBeLessThan(kinds.indexOf('odf'));
    expect(kinds.indexOf('splice')).toBeLessThan(kinds.indexOf('splitter'));
    expect(kinds.at(-1)).toBe('customer');
    expect(result.complete).toBe(true);
    // Nobody has checked any link yet: shown as not checked, never as good.
    expect(result.counts.unverified).toBeGreaterThan(0);
    expect(result.paths[0].steps.find((s) => s.kind === 'splice')!.state).toBe('unverified');
    expect(result.cableIds).toEqual(expect.arrayContaining(['FDR-1', 'DST-1']));
  });

  it('never says "Checked good" for a step no recorded check covers (customer, box, OLT, notes)', () => {
    const { data, asha } = network();
    for (const type of ['customer_to_olt', 'physical_route', 'logical_service', 'upstream'] as const) {
      const result = traceNetwork(data, { type, from: { type: 'customer', id: asha.id } });
      const all = traceSteps(result);
      expect(all.length, type).toBeGreaterThan(0);
      expect(all.filter(({ step }) => step.state === 'ok').map(({ step }) => step.title), type).toEqual([]);
      expect(result.counts.ok, type).toBe(0);
    }
  });

  it('shows a checked link as good, a failed check as faulty, and a check made before a change as not checked', () => {
    const { data, closure, splice, asha } = network();
    const g0 = buildTraceGraph(data);
    const link = g0.index.byId.get(`splice:${closure.id}:${splice.id}`)!;
    const check = (result: LinkVerification['result'], endsKey = link.endsKey): LinkVerification => ({
      id: `LCK-${result}`,
      connectionId: link.id,
      connectionLabel: 'x',
      endsKey,
      method: 'otdr',
      result,
      checkedOn: '2026-11-01',
      technician: 'Ravi',
      otdrRef: 'T-1',
      createdAt: '2026-11-01T10:00:00.000Z',
    });
    const spliceState = (checks: LinkVerification[]) =>
      traceNetwork({ ...data, linkVerifications: checks }, { type: 'customer_to_olt', from: { type: 'customer', id: asha.id } }).paths[0].steps.find((s) => s.kind === 'splice')!;
    expect(spliceState([check('pass')]).state).toBe('ok');
    expect(spliceState([check('fail')]).state).toBe('faulty');
    expect(spliceState([check('pass', 'core:OTHER#1>core:OTHER#2')]).state).toBe('unverified');
  });

  it('names a gap and never fills it in', () => {
    const { data, closure, asha } = network();
    const broken = { ...data, closures: data.closures.map((c) => (c.id === closure.id ? { ...c, splices: [] } : c)) };
    const result = traceNetwork(broken, { type: 'customer_to_olt', from: { type: 'customer', id: asha.id } });
    expect(result.complete).toBe(false);
    const steps = result.paths[0].steps;
    expect(steps[0].kind).toBe('gap');
    expect(steps[0].state).toBe('missing');
    expect(steps.some((s) => s.kind === 'equipment' && s.ids.includes('OLT-1'))).toBe(false);
    expect(result.gaps[0]).toMatch(/no recorded link on its OLT side/);
  });

  it('refuses to pick one of two feeds on one fibre', () => {
    const { data, closure, asha } = network();
    const twice = {
      ...data,
      closures: data.closures.map((c) => (c.id === closure.id ? { ...c, splices: [...c.splices, { ...c.splices[0], id: 'SPC-TWIN', inputCore: 4 }] } : c)),
    };
    const result = traceNetwork(twice, { type: 'customer_to_olt', from: { type: 'customer', id: asha.id } });
    expect(result.complete).toBe(false);
    expect(result.gaps.join(' ')).toMatch(/2 feeds on record/);
  });

  it('marks a step faulty from its record or an open fault, but not from a TEST fault', () => {
    const { data, asha } = network();
    const damaged = { ...data, cables: data.cables.map((c) => (c.id === 'DST-1' ? { ...c, status: 'Damaged' as const } : c)) };
    const r1 = traceNetwork(damaged, { type: 'customer_to_olt', from: { type: 'customer', id: asha.id } });
    expect(r1.paths[0].steps.find((s) => s.kind === 'cable' && s.cableId === 'DST-1')!.state).toBe('faulty');
    const withFault = { ...data, faults: [fault({ id: 'F-1', affectedCableId: 'FDR-1', status: 'Reported' })] };
    const r2 = traceNetwork(withFault, { type: 'customer_to_olt', from: { type: 'customer', id: asha.id } });
    expect(r2.paths[0].steps.find((s) => s.kind === 'cable' && s.cableId === 'FDR-1')!.state).toBe('faulty');
    const testFault = { ...data, faults: [fault({ id: 'F-2', affectedCableId: 'FDR-1', status: 'Reported', isTest: true })] };
    const r3 = traceNetwork(testFault, { type: 'customer_to_olt', from: { type: 'customer', id: asha.id } });
    expect(r3.paths[0].steps.find((s) => s.kind === 'cable' && s.cableId === 'FDR-1')!.state).not.toBe('faulty');
  });

  it('traces downstream from an OLT, a splitter and an ODF port to the customers', () => {
    const { data, splitter, panel, asha, ravi } = network();
    const olt = traceNetwork(data, { type: 'olt_to_ont', from: { type: 'equipment', id: 'OLT-1' } });
    expect(olt.customerIds.sort()).toEqual([asha.id, ravi.id].sort());
    const sp = traceNetwork(data, { type: 'splitter_to_customers', from: { type: 'splitter', id: splitter.id } });
    expect(sp.customerIds.sort()).toEqual([asha.id, ravi.id].sort());
    const port = data.equipment.find((e) => e.id === 'ODF-1')!.odfPanels![0].ports.find((p) => p.number === 3)!;
    const odf = traceNetwork(data, { type: 'downstream', from: { type: 'odf_port', equipmentId: 'ODF-1', panelId: panel.id, portId: port.id } });
    expect(odf.customerIds).toHaveLength(2);
    const up = traceNetwork(data, { type: 'upstream', from: { type: 'odf_port', equipmentId: 'ODF-1', panelId: panel.id, portId: port.id } });
    expect(up.paths[0].reaches).toEqual({ oltId: 'OLT-1', ponPortId: 'PON-01' });
  });

  it('traces from a closure and from one splice, both ways', () => {
    const { data, closure, splice, asha } = network();
    const fromClosure = traceNetwork(data, { type: 'upstream', from: { type: 'closure', id: closure.id } });
    expect(fromClosure.paths[0].reaches?.oltId).toBe('OLT-1');
    const down = traceNetwork(data, { type: 'downstream', from: { type: 'splice', closureId: closure.id, spliceId: splice.id } });
    expect(down.customerIds).toContain(asha.id);
  });

  it('traces between two points: one feeds the other, both share a feed, or nothing joins them', () => {
    const { data, asha, ravi } = network();
    const feeds = traceNetwork(data, { type: 'port_to_port', from: { type: 'pon_port', oltId: 'OLT-1', ponPortId: 'PON-01' }, to: { type: 'customer', id: asha.id } });
    expect(feeds.complete).toBe(true);
    expect(feeds.paths[0].steps[0].ids).toContain('OLT-1/PON-01');
    expect(feeds.paths[0].steps.at(-1)!.ids).toContain(asha.id);
    const shared = traceNetwork(data, { type: 'asset_to_asset', from: { type: 'customer', id: asha.id }, to: { type: 'customer', id: ravi.id } });
    expect(shared.paths).toHaveLength(2);
    expect(shared.paths[0].steps[0].kind).toBe('splitter');
    const apart = traceNetwork(data, { type: 'cable_to_cable', from: { type: 'cable', id: 'FDR-1' }, to: { type: 'cable', id: 'LOOSE' } });
    expect(apart.complete).toBe(false);
    expect(apart.gaps[0]).toMatch(/No recorded link joins/);
    expect(apart.paths).toHaveLength(0);
  });

  it('gives the physical route from the fibres, and the cable-level route only as "cables only"', () => {
    const { data, asha } = network();
    const route = traceNetwork(data, { type: 'physical_route', from: { type: 'customer', id: asha.id } });
    expect(route.level).toBe('fibre');
    expect(route.paths[0].steps.filter((s) => s.kind === 'route').map((s) => s.cableId)).toEqual(['FDR-1', 'DST-1', asha.dropCableId]);
    const cablesOnly = traceNetwork(data, { type: 'physical_route', from: { type: 'equipment', id: 'FAT-9' } });
    expect(cablesOnly.level).toBe('cable');
    expect(cablesOnly.notes.join(' ')).toMatch(/Cables only/);
    expect(cablesOnly.complete).toBe(false);
  });

  it('shows the service path and who a fault affects', () => {
    const { data, asha } = network();
    const service = traceNetwork(data, { type: 'logical_service', from: { type: 'customer', id: asha.id } });
    expect(service.paths.length).toBeGreaterThanOrEqual(1);
    const impact = traceNetwork({ ...data, faults: [fault({ id: 'F-9', affectedCableId: 'DST-1', status: 'Reported' })] }, { type: 'fault_impact', from: { type: 'fault', id: 'F-9' } });
    expect(impact.customerIds).toHaveLength(2);
    expect(impact.customerIds).toContain(asha.id);
    expect(impact.cableIds).toContain('DST-1');
  });

  it('finds a point from an id as typed', () => {
    const { data, asha, panel } = network();
    const g = buildTraceGraph(data);
    expect(tracePointFromId(g, asha.id)).toEqual({ type: 'customer', id: asha.id });
    expect(tracePointFromId(g, 'OLT-1/PON-01')).toEqual({ type: 'pon_port', oltId: 'OLT-1', ponPortId: 'PON-01' });
    expect(tracePointFromId(g, 'FDR-1#3')).toEqual({ type: 'core', cableId: 'FDR-1', core: 3 });
    expect(tracePointFromId(g, 'nothing')).toBeUndefined();
    expect(panel.id).toBeTruthy();
  });

  it('lists every step once for the report', () => {
    const { data } = network();
    const r = traceNetwork(data, { type: 'olt_to_ont', from: { type: 'pon_port', oltId: 'OLT-1', ponPortId: 'PON-01' } });
    const all = traceSteps(r);
    expect(all.length).toBeGreaterThan(5);
    expect(all.some((x) => x.depth > 2)).toBe(true);
  });

  it('keeps the older splitter input link command working with the new engine', () => {
    const { data, splitter } = network();
    const relinked = ok(linkSplitterInput(data, splitter.id, { cableId: 'LOOSE', core: 1 }, ctx));
    const next = applyPatch(data, relinked.patch);
    const r = traceNetwork(next, { type: 'upstream', from: { type: 'splitter', id: splitter.id } });
    expect(r.complete).toBe(false);
  });
});
