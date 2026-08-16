import { create } from 'zustand';

/**
 * In-app replacements for `window.prompt` and `window.confirm` (PLAN.md §11, 8.11).
 *
 * **The native ones do not work in this app, and fail silently.** Wails v2
 * declares `WKUIDelegate` conformance but implements none of the three
 * JS-dialog methods, so WKWebView falls back to its defaults: `prompt()`
 * returns `null` and `confirm()` returns `false`, with no dialog and no error.
 * Measured in a packaged build rather than inferred — a probe wrote
 * `{"prompt":null,"confirm":false}` to the preferences table.
 *
 * The consequence was four controls that worked in `wails dev` (a real browser,
 * where both dialogs exist) and did nothing whatsoever in the app anyone would
 * actually run: create a branch, rename a branch, delete a branch, and the
 * confirmation guarding `reset --hard`. All four passed every test.
 *
 * **Promise-based, so callers still read top to bottom.** The alternative —
 * threading dialog state and a callback through every caller — turns three
 * straight-line functions into three state machines. `await ask.text(…)` reads
 * exactly like the `window.prompt` it replaces, which is the point: the call
 * sites barely changed, so the fix could not introduce a second bug in them.
 */

export interface TextRequest {
  readonly kind: 'text';
  readonly message: string;
  readonly initial: string;
  readonly confirmLabel: string;
}

export interface ConfirmRequest {
  readonly kind: 'confirm';
  readonly message: string;
  readonly confirmLabel: string;
  /** Styles the action as destructive and is not the default focus. */
  readonly destructive: boolean;
}

export type AskRequest = TextRequest | ConfirmRequest;

interface AskState {
  readonly pending: AskRequest | null;
  /** Resolver for the in-flight request; null when nothing is pending. */
  readonly resolve: ((value: string | boolean | null) => void) | null;
  settle: (value: string | boolean | null) => void;
  request: (req: AskRequest, resolve: (value: string | boolean | null) => void) => void;
}

const useAskStore = create<AskState>((set, get) => ({
  pending: null,
  resolve: null,

  request: (pending, resolve) => {
    /*
     * A second request while one is open resolves the first as cancelled.
     *
     * It should not happen — these are modal — but a dropped resolver is a
     * promise that never settles, and the caller of *that* one is an `await`
     * that hangs forever with no error to explain it.
     */
    get().resolve?.(null);
    set({ pending, resolve });
  },

  settle: (value) => {
    get().resolve?.(value);
    set({ pending: null, resolve: null });
  },
}));

export { useAskStore };

/** Ask for a line of text. Resolves to null if cancelled — like `window.prompt`. */
export function askText(
  message: string,
  initial = '',
  confirmLabel = 'OK',
): Promise<string | null> {
  return new Promise((resolve) => {
    useAskStore.getState().request({ kind: 'text', message, initial, confirmLabel }, (value) => {
      resolve(typeof value === 'string' ? value : null);
    });
  });
}

/** Ask a yes/no question. Resolves false if dismissed — like `window.confirm`. */
export function askConfirm(
  message: string,
  { confirmLabel = 'OK', destructive = false } = {},
): Promise<boolean> {
  return new Promise((resolve) => {
    useAskStore
      .getState()
      .request({ kind: 'confirm', message, confirmLabel, destructive }, (value) => {
        resolve(value === true);
      });
  });
}
