import { QueryClient } from '@tanstack/react-query';

/**
 * Query client for all git *reads* (PLAN.md §6).
 *
 * Refetch-on-interval is deliberately off: freshness comes from the Go file
 * watcher emitting `repo:changed`, which drives targeted invalidation. Polling
 * a repository would be both slower and noisier than watching it.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: false,
    },
  },
});
