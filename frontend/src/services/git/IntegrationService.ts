/**
 * Merge and rebase — the two operations whose failure is not a failure.
 *
 * A conflicted merge exits 1, and treating that as an error would be wrong in
 * the way that matters most: the repository is now in a state the user has to
 * be shown and helped out of, not a state to report and forget. So these
 * return an *outcome*, and only genuine faults (bad ref, dirty tree, no such
 * branch) come back as a `GitError`.
 *
 * Every string matched below was captured from git 2.47:
 *
 *     Already up to date.                        exit 0
 *     Updating 5c002d3..f0f3d98 / Fast-forward   exit 0
 *     Merge made by the 'ort' strategy.          exit 0
 *     CONFLICT (content): … / Automatic merge failed;  exit 1, on stdout
 *
 * Conflicted outcomes deliberately carry **no path list**. The paths are in
 * the "CONFLICT (content): Merge conflict in <path>" lines, but those are
 * prose with no quoting rules — the same trap `diff.ts` avoids. Callers refresh
 * `RepositoryService.status()` instead, where unmerged paths arrive
 * NUL-delimited and exact.
 */

import { toGitError, type GitError } from './errors';
import { getGitRunner, type ExecOptions, type GitOutput, type GitRunner } from './GitRunner';
import type { ReadOptions } from './RepositoryService';
import { err, ok, type Result } from './result';

function toExecOptions(options: ReadOptions): ExecOptions {
  return options.signal !== undefined ? { signal: options.signal } : {};
}

export type IntegrationStatus =
  /** Nothing to do; the target was already an ancestor. */
  | 'upToDate'
  /** History was moved forward without creating a commit. */
  | 'fastForward'
  /** A merge or rebase commit was created. */
  | 'completed'
  /** Stopped with conflicts. The working tree now holds conflict markers. */
  | 'conflicted';

export interface IntegrationOutcome {
  readonly status: IntegrationStatus;
  /** git's own message, worth surfacing verbatim in the journal. */
  readonly summary: string;
}

/**
 * Exit 1 is *necessary* for a conflict but nowhere near sufficient.
 *
 * Measured against git 2.47, a merge can fail four ways:
 *
 *     genuine conflict          exit 1   CONFLICT … / Automatic merge failed
 *     unknown ref               exit 1   merge: X - not something we can merge
 *     dirty working tree        exit 2   error: Your local changes … overwritten
 *     --ff-only, diverged       exit 128 hint: Diverging branches can't be …
 *
 * An unknown ref shares its exit code with a real conflict. Classifying on the
 * code alone would report `conflicted` for a merge that never started, and the
 * UI would open a conflict-resolution flow over a working tree with nothing
 * conflicted in it — a dead end the user cannot act on or escape.
 *
 * So a conflict requires the exit code *and* git saying so.
 */
const CONFLICT_EXIT = 1;

/**
 * Single-quote a path for the shell git runs its editors through.
 *
 * Duplicated deliberately from `features/rebase/rebaseTodo.ts` rather than
 * imported: the git layer may not depend on a feature (PLAN.md §5), and three
 * lines of quoting is a smaller price than that seam.
 */
