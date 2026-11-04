import { describe, expect, it } from 'vitest';

import { allocateCore, createCable, deleteCable } from '../src/domain/cables';
import { applyPatch } from '../src/domain/command';
import { buildCores } from '../src/domain/defaults';
import { cable, closure, emptyNetwork, equipment, NOW, smallNetwork, splice } from './fixtures';

const ctx = { now: NOW };
const route: [number, number][] = [
  [17.4, 78.4],
  [17.41, 78.41],
];

describe('createCable', () => {
  it('rejects routes with fewer than two valid points', () => {
    const one = createCable(emptyNetwork(), { name: 'C', type: 'Distribution Fiber', coordinates: [[17, 78]] }, ctx);
    expect(one).toMatchObject({ ok: false, error: { title: 'Invalid Route' } });
    const bad = createCable(
      emptyNetwork(),
      {
        name: 'C',
        type: 'Distribution Fiber',
        coordinates: [
          [17, 78],
          [NaN, 78],
        ],
      },
      ctx,
    );
    expect(bad).toMatchObject({ ok: false, error: { title: 'Invalid Route' } });
  });

  it('rejects endpoints that do not exist', () => {
    const result = createCable(
      emptyNetwork(),
      { name: 'C', type: 'Distribution Fiber', coordinates: route, startEquipmentId: 'GHOST' },
      ctx,
    );
    expect(result).toMatchObject({ ok: false, error: { title: 'Invalid Endpoint' } });
  });

  it('rejects duplicate ids, ignoring case', () => {
    const data = { ...emptyNetwork(), cables: [cable({ id: 'CBL-X' })] };
    const result = createCable(data, { id: 'cbl-x', name: 'C', type: 'Distribution Fiber', coordinates: route }, ctx);
    expect(result).toMatchObject({ ok: false, error: { title: 'Duplicate Cable ID' } });
  });

  it('measures the route, builds the core inventory and assigns a typed id', () => {
    const data = { ...emptyNetwork(), equipment: [equipment({ id: 'FDT-01', type: 'FDT' })] };
    const result = createCable(
      data,
      { name: 'Feeder', type: 'Main Feeder Fiber', coordinates: route, startEquipmentId: 'FDT-01' },
      ctx,
    );
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.id).toBe('CBL-FEEDER-01');
    expect(result.value.lengthMeters).toBeGreaterThan(1400);
    expect(result.value.lengthMeters).toBeLessThan(1600);
    expect(result.value.cores).toHaveLength(result.value.fiberCount);
    expect(result.value.cores.every((c) => c.status === 'Available')).toBe(true);
    expect(result.value.installationDate).toBe('2026-11-04');
    expect(result.value.cableCategory).toBe('Fiber');
  });

  it('pads drop cable ids to three digits', () => {
    const result = createCable(emptyNetwork(), { name: 'Drop', type: 'Drop Fiber', coordinates: route }, ctx);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.id).toBe('DROP-001');
  });
});

describe('deleteCable', () => {
  it('refuses while customers depend on it', () => {
    expect(deleteCable(smallNetwork(), 'FEED-01')).toMatchObject({
      ok: false,
      error: { title: 'Cannot Delete Cable' },
    });
  });

  it('refuses while it feeds a splitter input', () => {
    const data = { ...smallNetwork(), customers: [] };
    const result = deleteCable(data, 'DIST-01');
    expect(result).toMatchObject({ ok: false, error: { title: 'Cannot Delete Cable' } });
    if (!result.ok) expect(result.error.message).toContain('SPL-01');
  });

  it('strips closure references and splices, and warns about cores in use', () => {
    const cores = buildCores(4).map((c) => (c.coreNumber === 1 ? { ...c, status: 'In Use' as const } : c));
    const data = {
      ...emptyNetwork(),
      cables: [cable({ id: 'CBL-A', cores }), cable({ id: 'CBL-B' })],
      closures: [
        closure({
          id: 'JC-1',
          cableAId: 'CBL-A',
          cableBId: 'CBL-B',
          splices: [splice({ id: 'S1' }), splice({ id: 'S2', inputCableId: 'CBL-B', outputCableId: 'CBL-C' })],
        }),
      ],
    };
    const result = deleteCable(data, 'CBL-A');
    if (!result.ok) throw new Error(result.error.message);
    expect(result.confirm).toContain('1 core(s) are marked In Use');
    expect(result.confirm).toContain('JC-1');
    const next = applyPatch(data, result.patch);
    expect(next.cables.map((c) => c.id)).toEqual(['CBL-B']);
    expect(next.closures[0]).toMatchObject({ cableAId: undefined, cableBId: 'CBL-B' });
    expect(next.closures[0].splices.map((s) => s.id)).toEqual(['S2']);
  });
});

describe('allocateCore', () => {
  const network = () => {
    const cores = buildCores(4).map((c) => {
      if (c.coreNumber === 2) return { ...c, status: 'In Use' as const, customerId: 'CUST-009' };
      if (c.coreNumber === 3) return { ...c, status: 'Damaged' as const };
      return c;
    });
    return { ...emptyNetwork(), cables: [cable({ id: 'CBL-A', cores })] };
  };

  it('refuses occupied and damaged cores', () => {
    const occupied = allocateCore(network(), { cableId: 'CBL-A', coreNumber: 2 }, ctx);
    expect(occupied).toMatchObject({ ok: false, error: { title: 'Core Already Occupied' } });
    if (!occupied.ok) expect(occupied.error.message).toContain('CUST-009');
    expect(allocateCore(network(), { cableId: 'CBL-A', coreNumber: 3 }, ctx)).toMatchObject({
      ok: false,
      error: { title: 'Damaged Core' },
    });
  });

  it('refuses unknown cables and cores', () => {
    expect(allocateCore(network(), { cableId: 'NOPE', coreNumber: 1 }, ctx)).toMatchObject({ ok: false });
    expect(allocateCore(network(), { cableId: 'CBL-A', coreNumber: 99 }, ctx)).toMatchObject({ ok: false });
  });

  it('marks an available core In Use for the target', () => {
    const result = allocateCore(
      network(),
      { cableId: 'CBL-A', coreNumber: 1, equipmentId: 'FAT-01', portName: 'P1' },
      ctx,
    );
    if (!result.ok) throw new Error(result.error.message);
    const core = result.value.cores.find((c) => c.coreNumber === 1)!;
    expect(core).toMatchObject({ status: 'In Use', connectedToEquipmentId: 'FAT-01', connectedPort: 'P1' });
    expect(core.remarks).toBe('Allocated to FAT-01 on 2026-11-04');
    expect(result.audit[0]).toMatchObject({ action: 'CORE_ALLOCATED', assetType: 'Core' });
  });
});
