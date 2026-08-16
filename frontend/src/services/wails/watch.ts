import { Unwatch, Watch, Watching } from '../../../wailsjs/go/watcher/Service';
import type { WatchInfo } from './types';

/**
 * Begin watching a repository. Idempotent — watching an already-watched path
 * returns the existing setup.
 *
 * `excludeDirs` are repository-relative directories to leave unwatched, and in
 * practice are the gitignored ones. Deciding that is git knowledge, which lives
 * on this side of the bridge (PLAN.md §4) — Go cannot read a `.gitignore`, and
 * a `.gitignore` is not a list of paths anyway.
 *
 * Check `degraded` on the result: part of the working tree is not being
 * watched, so commits and checkouts still report but edits to files in that
 * part do not. The UI should offer a manual refresh and explain why.
 */
export function watchRepo(repoPath: string, excludeDirs: string[] = []): Promise<WatchInfo> {
  return Watch(repoPath, excludeDirs);
}

export function unwatchRepo(repoPath: string): Promise<boolean> {
  return Unwatch(repoPath);
}

export function watchedRepos(): Promise<WatchInfo[]> {
  return Watching();
}
