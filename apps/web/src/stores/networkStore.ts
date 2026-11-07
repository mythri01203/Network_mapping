import { create } from 'zustand';

import {
  type AgentTrip,
  applyPatch,
  type AuditEntry,
  type AuditLog,
  type CatalogComponent,
  COLLECTION_NAMES,
  type CollectionName,
  type CommandContext,
  type CommandResult,
  type CommandSuccess,
  formatLogTimestamp,
  type GpsRoute,
  isLatLngPair,
  type LatLng,
  type NetworkData,
  type NetworkPatch,
  type NetworkSnapshot,
  type OpticalSettings,
  resolveOpticalSettings,
  type Setting,
  uniqueId,
  type UserRole,
} from '@fibergis/shared';
import { createSampleNetwork } from '@fibergis/shared/sample';

import { browserStorage, readJson, removeKeys, storageKey, writeJson } from '../lib/storage';
import { requestConfirm } from './confirmStore';
import { showToast } from './toastStore';
import { useTraceStore } from './traceStore';
import { type SelectedObject, type SelectedObjectType, useUiStore } from './uiStore';

/**
 * Bump whenever the bundled sample network changes shape so stale browser data
 * (which would otherwise shadow the fixed seed forever) is discarded once.
 */
const DATA_VERSION = '3';
const DATA_VERSION_KEY = 'data_version';
const PROJECT_START_KEY = 'project_start';
/** Server sync bookkeeping (last revision, unsent ids); it describes the cached collections below. */
export const SYNC_META_STORAGE_KEY = 'sync';
/** localStorage keys predate the shared collection names, so they are mapped explicitly. */
const COLLECTION_STORAGE_KEYS: Record<CollectionName, string> = {
  equipment: 'equipment',
  cables: 'cables',
  splitters: 'splitters',
  closures: 'closures',
  customers: 'customers',
  faults: 'faults',
  workOrders: 'work_orders',
  auditLogs: 'audit_logs',
  zones: 'zones',
  documents: 'documents',
  catalog: 'custom_components',
  gpsRoutes: 'gps_routes',
  agentTrips: 'agent_trips',
  settings: 'settings',
};

export const MAX_AUDIT_LOGS = 500;
export const MAX_HISTORY = 50;

/** The collections domain commands may change; these are what undo/redo restores. */
const DATA_KEYS = [
  'equipment',
  'cables',
  'splitters',
  'closures',
  'customers',
  'faults',
  'workOrders',
  'zones',
  'documents',
] as const satisfies readonly (keyof NetworkData)[];

const SELECTION_COLLECTION: Record<SelectedObjectType, keyof NetworkData> = {
  equipment: 'equipment',
  cable: 'cables',
  customer: 'customers',
  closure: 'closures',
  fault: 'faults',
};

export type Command<T> = (data: NetworkData, ctx: CommandContext) => CommandResult<T>;

export interface CommandOptions {
  /** Apply without a notice toast or audit entries (e.g. continuous drags). */
  silent?: boolean;
  /** The caller already confirmed with the user. */
  skipConfirm?: boolean;
  /** Title and button label for the confirmation dialog, when the command asks for one. */
  confirmTitle?: string;
  confirmLabel?: string;
}

export interface History {
  stack: NetworkData[];
  index: number;
}

export interface NetworkState extends NetworkSnapshot {
  projectStartPoint: LatLng | null;
  history: History;

  /**
   * Runs a domain command against the latest network: failures surface as a toast, and successes patch
   * state, notify the user, and extend the audit trail. A command that needs confirmation returns `null`
   * here and is re-run once the user accepts the dialog; use `runConfirmedCommand` to await that outcome.
   */
  runCommand: <T>(command: Command<T>, options?: CommandOptions) => CommandSuccess<T> | null;
  /** Like `runCommand`, but resolves after any confirmation dialog with the applied result (or `null`). */
  runConfirmedCommand: <T>(command: Command<T>, options?: CommandOptions) => Promise<CommandSuccess<T> | null>;
  logAudit: (...entries: AuditEntry[]) => void;
  undo: () => void;
  redo: () => void;
  /** Swaps in whole collections (restore, reset, server load); changed network data starts a fresh undo history. */
  replaceCollections: (collections: Partial<NetworkSnapshot>, projectStartPoint?: LatLng | null) => void;
  setProjectStartPoint: (point: LatLng | null) => void;
  addCatalogComponent: (item: CatalogComponent) => void;
  addGpsRoute: (route: GpsRoute) => void;
  deleteGpsRoute: (id: string) => void;
  /** Inserts or replaces a trip without a toast: active duties save on every location update. */
  saveAgentTrip: (trip: AgentTrip) => void;
  /** Inserts or replaces one operator override. Settings sit outside undo; "Reset" removes them. */
  saveSetting: (setting: Setting) => void;
  deleteSetting: (id: string) => void;
}

