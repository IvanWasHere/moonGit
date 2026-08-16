/**
 * Which paths exist, and which ones git is ignoring.
 *
 * The file explorer needs both, and they come from different places on
 * purpose. **The tree is read from the filesystem**, not from git: a file
 * explorer that only listed tracked files would hide the untracked ones, and
 * "the file I just created isn't there" is the first thing anyone would notice.
 * So directory listing goes through `fsapi.listDir` and this service answers
 * only the question the filesystem cannot: what does `.gitignore` say.
 *
 * `ls-files` is here too, for quick open, where the opposite trade is right —
 * a flat list of every path in the repository has to come from one command,
 * not a recursive walk of a 500k-file tree.
 */

import { parseFailure } from './boundary';
import type { GitError } from './errors';
import {
  getGitRunner,
  type ExecOptions,
  type GitRunner,
  type StreamOptions,
} from './GitRunner';
import type { ReadOptions } from './RepositoryService';
import { err, ok, type Result } from './result';

function toExecOptions(options: ReadOptions): ExecOptions {
  return options.signal !== undefined ? { signal: options.signal } : {};
}

/** Split NUL-terminated output, dropping the empty tail. */
function splitNul(stdout: string): string[] {
  return stdout.split('\0').filter((entry) => entry !== '');
}

/**
 * An incremental NUL splitter, for `listPaths`.
 *
 * Go cuts chunks at the last delimiter inside its window, so *usually* a chunk
 * ends on a whole record — but not always, and the exception is the one that
 * would corrupt a path silently. A record longer than the hard cap is flushed
 * mid-record to bound memory (`internal/gitexec/chunker.go`), and the final
 * chunk is whatever `flush()` had left. So the tail after the last NUL is
 * carried rather than emitted, exactly as `createLogParser` carries a partial
 * field. Splitting each chunk independently would turn one long path into two
 * plausible-looking short ones, which quick open would then happily offer.
 */
function createPathParser(): {
  push(chunk: string): string[];
  flush(): string[];
} {
  let partial = '';
  return {
    push(chunk: string): string[] {
      const parts = (partial + chunk).split('\0');
      // The last piece has no terminating NUL yet, so it is not a whole path.
      partial = parts.pop() ?? '';
      return parts.filter((entry) => entry !== '');
    },
    flush(): string[] {
      // `ls-files -z` terminates every path, so a non-empty tail means the
      // stream was cut short. Return it rather than discarding data; the
      // caller's chunk-count check is what decides whether that is a failure.
      const tail = partial;
      partial = '';
      return tail === '' ? [] : [tail];
    },
  };
}

/** The corpus query behind quick open. See `TreeService.listPaths`. */
export const LS_FILES_ARGS: readonly string[] = [
  'ls-files',
  '-z',
  '--cached',
  '--others',
  '--exclude-standard',
];

export class TreeService {
  constructor(private readonly runner: GitRunner) {}

  /**
   * Which of `paths` git ignores.
   *
   * Paths go in on **stdin**, not argv. A directory listing can be thousands
   * of entries and every one of them may contain spaces, quotes or newlines;
   * `--stdin -z` moves the whole set across in one call with no quoting rules
   * to get wrong.
   *
   * **Exit 1 is the answer "none of them".** `check-ignore` reports its result
   * in the exit status — 0 when at least one path matched, 1 when none did,
   * 128 for a real error. Treating 1 as a failure would make every unignored
   * directory in the tree render as an error.
   */
  async ignored(
    paths: readonly string[],
    options: ReadOptions = {},
  ): Promise<Result<Set<string>, GitError>> {
    if (paths.length === 0) return ok(new Set());

    const args = ['check-ignore', '-z', '--stdin'];
    const result = await this.runner.exec(args, {
      ...toExecOptions(options),
      // Each path is NUL-terminated on the way in as well, matching `-z`.
      stdin: `${paths.join('\0')}\0`,
      okExitCodes: [0, 1],
    });
    if (!result.ok) return result;
    if (result.value.exitCode === 1) return ok(new Set());

    return ok(new Set(splitNul(result.value.stdout)));
  }

