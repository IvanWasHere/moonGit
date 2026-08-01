/**
 * The stash stack.
 *
 * Note the selector discipline: every mutating call takes a `stash@{n}` string
 * that came from `list()`, never a bare index formatted at the call site. The
 * stack renumbers itself on every push and drop, so an index captured a moment
 * ago can refer to a different stash by the time the user clicks.
 */

import { mapParsed } from './boundary';
import type { GitError } from './errors';
import { getGitRunner, type ExecOptions, type GitRunner } from './GitRunner';
import {
  DIFF_OUTPUT_ARGS,
  parseDiff,
  parseStashList,
  STASH_LIST_ARGS,
  type DiffFile,
  type Stash,
} from './parsers';
import type { ReadOptions } from './RepositoryService';
import { ok, type Result } from './result';

function toExecOptions(options: ReadOptions): ExecOptions {
  return options.signal !== undefined ? { signal: options.signal } : {};
}

export interface StashPushOptions extends ReadOptions {
  readonly message?: string;
  /** `-u`: stash untracked files too. They come back as a third parent. */
  readonly includeUntracked?: boolean;
  /** `--keep-index`: leave the staged changes in the working tree. */
  readonly keepIndex?: boolean;
  /** Stash only these paths. */
  readonly paths?: readonly string[];
}

export class StashService {
  constructor(private readonly runner: GitRunner) {}

  async list(options: ReadOptions = {}): Promise<Result<Stash[], GitError>> {
    const result = await this.runner.exec(STASH_LIST_ARGS, toExecOptions(options));
    return mapParsed(result, parseStashList, {
      args: STASH_LIST_ARGS,
      repoPath: this.runner.repoPath,
    });
  }

  /**
   * Stash the working tree.
   *
   * Resolves to `false` when there was nothing to stash — git says "No local
   * changes to save" and exits 0, so without checking the output this would
   * look like a successful stash that then does not appear in the list.
   */
  async push(options: StashPushOptions = {}): Promise<Result<boolean, GitError>> {
    const args = ['stash', 'push'];
    if (options.includeUntracked === true) args.push('--include-untracked');
    if (options.keepIndex === true) args.push('--keep-index');
    if (options.message !== undefined) args.push('--message', options.message);
    if (options.paths !== undefined && options.paths.length > 0) args.push('--', ...options.paths);

    const result = await this.runner.exec(args, toExecOptions(options));
    if (!result.ok) return result;
    return ok(!/No local changes to save/i.test(result.value.stdout));
  }

  /** Restore a stash and remove it from the stack. */
  pop(selector: string, options: ReadOptions = {}): Promise<Result<void, GitError>> {
    return this.mutate(['stash', 'pop', selector], options);
  }

  /** Restore a stash but leave it on the stack. */
  apply(selector: string, options: ReadOptions = {}): Promise<Result<void, GitError>> {
    return this.mutate(['stash', 'apply', selector], options);
  }

  drop(selector: string, options: ReadOptions = {}): Promise<Result<void, GitError>> {
    return this.mutate(['stash', 'drop', selector], options);
  }

  /** What a stash would change, in the same shape as every other diff. */
  async show(selector: string, options: ReadOptions = {}): Promise<Result<DiffFile[], GitError>> {
    const args = ['stash', 'show', ...DIFF_OUTPUT_ARGS, selector];
    const result = await this.runner.exec(args, toExecOptions(options));
    return mapParsed(result, parseDiff, { args, repoPath: this.runner.repoPath });
  }

  private async mutate(args: string[], options: ReadOptions): Promise<Result<void, GitError>> {
    const result = await this.runner.exec(args, toExecOptions(options));
    return result.ok ? ok(undefined) : result;
  }
}

const services = new Map<string, StashService>();

export function stashService(repoPath: string): StashService {
  let service = services.get(repoPath);
  if (service === undefined) {
    service = new StashService(getGitRunner(repoPath));
    services.set(repoPath, service);
  }
  return service;
}

/** Test-only. */
export function resetStashServices(): void {
  services.clear();
}
