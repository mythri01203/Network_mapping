import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSyncStore } from '../stores/syncStore';
import { useToastStore } from '../stores/toastStore';
import {
  cacheHas,
  cacheRead,
  cacheRemove,
  cacheWrite,
  createMemoryOfficeBackend,
  flushOfficeCache,
  officeCacheMode,
  resetOfficeCacheForTests,
  startOfficeCache,
} from './officeCache';
import { storageKey } from './storage';

const quotaError = () => Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' });
const any = () => true;

beforeEach(() => {
  resetOfficeCacheForTests();
  localStorage.clear();
  useSyncStore.setState({ cacheWriteFailed: false });
  useToastStore.setState({ toasts: [] });
});

afterEach(() => {
  resetOfficeCacheForTests();
});

describe('office cache in IndexedDB (Phase 19)', () => {
  it('moves the offline copy over from localStorage once, and removes it there only after IndexedDB has it', async () => {
    localStorage.setItem(storageKey('equipment'), JSON.stringify([{ id: 'E-1', name: 'Edited offline' }]));
    localStorage.setItem(storageKey('sync'), JSON.stringify({ revision: 4, pending: { equipment: ['E-1'] } }));
    const backend = createMemoryOfficeBackend();
    expect(await startOfficeCache({ backend })).toBe('indexeddb');

    expect(cacheHas('equipment')).toBe(true);
    expect(cacheRead('equipment', [], Array.isArray)).toEqual([{ id: 'E-1', name: 'Edited offline' }]);
    expect(cacheRead('sync', null, any)).toEqual({ revision: 4, pending: { equipment: ['E-1'] } });
    // Still in localStorage until the IndexedDB write has completed.
    expect(localStorage.getItem(storageKey('equipment'))).not.toBeNull();

    await flushOfficeCache();
    expect(backend.data.get('equipment')).toEqual([{ id: 'E-1', name: 'Edited offline' }]);
    expect(backend.data.get('sync')).toEqual({ revision: 4, pending: { equipment: ['E-1'] } });
    expect(localStorage.getItem(storageKey('equipment'))).toBeNull();
    expect(localStorage.getItem(storageKey('sync'))).toBeNull();
  });

  it('takes the localStorage copy over only once, so a newer write is never replaced by it', async () => {
    localStorage.setItem(storageKey('equipment'), JSON.stringify([{ id: 'E-1', name: 'old' }]));
    const backend = createMemoryOfficeBackend();
    await startOfficeCache({ backend });
    expect(cacheRead('equipment', [], Array.isArray)).toEqual([{ id: 'E-1', name: 'old' }]);
    cacheWrite('equipment', [{ id: 'E-1', name: 'new' }]);
    // Read again before the write lands: the newer value wins.
    expect(cacheRead('equipment', [], Array.isArray)).toEqual([{ id: 'E-1', name: 'new' }]);
    await flushOfficeCache();
    expect(backend.data.get('equipment')).toEqual([{ id: 'E-1', name: 'new' }]);
  });

  it('stores a changed collection and the list of unsent changes in one transaction', async () => {
    const backend = createMemoryOfficeBackend();
    const write = vi.spyOn(backend, 'write');
    await startOfficeCache({ backend });
    cacheWrite('equipment', [{ id: 'E-2' }]);
    cacheWrite('sync', { revision: 7, pending: { equipment: ['E-2'] } });
    await flushOfficeCache();
    expect(write).toHaveBeenCalledTimes(1);
    expect([...write.mock.calls[0][0].keys()].sort()).toEqual(['equipment', 'sync']);
  });

  it('keeps unsent changes through a reload', async () => {
    const backend = createMemoryOfficeBackend();
    await startOfficeCache({ backend });
    cacheWrite('equipment', [{ id: 'E-3', name: 'Changed offline' }]);
    cacheWrite('sync', { revision: 9, pending: { equipment: ['E-3'] } });
    await flushOfficeCache();

    // The tab closes: everything in memory is gone. The next visit reads IndexedDB again.
    resetOfficeCacheForTests();
    await startOfficeCache({ backend });
    expect(cacheRead('sync', null, any)).toEqual({ revision: 9, pending: { equipment: ['E-3'] } });
    expect(cacheRead('equipment', [], Array.isArray)).toEqual([{ id: 'E-3', name: 'Changed offline' }]);
  });

  it('says honestly when IndexedDB is full, loses nothing, and clears the warning once a write succeeds', async () => {
    localStorage.setItem(storageKey('equipment'), JSON.stringify([{ id: 'E-4' }]));
    const backend = createMemoryOfficeBackend();
    await startOfficeCache({ backend });
    cacheRead('equipment', [], Array.isArray);
    backend.failNext(quotaError());
    await flushOfficeCache();

    expect(useSyncStore.getState().cacheWriteFailed).toBe(true);
    expect(useToastStore.getState().toasts.map((t) => t.title)).toContain('Phone storage is full');
    // Nothing stored, so the localStorage copy is kept.
    expect(backend.data.has('equipment')).toBe(false);
    expect(localStorage.getItem(storageKey('equipment'))).not.toBeNull();

    // The next write carries the earlier one with it.
    cacheWrite('sync', { revision: 1, pending: { equipment: ['E-4'] } });
    await flushOfficeCache();
    expect(backend.data.get('equipment')).toEqual([{ id: 'E-4' }]);
    expect(useSyncStore.getState().cacheWriteFailed).toBe(false);
    expect(localStorage.getItem(storageKey('equipment'))).toBeNull();
  });

  it('names a failure that is not "full" as what it is', async () => {
    const backend = createMemoryOfficeBackend();
    await startOfficeCache({ backend });
    backend.failNext(Object.assign(new Error('disk error'), { name: 'UnknownError' }));
    cacheWrite('sync', { revision: 1, pending: {} });
    await flushOfficeCache();
    expect(useToastStore.getState().toasts.map((t) => t.title)).toContain('Not saved on this device');
  });

  it('removes keys from both places', async () => {
    localStorage.setItem(storageKey('customers'), '[]');
    const backend = createMemoryOfficeBackend({ customers: [{ id: 'C-1' }] });
    await startOfficeCache({ backend });
    cacheRemove(['customers']);
    await flushOfficeCache();
    expect(backend.data.has('customers')).toBe(false);
    expect(localStorage.getItem(storageKey('customers'))).toBeNull();
    expect(cacheHas('customers')).toBe(false);
  });

  it('keeps working on localStorage when IndexedDB cannot open', async () => {
    const broken = { ...createMemoryOfficeBackend(), loadAll: () => Promise.reject(new Error('blocked')) };
    expect(await startOfficeCache({ backend: broken })).toBe('local');
    expect(officeCacheMode()).toBe('local');
    cacheWrite('equipment', [{ id: 'E-5' }]);
    expect(JSON.parse(localStorage.getItem(storageKey('equipment')) ?? 'null')).toEqual([{ id: 'E-5' }]);
  });
});

