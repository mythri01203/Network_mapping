import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { PonKey } from '@fibergis/shared';

import { preferenceKey, preferenceStorage } from '../../../stores/persistStorage';

export type CableColorBy = 'pon' | 'type';

interface PonMapState {
  /** One PON lit up on the map; the rest are dimmed. */
  focus: PonKey | null;
  /** Moving light along fibers that carry a PON. Off when the device asks for less motion. */
  lightFlow: boolean;
  colorBy: CableColorBy;
  /** Show PON, splitter and power labels on cables and boxes when zoomed in. */
  identifiers: boolean;
  panelOpen: boolean;
  setFocus: (focus: PonKey | null) => void;
  setLightFlow: (on: boolean) => void;
  setColorBy: (by: CableColorBy) => void;
  setIdentifiers: (on: boolean) => void;
  setPanelOpen: (open: boolean) => void;
}

export const usePonMapStore = create<PonMapState>()(
  persist(
    (set) => ({
      focus: null,
      lightFlow: true,
      colorBy: 'pon',
      identifiers: true,
      panelOpen: true,
      setFocus: (focus) => set({ focus }),
      setLightFlow: (lightFlow) => set({ lightFlow }),
      setColorBy: (colorBy) => set({ colorBy }),
      setIdentifiers: (identifiers) => set({ identifiers }),
      setPanelOpen: (panelOpen) => set({ panelOpen }),
    }),
    {
      name: preferenceKey('pon-map'),
      storage: preferenceStorage,
      version: 1,
      partialize: ({ lightFlow, colorBy, identifiers, panelOpen }) => ({ lightFlow, colorBy, identifiers, panelOpen }),
    },
  ),
);

/** True when the person's device asks for less motion. */
export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
