import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { LatLng } from '@fibergis/shared';

import type { SelectionKey } from '../features/selection/selectionModel';
import { preferenceKey, preferenceStorage } from './persistStorage';

/**
 * Phase 16: the map's selection set (many records at once), the ways of choosing them on the map,
 * named selections kept on this device, and requests to open the attribute table. The inspector's
 * single selection stays in `uiStore` (`selectedObject`): it is the one item whose details show.
 */

/** Ways to choose records by drawing on the map. `polygon` (tap the corners) works on every device. */
export type AreaTool = 'box' | 'lasso' | 'polygon';

export interface SavedSelection {
  id: string;
  name: string;
  /** The account that saved it ('' while login is off). Others on this device do not see it. */
  ownerId: string;
  createdAt: string;
  keys: SelectionKey[];
}

/** The right-click (or "More") menu: which record, and where to show it. */
export interface ContextMenuState {
  key: SelectionKey | null;
  x: number;
  y: number;
  /** Opened from a button (phones): shown as a sheet instead of at the pointer. */
  sheet?: boolean;
}

export interface TableRequest {
  layerId?: string;
  onlySelected?: boolean;
  /** Opens the filter builder too. */
  filters?: boolean;
  /** A fresh number each time, so the same request twice still opens the table. */
  at: number;
}

export type SelectionDialog = 'attribute' | 'zone' | 'saved';

/** The most a selection holds, and the most kept in one saved selection. */
export const MAX_SELECTION = 100_000;
export const MAX_SAVED_SELECTIONS = 30;

export interface SelectionState {
  keys: ReadonlySet<SelectionKey>;
  /** "Select several": a tap adds or removes an item instead of opening it (phones). */
  multiMode: boolean;
  areaTool: AreaTool | null;
  /** Corners tapped so far with the polygon tool. */
  areaPoints: LatLng[];
  menu: ContextMenuState | null;
  tableRequest: TableRequest | null;
  /** The attribute table is shown tall (desktop). */
  tableTall: boolean;
  /** Which selection dialog is open. */
  dialog: SelectionDialog | null;
  savedSelections: SavedSelection[];

  setDialog: (dialog: SelectionDialog | null) => void;

  /** Replaces the selection, or adds to it, takes away from it. */
  setKeys: (keys: Iterable<SelectionKey>, mode?: 'replace' | 'add' | 'remove') => void;
  toggle: (key: SelectionKey) => void;
  clear: () => void;
  setMultiMode: (on: boolean) => void;
  setAreaTool: (tool: AreaTool | null) => void;
  setAreaPoints: (points: LatLng[] | ((prev: LatLng[]) => LatLng[])) => void;
  openMenu: (menu: ContextMenuState) => void;
  closeMenu: () => void;
  openTable: (request?: Omit<TableRequest, 'at'>) => void;
  setTableTall: (tall: boolean) => void;
  saveSelection: (selection: SavedSelection) => void;
  deleteSelection: (id: string) => void;
}

const EMPTY: ReadonlySet<SelectionKey> = new Set();

export const useSelectionStore = create<SelectionState>()(
  persist(
    (set) => ({
      keys: EMPTY,
      multiMode: false,
      areaTool: null,
      areaPoints: [],
      menu: null,
      tableRequest: null,
      tableTall: false,
      dialog: null,
      savedSelections: [],

      setDialog: (dialog) => set({ dialog, menu: null }),
      setKeys: (keys, mode = 'replace') =>
        set((s) => {
          if (mode === 'replace') {
            const next = new Set<SelectionKey>();
            for (const k of keys) {
              if (next.size >= MAX_SELECTION) break;
              next.add(k);
            }
            return { keys: next.size === 0 ? EMPTY : next };
          }
          const next = new Set(s.keys);
          for (const k of keys) {
            if (mode === 'add') {
              if (next.size >= MAX_SELECTION) break;
              next.add(k);
            } else next.delete(k);
          }
          return { keys: next.size === 0 ? EMPTY : next };
        }),
      toggle: (key) =>
        set((s) => {
          const next = new Set(s.keys);
          if (next.has(key)) next.delete(key);
          else if (next.size < MAX_SELECTION) next.add(key);
          return { keys: next.size === 0 ? EMPTY : next };
        }),
      clear: () => set((s) => (s.keys.size === 0 ? s : { keys: EMPTY })),
      setMultiMode: (multiMode) => set({ multiMode, ...(multiMode ? { areaTool: null, areaPoints: [] } : {}) }),
      setAreaTool: (areaTool) => set({ areaTool, areaPoints: [], ...(areaTool ? { multiMode: false } : {}) }),
      setAreaPoints: (points) => set((s) => ({ areaPoints: typeof points === 'function' ? points(s.areaPoints) : points })),
      openMenu: (menu) => set({ menu }),
      closeMenu: () => set((s) => (s.menu ? { menu: null } : s)),
      openTable: (request = {}) => set({ tableRequest: { ...request, at: Date.now() + Math.random() } }),
      setTableTall: (tableTall) => set({ tableTall }),
      saveSelection: (selection) =>
        set((s) => ({
          savedSelections: [selection, ...s.savedSelections.filter((x) => x.id !== selection.id)].slice(0, MAX_SAVED_SELECTIONS),
        })),
      deleteSelection: (id) => set((s) => ({ savedSelections: s.savedSelections.filter((x) => x.id !== id) })),
    }),
    {
      name: preferenceKey('selection'),
      storage: preferenceStorage,
      version: 1,
      partialize: ({ savedSelections, tableTall }) => ({ savedSelections, tableTall }),
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<Pick<SelectionState, 'savedSelections' | 'tableTall'>>;
        const list = Array.isArray(saved.savedSelections)
          ? saved.savedSelections.filter((s) => s && typeof s.id === 'string' && typeof s.name === 'string' && Array.isArray(s.keys))
          : [];
        return { ...current, savedSelections: list, tableTall: saved.tableTall === true };
      },
    },
  ),
);

/** The current selection as a plain list (for saving or sending). */
export const selectedKeyList = (): SelectionKey[] => [...useSelectionStore.getState().keys];
