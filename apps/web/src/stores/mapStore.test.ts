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
