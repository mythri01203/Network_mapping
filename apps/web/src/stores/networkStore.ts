import { create } from 'zustand';

import {
  type Account,
  type AgentTrip,
  applyPatch,
  AUDIT_ROLE_FOR,
  type AuditEntry,
  type AuditLog,
  type CatalogComponent,
  catalogModelUsers,
  type ChangeSet,
  checkChangeAccess,
  COLLECTION_NAMES,
  type CollectionName,
  type ColorScheme,
  type CommandContext,
  type CommandResult,
  type CommandSuccess,
  describeAccessProblems,
  formatLogTimestamp,
  type GpsRoute,
  isLatLngPair,
  type LatLng,
  type NetworkData,
  type NetworkPatch,
  type NetworkSnapshot,
  type OpticalSettings,
  type OspSettings,
  resolveColorSchemes,
  resolveOpticalSettings,
  resolveOspSettings,
  resolveRfSettings,
  roleMay,
  type Setting,
  type SyncConflict,
  uniqueId,
  type UserRole,
  validateCatalogEntry,
} from '@fibergis/shared';
import { createSampleNetwork } from '@fibergis/shared/sample';

import { cacheHas, cacheRead, cacheRemove, cacheWrite } from '../lib/officeCache';
import { currentAccount, loginIsOn } from './authStore';
import { requestConfirm } from './confirmStore';
import { forgetSyncHistory } from './syncHistoryStore';
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
  spans: 'spans',
  attachments: 'attachments',
  ducts: 'ducts',
  slackLoops: 'slack_loops',
  permissions: 'permissions',
  onts: 'onts',
  services: 'services',
  buildings: 'buildings',
  alarms: 'alarms',
  syncConflicts: 'sync_conflicts',
  rfElements: 'rf_elements',
  rfLinks: 'rf_links',
  rfLevels: 'rf_levels',
  monitoringSources: 'monitoring_sources',
  onuReadings: 'onu_readings',
  onuStatuses: 'onu_statuses',
  deviceStatuses: 'device_statuses',
  inspections: 'inspections',
  sites: 'sites',
  racks: 'racks',
  cableSegments: 'cable_segments',
  linkVerifications: 'link_verifications',
  validationFindings: 'validation_findings',
  planningScenarios: 'planning_scenarios',
  opticalBudgetRuns: 'optical_budget_runs',
  imports: 'imports',
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
  'spans',
  'attachments',
  'ducts',
  'slackLoops',
  'permissions',
  'onts',
  'services',
  'buildings',
  'alarms',
  'rfElements',
  'rfLinks',
  'rfLevels',
  'inspections',
  // Phase 9: sites and racks.
  'sites',
  'racks',
  // Network mapping Phase 6: stretches of cables.
  'cableSegments',
  // Network mapping Phase 13: checks of links.
  'linkVerifications',
  // Network mapping Phase 15: map check findings (kept, never deleted).
  'validationFindings',
  // Network mapping Phase 18: expansion scenarios (plans only).
  'planningScenarios',
  // Network mapping Phase 17: stored optical budget runs (history, never changed).
  'opticalBudgetRuns',
  // Network mapping Phase 21: import history (undo of the import step removes its record too).
  'imports',
] as const satisfies readonly (keyof NetworkData)[];

/**
 * Stored history that undo leaves alone: a budget run is never changed or deleted, and a finding's
 * history only grows, so the server refuses a delete or a rollback of either. Storing one adds no
 * undo step, and undo/redo keeps these as they are now.
 */
const KEPT_BY_UNDO = ['validationFindings', 'opticalBudgetRuns'] as const satisfies readonly (typeof DATA_KEYS)[number][];

const SELECTION_COLLECTION: Record<SelectedObjectType, keyof NetworkData> = {
  equipment: 'equipment',
  cable: 'cables',
  customer: 'customers',
  closure: 'closures',
  fault: 'faults',
  span: 'spans',
  duct: 'ducts',
  slackLoop: 'slackLoops',
};

export type Command<T> = (data: NetworkData, ctx: CommandContext) => CommandResult<T>;

