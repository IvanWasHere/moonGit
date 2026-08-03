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

/**
 * The limiting patterns — what turns `log` into a search.
 *
 * Separated from the rest of `LogOptions` because the UI builds exactly this
 * subset from a query string (`features/search/commitQuery`), and because the
 * fields interact: `patternType` and `ignoreCase` are properties of the whole
 * command, not of one pattern, so git applies them to `grep` and `author`
 * alike. That is why they are not per-pattern here either — the type should
 * not be able to express something git cannot do.
 */
export interface CommitSearchParams {
  /** Message patterns. More than one is ORed by git unless `allMatch`. */
  readonly grep?: readonly string[];
  /** Require every `grep` to match, rather than any (`--all-match`). */
  readonly allMatch?: boolean;
  readonly author?: string;
  /** Approxidate — git parses "2 weeks ago" and "2026-01-02" alike. */
  readonly since?: string;
  readonly until?: string;
  /**
   * Limit to these paths. Pathspecs, so wildcards and `:(icase)` work.
   *
   * Here rather than on `LogOptions` because a pathspec limits which commits
   * come back exactly as `--grep` does — it is part of the search, and the
   * File Log and the search box both produce one.
   */
  readonly paths?: readonly string[];
  /** How git reads every pattern above. Git's own default is `extended`. */
  readonly patternType?: 'fixed' | 'extended';
  readonly ignoreCase?: boolean;
}

export interface LogOptions extends ReadOptions, CommitSearchParams {
  /** Commits to stop after. Omit only when the history is known to be small. */
  readonly maxCount?: number;
  /** Revision range, e.g. `['main']` or `['origin/main..HEAD']`. Defaults to HEAD. */
  readonly revisions?: readonly string[];
  /** Follow only the first parent, which flattens merge bubbles. */
  readonly firstParent?: boolean;
  /** Order by topology rather than date — what the commit graph needs. */
  readonly topoOrder?: boolean;
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
  // Keeps a branch's commits together instead of interleaving them by date,
  // which is what stops the graph's lanes zig-zagging. `git log --graph`
  // turns this on for itself for the same reason.
  if (options.topoOrder === true) args.push('--topo-order');

  /*
   * Limiting patterns.
   *
   * `--fixed-strings` / `--extended-regexp` are stateful in git's argument
   * parser — each one applies to the patterns that follow it — so they go in
   * first, before any `--grep` or `--author`. A pattern type placed after its
   * pattern silently does nothing.
   *
   * Every value uses the `--flag=value` form. A search for `-v` passed as two
   * arguments would be read as an option, and a leading dash is exactly the
   * sort of thing that ends up in a commit message.
   */
  if (options.patternType === 'fixed') args.push('--fixed-strings');
  if (options.patternType === 'extended') args.push('--extended-regexp');
  if (options.ignoreCase === true) args.push('--regexp-ignore-case');
  for (const pattern of options.grep ?? []) args.push(`--grep=${pattern}`);
  // Git ORs multiple --grep; this is what makes two typed words an AND.
  if (options.allMatch === true) args.push('--all-match');
  if (options.author !== undefined) args.push(`--author=${options.author}`);
  if (options.since !== undefined) args.push(`--since=${options.since}`);
  if (options.until !== undefined) args.push(`--until=${options.until}`);

  if (options.revisions !== undefined) args.push(...options.revisions);
  // `--` separates revisions from paths; without it a path that matches a
  // branch name is ambiguous and git refuses the command.
  if (options.paths !== undefined && options.paths.length > 0) args.push('--', ...options.paths);
  return args;
}

export interface CommitOptions extends ReadOptions {
  /** Replace the previous commit instead of adding one. */
  readonly amend?: boolean;
  readonly signoff?: boolean;
  readonly allowEmpty?: boolean;
  /** `Name <email>` — overrides the author, not the committer. */
  readonly author?: string;
  /** Commit only these paths, bypassing the index. */
  readonly paths?: readonly string[];
}

export interface CommitOutcome {
  /** False when there was nothing staged — not an error. */
  readonly created: boolean;
  readonly summary: string;
}

function firstLine(text: string): string {
  for (const line of text.split('\n')) {
    if (line.trim() !== '') return line.trim();
  }
  return '';
}

