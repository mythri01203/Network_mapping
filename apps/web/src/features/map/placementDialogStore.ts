import { create } from 'zustand';

import type { LatLng } from '@fibergis/shared';

/** Phase 3: the "other ways to place" dialog that is open, if any. */
export type PlacementDialog =
  | { kind: 'typed' }
  | { kind: 'structure'; structureId?: string }
  | { kind: 'line'; points: LatLng[] }
  | null;

/** Opened from the placing bar on the map and from the inspector's Tools. */
export const usePlacementDialog = create<{
  dialog: PlacementDialog;
  open: (dialog: Exclude<PlacementDialog, null>) => void;
  close: () => void;
}>()((set) => ({
  dialog: null,
  open: (dialog) => set({ dialog }),
  close: () => set({ dialog: null }),
}));
