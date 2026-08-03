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
import { getGitRunner, type ExecOptions, type GitRunner } from './GitRunner';
import type { ReadOptions } from './RepositoryService';
import { err, ok, type Result } from './result';

function toExecOptions(options: ReadOptions): ExecOptions {
  return options.signal !== undefined ? { signal: options.signal } : {};
}

/** Split NUL-terminated output, dropping the empty tail. */
function splitNul(stdout: string): string[] {
  return stdout.split('\0').filter((entry) => entry !== '');
}

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
   * Every path in the repository, for quick open.
   *
   * `--cached --others --exclude-standard` is tracked files plus untracked
   * ones that are not ignored — which is exactly the set a user expects to be
   * able to jump to. Deleted-but-still-tracked files are in `--cached` and are
   * left in: they still have history worth opening.
   */
  async listPaths(options: ReadOptions = {}): Promise<Result<string[], GitError>> {
    const args = ['ls-files', '-z', '--cached', '--others', '--exclude-standard'];
    const result = await this.runner.exec(args, toExecOptions(options));
    if (!result.ok) return result;

    try {
      // `ls-files` lists a path once per index entry, so a file with merge
      // conflicts appears three times — one per stage. The tree is a set of
      // paths, not of index entries.
      return ok([...new Set(splitNul(result.value.stdout))]);
    } catch (cause) {
      return err(parseFailure(cause, { args, repoPath: this.runner.repoPath }));
    }
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
