import { create } from 'zustand';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** `danger` styles the confirm button for destructive actions. */
  tone?: 'default' | 'danger';
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (confirmed: boolean) => void;
}

interface ConfirmState {
  pending: PendingConfirm | null;
  request: (options: ConfirmOptions) => Promise<boolean>;
  respond: (confirmed: boolean) => void;
}

export const useConfirmStore = create<ConfirmState>()((set, get) => ({
  pending: null,
  request: (options) =>
    new Promise<boolean>((resolve) => {
      // A newer request supersedes an unanswered one, which counts as cancelled.
      get().pending?.resolve(false);
      set({ pending: { ...options, resolve } });
    }),
  respond: (confirmed) => {
    const pending = get().pending;
    if (!pending) return;
    set({ pending: null });
    pending.resolve(confirmed);
  },
}));

/** Opens the app's confirmation dialog and resolves with the user's answer. */
export const requestConfirm = (options: ConfirmOptions): Promise<boolean> =>
  useConfirmStore.getState().request(options);
