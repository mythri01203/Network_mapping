import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { type FilterCondition, isFilterCondition } from '@fibergis/shared';

import { preferenceKey, preferenceStorage } from './persistStorage';

/**
 * Phase 16: recent searches and saved filters, kept on this device only, per person (`ownerId`:
 * the account id, '' while login is off). Another person on the same device never sees them.
 */

export interface RecentSearch {
  ownerId: string;
  query: string;
  at: string;
}

export interface SavedFilter {
  id: string;
  name: string;
  ownerId: string;
  layerId: string;
  conditions: FilterCondition[];
  createdAt: string;
}

export const MAX_RECENT_SEARCHES = 10;
export const MAX_SAVED_FILTERS = 40;

interface SearchState {
  recent: RecentSearch[];
  savedFilters: SavedFilter[];
  remember: (ownerId: string, query: string) => void;
  forgetRecent: (ownerId: string) => void;
  saveFilter: (filter: SavedFilter) => void;
  deleteFilter: (id: string) => void;
}

export const useSearchStore = create<SearchState>()(
  persist(
    (set) => ({
      recent: [],
      savedFilters: [],
      remember: (ownerId, query) => {
        const q = query.trim().slice(0, 200);
        if (q.length < 2) return;
        set((s) => {
          const mine = s.recent.filter((r) => r.ownerId === ownerId && r.query.toLowerCase() !== q.toLowerCase());
          const others = s.recent.filter((r) => r.ownerId !== ownerId);
          return { recent: [{ ownerId, query: q, at: new Date().toISOString() }, ...mine].slice(0, MAX_RECENT_SEARCHES).concat(others) };
        });
      },
      forgetRecent: (ownerId) => set((s) => ({ recent: s.recent.filter((r) => r.ownerId !== ownerId) })),
      saveFilter: (filter) => set((s) => ({ savedFilters: [filter, ...s.savedFilters.filter((f) => f.id !== filter.id)].slice(0, MAX_SAVED_FILTERS) })),
      deleteFilter: (id) => set((s) => ({ savedFilters: s.savedFilters.filter((f) => f.id !== id) })),
    }),
    {
      name: preferenceKey('search'),
      storage: preferenceStorage,
      version: 1,
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<Pick<SearchState, 'recent' | 'savedFilters'>>;
        const recent = Array.isArray(saved.recent) ? saved.recent.filter((r) => r && typeof r.query === 'string' && typeof r.ownerId === 'string') : [];
        const savedFilters = Array.isArray(saved.savedFilters)
          ? saved.savedFilters.filter((f) => f && typeof f.id === 'string' && typeof f.name === 'string' && typeof f.layerId === 'string' && Array.isArray(f.conditions) && f.conditions.every(isFilterCondition))
          : [];
        return { ...current, recent, savedFilters };
      },
      partialize: ({ recent, savedFilters }) => ({ recent, savedFilters }),
    },
  ),
);
