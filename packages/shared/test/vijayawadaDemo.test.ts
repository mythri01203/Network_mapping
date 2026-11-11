import { describe, expect, it } from 'vitest';

import type { NetworkData } from '../src/domain/command';
import { findConnectionProblems } from '../src/domain/connectionRules';
import { traceCustomerCores, tracePonTree } from '../src/domain/fiberPath';
import { findFiberProblems } from '../src/domain/fiberRules';
import { findBrokenLinks } from '../src/domain/outsidePlant';
import { createSampleNetwork } from '../src/sample';
import { createVijayawadaNetwork, vijayawadaPowerPlan, vijayawadaRecordIds } from '../src/sample/vijayawadaNetwork';

const built = createVijayawadaNetwork();
const data = built.records as unknown as NetworkData;

describe('Vijayawada demo network', () => {
  it('has one 8-port DASAN OLT and 500 sample customers', () => {
    const olts = data.equipment.filter((e) => e.type === 'OLT');
    expect(olts).toHaveLength(1);
    expect(olts[0]).toMatchObject({ manufacturer: 'DASAN', model: 'V5808', isSampleData: true });
    expect(olts[0].ponPorts).toHaveLength(8);
    expect(data.customers).toHaveLength(500);
    expect(data.customers.every((c) => c.isSampleData)).toBe(true);
    expect(data.onts).toHaveLength(500);
    expect(built.confirms).toEqual([]);
    expect(built.counts.splitters).toBe(8 + 64);
  });

  it('records every customer fiber by fiber from PON port to ONT', () => {
    for (const c of data.customers) {
      const path = traceCustomerCores(c, data);
      expect(path.gaps, c.id).toEqual([]);
      expect(path.steps.map((s) => s.kind)).toEqual([
        'olt',
        'patch',
        'odf',
        'cable',
        'splice',
        'cable',
        'splitter',
        'cable',
        'splitter',
        'cable',
        'ont',
      ]);
      expect(path.parts.splitProduct).toBe(64);
      expect(path.verdict).toMatch(/^fits/);
    }
  });

  it('puts 62 or 63 customers on each PON port', () => {
    for (let p = 1; p <= 8; p += 1) {
      const tree = tracePonTree('VJA-OLT-01', `PON-0${p}`, data)!;
      expect(tree.customers.length).toBe(p <= 4 ? 63 : 62);
      expect(tree.splitterIds).toHaveLength(9);
    }
  });

  it('passes the fiber, connection and link rules', () => {
    expect(findFiberProblems(data).filter((p) => p.severity === 'error')).toEqual([]);
    expect(findConnectionProblems(data).filter((p) => p.severity === 'error')).toEqual([]);
    expect(findBrokenLinks(data)).toEqual([]);
  });

  it('gives realistic calculated power levels at each splitter and ONT', () => {
    const plan = vijayawadaPowerPlan(data);
    expect(plan.incomplete).toEqual([]);
    expect(plan.splitters).toHaveLength(72);
    for (const s of plan.splitters) {
      if (s.stage === 'primary') {
        expect(s.inputDbm).toBeGreaterThan(0);
        expect(s.outputDbm).toBeLessThan(-7);
      } else {
        expect(s.outputDbm).toBeLessThan(s.inputDbm - 10);
      }
    }
    for (const c of plan.customers) {
      expect(c.rxDbm).toBeLessThan(-8);
      expect(c.rxDbm).toBeGreaterThan(-27);
    }
  });

  it('adds next to an existing network without touching it', () => {
    const base = createSampleNetwork();
    const added = createVijayawadaNetwork(base);
    expect(added.records.customers).toHaveLength(500);
    const baseIds = new Set(base.equipment.map((e) => e.id));
    expect(added.records.equipment!.some((e) => baseIds.has(e.id))).toBe(false);

    // Removal finds every demo record and none of the existing ones.
    const merged = Object.fromEntries(
      Object.keys(base).map((k) => [
        k,
        [...((base as never)[k] as { id: string }[]), ...(((added.records as never)[k] ?? []) as { id: string }[])],
      ]),
    );
    const found = vijayawadaRecordIds(merged);
    for (const [name, list] of Object.entries(added.records)) {
      expect(new Set(found[name as keyof typeof found]), name).toEqual(
        new Set((list as { id: string }[]).map((r) => r.id)),
      );
    }
  }, 60_000);
});
