import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The marker icons module loads Leaflet, which needs a browser window; nothing here draws a pin.
vi.mock('leaflet', () => ({ default: {} }));

import { duplicateTemplate, type Equipment, pointsAlongLine } from '@fibergis/shared';

import { useConfirmStore } from '../../stores/confirmStore';
import { useMapStore } from '../../stores/mapStore';
import { useNetworkStore } from '../../stores/networkStore';
import { useUiStore } from '../../stores/uiStore';
import { draftFor, placeAlongLine, placeAtStructure, placeAtTyped, previewNames, structuresNear } from './placementModes';

const pristine = useNetworkStore.getState();
const poleChoice = { type: 'Telecom Pole' as const, template: { category: 'Supporting Infrastructure' as const } };
const fatChoice = { type: 'FAT' as const, template: { category: 'Fiber Distribution' as const, totalPorts: 8, availablePorts: 8 } };

const item = (overrides: Partial<Equipment> & Pick<Equipment, 'id' | 'type'>): Equipment => ({
  name: overrides.id,
  category: 'Supporting Infrastructure',
  lat: 12.96,
  lng: 77.62,
  area: '',
  street: '',
  status: 'Active',
  images: [],
  installedDate: '',
  ...overrides,
});

beforeEach(() => {
  localStorage.clear();
  useNetworkStore.setState(pristine, true);
  useUiStore.setState({ selectedObject: null });
  useConfirmStore.setState({ pending: null });
});

afterEach(() => useConfirmStore.setState({ pending: null }));

async function answer(addNew: boolean) {
  for (let i = 0; i < 50 && !useConfirmStore.getState().pending; i += 1) await Promise.resolve();
  const pending = useConfirmStore.getState().pending;
  useConfirmStore.getState().respond(addNew);
  return pending;
}

describe('names and drafts', () => {
  it('previews one sequential name per new item', () => {
    const existing = [item({ id: 'P-A', type: 'Telecom Pole', name: 'Pole-07' })];
    expect(previewNames(poleChoice, 3, existing)).toEqual(['Pole-08', 'Pole-09', 'Pole-10']);
    expect(previewNames(fatChoice, 2, [item({ id: 'F-A', type: 'FAT', name: 'FAT-03' })])).toEqual(['FAT-04', 'FAT-05']);
  });

  it('builds a draft with the method used and nothing made up', () => {
    const draft = draftFor(fatChoice, [12.97, 77.59], 'typed', []);
    expect(draft).toMatchObject({ type: 'FAT', lat: 12.97, lng: 77.59, locationMethod: 'typed', totalPorts: 8 });
    expect(draft).not.toHaveProperty('locationAccuracyMeters');
    expect(draft).not.toHaveProperty('serialNumber');
    expect(draft).not.toHaveProperty('installedDate');
  });

  it('a copy keeps its own name and never the serial or tag', () => {
    const source = item({ id: 'F-A', type: 'FAT', name: 'FAT-03', serialNumber: 'SN-1', tagCode: 'T-1', manufacturer: 'Acme', totalPorts: 8, usedPorts: 5 });
    const draft = draftFor({ type: 'FAT', template: duplicateTemplate(source) }, [12.97, 77.59], 'map_pick', [source]);
    expect(draft).toMatchObject({ name: 'FAT-04', manufacturer: 'Acme', usedPorts: 0, availablePorts: 8 });
    expect(draft).not.toHaveProperty('serialNumber');
    expect(draft).not.toHaveProperty('tagCode');
  });
});

describe('picking a structure', () => {
  it('lists only poles and chambers with a confirmed position, nearest first', () => {
    const list = structuresNear(
      [
        item({ id: 'FAR', type: 'Telecom Pole', lat: 12.97 }),
        item({ id: 'NEAR', type: 'Manhole', lat: 12.9601 }),
        item({ id: 'BOX', type: 'FAT', lat: 12.96 }),
        item({ id: 'UNPLACED', type: 'Telecom Pole', officeMustPlace: true }),
        item({ id: 'ZERO', type: 'Telecom Pole', lat: 0, lng: 0 }),
      ],
      [12.96, 77.62],
    );
    expect(list.map((r) => r.equipment.id)).toEqual(['NEAR', 'FAR']);
    expect(structuresNear([item({ id: 'P1', type: 'Telecom Pole', poleNumber: 'BESCOM-44' })], [12.96, 77.62], 'bescom')).toHaveLength(1);
  });
});

describe('placing through the store', () => {
  it('typed coordinates are saved as "Typed" with no accuracy', async () => {
    const created = await placeAtTyped(fatChoice, [12.951, 77.611]);
    expect(created).toMatchObject({ lat: 12.951, lng: 77.611, locationMethod: 'typed' });
    expect(created?.locationAccuracyMeters).toBeUndefined();
    expect(useMapStore.getState().activeTool).toBe('select');
  });

  it('at a structure takes its exact position and how it was found, and links nothing', async () => {
    const pole = item({ id: 'POLE-X', type: 'Telecom Pole', name: 'Pole-77', lat: 12.952, lng: 77.612, locationMethod: 'gps_averaged', locationAccuracyMeters: 4 });
    useNetworkStore.setState({ equipment: [...useNetworkStore.getState().equipment, pole] });
    const created = await placeAtStructure(fatChoice, pole);
    expect(created).toMatchObject({ lat: 12.952, lng: 77.612, locationMethod: 'gps_averaged', locationAccuracyMeters: 4 });
    expect(created?.poleNumber).toBeUndefined();
    expect(useNetworkStore.getState().auditLogs.some((l) => l.action === 'PLACED_AT_STRUCTURE' && l.assetId === created?.id)).toBe(true);
  });

  it('along a line, places each in turn through "same one?" with its own next name', async () => {
    const existing = item({ id: 'POLE-OLD', type: 'Telecom Pole', name: 'Pole-50', lat: 12.94, lng: 77.6 });
    useNetworkStore.setState({ equipment: [...useNetworkStore.getState().equipment, existing] });
    // Starts on the existing pole, then every 40 m north.
    const plan = pointsAlongLine([[12.94, 77.6], [12.941, 77.6]], 40, false);
    expect(plan.points).toHaveLength(3);
    const run = placeAlongLine(poleChoice, plan.points, 40, plan.lengthMeters);
    const question = await answer(false); // "Same one: show it" for the first point
    expect(question?.title).toBe('Is this the same one?');
    const result = await run;
    expect(result.sameOne).toBe(1);
    expect(result.created.map((e) => e.name)).toEqual(['Pole-51', 'Pole-52']);
    expect(result.created.every((e) => e.locationMethod === 'map_pick')).toBe(true);
    expect(useNetworkStore.getState().auditLogs.some((l) => l.action === 'PLACED_ALONG_LINE')).toBe(true);
  });
});
