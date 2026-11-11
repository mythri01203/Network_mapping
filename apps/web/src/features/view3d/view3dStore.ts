import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { preferenceKey, preferenceStorage } from '../../stores/persistStorage';
import type { Lang3D } from './i18n';

/** The 3D view's own preferences, remembered per device. Network data stays in the network store. */

export type ThemeChoice = 'auto' | 'light' | 'dark';
/** Where local metres start: the first OLT, the project start point, or the middle of everything. */
export type OriginChoice = 'olt' | 'start' | 'middle';
/** What lies under the network: the 2D map's street tiles, the satellite picture, or plain grass. */
export type GroundChoice = 'map' | 'satellite' | 'plain';

interface View3DState {
  labels: boolean;
  pulses: boolean;
  lang: Lang3D | null;
  theme: ThemeChoice;
  tourDone: boolean;
  origin: OriginChoice;
  ground: GroundChoice;
  /** Showing the built-in demo network instead of the person's own. Not remembered. */
  demo: boolean;
  set: (patch: Partial<Omit<View3DState, 'set'>>) => void;
}

export const useView3DStore = create<View3DState>()(
  persist(
    (set) => ({
      labels: true,
      pulses: true,
      lang: null,
      theme: 'auto',
      tourDone: false,
      origin: 'olt',
      ground: 'satellite',
      demo: false,
      set: (patch) => set(patch),
    }),
    {
      name: preferenceKey('view3d'),
      storage: preferenceStorage,
      version: 1,
      // v1: the ground starts as the satellite picture.
      migrate: (state) => ({ ...(state as object), ground: 'satellite' }) as View3DState,
      partialize: ({ labels, pulses, lang, theme, tourDone, origin, ground }) => ({
        labels,
        pulses,
        lang,
        theme,
        tourDone,
        origin,
        ground,
      }),
    },
  ),
);
