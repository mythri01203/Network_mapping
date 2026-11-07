import { describe, expect, it } from 'vitest';

import { applyPatch } from '../src/domain/command';
import {
  addEquipmentPhoto,
  createEquipment,
  deleteEquipment,
  deleteImageAnnotation,
  moveEquipment,
  saveImageAnnotation,
  updateEquipmentPort,
} from '../src/domain/equipment';
import { polylineLengthMeters } from '../src/domain/geo';
import { equipmentSchema } from '../src/model/schemas';
import { cable, customer, emptyNetwork, equipment, NOW, smallNetwork, splitter } from './fixtures';

const ctx = { now: NOW, actor: 'Planner User' };

describe('createEquipment', () => {
  it('rejects invalid coordinates', () => {
    const result = createEquipment(emptyNetwork(), { name: 'X', type: 'FAT', lat: 95, lng: 78 }, ctx);
    expect(result).toMatchObject({ ok: false, error: { title: 'Invalid Location' } });
  });

  it('rejects an id that already exists, ignoring case', () => {
    const data = { ...emptyNetwork(), equipment: [equipment({ id: 'FAT-01', type: 'FAT' })] };
    const result = createEquipment(data, { id: 'fat-01', name: 'Dup', type: 'FAT', lat: 17, lng: 78 }, ctx);
    expect(result).toMatchObject({ ok: false, error: { title: 'Duplicate ID Error' } });
  });

  it('assigns the next sequential id, fills defaults and builds logical ports', () => {
    const data = { ...emptyNetwork(), equipment: [equipment({ id: 'FAT-04', type: 'FAT' })] };
    const result = createEquipment(data, { name: 'New FAT', type: 'FAT', lat: 17.5, lng: 78.5 }, ctx);
    if (!result.ok) throw new Error(result.error.message);

    expect(result.value).toMatchObject({
      id: 'FAT-05',
      status: 'Active',
      installedDate: '2026-11-04',
      usedPorts: 0,
    });
    expect(result.value.totalPorts).toBeGreaterThan(0);
    expect(result.value.availablePorts).toBe(result.value.totalPorts);
    expect(result.value.logicalPorts).toHaveLength(result.value.totalPorts!);
    expect(result.patch.equipment?.map((e) => e.id)).toEqual(['FAT-04', 'FAT-05']);
    expect(result.audit[0]).toMatchObject({ action: 'EQUIPMENT_CREATED', assetId: 'FAT-05' });
  });
});

describe('createEquipment facts', () => {
  it('saves no made-up area, street, manufacturer or model', () => {
    const result = createEquipment(emptyNetwork(), { name: 'Box', type: 'FAT', lat: 17.5, lng: 78.5 }, ctx);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.area).toBe('');
    expect(result.value.street).toBe('');
    expect(result.value.manufacturer).toBeUndefined();
    expect(result.value.model).toBeUndefined();
    expect(equipmentSchema.safeParse(result.value).success).toBe(true);
  });

  it('keeps what the person gave', () => {
    const result = createEquipment(
      emptyNetwork(),
      { name: 'Box', type: 'FAT', lat: 17.5, lng: 78.5, area: 'Ward 4', manufacturer: 'Syrotech' },
      ctx,
    );
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toMatchObject({ area: 'Ward 4', manufacturer: 'Syrotech' });
  });
});

describe('moveEquipment', () => {
  const network = () => ({
    ...emptyNetwork(),
    equipment: [equipment({ id: 'OLT-01', type: 'OLT', lat: 17, lng: 78 }), equipment({ id: 'FAT-01', type: 'FAT', lat: 17.01, lng: 78.01 })],
    cables: [
      cable({
        id: 'C-1',
        startEquipmentId: 'OLT-01',
        endEquipmentId: 'FAT-01',
        lengthMeters: 999,
        coordinates: [
          [17, 78],
          [17.005, 78.005],
          [17.01, 78.01],
        ],
      }),
      cable({ id: 'C-2', coordinates: [[1, 1], [2, 2]] }),
      cable({ id: 'C-3', endEquipmentId: 'FAT-01', coordinates: [] }),
    ],
  });

  it('moves the matching cable end and recalculates length', () => {
    const result = moveEquipment(network(), 'FAT-01', 17.02, 78.02);
    if (!result.ok) throw new Error(result.error.message);
    const next = applyPatch(network(), result.patch);
    expect(next.equipment.find((e) => e.id === 'FAT-01')).toMatchObject({ lat: 17.02, lng: 78.02 });
    const moved = next.cables.find((c) => c.id === 'C-1')!;
    expect(moved.coordinates).toEqual([
      [17, 78],
      [17.005, 78.005],
      [17.02, 78.02],
    ]);
    expect(moved.lengthMeters).toBe(Math.round(polylineLengthMeters(moved.coordinates)));
    expect(moved.lengthMeters).not.toBe(999);
    expect(result.value.movedCableIds).toEqual(['C-1']);
  });

  it('moves the start end when the equipment is at the start', () => {
    const result = moveEquipment(network(), 'OLT-01', 16.99, 77.99);
    if (!result.ok) throw new Error(result.error.message);
    const moved = applyPatch(network(), result.patch).cables.find((c) => c.id === 'C-1')!;
    expect(moved.coordinates[0]).toEqual([16.99, 77.99]);
    expect(moved.coordinates.at(-1)).toEqual([17.01, 78.01]);
  });

  it('leaves unconnected cables alone and describes one change', () => {
    const data = network();
    const result = moveEquipment(data, 'FAT-01', 17.02, 78.02);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.patch.cables!.find((c) => c.id === 'C-2')).toBe(data.cables[1]);
    expect(result.patch.cables!.find((c) => c.id === 'C-3')).toBe(data.cables[2]);
    expect(result.audit).toHaveLength(1);
    expect(result.audit[0].action).toBe('EQUIPMENT_MOVED');
  });

  it('rejects missing equipment and bad coordinates', () => {
    expect(moveEquipment(network(), 'NOPE', 17, 78).ok).toBe(false);
    expect(moveEquipment(network(), 'FAT-01', 95, 78).ok).toBe(false);
  });
});

