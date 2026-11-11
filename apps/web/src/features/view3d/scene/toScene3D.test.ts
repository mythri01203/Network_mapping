import { describe, expect, it } from 'vitest';

import { DEFAULT_OPTICAL_SETTINGS } from '@fibergis/shared';
import { createSampleNetwork } from '@fibergis/shared/sample';

import { tx } from '../i18n';
import { createBenchNetwork, createDemoNetwork } from './demoNetwork';
import { makeProjection, pickOrigin, seedOf } from './geoLocal';
import { budgetFor, typicalConnectors } from './lossBudget';
import { drawingFor, MODEL_TABLE, portColorCode, TIA598 } from './models';
import { findCustomer, toScene3D } from './toScene3D';

const NOW = new Date('2026-11-11T10:00:00Z');

describe('geo → local metres', () => {
  it('maps the origin to 0,0 and north to -z', () => {
    const p = makeProjection({ lat: 12.97, lng: 77.59 });
    expect(p.toLocal(12.97, 77.59)).toEqual({ x: 0, z: -0 });
    const north = p.toLocal(12.97 + 0.001, 77.59);
    expect(north.z).toBeLessThan(0);
    expect(Math.abs(north.z)).toBeCloseTo(111.2, 0);
    const east = p.toLocal(12.97, 77.59 + 0.001);
    expect(east.x).toBeCloseTo(108.4, 0);
  });

  it('round-trips through toGeo', () => {
    const p = makeProjection({ lat: 12.97, lng: 77.59 });
    const local = p.toLocal(12.9734, 77.5961);
    const back = p.toGeo(local);
    expect(back.lat).toBeCloseTo(12.9734, 9);
    expect(back.lng).toBeCloseTo(77.5961, 9);
  });

  it('picks the preferred origin, else the middle', () => {
    expect(pickOrigin([[1, 1]], [5, 6])).toEqual({ lat: 5, lng: 6 });
    expect(
      pickOrigin([
        [0, 0],
        [2, 4],
      ]),
    ).toEqual({ lat: 1, lng: 2 });
    expect(pickOrigin([])).toEqual({ lat: 0, lng: 0 });
  });

  it('seeds deterministically', () => {
    expect(seedOf('CUST-1')).toBe(seedOf('CUST-1'));
    expect(seedOf('CUST-1')).not.toBe(seedOf('CUST-2'));
  });
});

describe('loss budget', () => {
  it('adds splitters, fiber, connectors and splices from the settings', () => {
    const b = budgetFor({
      ratios: ['1:4', '1:4', '1:8'],
      distanceMeters: 2000,
      connectors: typicalConnectors(3),
      splices: 2,
      opticsClass: 'GPON B+',
    });
    // Settings defaults: 1:4 = 7.1, 1:8 = 10.4, 1310 nm 0.35 dB/km, connector 0.3, splice 0.1.
    expect(b.splitterLossDb).toBeCloseTo(24.6, 5);
    expect(b.fiberLossDb).toBeCloseTo(0.7, 5);
    expect(b.connectorLossDb).toBeCloseTo(8 * 0.3, 5);
    expect(b.spliceLossDb).toBeCloseTo(0.2, 5);
    expect(b.totalLossDb).toBeCloseTo(27.9, 5);
    expect(b.classMaxLossDb).toBe(28);
    expect(b.fits).toBe(true);
  });

  it('recommends C+ when B+ is exceeded but C+ is not', () => {
    const b = budgetFor({
      ratios: ['1:4', '1:4', '1:8'],
      distanceMeters: 8000,
      connectors: 8,
      splices: 4,
      opticsClass: 'GPON B+',
    });
    expect(b.fits).toBe(false);
    expect(b.recommendation.key).toBe('msg.cplus');
    expect(tx('en', b.recommendation)).toMatch(/C\+/);
  });

  it('honours operator settings', () => {
    const b = budgetFor(
      { ratios: ['1:8'], distanceMeters: 0, connectors: 0, splices: 0, opticsClass: 'GPON B+' },
      { ...budgetSettings(), splitterDb: { ...budgetSettings().splitterDb, '1:8': 10.5 } },
    );
    expect(b.splitterLossDb).toBe(10.5);
  });
});

const budgetSettings = () => structuredClone(DEFAULT_OPTICAL_SETTINGS);

