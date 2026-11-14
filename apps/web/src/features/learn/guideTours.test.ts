import { describe, expect, it } from 'vitest';

import {
  type Cable,
  type Customer,
  type Equipment,
  GUIDE_TOURS,
  LESSON_SCRIPTS,
  MAX_SCRIPT_CHARS,
  type Splitter,
} from '@fibergis/shared';

import { AUTO } from './guideAutopilot';
import { GUIDE_STEP_KEYS, guideSteps, startCtx, updateCtx } from './guideTours';

const keys = [...new Set([...GUIDE_TOURS.menu, ...GUIDE_TOURS.map, ...GUIDE_TOURS.demo])];
const eq = (id: string, type: string) => ({ id, type, lat: 16.5, lng: 80.6 }) as unknown as Equipment;
const cable = (id: string, type = 'Main Feeder Fiber') => ({ id, type }) as unknown as Cable;
const net = (
  over: Partial<{ equipment: Equipment[]; cables: Cable[]; customers: Customer[]; splitters: Splitter[] }> = {},
) => ({ equipment: [], cables: [], customers: [], splitters: [], ...over });

describe('on-screen guide', () => {
  it('has words for every step, English checked and Telugu and Kannada marked as drafts', () => {
    for (const key of keys) {
      const script = LESSON_SCRIPTS.find((s) => s.key === key);
      expect(script, key).toBeDefined();
      expect(script!.text.en.reviewed, key).toBe(true);
      for (const lang of ['en', 'te', 'kn'] as const) {
        expect(script!.text[lang].text.length, `${key} ${lang}`).toBeGreaterThan(10);
        expect(script!.text[lang].text.length, `${key} ${lang}`).toBeLessThanOrEqual(MAX_SCRIPT_CHARS);
      }
      // Nobody has checked these yet, so they must never be treated as final.
      expect(script!.text.te.reviewed, key).toBe(false);
      expect(script!.text.kn.reviewed, key).toBe(false);
    }
  });

  it('knows every step, and no step is left over', () => {
    expect([...GUIDE_STEP_KEYS].sort()).toEqual([...keys].sort());
    for (const tour of ['menu', 'map', 'demo'] as const)
      expect(guideSteps(tour).map((s) => s.key)).toEqual([...GUIDE_TOURS[tour]]);
  });

  it('maps in FTTH order: OLT, FDT, feeder cable, FDT splitter, FAT, distribution cable, customer', () => {
    const order = GUIDE_TOURS.map as readonly string[];
    const at = (k: string) => order.indexOf(k);
    expect(at('map.oltPlace')).toBeLessThan(at('map.fdtPlace'));
    expect(at('map.fdtPlace')).toBeLessThan(at('map.feederSave'));
    expect(at('map.feederSave')).toBeLessThan(at('map.fdtSplitterAdd'));
    expect(at('map.fdtSplitterAdd')).toBeLessThan(at('map.fatPlace'));
    expect(at('map.fatPlace')).toBeLessThan(at('map.distSave'));
    expect(at('map.distSave')).toBeLessThan(at('map.custSave'));
  });

  it('every hands-on step can tell when it is done; the menu tour only shows', () => {
    for (const s of guideSteps('map')) expect(s.kind === 'say' || typeof s.done === 'function', s.key).toBe(true);
    for (const s of guideSteps('menu')) expect(s.kind, s.key).toBe('say');
  });

  it('the self-running demo never saves a customer, and removes what it made at the end', () => {
    const demo = GUIDE_TOURS.demo as readonly string[];
    expect(demo).not.toContain('map.custSave');
    expect(demo.indexOf('demo.custSave')).toBeLessThan(demo.indexOf('demo.cleanup'));
    expect(demo.at(-1)).toBe('demo.done');
    // Every hands-on step of the demo has something the guide does by itself.
    for (const s of guideSteps('demo')) if (s.kind === 'do') expect(AUTO[s.key], s.key).toBeTypeOf('function');
  });

  it('notices only what was made after the guide started, and forgets what was undone', () => {
    const start = startCtx(net({ equipment: [eq('OLD-OLT', 'OLT')], cables: [cable('OLD-C')] }));
    let ctx = updateCtx(start, net({ equipment: [eq('OLD-OLT', 'OLT')], cables: [cable('OLD-C')] }));
    expect(ctx).toBe(start);
    ctx = updateCtx(
      ctx,
      net({
        equipment: [eq('OLD-OLT', 'OLT'), eq('N-OLT', 'OLT'), eq('N-FDT', 'FDT')],
        cables: [cable('OLD-C'), cable('F1')],
      }),
    );
    expect([ctx.olt, ctx.fdt, ctx.feeder, ctx.dist]).toEqual(['N-OLT', 'N-FDT', 'F1', undefined]);
    ctx = updateCtx(
      ctx,
      net({
        equipment: [eq('N-OLT', 'OLT'), eq('N-FDT', 'FDT')],
        cables: [cable('F1'), cable('D-1', 'Drop Fiber'), cable('C2', 'Distribution Fiber')],
      }),
    );
    // A house wire made by Add customer is not the distribution cable.
    expect([ctx.feeder, ctx.dist]).toEqual(['F1', 'C2']);
    // Undo removed the FDT: its steps wait again.
    ctx = updateCtx(ctx, net({ equipment: [eq('N-OLT', 'OLT')], cables: [cable('F1'), cable('C2')] }));
    expect(ctx.fdt).toBeUndefined();
  });

  it('never takes a record the server sent while the map moved as one the guide made', () => {
    const start = startCtx(net());
    // A map area loaded after the guide started: its OLT and cable are not in the baseline.
    const loaded = net({ equipment: [eq('REAL-OLT', 'OLT'), eq('REAL-POLE', 'Telecom Pole')], cables: [cable('REAL-C')] });
    expect(updateCtx(start, loaded, () => false)).toBe(start);
    const made = new Set(['N-OLT', 'N-POLE']);
    const ctx = updateCtx(
      start,
      net({ equipment: [...loaded.equipment, eq('N-OLT', 'OLT'), eq('N-POLE', 'Telecom Pole')], cables: loaded.cables }),
      (id) => made.has(id),
    );
    expect([ctx.olt, ctx.feeder]).toEqual(['N-OLT', undefined]);
  });

  it('demo full flow: follows the ISP-to-devices order and reads each link from the records', () => {
    const demo = GUIDE_TOURS.demo as readonly string[];
    const at = (k: string) => demo.indexOf(k);
    const order = ['flow.isp', 'flow.bng', 'flow.coreSwitch', 'flow.uplink', 'map.oltPlace', 'flow.chassis', 'flow.ponPort',
      'flow.odfPatch', 'flow.feederRoute', 'flow.feederPoles', 'flow.feederSlack', 'flow.odfFeeder', 'flow.closure',
      'flow.fdtSplitter', 'map.distSave', 'flow.fdtOutput', 'flow.fatSplitter', 'map.custPort', 'flow.drop', 'flow.rosette',
      'flow.ont', 'flow.lan', 'demo.cleanup'];
    for (let i = 1; i < order.length; i++) expect(at(order[i - 1]!), order[i]).toBeLessThan(at(order[i]!));

    // ODF patched to the OLT and fed by the feeder; FDT output on the distribution cable.
    const odf = {
      ...eq('N-ODF', 'ODF'),
      odfPanels: [{ id: 'P', label: 'A', ports: [{ id: 'P-1', number: 1, patch: { oltId: 'N-OLT', ponPortId: 'PON-01' }, feederCableId: 'F1', feederCore: 1 }] }],
    } as unknown as Equipment;
    const split = (id: string, box: string, out?: string) =>
      ({ id, terminalBoxId: box, inputPort: {}, outputPorts: [{ portNumber: 1, connectedDropCableId: out }] }) as unknown as Splitter;
    const made = net({
      equipment: [eq('N-OLT', 'OLT'), odf, eq('N-FDT', 'FDT'), eq('N-FAT', 'FAT'), eq('P1', 'Telecom Pole'), eq('P2', 'Electric Pole')],
      cables: [cable('F1'), cable('C2', 'Distribution Fiber')],
      splitters: [split('S1', 'N-FDT', 'C2'), split('S2', 'N-FAT')],
    });
    const ctx = updateCtx(startCtx(net()), made);
    expect(ctx).toMatchObject({ odf: 'N-ODF', poles: ['P1', 'P2'], fdtSplitter: 'S1', fatSplitter: 'S2' });
    expect([ctx.odfPanel, ctx.odfPatched, ctx.odfFed, ctx.fdtOut]).toEqual([true, true, true, true]);
    // The clean-up step waits until the poles are gone too.
    const cleanup = guideSteps('demo').find((s) => s.key === 'demo.cleanup')!;
    const world = (c: typeof ctx) => ({ ctx: c, map: { activeTool: 'select' as const, drawTarget: 'cable', equipmentTypeToAdd: null }, modals: {}, selected: null, enteredAt: 0 });
    expect(cleanup.done!(world({ baseline: ctx.baseline, poles: ['P1'] }))).toBe(false);
    expect(cleanup.done!(world({ baseline: ctx.baseline }))).toBe(true);
  });
});
