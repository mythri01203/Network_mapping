import { describe, expect, it } from 'vitest';

import type { NetworkData } from '../src/domain/command';
import { buildPonOverview } from '../src/domain/ponOverview';
import { createVijayawadaNetwork, vijayawadaPowerPlan } from '../src/sample/vijayawadaNetwork';
import { customer, emptyNetwork, smallNetwork } from './fixtures';

const data = createVijayawadaNetwork().records as unknown as NetworkData;

describe('PON overview', () => {
  const overview = buildPonOverview(data);

  it('names the area, streets, customers and free outputs of every PON', () => {
    expect(overview.pons).toHaveLength(8);
    const pon3 = overview.pons.find((p) => p.ponPortId === 'PON-03')!;
    expect(pon3.areas[0]).toEqual({ name: 'Gunadala', customers: 63 });
    expect(pon3.streets).toContain('Gunadala Main Road');
    expect(pon3.customers).toMatchObject({ total: 63 });
    expect(pon3.customers.active + pon3.customers.suspended).toBe(63);
    expect(pon3.accessOutputs).toMatchObject({ total: 64, used: 63, free: 1 });
    expect(pon3.vendorAddress).toBe('gpon-olt 3');
    expect(pon3.rxRange!.minDbm).toBeLessThan(pon3.rxRange!.maxDbm + 0.01);
    expect(pon3.bounds).toBeDefined();
  });

  it('gives each splitter its stage, PON and the same levels as the power plan', () => {
    const plan = vijayawadaPowerPlan(data);
    for (const row of plan.splitters) {
      const s = overview.splitters.get(row.splitterId)!;
      expect(s.stage).toBe(row.stage === 'primary' ? 1 : 2);
      expect(s.access).toBe(row.stage === 'secondary');
      expect(s.ponKey).toBe(`VJA-OLT-01/${row.ponPortId}`);
      expect(s.inputDbm).toBeCloseTo(row.inputDbm, 0);
    }
  });

  it('puts the north feeder on four PONs and a distribution cable on one', () => {
    expect(overview.cables.get('VJA-FDR-N01')!.ponKeys).toHaveLength(4);
    expect(overview.cables.get('VJA-DST-0301')!.ponKeys).toEqual(['VJA-OLT-01/PON-03']);
    expect(overview.cables.get('VJA-FDR-N01')).toMatchObject({ coresTotal: 48, coresUsed: 4, coresFree: 44 });
    expect(overview.equipment.get('VJA-FAT-0301')).toEqual(['VJA-OLT-01/PON-03']);
    expect(overview.customers.size).toBe(500);
  });

  it('gives no PON to a customer whose fibers are not recorded, and no level without a launch power', () => {
    const net = smallNetwork();
    const o = buildPonOverview({ ...net, customers: [...net.customers, customer({ id: 'C-X', splitterId: 'SPL-01', terminalBoxId: 'FAT-01' })] });
    expect(o.customers.has('C-X')).toBe(false);
    expect(o.notTraced).toContain('C-X');
    for (const s of o.splitters.values()) expect(s.inputDbm).toBeUndefined();
    expect(buildPonOverview(emptyNetwork()).pons).toEqual([]);
  });

  it('is quick enough for the map', () => {
    const start = Date.now();
    buildPonOverview(data);
    expect(Date.now() - start).toBeLessThan(3000);
  });
});
