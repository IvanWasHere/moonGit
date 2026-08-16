import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { ignoreService } from '@/services/git';
import { useWatchStore } from '@/stores/watchStore';
import { onRepoChanged, unwatchRepo, watchRepo } from '@/services/wails';
import { keysToInvalidate } from './keys';

/**
 * Keeps a repository's queries fresh from the file watcher.
 *
 * This is the whole of PLAN.md §6's "live without polling": Go debounces
 * filesystem noise into one event carrying which areas changed, and that maps
 * onto the exact query keys those areas affect. No interval, no refetch on
 * focus — the app is only ever doing work because something actually changed.
 *
 * Events for other repositories are ignored: the watcher is per-path, but a
 * stale subscription during a repository switch would otherwise invalidate the
 * wrong cache.
 */
export function useRepoWatcher(repoPath: string | null): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (repoPath === null || repoPath === '') return;

    let cancelled = false;

    /*
     * Ask git what to skip before watching (PLAN.md §10, 7.6).
     *
     * Watching an ignored directory is worse than useless: its events are by
     * definition invisible to `git status`, so each one is an invalidation
     * that finds nothing — and `node_modules` during an install is thousands
     * of them. It is also what exhausts the watcher's descriptor budget, which
     * is a process-wide resource shared with every git command the app runs.
     *
     * The listing is best-effort. A repository whose ignored directories
     * cannot be listed is still watched, just less completely — which is the
     * same state a very large tree ends up in, and the watcher already reports
     * it as `degraded`.
     */
    void (async () => {
      const ignored = await ignoreService(repoPath).ignoredDirectories();
      if (cancelled) return;
      try {
        const info = await watchRepo(repoPath, ignored.ok ? [...ignored.value] : []);
        if (cancelled) return;
        /*
         * Keep what the watcher reported, rather than discarding it.
         *
         * This return value used to be dropped on the floor, which is how
         * `degraded` came to exist in Go, be documented in `watch.ts` as
         * something "the UI should say", and then reach no UI at all — it was
         * visible only as a debug stat on `DevBridgePage`. A tree too large to
         * watch in full would quietly stop updating and say nothing (PLAN.md
         * §10, 7.6).
         */
        useWatchStore.getState().record(repoPath, info);
      } catch (cause: unknown) {
        // A repository that cannot be watched is still usable — it just will
        // not refresh by itself, which is better than refusing to open it.
        // Recorded as `null` so the panel can say so instead of looking live.
        console.warn(`could not watch ${repoPath}`, cause);
        if (!cancelled) useWatchStore.getState().record(repoPath, null);
      }
    })();

    const off = onRepoChanged((event) => {
      if (cancelled || event.repoPath !== repoPath) return;

      for (const queryKey of keysToInvalidate(repoPath, event.reasons)) {
        void queryClient.invalidateQueries({ queryKey });
      }
    });

    return () => {
      cancelled = true;
      off();
      // Back to "not known yet" rather than a stale verdict: reopening this
      // repository re-establishes the watch, and a remembered `degraded` would
      // otherwise render before the new watch has reported anything.
      useWatchStore.getState().forget(repoPath);
      void unwatchRepo(repoPath).catch(() => {
        // Teardown: the watch dies with the process anyway.
      });
    };
  }, [repoPath, queryClient]);
}
