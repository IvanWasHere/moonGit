import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { ignoreService } from '@/services/git';
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
        await watchRepo(repoPath, ignored.ok ? [...ignored.value] : []);
      } catch (cause: unknown) {
        // A repository that cannot be watched is still usable — it just will
        // not refresh by itself, which is better than refusing to open it.
        console.warn(`could not watch ${repoPath}`, cause);
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
      void unwatchRepo(repoPath).catch(() => {
        // Teardown: the watch dies with the process anyway.
      });
    };
  }, [repoPath, queryClient]);
}
