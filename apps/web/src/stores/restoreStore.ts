import { create } from 'zustand';

import type { RestoreRule } from '@fibergis/shared';

/** What the server said when it refused a restore (Phase 9): the checks that failed, by id. */
export interface RestoreRefusal {
  message: string;
  total: number;
  counts: Partial<Record<RestoreRule, number>>;
  problems: { rule: RestoreRule; message: string; refs: string[] }[];
  /** Sends the same backup again with "restore anyway". */
  retryAccepting: () => Promise<boolean>;
}

interface RestoreState {
  refusal: RestoreRefusal | null;
  /** The last restore that went through, for the plain report on the backup screen. */
  lastResult: { restored: string[]; safetyCopy?: string; photosAdded?: number; photosSkipped?: number; acceptedProblems?: number } | null;
  setRefusal: (refusal: RestoreRefusal | null) => void;
  setLastResult: (result: RestoreState['lastResult']) => void;
}

export const useRestoreStore = create<RestoreState>()((set) => ({
  refusal: null,
  lastResult: null,
  setRefusal: (refusal) => set({ refusal }),
  setLastResult: (lastResult) => set({ lastResult }),
}));