/** Settings are for engineers and the administrator once login is on (Phase 9). */
/** The catalogue is configuration: the same people who change settings change it (Phase 2). */
function catalogAllowed(): boolean {
  const account = enforcedAccount();
  if (!account || roleMay(account.role, 'change_settings')) return true;
  showToast('error', 'Not allowed for your account', 'Only engineers and the administrator change the equipment catalogue. Nothing was changed.');
  return false;
}

function settingsAllowed(): boolean {
  const account = enforcedAccount();
  if (!account || roleMay(account.role, 'change_settings')) return true;
  showToast('error', 'Not allowed for your account', 'Only engineers and the administrator change settings. Nothing was changed.');
  return false;
}

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
  /** Adds or replaces a catalogue entry. False when refused (permission or validation); nothing changes then. */
  addCatalogComponent: (item: CatalogComponent) => boolean;
  /** Removes an entry no item uses. False when refused. */
  removeCatalogComponent: (id: string) => boolean;
  addGpsRoute: (route: GpsRoute) => void;
  deleteGpsRoute: (id: string) => void;
  /** Inserts or replaces a trip without a toast: active duties save on every location update. */
  saveAgentTrip: (trip: AgentTrip) => void;
  /** Inserts or replaces one operator override. Settings sit outside undo; "Reset" removes them. */
  saveSetting: (setting: Setting) => void;
  deleteSetting: (id: string) => void;
  /** Inserts or replaces one sync conflict record. Conflicts sit outside undo. */
  saveSyncConflict: (conflict: SyncConflict) => void;
  /**
   * Writes one record as this person's own edit (or deletes it with `null`), so it is sent with
   * the normal version check. Used when the office chooses the field version of a conflict.
   */
  putRecord: (collection: CollectionName, id: string, record: { id: string } | null) => void;
}

