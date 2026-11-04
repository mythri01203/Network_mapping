import { type StateStorage, createJSONStorage } from 'zustand/middleware';
import { browserStorage, storageKey } from '../lib/storage';

const noopStorage: StateStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

/** JSON storage for `persist` middleware that degrades to in-memory when localStorage is unavailable. */
export const preferenceStorage = createJSONStorage(() => browserStorage() ?? noopStorage);

/** Namespaced key for a persisted preference slice. */
export const preferenceKey = (name: string) => storageKey(`${name}_prefs`);
