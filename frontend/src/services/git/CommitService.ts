/**
 * Commit history.
 *
 * The only service that streams. `git log` is unbounded — the PRD's target is
 * a million commits, which is hundreds of megabytes — so `list()` drives
 * `execStream` through the incremental parser and hands commits to `onBatch`
 * as they arrive. A caller that wants everything can ignore `onBatch` and take
 * the returned array, but that is only reasonable with a `maxCount`.
 */

import { parseFailure } from './boundary';
import type { GitError } from './errors';
import { getGitRunner, type GitRunner, type StreamOptions } from './GitRunner';
import { createLogParser, LOG_BASE_ARGS, parseLog, type Commit } from './parsers';
import type { ReadOptions } from './RepositoryService';
import { err, ok, type Result } from './result';

export interface LogOptions extends ReadOptions {
  /** Commits to stop after. Omit only when the history is known to be small. */
  readonly maxCount?: number;
  /** Revision range, e.g. `['main']` or `['origin/main..HEAD']`. Defaults to HEAD. */
  readonly revisions?: readonly string[];
  /** Limit history to these paths. */
  readonly paths?: readonly string[];
  /** Follow only the first parent, which flattens merge bubbles. */
  readonly firstParent?: boolean;
  /**
   * Called with each batch as it arrives, before the promise resolves.
   *
   * This is what makes a large log feel instant: the first screenful renders
   * while git is still walking.
   */
  readonly onBatch?: (commits: readonly Commit[]) => void;
}

function logArgs(options: LogOptions): string[] {
  const args = [...LOG_BASE_ARGS];
  if (options.maxCount !== undefined) args.push(`--max-count=${options.maxCount}`);
  if (options.firstParent === true) args.push('--first-parent');
  if (options.revisions !== undefined) args.push(...options.revisions);
  // `--` separates revisions from paths; without it a path that matches a
  // branch name is ambiguous and git refuses the command.
  if (options.paths !== undefined && options.paths.length > 0) args.push('--', ...options.paths);
  return args;
}

export class CommitService {
  constructor(private readonly runner: GitRunner) {}

  /**
   * Walk history, streaming.
   *
   * An empty repository is not an error here: `git log` exits 128 with "does
   * not have any commits yet", which is the normal state of a fresh `git
   * init`, so it comes back as an empty list.
   */
  async list(options: LogOptions = {}): Promise<Result<Commit[], GitError>> {
    const args = logArgs(options);
    const parser = createLogParser();
    const commits: Commit[] = [];
    let parseError: unknown;

    const streamOptions: StreamOptions = {
      // Records are NUL-terminated, so cutting there never splits a field.
      delimiter: 'nul',
      okExitCodes: [0, 128],
      ...(options.signal !== undefined && { signal: options.signal }),
    };

    const result = await this.runner.execStream(
      args,
      (chunk) => {
        if (parseError !== undefined) return;
        try {
          const batch = parser.push(chunk);
          if (batch.length > 0) {
            commits.push(...batch);
            options.onBatch?.(batch);
          }
        } catch (cause) {
          // Keep draining the stream rather than throwing through the event
          // handler, which would surface as an unhandled rejection.
          parseError = cause;
        }
      },
      streamOptions,
    );

    if (!result.ok) return result;
    const context = { args, repoPath: this.runner.repoPath };
    if (parseError !== undefined) return err(parseFailure(parseError, context));

    if (result.value.exitCode === 128) {
      // Distinguish "no commits yet" from a real failure; anything else that
      // exits 128 is a genuine error and keeps its message.
      if (/does not have any commits yet|unknown revision/i.test(result.value.stderr)) {
        return ok([]);
      }
      return err(parseFailure(new Error(result.value.stderr.trim()), context));
    }

    try {
      const tail = parser.flush();
      if (tail.length > 0) {
        commits.push(...tail);
        options.onBatch?.(tail);
      }
    } catch (cause) {
      return err(parseFailure(cause, context));
    }

    return ok(commits);
  }

  /** A single commit, or null when the id does not resolve. */
  async get(oid: string, options: ReadOptions = {}): Promise<Result<Commit | null, GitError>> {
    const args = [...LOG_BASE_ARGS, '--max-count=1', oid];
    const result = await this.runner.exec(args, {
      okExitCodes: [0, 128],
      ...(options.signal !== undefined && { signal: options.signal }),
    });
    if (!result.ok) return result;
    if (result.value.exitCode === 128) return ok(null);

    try {
      return ok(parseLog(result.value.stdout)[0] ?? null);
    } catch (cause) {
      return err(parseFailure(cause, { args, repoPath: this.runner.repoPath }));
    }
  }
}

const services = new Map<string, CommitService>();

export function commitService(repoPath: string): CommitService {
  let service = services.get(repoPath);
  if (service === undefined) {
    service = new CommitService(getGitRunner(repoPath));
    services.set(repoPath, service);
  }
  return service;
}

/** Test-only. */
export function resetCommitServices(): void {
  services.clear();
}
