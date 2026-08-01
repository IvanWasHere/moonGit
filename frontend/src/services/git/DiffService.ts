/**
 * Diffs: unstaged, staged, and per-commit.
 *
 * Every method returns the same `DiffFile[]`, so the Changes panel renders one
 * shape regardless of what it is looking at.
 */

import { mapParsed } from './boundary';
import type { GitError } from './errors';
import { getGitRunner, type ExecOptions, type GitRunner } from './GitRunner';
import { DIFF_BASE_ARGS, DIFF_OUTPUT_ARGS, parseDiff, type DiffFile } from './parsers';
import type { ReadOptions } from './RepositoryService';
import type { Result } from './result';

export interface DiffOptions extends ReadOptions {
  /** Restrict the diff to these paths. */
  readonly paths?: readonly string[];
}

function toExecOptions(options: ReadOptions): ExecOptions {
  return options.signal !== undefined ? { signal: options.signal } : {};
}

function withPaths(args: readonly string[], paths: readonly string[] | undefined): string[] {
  if (paths === undefined || paths.length === 0) return [...args];
  return [...args, '--', ...paths];
}

export class DiffService {
  constructor(private readonly runner: GitRunner) {}

  private async run(args: string[], options: ReadOptions): Promise<Result<DiffFile[], GitError>> {
    const result = await this.runner.exec(args, toExecOptions(options));
    return mapParsed(result, parseDiff, { args, repoPath: this.runner.repoPath });
  }

  /** Working tree against the index — what the Unstaged list shows. */
  workingTree(options: DiffOptions = {}): Promise<Result<DiffFile[], GitError>> {
    return this.run(withPaths(DIFF_BASE_ARGS, options.paths), options);
  }

  /** Index against HEAD — what the Staged list shows. */
  staged(options: DiffOptions = {}): Promise<Result<DiffFile[], GitError>> {
    return this.run(withPaths([...DIFF_BASE_ARGS, '--cached'], options.paths), options);
  }

  /**
   * What a commit changed.
   *
   * Uses `show`, not `diff <oid>^ <oid>`, because a root commit has no parent
   * to name and the latter simply fails on it.
   *
   * Merges need saying out loud: `git show` on a merge prints **nothing at
   * all** by default — verified, zero bytes — which would render as "this
   * commit changed no files". `--first-parent` gives the diff against the
   * branch that was merged into, which is the useful default. (`-m` would
   * emit one diff per parent, i.e. several concatenated raw+patch sections,
   * which this parser is not built to read.)
   */
  commit(oid: string, options: DiffOptions = {}): Promise<Result<DiffFile[], GitError>> {
    const args = withPaths(
      ['show', '--format=', '--first-parent', ...DIFF_OUTPUT_ARGS, oid],
      options.paths,
    );
    return this.run(args, options);
  }

  /** Difference between any two revisions — a branch against its upstream, say. */
  between(
    from: string,
    to: string,
    options: DiffOptions = {},
  ): Promise<Result<DiffFile[], GitError>> {
    return this.run(withPaths([...DIFF_BASE_ARGS, from, to], options.paths), options);
  }
}

const services = new Map<string, DiffService>();

export function diffService(repoPath: string): DiffService {
  let service = services.get(repoPath);
  if (service === undefined) {
    service = new DiffService(getGitRunner(repoPath));
    services.set(repoPath, service);
  }
  return service;
}

/** Test-only. */
export function resetDiffServices(): void {
  services.clear();
}
