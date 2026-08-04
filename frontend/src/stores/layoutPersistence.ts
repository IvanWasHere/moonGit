import { useEffect, useRef } from 'react';
import { getLayout, getPreference, setLayout, setPreference } from '@/services/db/keyValue';
import {
  useWorkspaceStore,
  type DiffViewMode,
  type MainLayout,
  type ReviewLayout,
} from './workspaceStore';

/**
 * Persists pane sizes to SQLite, not localStorage (PLAN.md §6).
 *
 * Two things this has to get right, and both are ordering problems:
 *
 * 1. **Do not save before loading.** The store starts at the mockup defaults;
 *    writing those out before the saved values arrive would overwrite the
 *    user's layout with defaults every launch. Saving is gated on the load
 *    completing.
 * 2. **Do not save every frame.** A resize drag fires on every mouse move, so
 *    writes are debounced. The final position is what matters, not the path
 *    the cursor took.
 */

const MAIN_KEY = 'workspace.main';
const REVIEW_KEY = 'workspace.review';
/** A preference rather than a layout: it is a choice, not a pane size. */
const DIFF_VIEW_KEY = 'diff.viewMode';
/**
 * The terminal drawer's height — and only its height.
 *
 * Whether it was *open* is deliberately not restored: opening the drawer
 * starts a real shell process, and a launch that spawns one because of where a
 * divider was left three sessions ago is doing something the user did not ask
 * for on this launch.
 */
const TERMINAL_KEY = 'workspace.terminalHeight';
const SAVE_DEBOUNCE_MS = 400;

export function useLayoutPersistence(): void {
  const loaded = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- load once ----------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const { main, review, diffView, terminalH, setMain, setReview, setDiffView, setTerminalH } =
          useWorkspaceStore.getState();
        const [savedMain, savedReview, savedDiffView, savedTerminalH] = await Promise.all([
          getLayout<MainLayout>(MAIN_KEY, main),
          getLayout<ReviewLayout>(REVIEW_KEY, review),
          getPreference<DiffViewMode>(DIFF_VIEW_KEY, diffView),
          getLayout<number>(TERMINAL_KEY, terminalH),
        ]);
        if (cancelled) return;
        setMain(savedMain);
        setReview(savedReview);
        // The setter clamps, so a value written by a build with a different
        // range cannot restore a drawer taller than the window.
        setTerminalH(savedTerminalH);
        // A stored value from an older build could be anything; only the two
        // modes this build knows are worth restoring.
        setDiffView(savedDiffView === 'split' ? 'split' : 'inline');
      } catch (cause) {
        // A layout that will not load is a cosmetic problem; the defaults are
        // perfectly usable and refusing to open the workspace is not.
        console.warn('could not restore layout', cause);
      } finally {
        if (!cancelled) loaded.current = true;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // --- save on change, debounced ------------------------------------------
  useEffect(() => {
    const unsubscribe = useWorkspaceStore.subscribe((state, previous) => {
      if (!loaded.current) return;
      if (
        state.main === previous.main &&
        state.review === previous.review &&
        state.diffView === previous.diffView &&
        state.terminalH === previous.terminalH
      ) {
        return;
      }

      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void Promise.all([
          setLayout(MAIN_KEY, state.main),
          setLayout(REVIEW_KEY, state.review),
          setPreference(DIFF_VIEW_KEY, state.diffView),
          setLayout(TERMINAL_KEY, state.terminalH),
        ]).catch((cause: unknown) => console.warn('could not save layout', cause));
      }, SAVE_DEBOUNCE_MS);
    });

    return () => {
      unsubscribe();
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, []);
}