describe('models', () => {
  it('draws every toolbox type, with a generic box for unknown types', () => {
    expect(drawingFor('OLT').kind).toBe('rack');
    expect(drawingFor('Electric Pole')).toEqual({ kind: 'pole', electric: true });
    expect(drawingFor('FAT')).toEqual({ kind: 'box', model: 'fat' });
    expect(drawingFor('FDT')).toEqual({ kind: 'box', model: 'closure' });
    expect(drawingFor('Fiber Distribution Cabinet')).toEqual({ kind: 'box', model: 'cabinet' });
    expect(drawingFor('My custom gadget')).toEqual({ kind: 'box', model: 'generic' });
    expect(MODEL_TABLE.length).toBeGreaterThan(40);
  });

  it('colours ports in TIA-598 order with names', () => {
    expect(TIA598.map((c) => c.name).slice(0, 8)).toEqual([
      'Blue',
      'Orange',
      'Green',
      'Brown',
      'Slate',
      'White',
      'Red',
      'Black',
    ]);
    expect(portColorCode(5).name).toBe('Slate');
    expect(portColorCode(13).name).toBe('Blue');
  });
});

describe('toScene3D with the demo network', () => {
  const demo = createDemoNetwork(NOW);
  const scene = toScene3D(demo, { origin: { lat: 12.9716, lng: 77.5946 }, now: NOW, isDemo: true });

  it('builds the rack with the OLT and the switch', () => {
    expect(scene.racks).toHaveLength(1);
    const kinds = scene.racks[0].items.map((i) => i.kind);
    expect(kinds).toContain('olt');
    expect(kinds).toContain('switch');
    const olt = scene.racks[0].items.find((i) => i.kind === 'olt');
    if (olt?.kind !== 'olt') throw new Error('no OLT');
    expect(olt.olt.ports).toHaveLength(8);
    expect(olt.olt.ports[0].state).toBe('in_use');
    expect(olt.olt.ports[0].led).toBe('blink');
    expect(olt.olt.ports[1].led).toBe('off');
    const sw = scene.racks[0].items.find((i) => i.kind === 'switch');
    if (sw?.kind !== 'switch') throw new Error('no switch');
    expect(sw.sw.ports).toHaveLength(24);
    expect(sw.sw.uplinkTo).toBe('DEMO-OLT-1');
  });

  it('walks the 1:4 → 1:4 → 1:8 cascade fiber by fiber', () => {
    const pon = scene.pons.find((p) => p.ponId === 'PON-1')!;
    expect(pon.levels.map((l) => [l.level, l.ratios, l.boxes])).toEqual([
      [1, ['1:4'], 1],
      [2, ['1:4'], 4],
      [3, ['1:8'], 13],
    ]);
    expect(pon.designPorts).toBe(128);
    expect(pon.used).toBe(100);
    expect(pon.spare).toBe(28);
    expect(pon.builtPorts).toBe(13 * 8 + 3);
    expect(pon.source).toBe('fiber');
    expect(pon.warnings.map((w) => tx('en', w))).toContain(
      'Split 1:128 is more than 1:64 on one PON port. Check the ONU limit of the OLT and the optics class.',
    );
    expect(tx('kn', pon.warnings[0])).toContain('1:128');
    expect(pon.budget?.splitterLossDb).toBeCloseTo(24.6, 5);
  });

  it('gives every house its plain-words fiber path', () => {
    expect(scene.customers).toHaveLength(100);
    expect(scene.houses).toHaveLength(100);
    const c = findCustomer(scene, '37')!;
    expect(c.number).toBe(37);
    expect(c.complete).toBe(true);
    expect(c.source).toBe('fiber');
    expect(c.text).toMatch(/^PON 1\/1\/1 → FDT-1 out \d → FDT-2\.\d out \d → FAT-\d+ port \d/);
    expect(c.portColor?.name).toBe(portColorCode(c.fatPort!).name);
    // One-fiber TIA-598 drop: fiber 1 is Blue, and it is said so from the cable's scheme.
    expect(c.fiberColor?.name).toBe('Blue');
  });

  it('marks the TEST no-light house with a fault and labels it TEST', () => {
    const c = scene.customers.find((p) => p.customerId === 'DEMO-CUST-037')!;
    expect(c.live?.fault).toBe(true);
    expect(c.live?.label).toMatch(/^TEST/);
    expect(scene.houses.find((h) => h.id === c.houseId)?.fault).toBe(true);
  });

  it('assigns cable roles from the walk', () => {
    const role = (id: string) => scene.cables.find((c) => c.id === id);
    expect(role('DEMO-FDR-1')?.role).toBe('feeder');
    expect(role('DEMO-L1-1')).toMatchObject({ role: 'branch', level: 1 });
    expect(role('DEMO-L2-1')).toMatchObject({ role: 'branch', level: 2 });
    expect(role('DEMO-DROP-001')?.role).toBe('drop');
    expect(role('DEMO-FDR-1')?.aerial).toBe(true);
    expect(scene.cables.filter((c) => c.schematic)).toHaveLength(0);
  });

  it('draws poles, spans with power lines and pole boxes', () => {
    expect(scene.poles.length).toBe(3 + 4 + 13);
    expect(scene.spans.length).toBeGreaterThan(15);
    expect(scene.spans.every((s) => s.power)).toBe(true);
    const fat = scene.boxes.find((b) => b.id === 'DEMO-FAT-1')!;
    expect(fat.model).toBe('fat');
    expect(fat.mount).toBe('pole');
    expect(fat.ports).toHaveLength(8);
    expect(fat.ports.every((p) => p.state === 'used')).toBe(true);
    const fdt = scene.boxes.find((b) => b.id === 'DEMO-FDT-1')!;
    expect(fdt).toMatchObject({ model: 'closure', mount: 'strand' });
    expect(fdt.splitters[0]).toMatchObject({ ratio: '1:4', level: 1 });
  });

  it('is pure: the same input gives the same scene', () => {
    const again = toScene3D(createDemoNetwork(NOW), { origin: { lat: 12.9716, lng: 77.5946 }, now: NOW, isDemo: true });
    expect(JSON.stringify(again)).toBe(JSON.stringify(scene));
  });
});