  /**
   * Every path in the repository, for quick open. **Streamed.**
   *
   * `--cached --others --exclude-standard` is tracked files plus untracked
   * ones that are not ignored — which is exactly the set a user expects to be
   * able to jump to. Deleted-but-still-tracked files are in `--cached` and are
   * left in: they still have history worth opening.
   *
   * Named rather than inline so the Phase 7 benchmark measures this command
   * and not a copy of it that drifts (`bench/git.bench.test.ts`), which is why
   * `STATUS_ARGS` and `LOG_BASE_ARGS` are constants too.
   *
   * **Why this streams (PLAN.md §10, the streaming audit).** Measured on the
   * bench repository, this command returns **11.9MB** — and it used to cross
   * the bridge as a single JSON string, which means one allocation of the whole
   * payload in Go, another in the webview, and a parse of both before the first
   * path is usable. Streaming replaces that with 64 KB chunks and a `Set` that
   * grows as they arrive; peak memory becomes the corpus, not the corpus twice
   * over plus its JSON encoding.
   *
   * What it does *not* fix, and should not be expected to: git itself takes
   * 2191ms to produce that output. This changes the shape of the transfer, not
   * the wait. Quick open is still gated on the command finishing, because its
   * consumer is a TanStack query with a single resolved value — delivering
   * matches progressively is a separate change to `usePaths` and `QuickOpen`,
   * and this deliberately does not pre-build an `onBatch` hook for it that
   * nothing calls.
   */
  async listPaths(options: ReadOptions = {}): Promise<Result<string[], GitError>> {
    const args = LS_FILES_ARGS;
    const parser = createPathParser();
    // `ls-files` lists a path once per index entry, so a file with merge
    // conflicts appears three times — one per stage. The tree is a set of
    // paths, not of index entries, and de-duplicating as chunks arrive avoids
    // holding a second full-size array to do it at the end.
    const paths = new Set<string>();
    let parseError: unknown;
    /** Chunks this side actually received, to check against what Go emitted. */
    let received = 0;

    const streamOptions: StreamOptions = {
      // Paths are NUL-terminated, so cutting there rarely splits a record —
      // and `createPathParser` carries the tail for the times it does.
      delimiter: 'nul',
      ...(options.signal !== undefined && { signal: options.signal }),
    };

    const result = await this.runner.execStream(
      args,
      (chunk) => {
        received += 1;
        if (parseError !== undefined) return;
        try {
          for (const path of parser.push(chunk)) paths.add(path);
        } catch (cause) {
          // Keep draining rather than throwing through the event handler,
          // which would surface as an unhandled rejection.
          parseError = cause;
        }
      },
      streamOptions,
    );

    if (!result.ok) return result;
    const context = { args, repoPath: this.runner.repoPath };
    if (parseError !== undefined) return err(parseFailure(parseError, context));

    /*
     * Every chunk git emitted has to have arrived.
     *
     * The same guard `CommitService.list` carries, for the same reason: chunks
     * travel as events and an event bus can drop one — a reconnecting WebSocket
     * in browser dev mode does exactly that. The process still exits 0, so
     * without this a corpus that never reached us becomes an empty array, and
     * quick open renders "no matches" over a repository full of files.
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

    for (const path of parser.flush()) paths.add(path);
    return ok([...paths]);
  }
}

const services = new Map<string, TreeService>();

export function treeService(repoPath: string): TreeService {
  let service = services.get(repoPath);
  if (service === undefined) {
    service = new TreeService(getGitRunner(repoPath));
    services.set(repoPath, service);
  }
  return service;
}

/** Test-only. */
export function resetTreeServices(): void {
  services.clear();
}
