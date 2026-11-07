import { describe, expect, it } from 'vitest';

import { calculateOpticalLossBudget, resolveSplitterLoss } from '../src/domain/lossEngine';
import { traceOpticalPath } from '../src/domain/opticalPathTrace';
import { resolveOpticalSettings } from '../src/domain/opticalSettings';
import type { TraceData } from '../src/domain/trace';
import { traceCustomer, traceEquipment } from '../src/domain/trace';
import { createSampleNetwork, SAMPLE_CUSTOMERS } from '../src/sample';
import { cable, customer, equipment, smallNetwork } from './fixtures';

describe('Loss Engine', () => {
  it('resolves splitter losses from the one settings table', () => {
    expect(resolveSplitterLoss('1:2')).toBe(3.8);
    expect(resolveSplitterLoss('1:4')).toBe(7.1);
    expect(resolveSplitterLoss('1:8')).toBe(10.4);
    expect(resolveSplitterLoss('1:16')).toBe(13.5);
    expect(resolveSplitterLoss('1:32')).toBe(17.0);
    expect(resolveSplitterLoss('90/10')).toBe(11.3);
    expect(resolveSplitterLoss({ ratio: '90/10', isTap: false })).toBe(0.6);
  });

  it('gives no loss for a ratio nothing on record knows', () => {
    expect(resolveSplitterLoss('1:7')).toBeUndefined();
    const result = calculateOpticalLossBudget({ totalDistanceMeters: 0, splitters: ['1:7'] });
    expect(result.unknownSplitters).toEqual(['1:7']);
    expect(result.splitterLossDb).toBe(0);
  });

  it('counts only the parts it is told about', () => {
    const result = calculateOpticalLossBudget({ totalDistanceMeters: 2000, wavelengthNm: 1490, splitters: ['1:8'] });
    expect(result.fiberLossDb).toBe(0.5);
    expect(result.spliceLossDb).toBe(0);
    expect(result.connectorLossDb).toBe(0);
    expect(result.totalLossDb).toBe(10.9);
  });

  it('never assumes a launch power', () => {
    const result = calculateOpticalLossBudget({ totalDistanceMeters: 2000, splitters: ['1:8'] });
    expect(result.oltTxPowerDbm).toBeUndefined();
    expect(result.expectedRxDbm).toBeUndefined();
    expect(result.expectedRxRangeDbm).toEqual({ min: -9.4, max: -5.9 });
  });

  it('flags a real reading much weaker than the recorded launch implies', () => {
    const result = calculateOpticalLossBudget({
      totalDistanceMeters: 1000,
      wavelengthNm: 1490,
      splitters: ['1:8'],
      oltTxPowerDbm: 3.0,
      measuredRxDbm: -28.5,
    });
    expect(result.verdict).toBe('High Attenuation / Macro-bend Alert');
    expect(result.discrepancyDb).toBeLessThan(-3);
  });
});

/** A network where every link is recorded, including a real launch power. */
const linked = (): TraceData => {
  const base = smallNetwork();
  return {
    ...base,
    equipment: base.equipment.map((e) =>
      e.id === 'OLT-01' ? { ...e, ponPorts: e.ponPorts?.map((p) => ({ ...p, txPowerDbm: 3 })) } : e,
    ),
    cables: [
      ...base.cables,
      cable({
        id: 'DROP-1',
        type: 'Drop Fiber',
        lengthMeters: 40,
        startEquipmentId: 'FAT-01',
        cores: [
          {
            coreNumber: 1,
            tubeNumber: 1,
            colorName: 'Blue',
            colorHex: '#00f',
            status: 'In Use',
          },
        ],
      }),
    ],
    customers: base.customers.map((c) => ({ ...c, dropCableId: 'DROP-1', rxSource: 'calculated' as const })),
  };
};

