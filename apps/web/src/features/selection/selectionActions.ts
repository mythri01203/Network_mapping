import {
  buildConnectionIndex,
  connectionsForElement,
  type LatLng,
  type NetworkSnapshot,
  resolveTraceTarget,
} from '@fibergis/shared';

import { currentAccount } from '../../stores/authStore';
import { useMapStore } from '../../stores/mapStore';
import { traceNetworkPath } from '../../stores/networkActions';
import { getNetworkSnapshot, selectColorSchemes, selectOpticalSettings, useNetworkStore } from '../../stores/networkStore';
import { type SavedSelection, useSelectionStore } from '../../stores/selectionStore';
import { showToast } from '../../stores/toastStore';
import { useUiStore } from '../../stores/uiStore';
import {
  boundsOfShapes,
  connectedKeys,
  countByCollection,
  describeCounts,
  invertKeys,
  keyOf,
  keysInArea,
  parseKey,
  recordIndex,
  recordLabel,
  type SelectableCollection,
  selectionFor,
  type SelectionKey,
  shapeOf,
} from './selectionModel';

/** Phase 16: what the selection bar, the right-click menu and the search box do. */

export const selectionOwnerId = (): string => currentAccount()?.id ?? '';

/** Zooms the map to show every one of these records that has a place on the map. */
export function zoomToKeys(keys: Iterable<SelectionKey>): boolean {
  const data = getNetworkSnapshot();
  const index = recordIndex(data);
  const shapes = [];
  for (const key of keys) {
    const p = parseKey(key);
    const record = p && index.get(p.collection, p.id);
    if (p && record) shapes.push(shapeOf(p.collection, record, index));
  }
  const box = boundsOfShapes(shapes);
  if (!box) {
    showToast('info', 'No place on the map', 'None of these items has a recorded place on the map.');
    return false;
  }
  const pad = 0.0004;
  useMapStore.getState().fitBounds({ south: box.south - pad, west: box.west - pad, north: box.north + pad, east: box.east + pad });
  return true;
}

/**
 * Opens one record: its details in the inspector (when there is a panel for its kind) and the map
 * on it. A splitter opens its box; an ONT its customer.
 */
export function focusKey(key: SelectionKey, { openPanel = true } = {}): void {
  const data = getNetworkSnapshot();
  const p = parseKey(key);
  if (!p) return;
  const index = recordIndex(data);
  let collection: SelectableCollection = p.collection;
  let record = index.get(p.collection, p.id);
  if (!record) {
    showToast('warning', 'Not on record', `${p.id} is no longer on this device.`);
    return;
  }
  if (collection === 'splitters') {
    const box = index.get('equipment', (record as { id: string; terminalBoxId?: string }).terminalBoxId ?? '');
    if (box) {
      collection = 'equipment';
      record = box;
    }
  } else if (collection === 'onts') {
    const customer = data.customers.find((c) => c.ontId === p.id);
    if (customer) {
      collection = 'customers';
      record = customer;
    }
  }
  const selection = selectionFor(collection, record);
  const ui = useUiStore.getState();
  if (selection) {
    ui.select(selection);
    if (openPanel && (typeof window === 'undefined' || window.innerWidth >= 768)) ui.setPanelOpen('right', true);
  }
  zoomToKeys([keyOf(collection, record.id)]);
}

/** Adds records joined to the selection (or to one record) by recorded links. */
export function selectConnected(from?: Iterable<SelectionKey>): number {
  const store = useSelectionStore.getState();
  const start = [...(from ?? store.keys)];
  if (start.length === 0) {
    showToast('info', 'Choose something first', 'Select an item, then choose "Select connected".');
    return 0;
  }
  const data = getNetworkSnapshot();
  const found = new Set(connectedKeys(data, start));
  for (const key of connectedByIndex(data, start)) found.add(key);
  for (const k of start) found.delete(k);
  store.setKeys([...start, ...found], 'add');
  showToast(
    found.size > 0 ? 'success' : 'info',
    found.size > 0 ? `${found.size} connected item(s) added` : 'Nothing connected on record',
    found.size > 0
      ? `Joined by recorded links only: ${describeCounts(countByCollection(found))}. Nothing was added because it is near.`
      : 'No recorded link joins these items to anything else. A link that is not recorded is not guessed.',
  );
  return found.size;
}

/** Phase 13's list of recorded fibre links, when it can be built: the other ends of current and planned links. */
function connectedByIndex(data: NetworkSnapshot, start: readonly SelectionKey[]): SelectionKey[] {
  try {
    const index = buildConnectionIndex(data, selectColorSchemes(useNetworkStore.getState()));
    const records = recordIndex(data);
    const resolveId = (id: string): SelectionKey | null => {
      for (const c of ['equipment', 'cables', 'splitters', 'customers', 'closures', 'onts'] as const) if (records.get(c, id)) return keyOf(c, id);
      return null;
    };
    const out: SelectionKey[] = [];
    for (const key of start) {
      const p = parseKey(key);
      if (!p) continue;
      for (const connection of connectionsForElement(index, p.id)) {
        if (connection.state !== 'current' && connection.state !== 'planned') continue;
        for (const id of connection.elementIds) {
          const k = resolveId(id);
          if (k) out.push(k);
        }
      }
    }
    return out;
  } catch {
    // The index is new (Phase 13); if it cannot be built here, the recorded fields above still answer.
    return [];
  }
}

