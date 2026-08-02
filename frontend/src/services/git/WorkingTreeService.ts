/**
 * Staging, unstaging and discarding.
 *
 * Three of these look like one-line wrappers and are not:
 *
 * - **Unstaging needs HEAD.** `git restore --staged` fails with "could not
 *   resolve HEAD" on an unborn branch, leaving the file staged while
 *   reporting nothing useful — verified against git 2.47. The very first
 *   files added to a fresh repository are exactly the ones a user is most
 *   likely to unstage, so that path falls back to `rm --cached`.
 *
 * - **Discarding an untracked file means deleting it.** `git restore` refuses
 *   ("pathspec did not match any file"), because there is no committed
 *   version to restore. Untracked paths go to `git clean` instead, and the
 *   caller has to say which are which — the status entry already knows.
 *
 * - **Discard is irreversible.** There is no reflog for uncommitted work. The
 *   UI confirms before calling this; the service does not, because a service
 *   that opens dialogs cannot be tested or scripted.
 */

import type { GitError } from './errors';
import { getGitRunner, type ExecOptions, type GitRunner } from './GitRunner';
import type { ReadOptions } from './RepositoryService';
import { ok, type Result } from './result';

function toExecOptions(options: ReadOptions): ExecOptions {
  return options.signal !== undefined ? { signal: options.signal } : {};
}

/** A path plus whether git is already tracking it — discard differs entirely. */
export interface DiscardTarget {
  readonly path: string;
  readonly untracked: boolean;
}

export class WorkingTreeService {
  constructor(private readonly runner: GitRunner) {}

  private async run(args: string[], options: ReadOptions): Promise<Result<void, GitError>> {
    const result = await this.runner.exec(args, toExecOptions(options));
    return result.ok ? ok(undefined) : result;
  }

  /**
   * Stage paths. `add` handles every case — new, modified and deleted files —
   * which `update-index` variants do not.
   */
  stage(paths: readonly string[], options: ReadOptions = {}): Promise<Result<void, GitError>> {
    if (paths.length === 0) return Promise.resolve(ok(undefined));
    return this.run(['add', '--', ...paths], options);
  }

  /** Stage everything, including untracked files. */
  stageAll(options: ReadOptions = {}): Promise<Result<void, GitError>> {
    return this.run(['add', '--all'], options);
  }

  /**
   * Unstage paths, falling back for a repository with no commits yet.
   *
   * `hasHead` is passed in rather than looked up so this stays one process:
   * the caller already has the status, which says whether HEAD is unborn.
   */
  unstage(
    paths: readonly string[],
    hasHead: boolean,
    options: ReadOptions = {},
  ): Promise<Result<void, GitError>> {
    if (paths.length === 0) return Promise.resolve(ok(undefined));

    return hasHead
      ? this.run(['restore', '--staged', '--', ...paths], options)
      : // No HEAD to restore from; removing the index entry is the equivalent.
        this.run(['rm', '--cached', '-r', '--quiet', '--', ...paths], options);
  }

  unstageAll(hasHead: boolean, options: ReadOptions = {}): Promise<Result<void, GitError>> {
    return hasHead
      ? this.run(['restore', '--staged', '--', '.'], options)
      : this.run(['rm', '--cached', '-r', '--quiet', '--', '.'], options);
  }

  /**
   * Throw away changes. Irreversible — there is no reflog for a working tree.
   *
   * Tracked and untracked paths need different commands, so they are split and
   * run separately. The tracked restore goes first: if `clean` fails there is
   * still something to report, whereas a half-done discard that deleted files
   * before failing would be worse.
   */
  async discard(
    targets: readonly DiscardTarget[],
    options: ReadOptions = {},
  ): Promise<Result<void, GitError>> {
    const tracked = targets.filter((target) => !target.untracked).map((target) => target.path);
    const untracked = targets.filter((target) => target.untracked).map((target) => target.path);

    if (tracked.length > 0) {
      // `--worktree` only: the index is left alone, so discarding an unstaged
      // edit to a staged file does not also unstage it.
      const restored = await this.run(['restore', '--worktree', '--', ...tracked], options);
      if (!restored.ok) return restored;
    }

    if (untracked.length > 0) {
      // `-d` so an untracked *directory* goes too; without it git ignores it.
      const cleaned = await this.run(['clean', '-f', '-d', '--', ...untracked], options);
      if (!cleaned.ok) return cleaned;
    }

    return ok(undefined);
  }

  /** Stop tracking a file but leave it on disk. */
  removeFromIndex(
    paths: readonly string[],
    options: ReadOptions = {},
  ): Promise<Result<void, GitError>> {
    if (paths.length === 0) return Promise.resolve(ok(undefined));
    return this.run(['rm', '--cached', '--quiet', '--', ...paths], options);
  }

  /** Stop tracking a file *and* delete it from the working tree. */
  removeFromDisk(
    paths: readonly string[],
    options: ReadOptions = {},
  ): Promise<Result<void, GitError>> {
    if (paths.length === 0) return Promise.resolve(ok(undefined));
    // `-f` because a file with staged or unstaged changes is exactly the one a
    // user reaches for this on, and git refuses those without it.
    return this.run(['rm', '-f', '--quiet', '--', ...paths], options);
  }

  /**
   * Throw away *both* halves of a file's changes — index and working tree.
   *
   * Distinct from `discard`, which restores the working tree only and leaves
   * anything staged alone. This is the "put it back the way HEAD has it"
   * action, and on a staged-and-modified file the two give different results.
   */
  revert(paths: readonly string[], options: ReadOptions = {}): Promise<Result<void, GitError>> {
    if (paths.length === 0) return Promise.resolve(ok(undefined));
    return this.run(
      ['restore', '--source=HEAD', '--staged', '--worktree', '--', ...paths],
      options,
    );
  }

  /**
   * Resolve a conflict by taking one side of it whole.
   *
   * `checkout --ours/--theirs` writes that stage over the working-tree file but
   * leaves the path *unmerged* — so the `add` is not an optional extra, it is
   * what marks the conflict resolved. Without it the file still reads as
   * conflicted and the merge cannot be committed.
   */
  async resolveUsing(
    paths: readonly string[],
    side: 'ours' | 'theirs',
    options: ReadOptions = {},
  ): Promise<Result<void, GitError>> {
    if (paths.length === 0) return ok(undefined);
    const taken = await this.run(['checkout', `--${side}`, '--', ...paths], options);
    if (!taken.ok) return taken;
    return this.run(['add', '--', ...paths], options);
  }

  /** Rename or move a tracked file, keeping its history. */
  move(from: string, to: string, options: ReadOptions = {}): Promise<Result<void, GitError>> {
    return this.run(['mv', '--', from, to], options);
  }
}

const services = new Map<string, WorkingTreeService>();

export function workingTreeService(repoPath: string): WorkingTreeService {
  let service = services.get(repoPath);
  if (service === undefined) {
    service = new WorkingTreeService(getGitRunner(repoPath));
    services.set(repoPath, service);
  }
  return service;
}

/** Test-only. */
export function resetWorkingTreeServices(): void {
  services.clear();
}
