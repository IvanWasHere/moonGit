/**
 * `GitRunner` — one door to git.
 *
 * Every git command in moonGit goes through here. Not as a style preference:
 * the four things this owns (serialization, timeouts, cancellation, error
 * classification) are only correct if they are *unavoidable*. A domain service
 * that reached past this to the Wails bridge would skip the repository lock,
 * and the resulting `index.lock` collisions would be intermittent and blamed
 * on git.
 *
 * Layering (PLAN.md §5): Go runs processes and knows nothing about git; this
 * file knows git's execution model but not its output; the parsers know its
 * output but perform no I/O. Nothing here inspects stdout beyond passing it on.
 */

import { runGit, runGitStream } from '../wails';
import type { GitDelimiter, GitRunRequest, GitRunResult, GitStreamResult } from '../wails';
import { isReadOnly } from './commands';
import { toGitError, type GitError } from './errors';
import { err, ok, type Result } from './result';
import { repoLockFor, type LockMode, type RepoLock } from './RepoLock';

/**
 * The slice of the Wails bridge the runner needs.
 *
 * Declared as an interface so tests drive a fake instead of mocking modules —
 * these are the highest-traffic code paths in the app and they should be
 * testable without a webview anywhere in sight.
 */
export interface GitBridge {
  run(request: GitRunRequest): Promise<GitRunResult>;
  runStream(
    request: GitRunRequest & { delimiter?: GitDelimiter; chunkSize?: number },
    handlers: { onChunk: (data: string, seq: number) => void; signal?: AbortSignal },
  ): Promise<GitStreamResult>;
}

const wailsBridge: GitBridge = {
  run: runGit,
  runStream: runGitStream,
};

export interface GitOutput {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly durationMs: number;
}

/** What a stream produced. Stdout is absent by design — it went to `onChunk`. */
export interface GitStreamOutput {
  readonly stderr: string;
  readonly exitCode: number;
  readonly durationMs: number;
  readonly bytesOut: number;
  readonly chunks: number;
}

export interface ExecOptions {
  readonly stdin?: string;
  readonly env?: readonly string[];
  readonly timeoutMs?: number;
  /**
   * Exit codes to treat as success. Defaults to `[0]`.
   *
   * Several git commands answer questions with their exit status —
   * `diff --quiet` exits 1 when there are changes, `merge-base --is-ancestor`
   * exits 1 for "no". Those callers pass `[0, 1]` and read `exitCode`; without
   * this they would have to catch an error to learn a boolean.
   */
  readonly okExitCodes?: readonly number[];
  /** Override the read/write classification from `commands.ts`. */
  readonly mode?: LockMode;
  readonly signal?: AbortSignal;
}

export interface StreamOptions extends ExecOptions {
  /** Where chunks may be cut. `nul` for `-z` output, `lf` for line-oriented. */
  readonly delimiter?: GitDelimiter;
  readonly chunkSize?: number;
}

export interface GitRunnerOptions {
  readonly bridge?: GitBridge;
  /** Applied when a call does not set its own. 30 s matches the Go default. */
  readonly defaultTimeoutMs?: number;
  readonly lock?: RepoLock;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Read the abort flag through a call.
 *
 * Inline `signal?.aborted` checks look identical but are worse: TypeScript
 * narrows the property after the first test and then treats every later test
 * as dead code — which is exactly wrong for a flag whose whole purpose is to
 * flip while we are awaiting something.
 */
function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted ?? false;
}

export class GitRunner {
  private readonly bridge: GitBridge;
  private readonly defaultTimeoutMs: number;
  private readonly lock: RepoLock;

  constructor(
    readonly repoPath: string,
    options: GitRunnerOptions = {},
  ) {
    this.bridge = options.bridge ?? wailsBridge;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.lock = options.lock ?? repoLockFor(repoPath);
  }

