/**
 * Branches, remote-tracking branches and tags — everything the Branches panel
 * renders, from a single `for-each-ref`.
 */

import { mapParsed } from './boundary';
import type { GitError } from './errors';
import { getGitRunner, type ExecOptions, type GitRunner } from './GitRunner';
import {
  FOR_EACH_REF_FORMAT,
  groupRefs,
  parseRefs,
  REF_PATTERNS,
  type GitRef,
  type RefCollection,
} from './parsers';
import type { ReadOptions } from './RepositoryService';
import { ok, type Result } from './result';

function toExecOptions(options: ReadOptions): ExecOptions {
  return options.signal !== undefined ? { signal: options.signal } : {};
}

/** Built here rather than in the parser so the format and its flags travel together. */
function refArgs(patterns: readonly string[]): string[] {
  return ['for-each-ref', `--format=${FOR_EACH_REF_FORMAT}`, ...patterns];
}

export class BranchService {
  constructor(private readonly runner: GitRunner) {}

  /** Every ref, flat and in git's order (refname ascending). */
  async listRefs(options: ReadOptions = {}): Promise<Result<GitRef[], GitError>> {
    const args = refArgs(REF_PATTERNS);
    const result = await this.runner.exec(args, toExecOptions(options));
    return mapParsed(result, parseRefs, { args, repoPath: this.runner.repoPath });
  }

  /** The same refs, split into the buckets the panel renders. */
  async list(options: ReadOptions = {}): Promise<Result<RefCollection, GitError>> {
    const refs = await this.listRefs(options);
    return refs.ok ? ok(groupRefs(refs.value)) : refs;
  }

  /**
   * The checked-out branch, or null when HEAD is detached.
   *
   * Asks git directly rather than filtering `list()`: this runs on every
   * `repo:changed` event, and scanning every ref in a repository with
   * thousands of tags to answer it would be wasteful.
   */
  async current(options: ReadOptions = {}): Promise<Result<string | null, GitError>> {
    const args = ['symbolic-ref', '--quiet', '--short', 'HEAD'];
    const result = await this.runner.exec(args, {
      ...toExecOptions(options),
      // `--quiet` exits 1 rather than erroring when HEAD is detached.
      okExitCodes: [0, 1],
    });
    if (!result.ok) return result;
    const name = result.value.stdout.trim();
    return ok(name === '' ? null : name);
  }
}

const services = new Map<string, BranchService>();

export function branchService(repoPath: string): BranchService {
  let service = services.get(repoPath);
  if (service === undefined) {
    service = new BranchService(getGitRunner(repoPath));
    services.set(repoPath, service);
  }
  return service;
}

/** Test-only. */
export function resetBranchServices(): void {
  services.clear();
}
