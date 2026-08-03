/**
 * The argv `CommitService.list` builds for a search.
 *
 * Asserted as arguments rather than results because every failure here is
 * silent: git accepts `--grep=x --fixed-strings` and reads the pattern as a
 * regex anyway, since the pattern type only applies to what follows it. That
 * produces a search that works for most inputs and quietly misbehaves on the
 * ones containing `.` or `*` — no error, no exit code, just wrong rows.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { GitRunRequest, GitStreamResult } from '../wails';
import { CommitService, type LogOptions } from './CommitService';
import { GitRunner, type GitBridge } from './GitRunner';
import { resetRepoLocks } from './RepoLock';

const REPO = '/repos/example';

/** Runs a log and hands back the arguments git was actually invoked with. */
async function argsFor(options: LogOptions): Promise<string[]> {
  let captured: string[] = [];
  const bridge: GitBridge = {
    run: () =>
      Promise.resolve({ stdout: '', stderr: '', exitCode: 0, durationMs: 1, timedOut: false }),
    runStream: (request: GitRunRequest): Promise<GitStreamResult> => {
      captured = [...request.args];
      return Promise.resolve({
        stderr: '',
        exitCode: 0,
        durationMs: 1,
        timedOut: false,
        canceled: false,
        bytesOut: 0,
        chunks: 0,
      });
    },
  };
  await new CommitService(new GitRunner(REPO, { bridge })).list(options);
  return captured;
}

beforeEach(() => {
  resetRepoLocks();
});

describe('pattern type', () => {
  it('places --fixed-strings before the patterns it governs', () => {
    return argsFor({ patternType: 'fixed', grep: ['v1.2'] }).then((args) => {
      expect(args.indexOf('--fixed-strings')).toBeLessThan(args.indexOf('--grep=v1.2'));
    });
  });

  it('places --extended-regexp before the patterns it governs', async () => {
    const args = await argsFor({ patternType: 'extended', grep: ['a.*b'], author: 'ivan' });
    expect(args.indexOf('--extended-regexp')).toBeLessThan(args.indexOf('--grep=a.*b'));
    expect(args.indexOf('--extended-regexp')).toBeLessThan(args.indexOf('--author=ivan'));
  });

  it('sends neither when none was asked for', async () => {
    const args = await argsFor({ grep: ['x'] });
    expect(args).not.toContain('--fixed-strings');
    expect(args).not.toContain('--extended-regexp');
  });
});

describe('patterns', () => {
  it('uses the --flag=value form, so a pattern may start with a dash', async () => {
    // Two arguments would make git read `-v` as an option.
    const args = await argsFor({ grep: ['-v'], author: '-x' });
    expect(args).toContain('--grep=-v');
    expect(args).toContain('--author=-x');
  });

  it('emits one --grep per pattern, plus --all-match when asked', async () => {
    const args = await argsFor({ grep: ['fix', 'parser'], allMatch: true });
    expect(args).toContain('--grep=fix');
    expect(args).toContain('--grep=parser');
    expect(args).toContain('--all-match');
  });

  it('passes dates through untouched for git to parse', async () => {
    const args = await argsFor({ since: '2 weeks ago', until: '2026-01-02' });
    expect(args).toContain('--since=2 weeks ago');
    expect(args).toContain('--until=2026-01-02');
  });

  it('omits every flag that was not set', async () => {
    const args = await argsFor({ maxCount: 10 });
    expect(args.filter((arg) => arg.startsWith('--grep'))).toEqual([]);
    expect(args).not.toContain('--all-match');
    expect(args.some((arg) => arg.startsWith('--author'))).toBe(false);
  });
});

describe('ordering against revisions and paths', () => {
  it('keeps limiting flags before the revisions', async () => {
    const args = await argsFor({ grep: ['fix'], revisions: ['--all'] });
    expect(args.indexOf('--grep=fix')).toBeLessThan(args.indexOf('--all'));
  });

  it('keeps pathspecs after the `--` separator', async () => {
    const args = await argsFor({ grep: ['fix'], paths: [':(icase)*log*'] });
    const separator = args.indexOf('--');
    expect(separator).toBeGreaterThan(-1);
    expect(args.indexOf(':(icase)*log*')).toBeGreaterThan(separator);
    expect(args.indexOf('--grep=fix')).toBeLessThan(separator);
  });
});