/** Selects the cables and equipment on the traced path of one record (cable level, as the trace says). */
export function selectTraced(key: SelectionKey): number {
  const p = parseKey(key);
  if (!p) return 0;
  const data = getNetworkSnapshot();
  const result = resolveTraceTarget(p.id, data, selectOpticalSettings(useNetworkStore.getState()));
  if (!result || result.nodes.length === 0) {
    showToast('warning', 'No traced path', `No path on record was found for ${p.id}.`);
    return 0;
  }
  const keys = [...result.cableIds.map((id) => keyOf('cables', id)), ...result.equipmentIds.map((id) => keyOf('equipment', id)), key];
  useSelectionStore.getState().setKeys(keys, 'add');
  showToast(
    result.summary.pathComplete ? 'success' : 'warning',
    `${keys.length} item(s) on the traced path selected`,
    `${result.summary.level === 'core' ? 'Followed fibre by fibre.' : 'Followed cable by cable; fibres are not recorded end to end.'}${result.summary.pathComplete ? '' : ' The path is not complete: the gap is shown in the trace.'}`,
  );
  return keys.length;
}

export function traceKey(key: SelectionKey): void {
  const p = parseKey(key);
  if (p) traceNetworkPath(p.id);
}

export async function copyKeyId(key: SelectionKey): Promise<void> {
  const p = parseKey(key);
  if (!p) return;
  try {
    await navigator.clipboard.writeText(p.id);
    showToast('success', 'Copied', `${p.id} is ready to paste.`);
  } catch {
    showToast('info', 'Copy by hand', `This browser did not allow copying. The id is ${p.id}.`);
  }
}

/** Selects what is drawn inside an area. */
export function selectInArea(polygon: readonly LatLng[], mode: 'replace' | 'add' = 'add', collections?: readonly SelectableCollection[]): number {
  const keys = keysInArea(getNetworkSnapshot(), polygon, collections);
  useSelectionStore.getState().setKeys(keys, mode);
  showToast(keys.length > 0 ? 'success' : 'info', keys.length > 0 ? `${keys.length.toLocaleString()} item(s) in the area` : 'Nothing in that area', keys.length > 0 ? describeCounts(countByCollection(keys)) : 'Only items with a recorded place on the map can be inside an area.');
  return keys.length;
}

/** Selects what lies in a zone's recorded boundary. */
export function selectInZone(zoneId: string, mode: 'replace' | 'add' = 'replace', collections?: readonly SelectableCollection[]): number {
  const zone = getNetworkSnapshot().zones.find((z) => z.id === zoneId);
  if (!zone || zone.boundaryCoords.length < 3) {
    showToast('warning', 'No boundary', 'This zone has no boundary drawn yet. Draw it in Zones first.');
    return 0;
  }
  const all = collections ?? (['equipment', 'cables', 'customers', 'closures', 'splitters', 'ducts', 'spans', 'slackLoops', 'faults', 'buildings'] as const);
  return selectInArea(zone.boundaryCoords, mode, all);
}

export function invertSelection(): void {
  const store = useSelectionStore.getState();
  if (store.keys.size === 0) {
    showToast('info', 'Choose something first', 'Invert swaps what is chosen for what is not, among the same kinds of item.');
    return;
  }
  store.setKeys(invertKeys(getNetworkSnapshot(), store.keys), 'replace');
}

export function saveCurrentSelection(name: string): SavedSelection | null {
  const store = useSelectionStore.getState();
  const trimmed = name.trim().slice(0, 80);
  if (!trimmed || store.keys.size === 0) return null;
  const saved: SavedSelection = {
    id: `SEL-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: trimmed,
    ownerId: selectionOwnerId(),
    createdAt: new Date().toISOString(),
    keys: [...store.keys],
  };
  store.saveSelection(saved);
  showToast('success', 'Selection saved on this device', `"${trimmed}": ${store.keys.size.toLocaleString()} item(s). Only you see it, on this device.`);
  return saved;
}

/** Loads a saved selection; items deleted since are left out and counted. */
export function loadSelection(saved: SavedSelection): void {
  const data = getNetworkSnapshot();
  const index = recordIndex(data);
  const present = saved.keys.filter((k) => {
    const p = parseKey(k);
    return !!p && !!index.get(p.collection, p.id);
  });
  useSelectionStore.getState().setKeys(present, 'replace');
  const gone = saved.keys.length - present.length;
  showToast(gone > 0 ? 'warning' : 'success', `"${saved.name}" selected`, `${present.length.toLocaleString()} item(s).${gone > 0 ? ` ${gone} are no longer on record and were left out.` : ''}`);
}

/** "Lakshmi Stores (CUST-9)" for one key. */
export function keyLabel(key: SelectionKey): string {
  const p = parseKey(key);
  if (!p) return key;
  const record = recordIndex(getNetworkSnapshot()).get(p.collection, p.id);
  const label = recordLabel(record, p.id);
  return label === p.id ? p.id : `${label} (${p.id})`;
}
