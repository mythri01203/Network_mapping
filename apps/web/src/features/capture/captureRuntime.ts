import { photoUrl } from '@fibergis/shared';

import { syncEngine } from '../../api/syncEngine';
import { getNetworkData, useNetworkStore } from '../../stores/networkStore';
import { useSyncStore } from '../../stores/syncStore';
import { createCaptureService, type UploadOutcome } from './captureService';
import { createIdbCaptureStorage, type PhotoEntry } from './captureStorage';

const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

/** Sends one photo. A 4xx other than 408 or 429 means the server will never take it unchanged. */
async function uploadPhotoHttp(photo: PhotoEntry): Promise<UploadOutcome> {
  try {
    const response = await fetch(`${API_BASE}${photoUrl(photo.id)}`, {
      method: 'PUT',
      headers: { 'content-type': photo.type },
      body: photo.blob,
      signal: AbortSignal.timeout(60_000),
    });
    if (response.ok) return { kind: 'stored' };
    if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      return { kind: 'refused', reason: body?.message ?? `HTTP ${response.status}` };
    }
    return { kind: 'retry' };
  } catch {
    return { kind: 'retry' };
  }
}

/** The one capture service for this tab, writing to the phone's IndexedDB and the shared network store. */
export const captureService = createCaptureService({
  storage: createIdbCaptureStorage(),
  uploadPhoto: uploadPhotoHttp,
  runCommand: (command) => {
    const store = useNetworkStore.getState();
    // Silent: the capture screens give their own feedback. The audit trail is still written.
    const result = store.runCommand((data) => command(data), { silent: true });
    if (!result) return null;
    store.logAudit(...result.audit);
    return { value: result.value };
  },
  getNetwork: getNetworkData,
  getConflicts: () => useNetworkStore.getState().syncConflicts,
  sync: {
    unsentIds: () => syncEngine.unsentIds(),
    isConnected: () => syncEngine.isConnected(),
    refusedKeys: () => useSyncStore.getState().refused,
    flush: () => void syncEngine.flush(),
  },
});

let started = false;

/** Starts photo uploads and status checks, on any screen, so photos leave the phone as soon as possible. */
export function startCaptureRuntime(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  void captureService.init();
  window.addEventListener('online', () => void captureService.processUploads(true));
  setInterval(() => void captureService.processUploads(), 15_000);
  useSyncStore.subscribe((state, prev) => {
    if (state.phase !== prev.phase || state.pendingCount !== prev.pendingCount || state.revision !== prev.revision) {
      void captureService.refresh();
    }
  });
}
