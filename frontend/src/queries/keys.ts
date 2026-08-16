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
  /**
   * The ignored files, from a second and much more expensive status call.
   *
   * Its own key rather than a parameter on `status`, and **deliberately absent
   * from `keysToInvalidate`**: an ignore rule changes about once a month, while
   * the watcher fires on every keystroke in an editor — and re-walking
   * `node_modules` on each of those would make the panel unusable on any real
   * repository. Editing `.gitignore` invalidates it explicitly, which is the
   * same bargain `config` above makes for the same reason.
   */
  ignored: (repoPath: string): QueryKey => [repoPath, 'ignored'],
  /**
   * How this repository has been tuned for its size (PLAN.md §10).
   *
   * A query rather than a store slice because it is read from SQLite and
   * changes from inside another query's lifecycle — `status` measures itself
   * and may degrade the repository as a result. Absent from `keysToInvalidate`:
   * no filesystem change can alter it, only a measurement or the user can.
   */
  tuning: (repoPath: string): QueryKey => [repoPath, 'tuning'],
  refs: (repoPath: string): QueryKey => [repoPath, 'refs'],
  currentBranch: (repoPath: string): QueryKey => [repoPath, 'currentBranch'],
  log: (repoPath: string, params: unknown = {}): QueryKey => [repoPath, 'log', params],
  /**
   * `worktree` = unstaged, `staged` = index against HEAD.
   *
   * There is no `commit` scope, and no `commit` key beside `log`. Both existed
   * for `useCommit`/`useCommitDiff`, which had no callers and were removed in
   * Phase 7.7 (PLAN.md §10) — an unscoped commit diff measured 187.6MB. A key
   * for a query nobody makes is the same trap as the query itself, one level
   * down: it reads as evidence that the feature exists.
   */
  diff: (repoPath: string, scope: 'worktree' | 'staged', params: unknown = {}): QueryKey => [
    repoPath,
    'diff',
    scope,
    params,
  ],
  /**
   * A blob's contents. Content-addressed, so it never goes stale and is never
   * invalidated — an object id names exactly one sequence of bytes forever.
   */
  blob: (repoPath: string, oid: string): QueryKey => [repoPath, 'blob', oid],
  /** A working-tree file read from disk, for the side git has no object for. */
  fileText: (repoPath: string, path: string): QueryKey => [repoPath, 'fileText', path],
  /** One directory of the explorer tree, keyed by its repo-relative path. */
  dir: (repoPath: string, path: string): QueryKey => [repoPath, 'dir', path],
  /** Every path in the repository, flat — quick open's corpus. */
  paths: (repoPath: string): QueryKey => [repoPath, 'paths'],
  stashes: (repoPath: string): QueryKey => [repoPath, 'stash'],
  remotes: (repoPath: string): QueryKey => [repoPath, 'remotes'],
  /**
   * The repository's config, per scope.
   *
   * Not invalidated by the watcher: `classify` in `internal/watcher` treats
   * `.git/config` as uninteresting, and rightly — nothing else in the app
   * reads it, and a write to it has no UI consequence anywhere but here. So
   * the settings panel invalidates its own key after a write, which is also
   * the only thing in the app that changes it.
   */
  config: (repoPath: string, scope: string): QueryKey => [repoPath, 'config', scope],
  /** An ignore file's text, keyed by which of the two it is. */
  ignoreText: (repoPath: string, file: string): QueryKey => [repoPath, 'ignoreText', file],
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
        // Files read off disk moved with it; blobs did not, being immutable.
        add([repoPath, 'fileText']);
        // The explorer reads the filesystem, so a created or deleted file
        // changes it. Every open directory is under this one prefix.
        add([repoPath, 'dir']);
        add(gitKeys.paths(repoPath));
        break;
      case 'index':
        add(gitKeys.status(repoPath));
        add(gitKeys.diff(repoPath, 'worktree'));
        add(gitKeys.diff(repoPath, 'staged'));
        // `ls-files --cached` is the index; staging a new file adds to it.
        add(gitKeys.paths(repoPath));
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
