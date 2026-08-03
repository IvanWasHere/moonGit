/**
 * Whether a rebase is in progress, and how far through.
 *
 * Porcelain status says nothing about this — a stopped rebase looks like an
 * ordinary working tree with conflicts, or like a clean one when it stopped for
 * an `edit`. Git records it on disk instead: `rebase-merge` for the interactive
 * machinery, `rebase-apply` for the older `am`-based path.
 *
 * The counters come from the same directory, which is why they are read rather
 * than derived: `msgnum` is the step being applied and `end` the last one, so
 * "3 of 7" is git's own arithmetic rather than ours.
 *
 * The watcher already fires `state` for anything under `.git/rebase-*`, so
 * this refreshes on its own as the rebase moves.
 */

import { useQuery } from '@tanstack/react-query';
import { pathExists, readFile } from '@/services/wails';

export interface RebaseState {
  readonly active: boolean;
  /** Step currently being applied, 1-based, or null when git did not record one. */
  readonly step: number | null;
  readonly total: number | null;
}

const IDLE: RebaseState = { active: false, step: null, total: null };

async function readNumber(path: string): Promise<number | null> {
  try {
    const content = await readFile(path);
    const value = Number.parseInt((content.text ?? '').trim(), 10);
    return Number.isNaN(value) ? null : value;
  } catch {
    return null;
  }
}

export function useRebaseState(repoPath: string | null): RebaseState {
  const query = useQuery({
    queryKey: [repoPath ?? '', 'state', 'rebase'],
    queryFn: async (): Promise<RebaseState> => {
      if (repoPath === null) return IDLE;

      // `rebase-merge` is `--interactive` and everything modern; `rebase-apply`
      // is the `am` path, still reachable through `--whitespace` and friends.
      const [interactive, applying] = await Promise.all([
        pathExists(`${repoPath}/.git/rebase-merge`),
        pathExists(`${repoPath}/.git/rebase-apply`),
      ]);
      if (!interactive && !applying) return IDLE;

      const dir = interactive ? 'rebase-merge' : 'rebase-apply';
      const [step, total] = await Promise.all([
        readNumber(`${repoPath}/.git/${dir}/msgnum`),
        readNumber(`${repoPath}/.git/${dir}/end`),
      ]);
      return { active: true, step, total };
    },
    enabled: repoPath !== null && repoPath !== '',
  });

  return query.data ?? IDLE;
}
