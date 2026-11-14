import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { GuideTourId } from '@fibergis/shared';

import { preferenceKey, preferenceStorage } from '../../stores/persistStorage';
import type { GuideCtx } from './guideTours';

/**
 * The welcome lesson's state on this device (learning assistant, Stage 2): shown once at first
 * open, then only when someone asks for it (Help, "Learn FiberGIS"); and where an on-screen guide
 * stopped. Holds no network or customer data, only the record ids the mapping guide must recognise.
 */
interface LearnState {
  /** The welcome was finished or skipped on this device. */
  welcomeSeen: boolean;
  welcomeOpen: boolean;
  /** Step shown, so a reload continues where it was. */
  welcomeStep: number;
  openWelcome: () => void;
  closeWelcome: () => void;
  setWelcomeStep: (step: number) => void;
  /** The on-screen guide: the choice of guides, one guide, or closed. */
  tour: GuideTourId | 'choose' | null;
  tourStep: number;
  /** The step was reached with Back: say it again before moving on. */
  tourReplay: boolean;
  /** Mapping guide: what was on the map at the start, and what the person has made since. */
  tourCtx: GuideCtx | null;
  /** Where a guide stopped, kept on this device so it can be resumed after closing or a reload. */
  tourSaved: { tour: GuideTourId; step: number; ctx: GuideCtx | null } | null;
  /** Starts a guide from the beginning (`ctx` for the mapping guide), or opens the choice. */
  openTour: (tour: GuideTourId | 'choose', ctx?: GuideCtx | null) => void;
  /** Opens the guide that was stopped, where it stopped. */
  resumeTour: () => void;
  /** Closes the guide; its place is kept unless it was finished. */
  closeTour: (finished?: boolean) => void;
  setTourStep: (step: number, replay?: boolean) => void;
  setTourCtx: (ctx: GuideCtx) => void;
}

export const useLearnStore = create<LearnState>()(
  persist(
    (set) => ({
      welcomeSeen: false,
      welcomeOpen: false,
      welcomeStep: 0,
      openWelcome: () => set({ welcomeOpen: true, welcomeStep: 0 }),
      closeWelcome: () => set({ welcomeOpen: false, welcomeSeen: true }),
      setWelcomeStep: (welcomeStep) => set({ welcomeStep }),
      tour: null,
      tourStep: 0,
      tourReplay: false,
      tourCtx: null,
      tourSaved: null,
      openTour: (tour, ctx = null) =>
        set(
          tour === 'choose'
            ? { tour }
            : { tour, tourStep: 0, tourReplay: false, tourCtx: ctx, tourSaved: { tour, step: 0, ctx } },
        ),
      resumeTour: () =>
        set((s) =>
          s.tourSaved
            ? { tour: s.tourSaved.tour, tourStep: s.tourSaved.step, tourReplay: false, tourCtx: s.tourSaved.ctx }
            : { tour: 'choose' },
        ),
      closeTour: (finished = false) =>
        set((s) => ({ tour: null, tourReplay: false, tourSaved: finished ? null : s.tourSaved })),
      setTourStep: (tourStep, replay = false) =>
        set((s) => ({
          tourStep,
          tourReplay: replay,
          tourSaved: s.tour && s.tour !== 'choose' ? { tour: s.tour, step: tourStep, ctx: s.tourCtx } : s.tourSaved,
        })),
      setTourCtx: (tourCtx) =>
        set((s) => ({ tourCtx, tourSaved: s.tourSaved ? { ...s.tourSaved, ctx: tourCtx } : s.tourSaved })),
    }),
    {
      name: preferenceKey('learning'),
      storage: preferenceStorage,
      partialize: ({ welcomeSeen, welcomeStep, tourSaved }) => ({ welcomeSeen, welcomeStep, tourSaved }),
    },
  ),
);