describe('traceOpticalPath', () => {
  it('reports a complete path with no gaps when everything is linked', () => {
    const trace = traceOpticalPath('CUST-001', linked())!;
    expect(trace.warnings).toEqual([]);
    expect(trace.complete).toBe(true);
    expect(trace.hops[0]).toMatchObject({ type: 'OLT', portId: 'PON-01' });
    expect(trace.hops.at(-1)?.type).toBe('ONT');
    expect(trace.hops.some((h) => h.gap)).toBe(false);
    expect(trace.budget.verdict).not.toBe('Incomplete');
    expect(trace.budget.oltTxPowerDbm).toBe(3);
    expect(trace.budget.expectedRxDbm).toBeDefined();
  });

  it('labels an estimated reading as estimated, never measured', () => {
    const trace = traceOpticalPath('CUST-001', linked())!;
    expect(trace.hops.at(-1)?.details).toContain('Estimated');
    expect(trace.hops.at(-1)?.details).not.toContain('Measured');
    expect(trace.budget.measuredRxDbm).toBeUndefined();
  });

  it('does not fall back to the first OLT or ODF in the list', () => {
    const data: TraceData = {
      ...smallNetwork(),
      equipment: [
        equipment({ id: 'OLT-X', type: 'OLT', ponPorts: [{ id: 'PON-01', portNumber: 1, status: 'Active', connectedCustomersCount: 0 }] }),
        equipment({ id: 'ODF-X', type: 'ODF' }),
        equipment({ id: 'FAT-X', type: 'FAT' }),
      ],
      cables: [],
      customers: [customer({ id: 'C-1', terminalBoxId: 'FAT-X', splitterId: '' })],
      splitters: [],
    };
    const trace = traceOpticalPath('C-1', data)!;
    expect(trace.hops.some((h) => h.id === 'OLT-X' || h.id === 'ODF-X')).toBe(false);
    expect(trace.equipmentIds).not.toContain('OLT-X');
    expect(JSON.stringify(trace.hops)).not.toContain('Tray 1');
    expect(trace.warnings.join(' ')).toContain('No cable is linked into FAT-X');
    expect(trace.complete).toBe(false);
  });

  it('names the exact missing cable start and shows no pass', () => {
    const base = linked();
    const data = { ...base, cables: base.cables.map((c) => (c.id === 'FEED-01' ? { ...c, startEquipmentId: undefined } : c)) };
    const trace = traceOpticalPath('CUST-001', data)!;
    expect(trace.warnings.join(' ')).toMatch(/FEED-01\) has no start equipment/);
    expect(trace.budget.verdict).toBe('Incomplete');
    expect(trace.budget.verdictTitle).toBe('Path is not complete');
    expect(trace.hops.some((h) => h.gap)).toBe(true);
  });

  it('names a missing PON port link and assumes no port', () => {
    const base = linked();
    const data = {
      ...base,
      customers: base.customers.map((c) => ({ ...c, ponPort: '' })),
      equipment: base.equipment.map((e) =>
        e.id === 'OLT-01' ? { ...e, ponPorts: e.ponPorts?.map((p) => ({ ...p, connectedFeederCableId: undefined })) } : e,
      ),
    };
    const trace = traceOpticalPath('CUST-001', data)!;
    expect(trace.hops[0].portId).toBeUndefined();
    expect(trace.warnings.join(' ')).toMatch(/No PON port on .*OLT-01.* is linked to .*FEED-01/);
  });

  it('does not invent a drop length when the drop is missing', () => {
    const base = linked();
    const data = { ...base, cables: base.cables.filter((c) => c.id !== 'DROP-1') };
    const trace = traceOpticalPath('CUST-001', data)!;
    expect(trace.warnings.join(' ')).toContain('Drop cable DROP-1 is not on the map');
    expect(trace.hops.some((h) => h.hopDistanceMeters === 85)).toBe(false);
    expect(trace.budget.verdict).toBe('Incomplete');
  });

  it('shows no core where none is recorded', () => {
    const trace = traceOpticalPath('CUST-001', linked())!;
    const feeder = trace.hops.find((h) => h.id === 'FEED-01')!;
    expect(feeder.coreNumber).toBeUndefined();
    expect(feeder.details).toContain('Core not recorded');
    expect(trace.notes.join(' ')).toContain('FEED-01');
  });

  it('calls out a splitter with no ratio instead of assuming 1:4', () => {
    const base = linked();
    const data = {
      ...base,
      equipment: base.equipment.map((e) => (e.id === 'FDT-01' ? { ...e, type: 'Fiber Splitter' as const } : e)),
    };
    const trace = traceOpticalPath('CUST-001', data)!;
    expect(trace.warnings.join(' ')).toContain('has no split ratio recorded');
    expect(JSON.stringify(trace.hops)).not.toContain('1:4');
  });

  it('warns when two cables feed one box and nothing says which', () => {
    const base = linked();
    const data = {
      ...base,
      customers: base.customers.map((c) => ({ ...c, feederCableId: '', distributionCableId: '' })),
      splitters: base.splitters.map((s) => ({ ...s, inputPort: { ...s.inputPort, connectedCableId: undefined } })),
      cables: [...base.cables, cable({ id: 'DIST-02', startEquipmentId: 'FDT-01', endEquipmentId: 'FAT-01' })],
    };
    const trace = traceOpticalPath('CUST-001', data)!;
    expect(trace.warnings.join(' ')).toContain('fed by 2 cables');
  });

  it('uses the operator overrides passed in', () => {
    const settings = resolveOpticalSettings([{ id: 'optical.connector.pair', value: 1 }]);
    const plain = traceOpticalPath('CUST-001', linked())!;
    const changed = traceOpticalPath('CUST-001', linked(), { settings })!;
    expect(changed.budget.connectorLossDb).toBeGreaterThan(plain.budget.connectorLossDb);
  });

  it('labels the sample network readings as sample data', () => {
    const trace = traceOpticalPath(SAMPLE_CUSTOMERS[0].id, createSampleNetwork())!;
    expect(trace.targetKind).toBe('customer');
    expect(trace.hops[0].type).toBe('OLT');
    expect(trace.hops.at(-1)?.details).toContain('Sample data');
    expect(trace.budget.totalDistanceMeters).toBeGreaterThan(0);
  });
});

