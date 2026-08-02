/**
 * Reading whole objects out of the object database.
 *
 * The diff viewer needs this for syntax highlighting, and the reason is worth
 * stating because it is the whole argument for the extra git call: a patch is
 * a set of *fragments*, and a tokenizer handed a fragment has no idea whether
 * it starts inside a block comment, a template literal or a JSX attribute. The
 * only way to colour a hunk correctly is to tokenize the file it came from and
 * then take the lines the hunk covers.
 *
 * `cat-file -s` runs first so a 40 MB generated file is refused before its
 * contents cross the Wails bridge, not after.
 */

import { mapParsed } from './boundary';
import type { GitError } from './errors';
import { getGitRunner, type ExecOptions, type GitRunner } from './GitRunner';
import type { ReadOptions } from './RepositoryService';
import { err, ok, type Result } from './result';

/**
 * The all-zero object id git prints for a side that has no object.
 *
 * The working-tree side of an unstaged diff is the obvious case — the file on
 * disk has not been hashed — and asking `cat-file` for it fails rather than
 * returning the file. Verified: `git diff --raw` on a modified, unstaged file
 * prints `0000000` as its destination.
 */
export function isNullOid(oid: string): boolean {
  return oid === '' || /^0+$/.test(oid);
}

function toExecOptions(options: ReadOptions): ExecOptions {
  return options.signal !== undefined ? { signal: options.signal } : {};
}

export class BlobService {
  constructor(private readonly runner: GitRunner) {}

  /** Size in bytes, without transferring the object. */
  async size(oid: string, options: ReadOptions = {}): Promise<Result<number, GitError>> {
    const args = ['cat-file', '-s', oid];
    const result = await this.runner.exec(args, toExecOptions(options));
    return mapParsed(result, (stdout) => Number.parseInt(stdout.trim(), 10), {
      args,
      repoPath: this.runner.repoPath,
    });
  }

  /**
   * An object's contents as text, or null when it is larger than `maxBytes`.
   *
   * Null is a limit, not a failure — the caller renders without highlighting
   * rather than showing an error for a file it can display perfectly well.
   */
  async text(
    oid: string,
    maxBytes: number,
    options: ReadOptions = {},
  ): Promise<Result<string | null, GitError>> {
    const measured = await this.size(oid, options);
    if (!measured.ok) return err(measured.error);
    if (measured.value > maxBytes) return ok(null);

    const args = ['cat-file', 'blob', oid];
    const result = await this.runner.exec(args, toExecOptions(options));
    return result.ok ? ok(result.value.stdout) : err(result.error);
  }

  /**
   * An object's contents as base64, or null when larger than `maxBytes`.
   *
   * Separate from `text` rather than an option on it because the two have
   * genuinely different callers and the wrong one is silently wrong: reading an
   * image as text returns a string full of U+FFFD that renders as a broken
   * picture with no error to explain it.
   */
  async base64(
    oid: string,
    maxBytes: number,
    options: ReadOptions = {},
  ): Promise<Result<string | null, GitError>> {
    const measured = await this.size(oid, options);
    if (!measured.ok) return err(measured.error);
    if (measured.value > maxBytes) return ok(null);

    const args = ['cat-file', 'blob', oid];
    const result = await this.runner.exec(args, {
      ...toExecOptions(options),
      encoding: 'base64',
    });
    return result.ok ? ok(result.value.stdout) : err(result.error);
  }
}

const services = new Map<string, BlobService>();

export function blobService(repoPath: string): BlobService {
  let service = services.get(repoPath);
  if (service === undefined) {
    service = new BlobService(getGitRunner(repoPath));
    services.set(repoPath, service);
  }
  return service;
}

/** Test-only. */
export function resetBlobServices(): void {
  services.clear();
}