describe('deleteEquipment', () => {
  it('refuses while cables are connected', () => {
    const data = {
      ...emptyNetwork(),
      equipment: [equipment({ id: 'FAT-01', type: 'FAT' })],
      cables: [cable({ id: 'C-1', endEquipmentId: 'FAT-01' })],
    };
    const result = deleteEquipment(data, 'FAT-01');
    expect(result).toMatchObject({ ok: false, error: { title: 'Cannot Delete Equipment' } });
    if (!result.ok) expect(result.error.message).toContain('C-1');
  });

  it('refuses while customers are served', () => {
    const data = {
      ...emptyNetwork(),
      equipment: [equipment({ id: 'FAT-01', type: 'FAT' })],
      customers: [customer({ id: 'CUST-001', terminalBoxId: 'FAT-01' })],
    };
    expect(deleteEquipment(data, 'FAT-01')).toMatchObject({ ok: false, error: { title: 'Cannot Delete Equipment' } });
  });

  it('removes owned splitters and asks for confirmation', () => {
    const data = {
      ...emptyNetwork(),
      equipment: [equipment({ id: 'FAT-01', type: 'FAT' }), equipment({ id: 'FAT-02', type: 'FAT' })],
      splitters: [
        splitter({ id: 'SPL-A', terminalBoxId: 'FAT-01' }),
        splitter({ id: 'SPL-B', terminalBoxId: 'FAT-02' }),
      ],
    };
    const result = deleteEquipment(data, 'FAT-01');
    if (!result.ok) throw new Error(result.error.message);
    expect(result.confirm).toContain('1 splitter(s)');
    const next = applyPatch(data, result.patch);
    expect(next.equipment.map((e) => e.id)).toEqual(['FAT-02']);
    expect(next.splitters.map((s) => s.id)).toEqual(['SPL-B']);
  });

  it('fails for unknown equipment', () => {
    expect(deleteEquipment(emptyNetwork(), 'NOPE')).toMatchObject({ ok: false });
  });
});

describe('equipment ports and photos', () => {
  it('updates one logical port and recomputes the usage summary', () => {
    const data = smallNetwork();
    const fat = data.equipment.find((e) => e.id === 'FAT-01')!;
    const created = createEquipment(emptyNetwork(), { ...fat, id: 'FAT-01' }, ctx);
    if (!created.ok) throw new Error(created.error.message);
    const network = { ...data, equipment: data.equipment.map((e) => (e.id === 'FAT-01' ? created.value : e)) };
    const portId = created.value.logicalPorts![2].id;

    const result = updateEquipmentPort(network, 'FAT-01', portId, { status: 'Used' });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.logicalPorts!.find((p) => p.id === portId)?.status).toBe('Used');
    expect(result.value.usedPorts).toBe(1);
    expect(result.value.availablePorts).toBe(result.value.totalPorts! - 1);
  });

  it('rejects an unknown port', () => {
    expect(updateEquipmentPort(smallNetwork(), 'FAT-01', 'missing', {})).toMatchObject({
      ok: false,
      error: { title: 'Port Missing' },
    });
  });

  it('adds a photo with defaults and supports annotations', () => {
    const data = smallNetwork();
    const photo = addEquipmentPhoto(data, 'FAT-01', { url: 'data:image/png;base64,AA' }, ctx);
    if (!photo.ok) throw new Error(photo.error.message);
    expect(photo.value).toMatchObject({ uploadedBy: 'Planner User', uploadDate: '2026-11-04', equipmentId: 'FAT-01' });

    const withPhoto = applyPatch(data, photo.patch);
    const annotation = { id: 'A1', x: 10, y: 20, label: 'Port 1', type: 'port_circle' as const };
    const saved = saveImageAnnotation(withPhoto, 'FAT-01', photo.value.id, annotation);
    if (!saved.ok) throw new Error(saved.error.message);
    const annotated = applyPatch(withPhoto, saved.patch);
    expect(annotated.equipment.find((e) => e.id === 'FAT-01')!.images[0].annotations).toHaveLength(1);

    const removed = deleteImageAnnotation(annotated, 'FAT-01', photo.value.id, 'A1');
    if (!removed.ok) throw new Error(removed.error.message);
    expect(
      applyPatch(annotated, removed.patch).equipment.find((e) => e.id === 'FAT-01')!.images[0].annotations,
    ).toEqual([]);
  });

  it('rejects a photo without data', () => {
    expect(addEquipmentPhoto(smallNetwork(), 'FAT-01', {}, ctx)).toMatchObject({
      ok: false,
      error: { title: 'Upload Failed' },
    });
  });
});
