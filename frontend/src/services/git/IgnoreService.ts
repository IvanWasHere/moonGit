/**
 * `git check-ignore` — which rule, in which file, decides a path's fate.
 *
 * This is the question an ignore editor actually gets asked. "Edit .gitignore"
 * is easy; "why is `dist/app.js` not showing up, and which of the four files
 * that can ignore it is responsible" is the part people lose time to, and git
 * answers it exactly.
 */

import { mapParsed } from './boundary';
import type { GitError } from './errors';
import { getGitRunner, type ExecOptions, type GitRunner } from './GitRunner';
import type { ReadOptions } from './RepositoryService';
import { ok, type Result } from './result';

function toExecOptions(options: ReadOptions): ExecOptions {
  return options.signal !== undefined ? { signal: options.signal } : {};
}

export interface IgnoreRule {
  /** The file the rule lives in, repo-relative or absolute as git reports it. */
  readonly source: string;
  /** 1-based line number within that file. */
  readonly line: number;
  readonly pattern: string;
  readonly path: string;
}

/**
 * `check-ignore -v -z` emits four NUL-terminated fields per path:
 * source, line number, pattern, pathname.
 *
 * `-z` rather than the default because the default is
 * `<source>:<line>:<pattern>\t<pathname>`, and both a source path and a pattern
 * may legally contain a colon — `.gitignore` can hold `foo:bar`, and on Windows
 * the source is `C:\…`. Splitting on colons would attribute the rule to the
 * wrong file.
 */
export function parseCheckIgnore(stdout: string): IgnoreRule[] {
  const fields = stdout.split('\0');
  const rules: IgnoreRule[] = [];

  // The trailing NUL leaves an empty final element, so a partial group at the
  // end is malformed rather than something to salvage.
  for (let i = 0; i + 3 < fields.length; i += 4) {
    const source = fields[i] ?? '';
    const line = Number.parseInt(fields[i + 1] ?? '', 10);
    const pattern = fields[i + 2] ?? '';
    const path = fields[i + 3] ?? '';
    // A path matched by no rule still gets a group, with the first three
    // fields empty. That is "not ignored", not a rule to report.
    if (source === '' && pattern === '') continue;
    rules.push({ source, line: Number.isNaN(line) ? 0 : line, pattern, path });
  }
  return rules;
}

export class IgnoreService {
  constructor(private readonly runner: GitRunner) {}

  /**
   * Which rule ignores each of these paths. Paths with no matching rule are
   * simply absent from the result.
   *
   * `--no-index` on purpose. Without it git reports nothing for a path that is
   * already tracked, because a tracked file is not ignored whatever the rules
   * say — true, and useless for the question being asked here, which is "which
   * rule matches this pattern". With it, the answer explains why `git add`
   * skipped a file *and* why an already-tracked file would be skipped if it
   * were not tracked.
   */
  async explain(
    paths: readonly string[],
    options: ReadOptions = {},
  ): Promise<Result<IgnoreRule[], GitError>> {
    if (paths.length === 0) return ok([]);

    // `--` keeps a path that begins with a dash from being read as an option.
    const args = ['check-ignore', '-v', '-z', '--no-index', '--', ...paths];
    const result = await this.runner.exec(args, {
      ...toExecOptions(options),
      // 1 is "none of these are ignored" — the answer for a clean path.
      okExitCodes: [0, 1],
    });
    return mapParsed(result, parseCheckIgnore, { args, repoPath: this.runner.repoPath });
  }
}

const services = new Map<string, IgnoreService>();

export function ignoreService(repoPath: string): IgnoreService {
  let service = services.get(repoPath);
  if (service === undefined) {
    service = new IgnoreService(getGitRunner(repoPath));
    services.set(repoPath, service);
  }
  return service;
}

/** Test-only. */
export function resetIgnoreServices(): void {
  services.clear();
}
