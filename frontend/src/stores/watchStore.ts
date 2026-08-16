import { create } from 'zustand';
import type { WatchInfo } from '@/services/wails';

/**
 * What the file watcher managed to set up, so the UI can admit it (PLAN.md §10, 7.6).
 *
 * The Go side has always reported this. `WatchInfo.Degraded` is set when
 * covering the whole working tree would have cost more file descriptors than
 * the process can spare, `watch.ts` documents it as something "the UI should
 * say", and until now the only place it reached was a debug stat on
 * `DevBridgePage`. `useRepoWatcher` discarded the return value of `Watch`
 * entirely — so a tree too large to watch stopped updating and said nothing,
 * which is the failure this store exists to end.
 *
 * A store rather than a query key, deliberately. There is nothing to fetch:
 * `useRepoWatcher` is the sole writer and asking Go again would race with it,
 * so a `useQuery` here would be a query with no `queryFn` — fighting TanStack's
 * fetch model to hold a value that is pushed, not pulled.
 *
 * Keyed by repository path so a repository switch cannot show the previous
 * repository's watch health, which matters precisely because the two are most
 * likely to differ when one of them is enormous.
 */

/**
 * `undefined` — not known yet, the watch is still being established.
 * `null` — `Watch` threw; nothing is being watched and nothing auto-refreshes.
 * `WatchInfo` — a watch exists; check `degraded` for whether it covers everything.
 *
 * The first is a real third state and not a synonym for "fine": treating it as
 * healthy is what keeps a banner off the screen during the few hundred
 * milliseconds of every repository open, and treating it as broken would put
 * one on every single time.
 */
export type WatchState = WatchInfo | null | undefined;

interface WatchStoreState {
  readonly byRepo: Readonly<Record<string, WatchInfo | null>>;
  record: (repoPath: string, info: WatchInfo | null) => void;
  forget: (repoPath: string) => void;
}

export const useWatchStore = create<WatchStoreState>((set) => ({
  byRepo: {},

  record: (repoPath, info) =>
    set((state) => ({ byRepo: { ...state.byRepo, [repoPath]: info } })),

  forget: (repoPath) =>
    set((state) => {
      if (!(repoPath in state.byRepo)) return state;
      const next = { ...state.byRepo };
      delete next[repoPath];
      return { byRepo: next };
    }),
}));

/** The watch state for one repository, or `undefined` if not established yet. */
export function useWatchState(repoPath: string | null): WatchState {
  return useWatchStore((state) => (repoPath === null ? undefined : state.byRepo[repoPath]));
}
