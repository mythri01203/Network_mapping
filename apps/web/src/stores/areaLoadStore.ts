import { create } from 'zustand';

/**
 * Phase 24b: what this device holds of the network, for the screens that must not show a record as
 * missing when it is only not loaded. Written only by the sync engine.
 *
 * - `whole`: the whole network is here (small networks, or the person chose it).
 * - `area`: only the map areas looked at, plus every record those point to, plus every collection
 *   that is not loaded by area. Lists, counts, checks and reports may be missing records.
 */
export type LoadMode = 'whole' | 'area';

export interface AreaLoadState {
  mode: LoadMode;
  /** Map areas loaded since the last full reload. */
  areas: number;
  /** The last area had more records than one answer may carry: some in it are not loaded yet. */
  truncated: boolean;
  /** The view is wider than what is loaded at once: only its middle is loaded. */
  wide: boolean;
  /** A map area is being loaded now. */
  loading: boolean;
  /** Records the server holds in the collections loaded by area (from its counts), and how many are here. */
  serverRecords: number | null;
  loadedRecords: number;
}

export const initialAreaLoadState: AreaLoadState = { mode: 'whole', areas: 0, truncated: false, wide: false, loading: false, serverRecords: null, loadedRecords: 0 };

export const useAreaLoadStore = create<AreaLoadState>()(() => initialAreaLoadState);

/** True when this device may not hold every record (anything "not found" may be outside the loaded area). */
export const isPartlyLoaded = (): boolean => useAreaLoadStore.getState().mode === 'area';
