import { Unwatch, Watch, Watching } from '../../../wailsjs/go/watcher/Service';
import type { WatchInfo } from './types';

/**
 * Begin watching a repository. Idempotent — watching an already-watched path
 * returns the existing setup.
 *
 * Check `degraded` on the result: a working tree too large to watch means only
 * .git is monitored, so commits and checkouts still report but file edits do
 * not. The UI should offer a manual refresh and explain why.
 */
export function watchRepo(repoPath: string): Promise<WatchInfo> {
  return Watch(repoPath);
}

export function unwatchRepo(repoPath: string): Promise<boolean> {
  return Unwatch(repoPath);
}

export function watchedRepos(): Promise<WatchInfo[]> {
  return Watching();
}
