/**
 * Remotes, tags, and blame — the remaining reads and the network operations.
 *
 * Remotes are listed from `config --get-regexp` rather than `git remote -v`.
 * Both are parseable, but `remote -v` prints each remote twice (fetch and
 * push) with a trailing ` (fetch)` marker to strip, while the config form is
 * one line per remote and its shape is `remote.<name>.url <value>` — a name
 * that cannot contain spaces followed by the rest of the line.
 */

import { mapParsed } from './boundary';
import type { GitError } from './errors';
import { getGitRunner, type ExecOptions, type GitRunner } from './GitRunner';
import { BLAME_BASE_ARGS, parseBlame, type Blame } from './parsers';
import type { ReadOptions } from './RepositoryService';
import { err, ok, type Result } from './result';

function toExecOptions(options: ReadOptions): ExecOptions {
  return options.signal !== undefined ? { signal: options.signal } : {};
}

export interface Remote {
  readonly name: string;
  readonly url: string;
}

/** `remote.origin.url https://…` — the key has no spaces, the URL is the remainder. */
function parseRemotes(stdout: string): Remote[] {
  const remotes: Remote[] = [];
  for (const line of stdout.split('\n')) {
    if (line === '') continue;
    const space = line.indexOf(' ');
    if (space === -1) continue;
    const key = line.slice(0, space);
    const match = /^remote\.(.+)\.url$/.exec(key);
    if (match === null) continue;
    remotes.push({ name: match[1] ?? '', url: line.slice(space + 1) });
  }
  return remotes;
}

export interface FetchOptions extends ReadOptions {
  /** Fetch from every remote. */
  readonly all?: boolean;
  /** Delete remote-tracking refs whose upstream branch is gone. */
  readonly prune?: boolean;
  /** Fetch tags too. */
  readonly tags?: boolean;
}

/** Git's own rule: none of these may appear in a ref path, and a remote name becomes one. */
const FORBIDDEN_IN_REF = ' \t~^:?*[\\';

/**
 * Names git will accept, and that argv will not misread.
 *
 * Two rules with different reasons. Git's own: a remote name may not contain
 * whitespace or the ref metacharacters `~^:?*[\`, because it becomes part of a
 * ref path (`refs/remotes/<name>/…`). And ours: it may not begin with `-`,
 * because `git remote add` has no `--` separator, so a "name" of `--mirror`
 * would be read as an option and add a remote nobody asked for.
 */
export function isValidRemoteName(name: string): boolean {
  if (name === '' || name.startsWith('-') || name.startsWith('.') || name.endsWith('.lock')) {
    return false;
  }
  if (name.includes('..')) return false;
  // Checked character by character rather than with a regex class. The class
  // that expresses this needs three escapes and a trailing dash, and a
  // near-invisible mistake in one is a validator that quietly accepts what it
  // was written to refuse.
  return ![...name].some((char) => FORBIDDEN_IN_REF.includes(char) || char < ' ');
}

/**
 * A URL git will not read as an option.
 *
 * Deliberately not a URL *format* check: `git@host:org/repo.git`, `../sibling`,
 * `file:///srv/git/x`, and `ssh://…` are all legitimate, and a validator strict
 * enough to be worth having would reject something real. The only thing being
 * excluded is the leading dash, for the same argv reason as the name.
 */
export function isSafeRemoteUrl(url: string): boolean {
  const trimmed = url.trim();
  if (trimmed === '' || trimmed.startsWith('-')) return false;
  // Anything at or below the space character: whitespace would make the URL a
  // second argv word, and a control character has no business in one.
  return ![...trimmed].some((char) => char <= ' ');
}

function refusedRemote(
  message: string,
  args: readonly string[],
  repoPath: string,
): Result<never, GitError> {
  return err({ kind: 'Unknown', message, stderr: '', exitCode: -1, args, repoPath });
}

export class RemoteService {
  constructor(private readonly runner: GitRunner) {}

  async list(options: ReadOptions = {}): Promise<Result<Remote[], GitError>> {
    const args = ['config', '--get-regexp', '^remote\\..*\\.url$'];
    const result = await this.runner.exec(args, {
      ...toExecOptions(options),
      // `--get-regexp` exits 1 when nothing matches, which is a repository
      // with no remotes — an answer, not a failure.
      okExitCodes: [0, 1],
    });
    return mapParsed(result, parseRemotes, { args, repoPath: this.runner.repoPath });
  }