describe('the network store on IndexedDB (Phase 19)', () => {
  it('starts again from IndexedDB after a reload, with the unsent list intact', async () => {
    // First visit: the store starts from the bundled network and an edit is made offline.
    vi.resetModules();
    const first = await import('./officeCache');
    const backend = first.createMemoryOfficeBackend();
    await first.startOfficeCache({ backend });
    const store1 = await import('../stores/networkStore');
    const [e0, ...rest] = store1.useNetworkStore.getState().equipment;
    store1.useNetworkStore.setState({ equipment: [{ ...e0, name: 'Renamed offline' }, ...rest] });
    first.cacheWrite(store1.SYNC_META_STORAGE_KEY, { revision: 12, pending: { equipment: [e0.id] } });
    await first.flushOfficeCache();
    first.resetOfficeCacheForTests();

    // Reload: fresh modules, same IndexedDB.
    vi.resetModules();
    const second = await import('./officeCache');
    await second.startOfficeCache({ backend });
    const store2 = await import('../stores/networkStore');
    expect(store2.useNetworkStore.getState().equipment[0]).toMatchObject({ id: e0.id, name: 'Renamed offline' });
    expect(store2.wasLoadedFromCache()).toBe(true);
    expect(second.cacheRead(store2.SYNC_META_STORAGE_KEY, null, any)).toEqual({ revision: 12, pending: { equipment: [e0.id] } });
    // Nothing of the network went to localStorage.
    expect(localStorage.getItem(storageKey('equipment'))).toBeNull();
    second.resetOfficeCacheForTests();
  });
});
