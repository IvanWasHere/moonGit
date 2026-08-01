import { create } from 'zustand';

/**
 * Toasts — the mockup's `showToast` / `state.toasts` (ui-example L370–379)
 * as a store rather than a global mutated from every click handler.
 *
 * The three-second auto-dismiss is preserved. The timer is cleared if the
 * toast is dismissed early, so a burst of notifications cannot leave stray
 * timeouts firing against an empty list.
 */

export type ToastType = 'success' | 'error' | 'info';

export interface Toast {
  readonly id: string;
  readonly message: string;
  readonly type: ToastType;
}

interface NotificationState {
  readonly toasts: readonly Toast[];
  show: (message: string, type?: ToastType) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

const DISMISS_AFTER_MS = 3000;

const timers = new Map<string, ReturnType<typeof setTimeout>>();

export const useNotificationStore = create<NotificationState>((set, get) => ({
  toasts: [],

  show: (message, type = 'info') => {
    const id = crypto.randomUUID();
    set((state) => ({ toasts: [...state.toasts, { id, message, type }] }));

    timers.set(
      id,
      setTimeout(() => get().dismiss(id), DISMISS_AFTER_MS),
    );
    return id;
  },

  dismiss: (id) => {
    const timer = timers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.delete(id);
    }
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
  },

  clear: () => {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    set({ toasts: [] });
  },
}));

/** Imperative helper for call sites that are not components. */
export function showToast(message: string, type: ToastType = 'info'): void {
  useNotificationStore.getState().show(message, type);
}