function shellQuoteForGit(path: string): string {
  return `'${path.replaceAll("'", `'\\''`)}'`;
}

const CONFLICT_EVIDENCE = /CONFLICT|Automatic merge failed|could not apply|needs merge/i;

/** Returns null when the run was not an outcome at all, but a failure. */
function classify(stdout: string, stderr: string, exitCode: number): IntegrationStatus | null {
  if (exitCode === 0) {
    if (/Already up to date/i.test(stdout)) return 'upToDate';
    if (/^Fast-forward$/m.test(stdout)) return 'fastForward';
    return 'completed';
  }
  if (exitCode === CONFLICT_EXIT && CONFLICT_EVIDENCE.test(stdout + stderr)) return 'conflicted';
  return null;
}

function firstLine(text: string): string {
  for (const line of text.split('\n')) {
    if (line.trim() !== '') return line.trim();
  }
  return '';
}

/**
 * Turn a completed run into an outcome, or into the error it really was.
 *
 * `okExitCodes` lets exit 1 reach here so a conflict can be recognised; when
 * it turns out not to be one, the error is built here rather than by the
 * runner, which had no way to tell the difference.
 */
function toOutcome(
  result: GitOutput,
  args: readonly string[],
  repoPath: string,
  summaryFrom: 'stdout' | 'stderr',
): Result<IntegrationOutcome, GitError> {
  const { stdout, stderr, exitCode } = result;
  const status = classify(stdout, stderr, exitCode);
  if (status === null) {
    return err(toGitError({ stderr, stdout, exitCode, args, repoPath }));
  }
  const primary = summaryFrom === 'stderr' ? stderr : stdout;
  const secondary = summaryFrom === 'stderr' ? stdout : stderr;
  return ok({ status, summary: firstLine(primary) || firstLine(secondary) });
}

export interface MergeOptions extends ReadOptions {
  /** `--no-ff`: always create a merge commit, even when a fast-forward is possible. */
  readonly noFastForward?: boolean;
  /** `--ff-only`: refuse anything that is not a fast-forward. */
  readonly fastForwardOnly?: boolean;
  /** `--squash`: apply the changes without recording the merge. */
  readonly squash?: boolean;
  readonly message?: string;
}

export class MergeService {
  constructor(private readonly runner: GitRunner) {}

  async merge(
    ref: string,
    options: MergeOptions = {},
  ): Promise<Result<IntegrationOutcome, GitError>> {
    const args = ['merge'];
    if (options.noFastForward === true) args.push('--no-ff');
    if (options.fastForwardOnly === true) args.push('--ff-only');
    if (options.squash === true) args.push('--squash');
    if (options.message !== undefined) args.push('--message', options.message);
    // Never open an editor: there is no terminal behind this process.
    args.push('--no-edit', ref);

    const result = await this.runner.exec(args, {
      ...toExecOptions(options),
      okExitCodes: [0, CONFLICT_EXIT],
    });
    if (!result.ok) return result;
    return toOutcome(result.value, args, this.runner.repoPath, 'stdout');
  }

  /** Throw away a conflicted merge and return to the pre-merge state. */
  async abort(options: ReadOptions = {}): Promise<Result<void, GitError>> {
    const result = await this.runner.exec(['merge', '--abort'], toExecOptions(options));
    return result.ok ? ok(undefined) : result;
  }

  /** Conclude a merge whose conflicts have been resolved and staged. */
  async continueMerge(options: ReadOptions = {}): Promise<Result<void, GitError>> {
    const result = await this.runner.exec(
      ['merge', '--continue', '--no-edit'],
      toExecOptions(options),
    );
    return result.ok ? ok(undefined) : result;
  }
}

export interface RebaseOptions extends ReadOptions {
  /** Rebase this branch instead of the current one. */
  readonly branch?: string;
  /** `--onto`: replay onto a different base than the upstream. */
  readonly onto?: string;
  /** `--autostash`: stash and restore local changes around the rebase. */
  readonly autostash?: boolean;
}

export interface InteractiveRebaseOptions extends RebaseOptions {
  /**
   * A file holding the todo list. Copied over git's own by the sequence
   * editor, so it must exist and be readable when the rebase starts.
   */
  readonly todoPath: string;
}

export class RebaseService {
  constructor(private readonly runner: GitRunner) {}

  /**
   * Rebase interactively, with the todo list supplied rather than edited.
   *
   * There is no terminal to open an editor in, so git is given ones that are
   * not editors:
   *
   * - **`GIT_SEQUENCE_EDITOR`** copies `todoPath` over the todo git generated.
   *   Git invokes it through `sh -c`, which is why the path is shell-quoted —
   *   a repository under a path with a space would otherwise copy the wrong
   *   file, or nothing at all.
   * - **`GIT_EDITOR=true`** answers the message prompts. `squash` and `fixup`
   *   only *offer* to edit the combined message git has already composed, so
   *   accepting it unchanged is right. `reword` would be silently ignored,
   *   which is why `rebaseTodo.ts` does not offer it.
   *
   * A stop for `edit`, or for a conflict, comes back as `conflicted` — the
   * rebase is paused either way and the same continue/skip/abort gets out of
   * it.
   */
  async interactive(
    upstream: string,
    options: InteractiveRebaseOptions,
  ): Promise<Result<IntegrationOutcome, GitError>> {
    const args = ['rebase', '--interactive'];
    if (options.autostash === true) args.push('--autostash');
    if (options.onto !== undefined) args.push('--onto', options.onto);
    args.push(upstream);
    if (options.branch !== undefined) args.push(options.branch);

    const result = await this.runner.exec(args, {
      ...toExecOptions(options),
      okExitCodes: [0, CONFLICT_EXIT],
      env: [`GIT_SEQUENCE_EDITOR=cp ${shellQuoteForGit(options.todoPath)}`, 'GIT_EDITOR=true'],
    });
    if (!result.ok) return result;
    return toOutcome(result.value, args, this.runner.repoPath, 'stderr');
  }

  async rebase(
    upstream: string,
    options: RebaseOptions = {},
  ): Promise<Result<IntegrationOutcome, GitError>> {
    const args = ['rebase'];
    if (options.autostash === true) args.push('--autostash');
    if (options.onto !== undefined) args.push('--onto', options.onto);
    args.push(upstream);
    if (options.branch !== undefined) args.push(options.branch);

    const result = await this.runner.exec(args, {
      ...toExecOptions(options),
      okExitCodes: [0, CONFLICT_EXIT],
    });
    if (!result.ok) return result;
    return toOutcome(result.value, args, this.runner.repoPath, 'stderr');
  }

  async abort(options: ReadOptions = {}): Promise<Result<void, GitError>> {
    const result = await this.runner.exec(['rebase', '--abort'], toExecOptions(options));
    return result.ok ? ok(undefined) : result;
  }

  async continueRebase(options: ReadOptions = {}): Promise<Result<IntegrationOutcome, GitError>> {
    const args = ['rebase', '--continue'];
    const result = await this.runner.exec(args, {
      ...toExecOptions(options),
      okExitCodes: [0, CONFLICT_EXIT],
    });
    if (!result.ok) return result;
    return toOutcome(result.value, args, this.runner.repoPath, 'stderr');
  }

  /** Drop the commit that is currently conflicting and carry on. */
  async skip(options: ReadOptions = {}): Promise<Result<IntegrationOutcome, GitError>> {
    const args = ['rebase', '--skip'];
    const result = await this.runner.exec(args, {
      ...toExecOptions(options),
      okExitCodes: [0, CONFLICT_EXIT],
    });
    if (!result.ok) return result;
    return toOutcome(result.value, args, this.runner.repoPath, 'stderr');
  }
}

export interface CherryPickOptions extends ReadOptions {
  /** `-n`: apply the change to the working tree and index without committing. */
  readonly noCommit?: boolean;
  /**
   * `-x`: append "(cherry picked from commit …)" to the message.
   *
   * Worth offering rather than defaulting: it is the right thing on a public
   * branch and noise on a private one, and git leaves the choice to the caller.
   */
  readonly recordOrigin?: boolean;
  /** `-m <n>`: which parent to treat as mainline when picking a merge commit. */
  readonly mainline?: number;
}

/**
 * Cherry-pick — the third operation whose failure is not a failure.
 *
 * Same shape as merge and rebase because it stops the same way: a conflicted
 * pick leaves unmerged paths with stages 1, 2 and 3, which is exactly what the
 * three-way resolver already reads. Nothing new is needed to get out of one.
 *
 * The summary comes from **stderr**. `git merge` prints "Automatic merge
 * failed" to stdout; cherry-pick prints "could not apply …" to stderr, a
 * difference `errors.ts` documents and that `toOutcome` takes as a parameter
 * rather than guessing.
 */
export class CherryPickService {
  constructor(private readonly runner: GitRunner) {}

  async pick(
    oids: readonly string[],
    options: CherryPickOptions = {},
  ): Promise<Result<IntegrationOutcome, GitError>> {
    if (oids.length === 0) return ok({ status: 'upToDate', summary: 'Nothing to pick' });

    const args = ['cherry-pick'];
    if (options.noCommit === true) args.push('--no-commit');
    if (options.recordOrigin === true) args.push('-x');
    if (options.mainline !== undefined) args.push('--mainline', String(options.mainline));
    args.push(...oids);

    const result = await this.runner.exec(args, {
      ...toExecOptions(options),
      okExitCodes: [0, CONFLICT_EXIT],
    });
    if (!result.ok) return result;
    return toOutcome(result.value, args, this.runner.repoPath, 'stderr');
  }

  async continuePick(options: ReadOptions = {}): Promise<Result<IntegrationOutcome, GitError>> {
    const args = ['cherry-pick', '--continue'];
    const result = await this.runner.exec(args, {
      ...toExecOptions(options),
      okExitCodes: [0, CONFLICT_EXIT],
    });
    if (!result.ok) return result;
    return toOutcome(result.value, args, this.runner.repoPath, 'stderr');
  }

  async skip(options: ReadOptions = {}): Promise<Result<IntegrationOutcome, GitError>> {
    const args = ['cherry-pick', '--skip'];
    const result = await this.runner.exec(args, {
      ...toExecOptions(options),
      okExitCodes: [0, CONFLICT_EXIT],
    });
    if (!result.ok) return result;
    return toOutcome(result.value, args, this.runner.repoPath, 'stderr');
  }

  async abort(options: ReadOptions = {}): Promise<Result<void, GitError>> {
    const result = await this.runner.exec(['cherry-pick', '--abort'], toExecOptions(options));
    return result.ok ? ok(undefined) : result;
  }
}

const mergeServices = new Map<string, MergeService>();
const cherryPickServices = new Map<string, CherryPickService>();
const rebaseServices = new Map<string, RebaseService>();

export function mergeService(repoPath: string): MergeService {
  let service = mergeServices.get(repoPath);
  if (service === undefined) {
    service = new MergeService(getGitRunner(repoPath));
    mergeServices.set(repoPath, service);
  }
  return service;
}

export function rebaseService(repoPath: string): RebaseService {
  let service = rebaseServices.get(repoPath);
  if (service === undefined) {
    service = new RebaseService(getGitRunner(repoPath));
    rebaseServices.set(repoPath, service);
  }
  return service;
}

export function cherryPickService(repoPath: string): CherryPickService {
  let service = cherryPickServices.get(repoPath);
  if (service === undefined) {
    service = new CherryPickService(getGitRunner(repoPath));
    cherryPickServices.set(repoPath, service);
  }
  return service;
}

/** Test-only. */
export function resetIntegrationServices(): void {
  mergeServices.clear();
  rebaseServices.clear();
  cherryPickServices.clear();
}
