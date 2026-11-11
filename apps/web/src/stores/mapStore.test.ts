import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadStore = async () => (await import('./mapStore')).useMapStore;

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

describe('mapStore', () => {
  it('merges saved layer preferences over the defaults', async () => {
    localStorage.setItem(
      'fiber_gis_map_prefs',
      JSON.stringify({
        state: { layers: { olt: false }, layerOpacity: { poles: 0.2 }, tileProvider: 'osm' },
        version: 1,
      }),
    );
    const { DEFAULT_LAYERS, DEFAULT_LAYER_OPACITY } = await import('./mapStore');
    const state = (await loadStore()).getState();

    expect(state.tileProvider).toBe('osm');
    expect(state.layers).toEqual({ ...DEFAULT_LAYERS, olt: false });
    expect(state.layerOpacity).toEqual({ ...DEFAULT_LAYER_OPACITY, poles: 0.2 });
  });

  it('clamps opacity and re-centres on every flyTo', async () => {
    const store = await loadStore();
    store.getState().setLayerOpacity('olt', 4);
    expect(store.getState().layerOpacity.olt).toBe(1);

    store.getState().flyTo(1, 2);
    const first = store.getState().flyToTarget;
    store.getState().flyTo(1, 2);
    expect(store.getState().flyToTarget).toEqual({ lat: 1, lng: 2, zoom: 17 });
    expect(store.getState().flyToTarget).not.toBe(first);
  });

  it('consumes fly targets and keeps the viewport out of persisted prefs', async () => {
    const { DEFAULT_VIEWPORT } = await import('./mapStore');
    const store = await loadStore();
    expect(store.getState().viewport).toEqual(DEFAULT_VIEWPORT);

    store.getState().flyTo(1, 2, 15);
    store.getState().clearFlyTo();
    expect(store.getState().flyToTarget).toBeNull();

    store.getState().setViewport({ lat: 3, lng: 4, zoom: 11 });
    expect(store.getState().viewport).toEqual({ lat: 3, lng: 4, zoom: 11 });
    expect(localStorage.getItem('fiber_gis_map_prefs') ?? '').not.toContain('viewport');
  });

  it('applies updater functions to sketch points and clears them together', async () => {
    const store = await loadStore();
    store.getState().setDrawingPoints([[1, 1]]);
    store.getState().setDrawingPoints((prev) => [...prev, [2, 2]]);
    store.getState().setMeasuringPoints([[3, 3]]);
    expect(store.getState().drawingPoints).toEqual([
      [1, 1],
      [2, 2],
    ]);
    store.getState().resetSketches();
    expect(store.getState().drawingPoints).toEqual([]);
    expect(store.getState().measuringPoints).toEqual([]);
  });
});

describe('layer settings and saved views (Phase 1)', () => {
  it('moves an equipment layer up and down, and keeps new layers in the saved order', async () => {
    localStorage.setItem('fiber_gis_map_prefs', JSON.stringify({ state: { equipmentOrder: ['poles', 'olt'] }, version: 1 }));
    const { DEFAULT_EQUIPMENT_ORDER } = await import('./mapStore');
    const store = await loadStore();
    const order = store.getState().equipmentOrder;
    expect(order.slice(0, 2)).toEqual(['poles', 'olt']);
    expect([...order].sort()).toEqual([...DEFAULT_EQUIPMENT_ORDER].sort());
    store.getState().moveEquipmentLayer('olt', -1);
    expect(store.getState().equipmentOrder.slice(0, 2)).toEqual(['olt', 'poles']);
    store.getState().moveEquipmentLayer('olt', -1);
    expect(store.getState().equipmentOrder[0]).toBe('olt');
  });

  it('sets and clears a layer zoom, and applies a saved view with its place', async () => {
    const store = await loadStore();
    store.getState().setLayerMinZoom('poles', 16);
    expect(store.getState().layerMinZoom).toEqual({ poles: 16, spans: 17 });
    // Poles and spans start from street zoom; "always" is kept as 0 so the default does not return.
    store.getState().setLayerMinZoom('poles', null);
    expect(store.getState().layerMinZoom).toEqual({ poles: 0, spans: 17 });
    store.getState().setLayerMinZoom('fat', 15);
    store.getState().setLayerMinZoom('fat', null);
    expect(store.getState().layerMinZoom).toEqual({ poles: 0, spans: 17 });
    const s = store.getState();
    store.getState().saveView({
      id: 'VIEW-1',
      name: 'Ward 12',
      ownerId: 'u1',
      createdAt: '2026-11-10T00:00:00.000Z',
      viewport: { lat: 12.9, lng: 77.6, zoom: 15 },
      layers: { ...s.layers, poles: false },
      layerOpacity: s.layerOpacity,
      layerMinZoom: { fat: 15 },
      layerLabels: s.layerLabels,
      labelMinZoom: 18,
      equipmentOrder: s.equipmentOrder,
    });
    store.getState().applyView(store.getState().savedViews[0]);
    const after = store.getState();
    expect(after.layers.poles).toBe(false);
    expect(after.layerMinZoom).toEqual({ fat: 15 });
    expect(after.labelMinZoom).toBe(18);
    expect(after.flyToTarget).toEqual({ lat: 12.9, lng: 77.6, zoom: 15 });
  });

  it('draws a zone boundary as its own kind of line, forgotten when the tool changes', async () => {
    const store = await loadStore();
    store.getState().startZoneBoundary('ZONE-1');
    expect(store.getState()).toMatchObject({ activeTool: 'draw_cable', drawTarget: 'zone', zoneDrawId: 'ZONE-1' });
    store.getState().setActiveTool('select');
    expect(store.getState()).toMatchObject({ drawTarget: 'cable', zoneDrawId: null });
  });
});
