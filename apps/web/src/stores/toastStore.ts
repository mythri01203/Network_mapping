import { create } from 'zustand';

import { uniqueId } from '@fibergis/shared';

export type ToastTone = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  type: ToastTone;
  title: string;
  message: string;
}

export const TOAST_DURATION_MS = 5500;
/** Older toasts are dropped beyond this so a burst of events can't bury the screen. */
const MAX_VISIBLE_TOASTS = 4;

interface ToastState {
  toasts: ToastItem[];
  show: (type: ToastTone, title: string, message: string) => string;
  dismiss: (id: string) => void;
}

export const useToastStore = create<ToastState>()((set, get) => ({
  toasts: [],
  show: (type, title, message) => {
    const id = uniqueId('TOAST');
    set((s) => ({ toasts: [...s.toasts, { id, type, title, message }].slice(-MAX_VISIBLE_TOASTS) }));
    setTimeout(() => get().dismiss(id), TOAST_DURATION_MS);
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Shows a toast from anywhere (components, stores, async callbacks). */
export const showToast = (type: ToastTone, title: string, message: string) =>
  useToastStore.getState().show(type, title, message);
