import { getGitRunner } from './GitRunner';
import type { GitError } from './errors';
import { err, ok, type Result } from './result';

/**
 * Clone a repository (PLAN.md §11, 8.9).
 *
 * **The one git operation in the app that runs outside a repository**, which is
 * why it is a function here rather than a method on a service. Every service
 * takes a `GitRunner` bound to a work tree; a clone has no work tree yet, so
 * this binds a runner to the *parent directory* the clone will land in and runs
 * there. That directory is a real path the user picked, so the runner's cwd is
 * still a real place — it simply is not a repository, which `clone` is the only
 * command that does not mind.
 *
 * The destination folder name is derived here rather than left to git, so the
 * caller knows the path before the command runs and can register and open it
 * without guessing what git chose.
 */

/** `https://host/owner/repo.git` and `git@host:owner/repo.git` → `repo`. */
export function cloneTargetName(url: string): string | null {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (trimmed === '') return null;
  const last = trimmed.split(/[/:]/).pop();
  if (last === undefined || last === '') return null;
  const name = last.replace(/\.git$/, '');
  // A name that would escape the chosen directory is not a name.
  return name === '' || name === '.' || name === '..' ? null : name;
}

export interface CloneOutcome {
  /** Absolute path of the new work tree. */
  readonly path: string;
  readonly name: string;
}

export async function cloneRepository(
  url: string,
  parentDir: string,
): Promise<Result<CloneOutcome, GitError>> {
  const name = cloneTargetName(url);
  if (name === null) {
    return err({
      kind: 'Unknown',
      message: `Could not work out a folder name from "${url}"`,
      stderr: '',
      exitCode: -1,
      args: ['clone', url],
      repoPath: parentDir,
    });
  }

  /*
   * No timeout, deliberately.
   *
   * `GitRunner` defaults to 30 seconds, which is fine for every other command
   * in the app and wrong for this one: cloning a large repository over a slow
   * link takes minutes, and killing it partway leaves a half-written directory
   * that is worse than a slow wait. An hour is not a real limit, it is a
   * backstop against a hung network connection.
   */
  const result = await getGitRunner(parentDir).exec(['clone', url, name], {
    timeoutMs: 60 * 60_000,
    mode: 'write',
  });
  if (!result.ok) return result;

  return ok({ path: `${parentDir.replace(/\/+$/, '')}/${name}`, name });
}