  /**
   * Run git and buffer the output.
   *
   * For bounded output only. `git log` on a large repository is hundreds of
   * megabytes and returning that across the bridge in one value stalls the
   * webview — use `execStream` (PLAN.md §4.1).
   */
  async exec(
    args: readonly string[],
    options: ExecOptions = {},
  ): Promise<Result<GitOutput, GitError>> {
    if (isAborted(options.signal)) return err(this.canceled(args));

    return this.lock.run(this.modeFor(args, options), async () => {
      // Re-checked after the wait: a queued command whose caller has since
      // navigated away should not spawn a process at all.
      if (isAborted(options.signal)) return err(this.canceled(args));

      let result: GitRunResult;
      try {
        result = await this.bridge.run(this.request(args, options));
      } catch (cause) {
        return err(this.spawnFailed(args, cause));
      }

      if (result.timedOut) {
        return err(this.fail(args, result, 'Timeout'));
      }
      // A buffered run cannot be killed mid-flight — Go exposes no run id for
      // it — so an abort that lands here means the output is unwanted rather
      // than unavailable. Discard it instead of feeding a stale answer to a
      // caller that has moved on.
      if (isAborted(options.signal)) return err(this.canceled(args));

      const accepted = options.okExitCodes ?? [0];
      if (!accepted.includes(result.exitCode)) {
        return err(this.fail(args, result));
      }

      return ok({
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
      });
    });
  }

  /**
   * Run git and receive stdout incrementally.
   *
   * `onChunk` is called in order with chunks cut on record boundaries, so a
   * parser fed from here never sees a split record. The repository lock is
   * held for the whole stream.
   */
  async execStream(
    args: readonly string[],
    onChunk: (data: string, seq: number) => void,
    options: StreamOptions = {},
  ): Promise<Result<GitStreamOutput, GitError>> {
    if (isAborted(options.signal)) return err(this.canceled(args));

    return this.lock.run(this.modeFor(args, options), async () => {
      if (isAborted(options.signal)) return err(this.canceled(args));

      let result: GitStreamResult;
      try {
        result = await this.bridge.runStream(
          {
            ...this.request(args, options),
            ...(options.delimiter !== undefined && { delimiter: options.delimiter }),
            ...(options.chunkSize !== undefined && { chunkSize: options.chunkSize }),
          },
          {
            onChunk,
            ...(options.signal !== undefined && { signal: options.signal }),
          },
        );
      } catch (cause) {
        return err(this.spawnFailed(args, cause));
      }

      if (result.canceled) {
        return err(this.fail(args, result, 'Canceled'));
      }
      if (result.timedOut) {
        return err(this.fail(args, result, 'Timeout'));
      }

      const accepted = options.okExitCodes ?? [0];
      if (!accepted.includes(result.exitCode)) {
        return err(this.fail(args, result));
      }

      return ok({
        stderr: result.stderr,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        bytesOut: result.bytesOut,
        chunks: result.chunks,
      });
    });
  }

  private modeFor(args: readonly string[], options: ExecOptions): LockMode {
    return options.mode ?? (isReadOnly(args) ? 'read' : 'write');
  }

  private request(args: readonly string[], options: ExecOptions): GitRunRequest {
    return {
      repoPath: this.repoPath,
      args: [...args],
      ...(options.stdin !== undefined && { stdin: options.stdin }),
      ...(options.env !== undefined && { env: [...options.env] }),
      timeoutMs: options.timeoutMs ?? this.defaultTimeoutMs,
    };
  }

  private fail(
    args: readonly string[],
    /** Streams have no stdout here — it was handed to `onChunk` as it arrived. */
    result: { stderr: string; stdout?: string; exitCode: number },
    kind?: GitError['kind'],
  ): GitError {
    return toGitError({
      stderr: result.stderr,
      exitCode: result.exitCode,
      args,
      repoPath: this.repoPath,
      ...(result.stdout !== undefined && { stdout: result.stdout }),
      ...(kind !== undefined && { kind }),
    });
  }

  private canceled(args: readonly string[]): GitError {
    return this.fail(args, { stderr: '', exitCode: -1 }, 'Canceled');
  }

  private spawnFailed(args: readonly string[], cause: unknown): GitError {
    const message = cause instanceof Error ? cause.message : String(cause);
    return toGitError({
      stderr: message,
      exitCode: -1,
      args,
      repoPath: this.repoPath,
      kind: 'SpawnFailed',
      cause,
    });
  }
}

/**
 * Shared runners, one per repository path.
 *
 * Constructing runners ad hoc would still be safe — the lock is keyed by path,
 * not held by the instance — but a single instance per repository keeps a
 * future addition (a command log, in-flight counters for the status bar) from
 * seeing only a fraction of the traffic.
 */
const runners = new Map<string, GitRunner>();

export function getGitRunner(repoPath: string): GitRunner {
  let runner = runners.get(repoPath);
  if (runner === undefined) {
    runner = new GitRunner(repoPath);
    runners.set(repoPath, runner);
  }
  return runner;
}

/** Test-only: forget cached runners between suites. */
export function resetGitRunners(): void {
  runners.clear();
}
