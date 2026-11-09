import { describe, expect, it } from 'vitest';

import {
  budgetStatusFor,
  collectDownstream,
  estimateRxForSplitter,
  findServingOlt,
  resolveTraceTarget,
  traceCable,
  traceCustomer,
  type TraceData,
  traceEquipment,
  walkUpstreamCables,
} from '../src/domain/trace';
import { cable, closure, equipment, fault, smallNetwork } from './fixtures';

const data: TraceData = {
  equipment: [
    equipment({ id: 'OLT-01', type: 'OLT', category: 'Central Office' }),
    equipment({ id: 'FDT-01', type: 'FDT' }),
    equipment({ id: 'FAT-01', type: 'FAT' }),
    equipment({ id: 'OLT-02', type: 'OLT', category: 'Central Office' }),
  ],
  cables: [
    cable({
      id: 'FEED-1',
      type: 'Main Feeder Fiber',
      startEquipmentId: 'OLT-01',
      endEquipmentId: 'FDT-01',
      lengthMeters: 2000,
    }),
    cable({ id: 'DIST-1', startEquipmentId: 'FDT-01', endEquipmentId: 'FAT-01', lengthMeters: 500 }),
    cable({ id: 'BACKHAUL', startEquipmentId: 'OLT-02', endEquipmentId: 'OLT-01' }),
  ],
  splitters: [],
  closures: [],
  customers: [],
  faults: [],
};

describe('budgetStatusFor', () => {
  it('maps Rx power to a budget status', () => {
    expect(budgetStatusFor(undefined)).toBe('Unknown');
    expect(budgetStatusFor(Number.NaN)).toBe('Unknown');
    expect(budgetStatusFor(-20)).toBe('Pass');
    expect(budgetStatusFor(-26)).toBe('Warning');
    expect(budgetStatusFor(-29)).toBe('Fail');
  });
});

describe('findServingOlt', () => {
  it('walks trunk cables back to the OLT', () => {
    const { olt, hops } = findServingOlt('FAT-01', data);
    expect(olt?.id).toBe('OLT-01');
    expect(hops.map((h) => h.cable.id)).toEqual(['FEED-1', 'DIST-1']);
  });

  it('never follows inter-OLT backhaul', () => {
    expect(findServingOlt('OLT-01', data).hops).toEqual([]);
  });

  it('picks no cable when two end at a box and none is on record for the path', () => {
    const two = { ...data, cables: [...data.cables, cable({ id: 'DIST-2', startEquipmentId: 'FDT-01', endEquipmentId: 'FAT-01' })] };
    const walk = walkUpstreamCables('FAT-01', two);
    expect(walk.hops).toEqual([]);
    expect(walk.ambiguousAt).toEqual({ equipmentId: 'FAT-01', cableIds: ['DIST-1', 'DIST-2'] });
    expect(findServingOlt('FAT-01', two).olt).toBeUndefined();
    // A recorded cable (for example the splitter input) still decides it.
    expect(findServingOlt('FAT-01', two, ['DIST-2']).hops.map((h) => h.cable.id)).toEqual(['FEED-1', 'DIST-2']);

    const trace = traceEquipment(two.equipment.find((e) => e.id === 'FAT-01')!, two);
    expect(trace.summary.pathComplete).toBe(false);
    expect(trace.summary.warnings.join(' ')).toContain('fed by 2 cables');
    expect(trace.cableIds).not.toContain('DIST-1');
  });
});