const isRecordArray = (value: unknown): boolean =>
  Array.isArray(value) &&
  value.every((item) => item !== null && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string');

const pickData = (state: NetworkData): NetworkData =>
  Object.fromEntries(DATA_KEYS.map((key) => [key, state[key]])) as unknown as NetworkData;

const freshHistory = (state: NetworkData): History => ({ stack: [pickData(state)], index: 0 });

/**
 * After a logout on a shared device: removes the stored copy of the network, so the next person
 * does not find the customer list in this browser. The server copy is loaded again at the next
 * login. Only the sync engine's bookkeeping stays. Call it only when nothing is waiting to be sent.
 */
export function forgetCachedNetwork(): void {
  cacheRemove([...Object.values(COLLECTION_STORAGE_KEYS), PROJECT_START_KEY]);
  // Phase 19: the device's sync history names records (customers too), so it goes as well.
  forgetSyncHistory();
}

/** Discards browser data written by an incompatible earlier release. */
function ensureStorageVersion(): void {
  // Older releases wrote the bare text "3"; JSON reads it back as the number 3.
  const stored = cacheRead<unknown>(DATA_VERSION_KEY, null, () => true);
  if (stored !== null && String(stored) === DATA_VERSION) return;
  cacheRemove([...Object.values(COLLECTION_STORAGE_KEYS), PROJECT_START_KEY, SYNC_META_STORAGE_KEY]);
  cacheWrite(DATA_VERSION_KEY, DATA_VERSION);
}

let loadedFromCache = false;

/** Whether the store started from collections cached in this browser rather than the bundled sample. */
export const wasLoadedFromCache = (): boolean => loadedFromCache;

/**
 * Phase 19: the cache is IndexedDB when `startOfficeCache` ran first (the app does that in
 * `main.tsx`), else `localStorage` as before. Either way it is read here, once, synchronously.
 */
function loadInitialState(): Pick<NetworkState, CollectionName | 'projectStartPoint'> {
  ensureStorageVersion();
  loadedFromCache = Object.values(COLLECTION_STORAGE_KEYS).some((key) => cacheHas(key));
  const sample = createSampleNetwork();
  const collections = Object.fromEntries(
    COLLECTION_NAMES.map((name) => [name, cacheRead(COLLECTION_STORAGE_KEYS[name], sample[name], isRecordArray)]),
  ) as NetworkSnapshot;
  return { ...collections, projectStartPoint: cacheRead<LatLng | null>(PROJECT_START_KEY, null, isLatLngPair) };
}

/** Keeps the inspector pointed at the latest version of the selected record, or clears it once deleted. */
function syncSelection(before: NetworkData, after: NetworkData): void {
  const { selectedObject, select } = useUiStore.getState();
  if (!selectedObject) return;
  const key = SELECTION_COLLECTION[selectedObject.type];
  if (before[key] === after[key]) return;
  const id = selectedObject.data.id;
  const match = ((after[key] ?? []) as { id: string }[]).find((item) => item.id === id);
  if (match) {
    if (match !== selectedObject.data) select({ type: selectedObject.type, data: match } as SelectedObject);
    return;
  }
  const existed = ((before[key] ?? []) as { id: string }[]).some((item) => item.id === id);
  if (existed) select(null);
}

/** The logged-in person (Phase 9), or the older role choice in setup mode. The server stamps the real person again. */
const toAuditLog = (entry: AuditEntry, role: UserRole, now: Date, account: Account | null): AuditLog => ({
  id: uniqueId('LOG'),
  timestamp: formatLogTimestamp(now),
  user: account ? account.displayName : `${role} (local session)`,
  role: account ? AUDIT_ROLE_FOR[account.role] : role,
  ...entry,
});

/** The person whose rules apply here, or null when login is off (setup mode: everything allowed, as before). */
const enforcedAccount = (): Account | null => (loginIsOn() ? currentAccount() : null);

/**
 * The same access rules the server applies (`checkChangeAccess`), run before a change is made, so
 * the person is told at once in plain words instead of finding a refused item later. The server
 * stays the last word (it also knows who first saved each record).
 */
function accessProblem(before: NetworkData, patch: NetworkPatch): string | null {
  const account = enforcedAccount();
  if (!account) return null;
  const changes: ChangeSet = { upserts: {}, deletes: {} };
  for (const key of DATA_KEYS) {
    const next = patch[key] as readonly { id: string }[] | undefined;
    const prev = before[key] as readonly { id: string }[];
    if (!next || next === prev) continue;
    const old = new Map(prev.map((r) => [r.id, r]));
    const upserts = next.filter((r) => old.get(r.id) !== r);
    const kept = new Set(next.map((r) => r.id));
    const deletes = prev.filter((r) => !kept.has(r.id)).map((r) => r.id);
    if (upserts.length) (changes.upserts as Record<string, unknown[]>)[key] = upserts;
    if (deletes.length) (changes.deletes as Record<string, string[]>)[key] = deletes;
  }
  const lookup = (collection: CollectionName, id: string) => {
    const record = (before[collection as keyof NetworkData] as readonly { id: string }[] | undefined)?.find((r) => r.id === id);
    return record ? { record: record as unknown as Record<string, unknown> } : undefined;
  };
  const problems = checkChangeAccess(account, changes, lookup);
  return problems.length > 0 ? describeAccessProblems(problems) : null;
}

let opticalCache: { records: readonly Setting[]; merged: OpticalSettings } | null = null;

/** Optical defaults merged with the operator's overrides. Stable until the overrides change. */
export const selectOpticalSettings = (state: Pick<NetworkSnapshot, 'settings'>): OpticalSettings => {
  const records = state.settings ?? [];
  if (opticalCache?.records !== records) opticalCache = { records, merged: resolveOpticalSettings(records) };
  return opticalCache.merged;
};

let schemeCache: { records: readonly Setting[]; merged: ColorScheme[] } | null = null;

/** Fiber colour schemes: the built-in ones plus the operator's (`fiber.scheme.*` settings). */
export const selectColorSchemes = (state: Pick<NetworkSnapshot, 'settings'>): ColorScheme[] => {
  const records = state.settings ?? [];
  if (schemeCache?.records !== records) schemeCache = { records, merged: resolveColorSchemes(records) };
  return schemeCache.merged;
};

let ospCache: { records: readonly Setting[]; merged: OspSettings } | null = null;

/** Pole, route and length limits merged with the operator's overrides. */
export const selectOspSettings = (state: Pick<NetworkSnapshot, 'settings'>): OspSettings => {
  const records = state.settings ?? [];
  if (ospCache?.records !== records) ospCache = { records, merged: resolveOspSettings(records) };
  return ospCache.merged;
};

/**
 * Ids of records created by a change made on this device since the app opened. Records the server
 * sends (another device's work, or a map area loaded as the map moves) are never in it. The on-screen
 * guide uses it so that only what was really made during the guide counts as the guide's own.
 */
const madeHere = new Set<string>();
export const wasMadeHere = (id: string): boolean => madeHere.has(id);
const MADE_HERE_KEYS = ['equipment', 'cables', 'customers', 'splitters'] as const;

export const useNetworkStore = create<NetworkState>()((set, get) => {
  const initial = loadInitialState();

  /** False when the person may not make this change; nothing is changed then. */
  const commit = (patch: NetworkPatch): boolean => {
    const state = get();
    const before = pickData(state);
    if (!DATA_KEYS.some((key) => patch[key] !== undefined && patch[key] !== before[key])) return true;
    const refused = accessProblem(before, patch);
    if (refused) {
      showToast('error', 'Not allowed for your account', refused);
      return false;
    }
    const after = applyPatch(before, patch);
    for (const key of MADE_HERE_KEYS) {
      if (after[key] === before[key]) continue;
      const had = new Set(before[key].map((r) => r.id));
      for (const r of after[key]) if (!had.has(r.id)) madeHere.add(r.id);
    }
    const changed = DATA_KEYS.filter((key) => patch[key] !== undefined && patch[key] !== before[key]);
    if (changed.every((key) => (KEPT_BY_UNDO as readonly string[]).includes(key))) {
      set({ ...patch });
      syncSelection(before, after);
      return true;
    }
    const { stack, index } = state.history;
    const nextStack = [...stack.slice(0, index + 1), after].slice(-MAX_HISTORY);
    set({ ...patch, history: { stack: nextStack, index: nextStack.length - 1 } });
    syncSelection(before, after);
    return true;
  };

  const travel = (index: number) => {
    const state = get();
    const target = state.history.stack[index];
    if (!target) return false;
    const before = pickData(state);
    const kept = Object.fromEntries(KEPT_BY_UNDO.map((key) => [key, state[key]]));
    set({ ...target, ...kept, history: { ...state.history, index } });
    syncSelection(before, target);
    useTraceStore.getState().clear();
    return true;
  };

  const evaluate = <T>(command: Command<T>): CommandSuccess<T> | null => {
    const state = get();
    const role = useUiStore.getState().userRole;
    const account = currentAccount();
    const result = command(pickData(state), {
      now: new Date(),
      actor: account ? account.displayName : `${role} User`,
      fallbackLocation: state.projectStartPoint ?? undefined,
      optical: selectOpticalSettings(state),
      schemes: selectColorSchemes(state),
      rf: resolveRfSettings(state.settings),
    });
    if (result.ok) return result;
    showToast(result.error.tone, result.error.title, result.error.message);
    return null;
  };

  const apply = <T>(result: CommandSuccess<T>, options: CommandOptions): boolean => {
    if (!commit(result.patch)) return false;
    if (options.silent) return true;
    if (result.notice) showToast(result.notice.tone, result.notice.title, result.notice.message);
    get().logAudit(...result.audit);
    return true;
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
      return apply(result, options) ? result : null;
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
      return apply(result, options) ? result : null;
    },

    logAudit: (...entries) => {
      if (entries.length === 0) return;
      const role = useUiStore.getState().userRole;
      const account = currentAccount();
      // A look-only account changes nothing, so it writes no audit entries either.
      if (account?.role === 'viewer') return;
      const now = new Date();
      // Newest first, matching how the audit trail is displayed.
      const logs = entries.map((entry) => toAuditLog(entry, role, now, account)).reverse();
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
      if (!catalogAllowed()) return false;
      const existing = get().catalog;
      const problem = validateCatalogEntry(existing, item);
      if (problem) {
        showToast('error', 'Not saved', problem);
        return false;
      }
      const isNew = !existing.some((c) => c.id === item.id);
      set((s) => ({ catalog: [...s.catalog.filter((c) => c.id !== item.id), item] }));
      showToast('success', isNew ? 'Added to the catalogue' : 'Catalogue entry saved', `${item.name} is ${isNew ? 'now in' : 'saved in'} the catalogue.`);
      get().logAudit({ action: isNew ? 'CATALOG_ADDED' : 'CATALOG_UPDATED', details: `${isNew ? 'Added' : 'Changed'} catalogue entry ${item.name}`, assetId: item.id, assetType: 'System' });
      return true;
    },

    removeCatalogComponent: (id) => {
      if (!catalogAllowed()) return false;
      const item = get().catalog.find((c) => c.id === id);
      if (!item) return false;
      const users = catalogModelUsers(get().equipment, id);
      if (users.length > 0) {
        showToast('error', 'Still in use', `${users.length} item(s) on the map are this model (${users.slice(0, 3).map((e) => e.name).join(', ')}${users.length > 3 ? ', …' : ''}). Change them to another model first.`);
        return false;
      }
      set((s) => ({ catalog: s.catalog.filter((c) => c.id !== id) }));
      showToast('info', 'Removed from the catalogue', `${item.name} was removed. Items placed before keep their details.`);
      get().logAudit({ action: 'CATALOG_REMOVED', details: `Removed catalogue entry ${item.name}`, assetId: id, assetType: 'System' });
      return true;
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
      if (!settingsAllowed()) return;
      set((s) => ({ settings: [...s.settings.filter((item) => item.id !== setting.id), setting] }));
    },

    deleteSetting: (id) => {
      if (!settingsAllowed()) return;
      set((s) => ({ settings: s.settings.filter((item) => item.id !== id) }));
    },

    saveSyncConflict: (conflict) => {
      set((s) => {
        const exists = s.syncConflicts.some((c) => c.id === conflict.id);
        return { syncConflicts: exists ? s.syncConflicts.map((c) => (c.id === conflict.id ? conflict : c)) : [conflict, ...s.syncConflicts] };
      });
    },

    putRecord: (collection, id, record) => {
      const state = get();
      const list = state[collection] as readonly { id: string }[];
      const found = list.some((r) => r.id === id);
      const next = record ? (found ? list.map((r) => (r.id === id ? record : r)) : [...list, record]) : list.filter((r) => r.id !== id);
      if ((DATA_KEYS as readonly string[]).includes(collection)) void commit({ [collection]: next } as NetworkPatch);
      else set({ [collection]: next } as Partial<NetworkState>);
    },
  };
});

// Write-through cache: every changed collection is mirrored to the office cache (IndexedDB since
// Phase 19, `localStorage` when IndexedDB cannot open).
useNetworkStore.subscribe((state, prev) => {
  for (const name of COLLECTION_NAMES) {
    if (state[name] !== prev[name]) cacheWrite(COLLECTION_STORAGE_KEYS[name], state[name]);
  }
  if (state.projectStartPoint !== prev.projectStartPoint) cacheWrite(PROJECT_START_KEY, state.projectStartPoint);
});

export const selectCanUndo = (state: NetworkState): boolean => state.history.index > 0;
export const selectCanRedo = (state: NetworkState): boolean => state.history.index < state.history.stack.length - 1;

/** The current network as plain data (for commands, exports and sync). */
export const getNetworkData = (): NetworkData => pickData(useNetworkStore.getState());

export const getNetworkSnapshot = (): NetworkSnapshot => {
  const state = useNetworkStore.getState();
  return Object.fromEntries(COLLECTION_NAMES.map((name) => [name, state[name]])) as NetworkSnapshot;
};