export class CommitService {
  constructor(private readonly runner: GitRunner) {}

  /**
   * Walk history, streaming.
   *
   * **An empty result has to be earned.** Two things can produce one — a
   * repository with no commits, and a failure that lost git's output — and a
   * history panel cannot tell them apart, so this does it here.
   *
   * Measured against git 2.47, every way `log` can exit 128:
   *
   *     fresh `git init`, no revisions   fatal: your current branch 'main'
   *                                      does not have any commits yet
   *     fresh `git init`, `--all`        exit 0, no output at all
   *     a ref pointing at a dead object  fatal: bad object refs/stash
   *     a revision that does not exist   fatal: ambiguous argument 'x':
   *                                      unknown revision or path…
   *
   * Only the first is an empty history. The last used to be treated as one
   * too, which meant a branch deleted out from under the merge wizard read as
   * "already up to date" rather than as the failure it is.
   */
  async list(options: LogOptions = {}): Promise<Result<Commit[], GitError>> {
    const args = logArgs(options);
    const parser = createLogParser();
    const commits: Commit[] = [];
    let parseError: unknown;
    /** Chunks this side actually received, to check against what Go emitted. */
    let received = 0;

    const streamOptions: StreamOptions = {
      // Records are NUL-terminated, so cutting there never splits a field.
      delimiter: 'nul',
      okExitCodes: [0, 128],
      ...(options.signal !== undefined && { signal: options.signal }),
    };

    const result = await this.runner.execStream(
      args,
      (chunk) => {
        received += 1;
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
      // The one 128 that means "no history", not "something went wrong".
      if (/does not have any commits yet/i.test(result.value.stderr)) return ok([]);
      return err(parseFailure(new Error(result.value.stderr.trim()), context));
    }

    /*
     * Every chunk git emitted has to have arrived.
     *
     * Chunks travel as events, and an event bus can drop one — in browser dev
     * mode a reconnecting WebSocket does exactly that. The process still exits
     * 0, so without this check a log whose output never reached us returns an
     * empty array and the Journal renders "No commits yet" over a repository
     * full of commits. Go counts what it sent; this counts what arrived, and
     * a mismatch is a failure rather than a history.
     */
    if (received !== result.value.chunks) {
      return err(
        parseFailure(
          new Error(
            `git emitted ${result.value.chunks} chunk${result.value.chunks === 1 ? '' : 's'} ` +
              `but ${received} arrived — ${result.value.bytesOut} bytes of output were lost ` +
              `in transit`,
          ),
          context,
        ),
      );
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

  /**
   * Create a commit.
   *
   * The message goes in on **stdin** (`-F -`), not as an argument. A commit
   * message can be thousands of characters with newlines, quotes and
   * backticks in it; passing it as argv means fighting shell-free exec limits
   * and getting the encoding right for no benefit.
   *
   * Hooks are left enabled. A pre-commit hook refusing the commit is a real
   * answer the user needs to see, and `GIT_TERMINAL_PROMPT=0` from the Go
   * layer stops an interactive one from hanging the app.
   */
  async create(
    message: string,
    options: CommitOptions = {},
  ): Promise<Result<CommitOutcome, GitError>> {
    const args = ['commit', '--file', '-'];
    if (options.amend === true) args.push('--amend');
    if (options.signoff === true) args.push('--signoff');
    if (options.allowEmpty === true) args.push('--allow-empty');
    if (options.author !== undefined) args.push('--author', options.author);
    if (options.paths !== undefined && options.paths.length > 0) {
      args.push('--', ...options.paths);
    }

    const result = await this.runner.exec(args, {
      stdin: message,
      // Exit 1 with "nothing to commit" is an answer, not a failure.
      okExitCodes: [0, 1],
      ...(options.signal !== undefined && { signal: options.signal }),
    });
    if (!result.ok) return result;

    const { stdout, stderr, exitCode } = result.value;
    if (exitCode !== 0) {
      if (/nothing to commit|no changes added to commit/i.test(stdout + stderr)) {
        return ok({ created: false, summary: 'Nothing to commit' });
      }
      return err(
        parseFailure(new Error(firstLine(stderr) || firstLine(stdout)), {
          args,
          repoPath: this.runner.repoPath,
        }),
      );
    }

    return ok({ created: true, summary: firstLine(stdout) });
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