describe('estimateRxForSplitter', () => {
  it('gives no Rx and no stored path when the fibers are not recorded, and names the gap', () => {
    const base = smallNetwork();
    const withTx = { ...base, equipment: base.equipment.map((e) => (e.id === 'OLT-01' ? { ...e, ponPorts: e.ponPorts?.map((p) => ({ ...p, txPowerDbm: 3 })) } : e)) };
    const fat = withTx.equipment.find((e) => e.id === 'FAT-01')!;
    const estimate = estimateRxForSplitter(fat, withTx.splitters[0], withTx, 50);
    expect(estimate.level).toBe('cable');
    expect(estimate.pathComplete).toBe(false);
    expect(estimate.rxDbm).toBeUndefined();
    expect(estimate.rxRangeDbm).toBeUndefined();
    expect(estimate.gaps[0]).toContain('DIST-01');
  });

  it('gives no estimated Rx on an incomplete customer trace, even with a recorded launch', () => {
    const base = smallNetwork();
    const withTx = { ...base, equipment: base.equipment.map((e) => (e.id === 'OLT-01' ? { ...e, ponPorts: e.ponPorts?.map((p) => ({ ...p, txPowerDbm: 3 })) } : e)) };
    const result = traceCustomer(withTx.customers[0], withTx);
    expect(result.summary.pathComplete).toBe(false);
    expect(result.summary.txPowerDbm).toBe(3);
    expect(result.summary.estimatedRxDbm).toBeUndefined();
  });

  it('shows no colour for a core whose colour is not recorded', () => {
    const base = smallNetwork();
    const plain = {
      ...base,
      cables: base.cables.map((c) => (c.id === 'DIST-01' ? { ...c, cores: c.cores.map((k) => ({ ...k, colorName: undefined })) } : c)),
    };
    const result = traceCustomer(plain.customers[0], plain);
    const dist = result.nodes.find((n) => n.id === 'DIST-01')!;
    expect(dist.details).toContain('Core 1');
    expect(dist.details).not.toContain('undefined');
  });
});

describe('collectDownstream', () => {
  it('includes every downstream cable and equipment', () => {
    const result = collectDownstream('FDT-01', data);
    expect(result.cableIds).toContain('DIST-1');
    expect(result.equipmentIds).toContain('FAT-01');
    expect(result.cableIds).not.toContain('FEED-1');
  });
});

describe('traceEquipment', () => {
  it('builds an OLT-first path with length and loss', () => {
    const fat = data.equipment.find((e) => e.id === 'FAT-01')!;
    const result = traceEquipment(fat, data);
    expect(result.nodes[0].id).toBe('OLT-01');
    expect(result.cableIds).toEqual(expect.arrayContaining(['FEED-1', 'DIST-1']));
    expect(result.summary.totalLengthMeters).toBe(2500);
    expect(result.summary.totalLossDb).toBeGreaterThan(0);
  });
});

describe('traceCable', () => {
  it('traces a cable back to its OLT', () => {
    const result = traceCable(data.cables[1], data);
    expect(result.summary.kind).toBe('cable');
    expect(result.nodes.some((n) => n.id === 'OLT-01')).toBe(true);
  });
});

describe('resolveTraceTarget', () => {
  const network = () => {
    const base = smallNetwork();
    return {
      ...base,
      closures: [closure({ id: 'JC-1', cableAId: 'DIST-01' })],
      faults: [fault({ id: 'FLT-1', affectedEquipmentId: 'FDT-01' })],
    };
  };

  it.each([
    ['CUST-001', 'customer', 'CUST-001'],
    ['ONT-CUST-001', 'customer', 'CUST-001'],
    ['FAT-01', 'equipment', 'FAT-01'],
    ['DIST-01', 'cable', 'DIST-01'],
    ['OLT-01/PON-01', 'cable', 'FEED-01'],
    ['PON-01', 'cable', 'FEED-01'],
    ['FLT-1', 'equipment', 'FDT-01'],
    ['JC-1', 'cable', 'DIST-01'],
    ['SPL-01', 'equipment', 'FAT-01'],
  ])('resolves %s to the %s path of %s', (id, kind, targetId) => {
    expect(resolveTraceTarget(id, network())?.summary).toMatchObject({ kind, targetId });
  });

  it('returns null for blank or unknown identifiers', () => {
    expect(resolveTraceTarget('  ', network())).toBeNull();
    expect(resolveTraceTarget('NOPE', network())).toBeNull();
  });
});
