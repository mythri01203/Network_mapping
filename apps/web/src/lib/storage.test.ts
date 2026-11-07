import { afterEach, describe, expect, it, vi } from 'vitest';

import { useSyncStore } from '../stores/syncStore';
import { useToastStore } from '../stores/toastStore';
import { onStorageWrite, readJson, writeJson } from './storage';

const quotaError = () => Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' });

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  useSyncStore.setState({ cacheWriteFailed: false });
  useToastStore.setState({ toasts: [] });
});

describe('writeJson', () => {
  it('reports a successful write', () => {
    expect(writeJson('thing', { a: 1 })).toBe(true);
    expect(readJson('thing', null, () => true)).toEqual({ a: 1 });
  });

  it('reports a storage-full failure instead of swallowing it', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw quotaError();
    });
    const heard: boolean[] = [];
    const stop = onStorageWrite((_key, ok) => heard.push(ok));
    expect(writeJson('thing', { a: 1 })).toBe(false);
    stop();
    expect(heard).toEqual([false]);
  });
});

describe('cache failure status', () => {
  it('stops "Saved" from showing and tells the person, once', () => {
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw quotaError();
    });
    writeJson('equipment', [1]);
    writeJson('cables', [2]);
    expect(useSyncStore.getState().cacheWriteFailed).toBe(true);
    const titles = useToastStore.getState().toasts.map((t) => t.title);
    expect(titles).toEqual(['Phone storage is full']);

    spy.mockRestore();
    writeJson('equipment', [1]);
    expect(useSyncStore.getState().cacheWriteFailed).toBe(true);
    writeJson('cables', [2]);
    // The earlier test left 'thing' failing; once every failed key writes again the warning clears.
    writeJson('thing', 1);
    expect(useSyncStore.getState().cacheWriteFailed).toBe(false);
    expect(useToastStore.getState().toasts.at(-1)?.title).toBe('Saved on this device again');
  });
});