const isRecordArray = (value: unknown): boolean =>
  Array.isArray(value) &&
  value.every((item) => item !== null && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string');

const pickData = (state: NetworkData): NetworkData =>
  Object.fromEntries(DATA_KEYS.map((key) => [key, state[key]])) as unknown as NetworkData;

const freshHistory = (state: NetworkData): History => ({ stack: [pickData(state)], index: 0 });

/** Discards browser data written by an incompatible earlier release. */
function ensureStorageVersion(): void {
  const storage = browserStorage();
  try {
    if (!storage || storage.getItem(storageKey(DATA_VERSION_KEY)) === DATA_VERSION) return;
    removeKeys([...Object.values(COLLECTION_STORAGE_KEYS), PROJECT_START_KEY, SYNC_META_STORAGE_KEY]);
    storage.setItem(storageKey(DATA_VERSION_KEY), DATA_VERSION);
  } catch {
    // Storage unavailable: the bundled sample is used in memory.
  }
}

let loadedFromCache = false;

/** Whether the store started from collections cached in this browser rather than the bundled sample. */
export const wasLoadedFromCache = (): boolean => loadedFromCache;

function loadInitialState(): Pick<NetworkState, CollectionName | 'projectStartPoint'> {
  ensureStorageVersion();
  try {
    const storage = browserStorage();
    loadedFromCache = Object.values(COLLECTION_STORAGE_KEYS).some((key) => storage?.getItem(storageKey(key)) != null);
  } catch {
    loadedFromCache = false;
  }
  const sample = createSampleNetwork();
  const collections = Object.fromEntries(
    COLLECTION_NAMES.map((name) => [name, readJson(COLLECTION_STORAGE_KEYS[name], sample[name], isRecordArray)]),
  ) as NetworkSnapshot;
  return { ...collections, projectStartPoint: readJson<LatLng | null>(PROJECT_START_KEY, null, isLatLngPair) };
}

/** Keeps the inspector pointed at the latest version of the selected record, or clears it once deleted. */
function syncSelection(before: NetworkData, after: NetworkData): void {
  const { selectedObject, select } = useUiStore.getState();
  if (!selectedObject) return;
  const key = SELECTION_COLLECTION[selectedObject.type];
  if (before[key] === after[key]) return;
  const id = selectedObject.data.id;
  const match = (after[key] as { id: string }[]).find((item) => item.id === id);
  if (match) {
    if (match !== selectedObject.data) select({ type: selectedObject.type, data: match } as SelectedObject);
    return;
  }
  const existed = (before[key] as { id: string }[]).some((item) => item.id === id);
  if (existed) select(null);
}

const toAuditLog = (entry: AuditEntry, role: UserRole, now: Date): AuditLog => ({
  id: uniqueId('LOG'),
  timestamp: formatLogTimestamp(now),
  user: `${role} (local session)`,
  role,
  ...entry,
});

let opticalCache: { records: readonly Setting[]; merged: OpticalSettings } | null = null;

/** Optical defaults merged with the operator's overrides. Stable until the overrides change. */
export const selectOpticalSettings = (state: Pick<NetworkSnapshot, 'settings'>): OpticalSettings => {
  const records = state.settings ?? [];
  if (opticalCache?.records !== records) opticalCache = { records, merged: resolveOpticalSettings(records) };
  return opticalCache.merged;
};

export const useNetworkStore = create<NetworkState>()((set, get) => {
  const initial = loadInitialState();

  const commit = (patch: NetworkPatch) => {
    const state = get();
    const before = pickData(state);
    if (!DATA_KEYS.some((key) => patch[key] !== undefined && patch[key] !== before[key])) return;
    const after = applyPatch(before, patch);
    const { stack, index } = state.history;
    const nextStack = [...stack.slice(0, index + 1), after].slice(-MAX_HISTORY);
    set({ ...patch, history: { stack: nextStack, index: nextStack.length - 1 } });
    syncSelection(before, after);
  };

  const travel = (index: number) => {
    const state = get();
    const target = state.history.stack[index];
    if (!target) return false;
    const before = pickData(state);
    set({ ...target, history: { ...state.history, index } });
    syncSelection(before, target);
    useTraceStore.getState().clear();
    return true;
  };

  const evaluate = <T>(command: Command<T>): CommandSuccess<T> | null => {
    const state = get();
    const role = useUiStore.getState().userRole;
    const result = command(pickData(state), {
      now: new Date(),
      actor: `${role} User`,
      fallbackLocation: state.projectStartPoint ?? undefined,
      optical: selectOpticalSettings(state),
    });
    if (result.ok) return result;
    showToast(result.error.tone, result.error.title, result.error.message);
    return null;
  };

  const apply = <T>(result: CommandSuccess<T>, options: CommandOptions) => {
    commit(result.patch);
    if (options.silent) return;
    if (result.notice) showToast(result.notice.tone, result.notice.title, result.notice.message);
    get().logAudit(...result.audit);
  };

  return {
    ...initial,
    history: freshHistory(initial),

    runCommand: (command, options = {}) => {
      const result = evaluate(command);
      if (!result) return null;
      if (result.confirm && !options.skipConfirm) {
        void get().runConfirmedCommand(command, options);
        return null;
      }
      apply(result, options);
      return result;
    },

    runConfirmedCommand: async (command, options = {}) => {
      const result = evaluate(command);
      if (!result) return null;
      if (result.confirm && !options.skipConfirm) {
        const confirmed = await requestConfirm({
          title: options.confirmTitle ?? 'Confirm change',
          message: result.confirm,
          confirmLabel: options.confirmLabel ?? 'Confirm',
          tone: 'danger',
        });
        // Re-run against the network as it is now; it may have changed while the dialog was open.
        return confirmed ? get().runCommand(command, { ...options, skipConfirm: true }) : null;
      }
      apply(result, options);
      return result;
    },

    logAudit: (...entries) => {
      if (entries.length === 0) return;
      const role = useUiStore.getState().userRole;
      const now = new Date();
      // Newest first, matching how the audit trail is displayed.
      const logs = entries.map((entry) => toAuditLog(entry, role, now)).reverse();
      set((s) => ({ auditLogs: [...logs, ...s.auditLogs].slice(0, MAX_AUDIT_LOGS) }));
    },

    undo: () => {
      if (travel(get().history.index - 1)) showToast('info', 'Undo Successful', 'Reverted the last network change');
    },

    redo: () => {
      if (travel(get().history.index + 1)) showToast('info', 'Redo Successful', 'Reapplied the network change');
    },

    replaceCollections: (collections, projectStartPoint) => {
      const before = pickData(get());
      set({
        ...collections,
        ...(projectStartPoint !== undefined ? { projectStartPoint } : {}),
      });
      const after = pickData(get());
      // Undo only covers DATA_KEYS, so audit-log or catalog refreshes leave the history intact.
      if (DATA_KEYS.some((key) => before[key] !== after[key])) set({ history: freshHistory(after) });
      syncSelection(before, after);
    },

    setProjectStartPoint: (projectStartPoint) => set({ projectStartPoint }),

    addCatalogComponent: (item) => {
      set((s) => ({ catalog: [...s.catalog.filter((c) => c.id !== item.id), item] }));
      showToast('success', 'Component Type Added', `${item.name} is now in the catalog.`);
    },

    addGpsRoute: (route) => {
      set((s) => ({ gpsRoutes: [...(s.gpsRoutes || []).filter((r) => r.id !== route.id), route] }));
      showToast('success', 'GPS Route Saved', `Route "${route.name}" (${route.distanceKm.toFixed(2)} km) saved.`);
    },

    deleteGpsRoute: (id) => {
      set((s) => ({ gpsRoutes: (s.gpsRoutes || []).filter((r) => r.id !== id) }));
      showToast('info', 'GPS Route Deleted', 'Route removed from saved tracks.');
    },

    saveAgentTrip: (trip) => {
      set((s) => {
        const exists = s.agentTrips.some((t) => t.id === trip.id);
        return { agentTrips: exists ? s.agentTrips.map((t) => (t.id === trip.id ? trip : t)) : [...s.agentTrips, trip] };
      });
    },

    saveSetting: (setting) => {
      set((s) => ({ settings: [...s.settings.filter((item) => item.id !== setting.id), setting] }));
    },

    deleteSetting: (id) => {
      set((s) => ({ settings: s.settings.filter((item) => item.id !== id) }));
    },
  };
});

// Write-through cache: every changed collection is mirrored to localStorage.
useNetworkStore.subscribe((state, prev) => {
  for (const name of COLLECTION_NAMES) {
    if (state[name] !== prev[name]) writeJson(COLLECTION_STORAGE_KEYS[name], state[name]);
  }
  if (state.projectStartPoint !== prev.projectStartPoint) writeJson(PROJECT_START_KEY, state.projectStartPoint);
});

export const selectCanUndo = (state: NetworkState): boolean => state.history.index > 0;
export const selectCanRedo = (state: NetworkState): boolean => state.history.index < state.history.stack.length - 1;

/** The current network as plain data (for commands, exports and sync). */
export const getNetworkData = (): NetworkData => pickData(useNetworkStore.getState());

export const getNetworkSnapshot = (): NetworkSnapshot => {
  const state = useNetworkStore.getState();
  return Object.fromEntries(COLLECTION_NAMES.map((name) => [name, state[name]])) as NetworkSnapshot;
};