describe('toScene3D with the bundled sample network', () => {
  const sample = createSampleNetwork();
  const scene = toScene3D(sample, { now: NOW });

  it('draws every equipment record somewhere', () => {
    const drawn = new Set<string>([
      ...scene.racks.flatMap((r) =>
        r.items.map((i) =>
          i.kind === 'olt'
            ? i.olt.equipmentId
            : i.kind === 'switch'
              ? i.sw.equipmentId
              : i.kind === 'odf'
                ? i.odf.equipmentId
                : i.equipmentId,
        ),
      ),
      ...scene.poles.map((p) => p.id),
      ...scene.boxes.map((b) => b.id),
    ]);
    for (const e of sample.equipment) expect(drawn.has(e.id)).toBe(true);
  });

  it('places customers from their recorded links and names the gaps honestly', () => {
    const active = sample.customers.filter((c) => c.status !== 'Disconnected');
    expect(scene.customers).toHaveLength(active.length);
    for (const c of scene.customers) {
      expect(c.text.length).toBeGreaterThan(0);
      if (!c.complete)
        expect(c.text.includes('not recorded') || c.hops.some((h) => h.kind === 'gap') || !c.fatPort).toBe(true);
    }
    expect(scene.notes.map((n) => tx('en', n)).some((n) => n.includes('links written on the customer'))).toBe(true);
  });

  it('uses the first OLT as the origin', () => {
    const olt = sample.equipment.find((e) => e.type === 'OLT')!;
    expect(scene.origin).toEqual({ lat: olt.lat, lng: olt.lng });
  });
});

describe('toScene3D with nothing recorded', () => {
  it('returns an empty scene without throwing', () => {
    const scene = toScene3D({ equipment: [], cables: [], splitters: [], closures: [], customers: [] });
    expect(scene.racks).toEqual([]);
    expect(scene.houses).toEqual([]);
    expect(scene.extent).toBe(30);
  });
});

describe('benchmark network', () => {
  it('builds 1000 houses on 10 OLTs, every path traced fiber by fiber', () => {
    const scene = toScene3D(createBenchNetwork(10, NOW), {
      origin: { lat: 12.9716, lng: 77.5946 },
      now: NOW,
      isDemo: true,
    });
    expect(scene.houses).toHaveLength(1000);
    expect(scene.racks).toHaveLength(10);
    expect(scene.customers.every((c) => c.complete && c.source === 'fiber')).toBe(true);
    expect(scene.pons.filter((p) => p.used === 100)).toHaveLength(10);
  });
});
