/**
 * `git config` — reading and writing the repository's own settings.
 *
 * The distinction that matters here is **local versus effective**. A repository
 * usually sets almost nothing: `user.email` is normally inherited from the
 * user's global config, and a panel that showed an empty box for it would be
 * saying "unset" when the answer is "Ivan's global address, and commits made
 * here will carry it". So both are read, and the UI shows the inherited value
 * where nothing local overrides it.
 *
 * These are the *repository's* settings, distinct from `settingsStore`'s, which
 * belong to the moonGit install and live in SQLite. Nothing here is mirrored
 * into that database — the config file is the source of truth, the same rule
 * §1.2 applies to every other piece of git state.
 */

import { mapParsed } from './boundary';
import type { GitError } from './errors';
import { getGitRunner, type ExecOptions, type GitRunner } from './GitRunner';
import type { ReadOptions } from './RepositoryService';
import { err, ok, type Result } from './result';

function toExecOptions(options: ReadOptions): ExecOptions {
  return options.signal !== undefined ? { signal: options.signal } : {};
}

export interface ConfigEntry {
  readonly key: string;
  readonly value: string;
}

/**
 * Where a value is read from or written to.
 *
 * `effective` is read-only by construction: it is the merge of system, global
 * and local, so there is no single file to write it back to.
 */
export type ConfigScope = 'local' | 'global' | 'effective';

/**
 * `config --list -z` emits `key\nvalue\0` per entry, and `key\0` for a
 * valueless one (`[section] flag` with nothing after it).
 *
 * The `-z` form rather than the line-oriented default because a config value
 * may legally contain newlines — a multi-line `alias.*` is common — and line
 * splitting would turn one alias into several entries with garbage keys.
 */
export function parseConfigList(stdout: string): ConfigEntry[] {
  const entries: ConfigEntry[] = [];
  for (const record of stdout.split('\0')) {
    if (record === '') continue;
    const newline = record.indexOf('\n');
    entries.push(
      newline === -1
        ? { key: record, value: '' }
        : { key: record.slice(0, newline), value: record.slice(newline + 1) },
    );
  }
  return entries;
}

/**
 * Config keys are `section.name` or `section.subsection.name`, where the
 * subsection may contain almost anything (a remote URL lives in one).
 *
 * Validated before the key reaches argv, and this is the point of the function
 * rather than tidiness: `git config --local` takes its key positionally, so a
 * "key" of `--global` would be read as an *option* and quietly write to the
 * user's global file instead. Every key here comes from a fixed list in the UI
 * today, but the guard belongs beside the command rather than in the caller
 * that happens to be safe right now.
 */
export function isValidConfigKey(key: string): boolean {
  if (key.startsWith('-') || key.includes('\n') || key.includes('\0')) return false;
  return /^[A-Za-z][A-Za-z0-9-]*(\..+)?\.[A-Za-z][A-Za-z0-9-]*$/.test(key);
}

/**
 * A value git will not mistake for an option.
 *
 * Same argv concern as the key, and with the same non-solution: `git config`
 * has no `--` separator to hide behind. A value that starts with a dash is
 * refused rather than sent, which costs nothing real — no git config value
 * anybody sets from this panel begins with one.
 */
export function isSafeConfigValue(value: string): boolean {
  return !value.startsWith('-') && !value.includes('\0');
}

function refused(
  message: string,
  args: readonly string[],
  repoPath: string,
): Result<never, GitError> {
  return err({
    kind: 'Unknown',
    message,
    stderr: '',
    exitCode: -1,
    args,
    repoPath,
  });
}

export class ConfigService {
  constructor(private readonly runner: GitRunner) {}

  /**
   * Every entry in a scope.
   *
   * Exits 1 when the file does not exist — a repository with no local config,
   * or a user with no `~/.gitconfig` — which is an answer, not a failure.
   */
  async list(
    scope: ConfigScope = 'local',
    options: ReadOptions = {},
  ): Promise<Result<ConfigEntry[], GitError>> {
    const args = ['config', ...scopeArgs(scope), '--list', '-z'];
    const result = await this.runner.exec(args, {
      ...toExecOptions(options),
      okExitCodes: [0, 1],
    });
    return mapParsed(result, parseConfigList, { args, repoPath: this.runner.repoPath });
  }

  /** A single value, or null when it is not set in that scope. */
  async get(
    key: string,
    scope: ConfigScope = 'local',
    options: ReadOptions = {},
  ): Promise<Result<string | null, GitError>> {
    const args = ['config', ...scopeArgs(scope), '--get', key];
    if (!isValidConfigKey(key)) {
      return refused(`${key} is not a valid config key`, args, this.runner.repoPath);
    }
    const result = await this.runner.exec(args, {
      ...toExecOptions(options),
      // 1 is "no such key". Every other non-zero is a real failure.
      okExitCodes: [0, 1],
    });
    if (!result.ok) return result;
    return ok(result.value.exitCode === 0 ? trimTrailingNewline(result.value.stdout) : null);
  }

  async set(
    key: string,
    value: string,
    scope: Exclude<ConfigScope, 'effective'> = 'local',
    options: ReadOptions = {},
  ): Promise<Result<void, GitError>> {
    const args = ['config', ...scopeArgs(scope), key, value];
    if (!isValidConfigKey(key)) {
      return refused(`${key} is not a valid config key`, args, this.runner.repoPath);
    }
    if (!isSafeConfigValue(value)) {
      return refused('A config value cannot begin with “-”', args, this.runner.repoPath);
    }
    const result = await this.runner.exec(args, toExecOptions(options));
    return result.ok ? ok(undefined) : result;
  }

  /**
   * Remove a key, falling back to the inherited value.
   *
   * Exit 5 is "you asked me to unset something that was not set", which is the
   * outcome the caller wanted either way.
   */
  async unset(
    key: string,
    scope: Exclude<ConfigScope, 'effective'> = 'local',
    options: ReadOptions = {},
  ): Promise<Result<void, GitError>> {
    const args = ['config', ...scopeArgs(scope), '--unset', key];
    if (!isValidConfigKey(key)) {
      return refused(`${key} is not a valid config key`, args, this.runner.repoPath);
    }
    const result = await this.runner.exec(args, {
      ...toExecOptions(options),
      okExitCodes: [0, 5],
    });
    return result.ok ? ok(undefined) : result;
  }
}

function scopeArgs(scope: ConfigScope): string[] {
  switch (scope) {
    case 'local':
      return ['--local'];
    case 'global':
      return ['--global'];
    case 'effective':
      // No scope flag: git merges system, global and local, which is what the
      // repository will actually behave like.
      return [];
  }
}

function trimTrailingNewline(text: string): string {
  return text.endsWith('\n') ? text.slice(0, -1) : text;
}

const services = new Map<string, ConfigService>();

export function configService(repoPath: string): ConfigService {
  let service = services.get(repoPath);
  if (service === undefined) {
    service = new ConfigService(getGitRunner(repoPath));
    services.set(repoPath, service);
  }
  return service;
}

/** Test-only. */
export function resetConfigServices(): void {
  services.clear();
}