describe('traceNetworkPath honesty', () => {
  it('does not add an ODF for being near the OLT', () => {
    const base = linked();
    const data = {
      ...base,
      equipment: [...base.equipment, equipment({ id: 'ODF-NEAR', type: 'ODF', lat: 17.4001, lng: 78.4001 })],
    };
    const result = traceCustomer(data.customers[0], data);
    expect(result.nodes.some((n) => n.id === 'ODF-NEAR')).toBe(false);
  });

  it('includes an ODF that a cable explicitly links', () => {
    const base = linked();
    const data = {
      ...base,
      equipment: [...base.equipment, equipment({ id: 'ODF-1', type: 'ODF' })],
      cables: base.cables.flatMap((c) =>
        c.id === 'FEED-01'
          ? [
              { ...c, endEquipmentId: 'ODF-1' },
              cable({ id: 'LINK-1', startEquipmentId: 'ODF-1', endEquipmentId: 'FDT-01' }),
            ]
          : [c],
      ),
    };
    const result = traceCustomer(data.customers[0], data);
    expect(result.nodes.some((n) => n.id === 'ODF-1')).toBe(true);
  });

  it('assumes no launch power and gives no pass on a broken path', () => {
    const base = smallNetwork();
    const broken = { ...base, cables: base.cables.filter((c) => c.id !== 'FEED-01') };
    const result = traceCustomer(broken.customers[0], broken);
    expect(result.summary.pathComplete).toBe(false);
    expect(result.summary.budgetStatus).toBe('Unknown');
    expect(result.summary.txPowerDbm).toBeUndefined();
    expect(result.summary.estimatedRxDbm).toBeUndefined();
    expect(result.summary.warnings.join(' ')).toContain('back to an OLT');
  });

  it('only reports a real reading as measured', () => {
    const base = linked();
    const estimated = traceCustomer(base.customers[0], base);
    expect(estimated.summary.measuredRxDbm).toBeUndefined();
    expect(estimated.summary.rxText).toContain('Estimated');
    expect(JSON.stringify(estimated.nodes)).not.toContain('Measured');

    const measured = { ...base.customers[0], rxSource: 'field_measured' as const, rxOpticalPowerDbm: -21 };
    expect(traceCustomer(measured, base).summary.measuredRxDbm).toBe(-21);
    expect(traceCustomer(measured, base).summary.rxText).toContain('Measured');
  });

  it('flags equipment with no upstream cable', () => {
    const result = traceEquipment(equipment({ id: 'FAT-9', type: 'FAT' }), smallNetwork());
    expect(result.summary.pathComplete).toBe(false);
  });
});
