/**
 * Query keys for every git read, and the rule that maps a filesystem change
 * onto the queries it invalidates.
 *
 * Keys are `[repoPath, kind, ...params]` (PLAN.md §6). Leading with the
 * repository path means switching repositories cannot show another one's data
 * even for a frame, and closing one can drop its cache in a single call.
 */

import type { ChangeReason } from '@/services/wails';

export type QueryKey = readonly unknown[];

export const gitKeys = {
  /** Everything for one repository — used to drop a whole repo's cache. */
  repo: (repoPath: string): QueryKey => [repoPath],
  status: (repoPath: string): QueryKey => [repoPath, 'status'],
  refs: (repoPath: string): QueryKey => [repoPath, 'refs'],
  currentBranch: (repoPath: string): QueryKey => [repoPath, 'currentBranch'],
  log: (repoPath: string, params: unknown = {}): QueryKey => [repoPath, 'log', params],
  commit: (repoPath: string, oid: string): QueryKey => [repoPath, 'commit', oid],
  /** `worktree` = unstaged, `staged` = index against HEAD. */
  diff: (
    repoPath: string,
    scope: 'worktree' | 'staged' | 'commit',
    params: unknown = {},
  ): QueryKey => [repoPath, 'diff', scope, params],
  stashes: (repoPath: string): QueryKey => [repoPath, 'stash'],
  remotes: (repoPath: string): QueryKey => [repoPath, 'remotes'],
  blame: (repoPath: string, path: string, revision?: string): QueryKey => [
    repoPath,
    'blame',
    path,
    revision ?? 'WORKTREE',
  ],
} as const;

/**
 * Which queries a `repo:changed` event makes stale.
 *
 * The watcher reports *why* it fired, and honouring that is the difference
 * between a targeted refresh and re-running every git command in the app on
 * every keystroke in an editor. Saving a file should not re-read the ref list.
 *
 * Two mappings are less obvious than they look:
 *
 * - **`refs` invalidates `status`.** Ahead/behind counts live in the status
 *   header (`# branch.ab`), so a fetch that moves a remote-tracking ref
 *   changes what the status panel should say even though no file moved.
 * - **`refs` invalidates the stash list.** The stash *is* a ref
 *   (`refs/stash`), so pushing or popping one arrives as a refs change.
 *
 * `head` is the broad one — a checkout changes the working tree, the index,
 * the branch and the history at once — so it invalidates the repository whole.
 */
export function keysToInvalidate(repoPath: string, reasons: readonly ChangeReason[]): QueryKey[] {
  // A checkout or reset moves everything; nothing is worth keeping.
  if (reasons.includes('head')) return [gitKeys.repo(repoPath)];

  const keys = new Set<string>();
  const add = (key: QueryKey) => keys.add(JSON.stringify(key));

  for (const reason of reasons) {
    switch (reason) {
      case 'worktree':
        add(gitKeys.status(repoPath));
        add(gitKeys.diff(repoPath, 'worktree'));
        break;
      case 'index':
        add(gitKeys.status(repoPath));
        add(gitKeys.diff(repoPath, 'worktree'));
        add(gitKeys.diff(repoPath, 'staged'));
        break;
      case 'refs':
        add(gitKeys.refs(repoPath));
        add(gitKeys.currentBranch(repoPath));
        add(gitKeys.log(repoPath));
        add(gitKeys.stashes(repoPath));
        add(gitKeys.status(repoPath));
        break;
      case 'state':
        // MERGE_HEAD, REBASE_HEAD and friends: the operation in progress
        // changed, which shows up as unmerged entries in status.
        add(gitKeys.status(repoPath));
        break;
      default:
        break;
    }
  }

  return [...keys].map((key) => JSON.parse(key) as QueryKey);
}
