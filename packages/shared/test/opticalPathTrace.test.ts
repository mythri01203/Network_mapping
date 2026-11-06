import { describe, expect, it } from 'vitest';
import { calculateOpticalLossBudget, resolveSplitterLoss } from '../src/domain/lossEngine';
import { traceOpticalPath } from '../src/domain/opticalPathTrace';
import { createSampleNetwork, SAMPLE_CUSTOMERS } from '../src/sample';

describe('Loss Engine', () => {
  it('resolves splitter insertion losses accurately', () => {
    expect(resolveSplitterLoss('1:2')).toBe(3.5);
    expect(resolveSplitterLoss('1:4')).toBe(7.2);
    expect(resolveSplitterLoss('1:8')).toBe(10.5);
    expect(resolveSplitterLoss('1:16')).toBe(14.0);
    expect(resolveSplitterLoss('1:32')).toBe(17.5);
    expect(resolveSplitterLoss('90/10')).toBe(10.5);
  });

  it('calculates link budget and returns Normal verdict when within budget', () => {
    const result = calculateOpticalLossBudget({
      totalDistanceMeters: 2000, // 2 km = 0.5 dB @ 1490nm (0.25 dB/km)
      wavelengthNm: 1490,
      splitters: ['1:8'], // 10.5 dB
      splicesCount: 2, // 0.2 dB
      connectorsCount: 4, // 2.0 dB
      oltTxPowerDbm: 3.0,
      measuredRxDbm: -19.4,
    });

    expect(result.fiberLossDb).toBe(0.5);
    expect(result.splitterLossDb).toBe(10.5);
    expect(result.spliceLossDb).toBe(0.2);
    expect(result.connectorLossDb).toBe(2.0);
    expect(result.totalLossDb).toBe(13.2);
    expect(result.expectedRxDbm).toBe(-10.2);
  });

  it('detects High Attenuation / Macro-bend Alert when loss exceeds threshold by > 4 dB', () => {
    const result = calculateOpticalLossBudget({
      totalDistanceMeters: 1000,
      wavelengthNm: 1490,
      splitters: ['1:8'],
      oltTxPowerDbm: 3.0,
      measuredRxDbm: -28.5, // much lower than expected ~ -10 dBm
    });

    expect(result.verdict).toBe('High Attenuation / Macro-bend Alert');
    expect(result.discrepancyDb).toBeLessThan(-4.0);
  });
});

describe('Optical Path Trace Service', () => {
  it('traces end-to-end path from customer ONU to OLT with all hops', () => {
    const data = createSampleNetwork();
    const cust = SAMPLE_CUSTOMERS[0];
    const trace = traceOpticalPath(cust.id, data);

    expect(trace).not.toBeNull();
    expect(trace!.targetKind).toBe('customer');
    expect(trace!.hops.length).toBeGreaterThanOrEqual(4);

    // Verify OLT is the first hop
    const firstHop = trace!.hops[0];
    expect(firstHop.type).toBe('OLT');
    expect(firstHop.portName).toBeDefined();

    // Verify drop cable has core color assigned
    const dropHop = trace!.hops.find((h) => h.type === 'Drop');
    expect(dropHop).toBeDefined();
    expect(dropHop!.coreColorName).toBeDefined();

    // Verify ONT is the last hop
    const lastHop = trace!.hops[trace!.hops.length - 1];
    expect(lastHop.type).toBe('ONT');
    expect(lastHop.details).toContain('Measured Rx');

    // Verify budget is calculated
    expect(trace!.budget.totalDistanceMeters).toBeGreaterThan(0);
    expect(trace!.budget.totalLossDb).toBeGreaterThan(0);
  });
});
