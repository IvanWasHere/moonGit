import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
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
    void watchRepo(repoPath).catch((cause: unknown) => {
      // A repository that cannot be watched is still usable — it just will not
      // refresh by itself, which is better than refusing to open it.
      console.warn(`could not watch ${repoPath}`, cause);
    });

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
