/**
 * Repository-level questions: is this a repository, where is its root, what is
 * the state of its working tree.
 *
 * Domain services are deliberately thin — compose a runner with a parser,
 * return a `Result`. The value is not in the code but in the boundary: this is
 * the layer above which nothing throws and nothing knows what a git argument
 * looks like.
 */

import { mapParsed } from './boundary';
import type { GitError } from './errors';
import { getGitRunner, type ExecOptions, type GitRunner } from './GitRunner';
import {
  IGNORED_STATUS_ARGS,
  parseStatus,
  STATUS_ARGS,
  type RepoStatus,
  type StatusEntry,
} from './parsers';
import { ok, type Result } from './result';

/** Options every read shares. Cancellation matters once a repo switch can outrun a query. */
export interface ReadOptions {
  readonly signal?: AbortSignal;
}

function toExecOptions(options: ReadOptions): ExecOptions {
  return options.signal !== undefined ? { signal: options.signal } : {};
}

export class RepositoryService {
  constructor(private readonly runner: GitRunner) {}

  get repoPath(): string {
    return this.runner.repoPath;
  }

  /** Working tree and index state, plus the current branch's upstream position. */
  async status(options: ReadOptions = {}): Promise<Result<RepoStatus, GitError>> {
    const result = await this.runner.exec(STATUS_ARGS, toExecOptions(options));
    return mapParsed(result, parseStatus, {
      args: STATUS_ARGS,
      repoPath: this.runner.repoPath,
    });
  }

  /**
   * The ignored files and directories, and nothing else.
   *
   * A separate command from `status()` because it is a separate cost: the
   * ordinary status runs on every watcher tick, and walking the ignored tree on
   * a repository with a `node_modules` costs more than everything else in the
   * panel put together. So this one is asked for only while the Ignored chip is
   * on (PLAN.md §9, Phase 6.12).
   *
   * `--ignored` *adds* the `!` records to a normal status rather than replacing
   * it, so the selection here is not a convenience — the caller would otherwise
   * get a second, differently-flagged copy of every file it already has.
   */
  async ignored(options: ReadOptions = {}): Promise<Result<StatusEntry[], GitError>> {
    const result = await this.runner.exec(IGNORED_STATUS_ARGS, toExecOptions(options));
    return mapParsed(
      result,
      (stdout) => parseStatus(stdout).entries.filter((entry) => entry.kind === 'ignored'),
      { args: IGNORED_STATUS_ARGS, repoPath: this.runner.repoPath },
    );
  }

  /**
   * Absolute path of the working tree root.
   *
   * Worth asking rather than assuming: the path the user picked may be a
   * subdirectory, and every other command should be scoped to the root.
   */
  async root(options: ReadOptions = {}): Promise<Result<string, GitError>> {
    const args = ['rev-parse', '--show-toplevel'];
    const result = await this.runner.exec(args, toExecOptions(options));
    return mapParsed(result, (stdout) => stdout.trim(), {
      args,
      repoPath: this.runner.repoPath,
    });
  }

  /**
   * Whether the path is inside a git repository.
   *
   * Returns a plain boolean, not a `Result`: "no" is the answer, not a
   * failure, and the Repository Dashboard asks this about paths that are
   * routinely not repositories.
   */
  async isRepository(options: ReadOptions = {}): Promise<boolean> {
    const result = await this.runner.exec(['rev-parse', '--is-inside-work-tree'], {
      ...toExecOptions(options),
      // Exit 128 is git's way of saying "not a repository" — an answer here.
      okExitCodes: [0, 128],
    });
    return result.ok && result.value.stdout.trim() === 'true';
  }

  /**
   * The commit HEAD resolves to, or null on an unborn branch.
   *
   * `status()` also reports this; this exists for the callers that need only
   * the id and should not pay for a working-tree scan to get it.
   */
  async headOid(options: ReadOptions = {}): Promise<Result<string | null, GitError>> {
    const args = ['rev-parse', '--verify', '--quiet', 'HEAD'];
    const result = await this.runner.exec(args, {
      ...toExecOptions(options),
      // `--quiet` turns "no such ref" into a silent exit 1, which is the
      // normal state of a repository with no commits yet.
      okExitCodes: [0, 1],
    });
    if (!result.ok) return result;
    const oid = result.value.stdout.trim();
    return ok(oid === '' ? null : oid);
  }
}

const services = new Map<string, RepositoryService>();

export function repositoryService(repoPath: string): RepositoryService {
  let service = services.get(repoPath);
  if (service === undefined) {
    service = new RepositoryService(getGitRunner(repoPath));
    services.set(repoPath, service);
  }
  return service;
}

/** Test-only. */
export function resetRepositoryServices(): void {
  services.clear();
}