  async add(name: string, url: string, options: ReadOptions = {}): Promise<Result<void, GitError>> {
    const args = ['remote', 'add', name, url];
    const invalid = this.reject(name, url, args);
    if (invalid !== null) return invalid;

    const result = await this.runner.exec(args, toExecOptions(options));
    return result.ok ? ok(undefined) : result;
  }

  async remove(name: string, options: ReadOptions = {}): Promise<Result<void, GitError>> {
    const args = ['remote', 'remove', name];
    const invalid = this.reject(name, undefined, args);
    if (invalid !== null) return invalid;

    const result = await this.runner.exec(args, toExecOptions(options));
    return result.ok ? ok(undefined) : result;
  }

  /**
   * Rename a remote.
   *
   * `git remote rename` is the whole operation, not a config edit: it also
   * rewrites `refs/remotes/<old>/*` and every branch's `branch.*.remote`, so a
   * branch that tracked `origin/main` still tracks it afterwards. Editing
   * `remote.<name>.url` by hand would leave both dangling.
   */
  async rename(
    from: string,
    to: string,
    options: ReadOptions = {},
  ): Promise<Result<void, GitError>> {
    const args = ['remote', 'rename', from, to];
    const invalid = this.reject(from, undefined, args) ?? this.reject(to, undefined, args);
    if (invalid !== null) return invalid;

    const result = await this.runner.exec(args, toExecOptions(options));
    return result.ok ? ok(undefined) : result;
  }

  async setUrl(
    name: string,
    url: string,
    options: ReadOptions = {},
  ): Promise<Result<void, GitError>> {
    const args = ['remote', 'set-url', name, url];
    const invalid = this.reject(name, url, args);
    if (invalid !== null) return invalid;

    const result = await this.runner.exec(args, toExecOptions(options));
    return result.ok ? ok(undefined) : result;
  }

  /** Null when the inputs are usable; a refusal otherwise. */
  private reject(
    name: string,
    url: string | undefined,
    args: readonly string[],
  ): Result<never, GitError> | null {
    if (!isValidRemoteName(name)) {
      return refusedRemote(`“${name}” is not a valid remote name`, args, this.runner.repoPath);
    }
    if (url !== undefined && !isSafeRemoteUrl(url)) {
      return refusedRemote('That is not a usable remote URL', args, this.runner.repoPath);
    }
    return null;
  }

  /**
   * Fetch. Given a longer timeout than the default because this is the one
   * read that waits on a network and a credential helper.
   */
  async fetch(remote?: string, options: FetchOptions = {}): Promise<Result<void, GitError>> {
    const args = ['fetch'];
    if (options.all === true) args.push('--all');
    if (options.prune === true) args.push('--prune');
    if (options.tags === true) args.push('--tags');
    if (remote !== undefined) args.push(remote);

    const result = await this.runner.exec(args, {
      ...toExecOptions(options),
      timeoutMs: 120_000,
    });
    return result.ok ? ok(undefined) : result;
  }

  /**
   * Push.
   *
   * `--set-upstream` is passed when the branch has no upstream yet, which is
   * the difference between "pushed" and "fatal: The current branch has no
   * upstream branch" on the first push of a new branch.
   *
   * Force is `--force-with-lease`, never `--force`: with-lease refuses if the
   * remote moved since the last fetch, so it cannot silently discard someone
   * else's commits.
   */
  async push(options: PushOptions = {}): Promise<Result<PushOutcome, GitError>> {
    const args = ['push'];
    if (options.setUpstream === true) args.push('--set-upstream');
    if (options.force === true) args.push('--force-with-lease');
    if (options.tags === true) args.push('--tags');
    if (options.remote !== undefined) args.push(options.remote);
    if (options.branch !== undefined) args.push(options.branch);

    const result = await this.runner.exec(args, {
      ...toExecOptions(options),
      timeoutMs: 180_000,
    });
    if (!result.ok) return result;

    // git reports push progress on stderr even when it succeeds.
    const output = `${result.value.stdout}${result.value.stderr}`;
    return ok({
      upToDate: /Everything up-to-date/i.test(output),
      summary: firstNonEmptyLine(output),
    });
  }

  /**
   * Pull. Defaults to `--ff-only`.
   *
   * A pull that quietly creates a merge commit is how unwanted merge bubbles
   * get into history. Refusing and telling the user their branch has diverged
   * lets them choose merge or rebase deliberately.
   */
  async pull(options: PullOptions = {}): Promise<Result<void, GitError>> {
    const args = ['pull'];
    if (options.rebase === true) args.push('--rebase');
    else if (options.allowMerge !== true) args.push('--ff-only');
    if (options.remote !== undefined) args.push(options.remote);
    if (options.branch !== undefined) args.push(options.branch);

    const result = await this.runner.exec(args, {
      ...toExecOptions(options),
      timeoutMs: 180_000,
    });
    return result.ok ? ok(undefined) : result;
  }
}

