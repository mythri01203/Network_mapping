import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { preferenceKey, preferenceStorage } from '../../stores/persistStorage';

/**
 * The welcome lesson's state on this device (learning assistant, Stage 2): shown once at first
 * open, then only when someone asks for it (Help, "Learn FiberGIS"). Holds no network or customer
 * data.
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
    }),
    {
      name: preferenceKey('learning'),
      storage: preferenceStorage,
      partialize: ({ welcomeSeen, welcomeStep }) => ({ welcomeSeen, welcomeStep }),
    },
  ),
);