export interface PushOptions extends ReadOptions {
  readonly remote?: string;
  readonly branch?: string;
  /** Needed on the first push of a branch that has no upstream. */
  readonly setUpstream?: boolean;
  /** Maps to `--force-with-lease`, never bare `--force`. */
  readonly force?: boolean;
  readonly tags?: boolean;
}

export interface PushOutcome {
  readonly upToDate: boolean;
  readonly summary: string;
}

export interface PullOptions extends ReadOptions {
  readonly remote?: string;
  readonly branch?: string;
  readonly rebase?: boolean;
  /** Permit a merge commit; without it a diverged branch is refused. */
  readonly allowMerge?: boolean;
}

function firstNonEmptyLine(text: string): string {
  for (const line of text.split('\n')) {
    if (line.trim() !== '') return line.trim();
  }
  return '';
}

export interface TagCreateOptions extends ReadOptions {
  /** Annotated tag with this message; omit for a lightweight tag. */
  readonly message?: string;
  /** Tag this revision instead of HEAD. */
  readonly target?: string;
  /** Move the tag if it already exists. */
  readonly force?: boolean;
}

export class TagService {
  constructor(private readonly runner: GitRunner) {}

  /**
   * Create a tag.
   *
   * Passing a message makes it annotated — a real object with a tagger and
   * date, which is what `refs.ts` reports as `annotated: true`.
   */
  async create(name: string, options: TagCreateOptions = {}): Promise<Result<void, GitError>> {
    const args = ['tag'];
    if (options.force === true) args.push('--force');
    if (options.message !== undefined) args.push('--annotate', '--message', options.message);
    args.push(name);
    if (options.target !== undefined) args.push(options.target);

    const result = await this.runner.exec(args, toExecOptions(options));
    return result.ok ? ok(undefined) : result;
  }

  async delete(name: string, options: ReadOptions = {}): Promise<Result<void, GitError>> {
    const result = await this.runner.exec(['tag', '--delete', name], toExecOptions(options));
    return result.ok ? ok(undefined) : result;
  }
}

export interface BlameOptions extends ReadOptions {
  /** Blame the file as of this revision instead of the working tree. */
  readonly revision?: string;
  /** `-w`: ignore whitespace-only changes when assigning blame. */
  readonly ignoreWhitespace?: boolean;
  /** `-M`: detect lines moved within the file. */
  readonly detectMoves?: boolean;
  /** Restrict to a line range, 1-based and inclusive. */
  readonly lineRange?: { readonly start: number; readonly end: number };
}

export class BlameService {
  constructor(private readonly runner: GitRunner) {}

  async blame(path: string, options: BlameOptions = {}): Promise<Result<Blame, GitError>> {
    const args = [...BLAME_BASE_ARGS];
    if (options.ignoreWhitespace === true) args.push('-w');
    if (options.detectMoves === true) args.push('-M');
    if (options.lineRange !== undefined) {
      args.push('-L', `${options.lineRange.start},${options.lineRange.end}`);
    }
    if (options.revision !== undefined) args.push(options.revision);
    // `--` keeps a path that looks like a revision from being read as one.
    args.push('--', path);

    const result = await this.runner.exec(args, toExecOptions(options));
    return mapParsed(result, parseBlame, { args, repoPath: this.runner.repoPath });
  }
}

const remoteServices = new Map<string, RemoteService>();
const tagServices = new Map<string, TagService>();
const blameServices = new Map<string, BlameService>();

export function remoteService(repoPath: string): RemoteService {
  let service = remoteServices.get(repoPath);
  if (service === undefined) {
    service = new RemoteService(getGitRunner(repoPath));
    remoteServices.set(repoPath, service);
  }
  return service;
}

export function tagService(repoPath: string): TagService {
  let service = tagServices.get(repoPath);
  if (service === undefined) {
    service = new TagService(getGitRunner(repoPath));
    tagServices.set(repoPath, service);
  }
  return service;
}

export function blameService(repoPath: string): BlameService {
  let service = blameServices.get(repoPath);
  if (service === undefined) {
    service = new BlameService(getGitRunner(repoPath));
    blameServices.set(repoPath, service);
  }
  return service;
}

/** Test-only. */
export function resetRemoteServices(): void {
  remoteServices.clear();
  tagServices.clear();
  blameServices.clear();
}
