/**
 * `TreeService` — the two questions the filesystem cannot answer.
 *
 * Both are exit-code-sensitive in ways that are easy to get wrong and quiet
 * when wrong: `check-ignore` reports its *answer* in the exit status, and
 * `ls-files` lists a conflicted path once per index stage.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { GitRunRequest, GitRunResult } from '../wails';
import { GitRunner, type GitBridge } from './GitRunner';
import { resetRepoLocks } from './RepoLock';
import { TreeService } from './TreeService';

const REPO = '/repos/example';

interface Plan {
  readonly stdout?: string;
  readonly exitCode?: number;
  readonly stderr?: string;
}

let lastRequest: GitRunRequest | null = null;

function serviceFor(plan: Plan): TreeService {
  const bridge: GitBridge = {
    run: (request: GitRunRequest): Promise<GitRunResult> => {
      lastRequest = request;
      return Promise.resolve({
        stdout: plan.stdout ?? '',
        stderr: plan.stderr ?? '',
        exitCode: plan.exitCode ?? 0,
        durationMs: 1,
        timedOut: false,
      });
    },
    runStream: () =>
      Promise.resolve({
        stderr: '',
        exitCode: 0,
        durationMs: 1,
        timedOut: false,
        canceled: false,
        bytesOut: 0,
        chunks: 0,
      }),
  };
  return new TreeService(new GitRunner(REPO, { bridge }));
}

beforeEach(() => {
  resetRepoLocks();
  lastRequest = null;
});

describe('ignored', () => {
  it('reads exit 1 as "none of them", not as a failure', async () => {
    // check-ignore answers in its exit status. Treating 1 as an error would
    // make every unignored directory in the tree render as broken.
    const result = await serviceFor({ exitCode: 1 }).ignored(['src', 'README.md']);
    expect(result.ok && result.value.size).toBe(0);
  });

  it('returns the matched paths on exit 0', async () => {
    const result = await serviceFor({ stdout: 'node_modules\0dist\0', exitCode: 0 }).ignored([
      'src',
      'node_modules',
      'dist',
    ]);
    expect(result.ok && [...result.value]).toEqual(['node_modules', 'dist']);
  });

  it('sends paths NUL-terminated on stdin, not as arguments', async () => {
    // A directory listing can be thousands of entries containing spaces,
    // quotes and newlines; stdin has no quoting rules to get wrong.
    await serviceFor({ exitCode: 1 }).ignored(['a b.txt', 'new\nline.txt']);
    expect(lastRequest?.args).toEqual(['check-ignore', '-z', '--stdin']);
    expect(lastRequest?.stdin).toBe('a b.txt\0new\nline.txt\0');
  });

  it('runs no command at all for an empty list', async () => {
    const result = await serviceFor({}).ignored([]);
    expect(result.ok && result.value.size).toBe(0);
    expect(lastRequest).toBeNull();
  });

  it('still fails on a real error', async () => {
    const result = await serviceFor({
      exitCode: 128,
      stderr: 'fatal: not a git repository',
    }).ignored(['src']);
    expect(result.ok).toBe(false);
  });
});

describe('listPaths', () => {
  it('asks for tracked plus unignored untracked files', async () => {
    await serviceFor({ stdout: '' }).listPaths();
    expect(lastRequest?.args).toEqual([
      'ls-files',
      '-z',
      '--cached',
      '--others',
      '--exclude-standard',
    ]);
  });

  it('de-duplicates a conflicted path listed once per index stage', async () => {
    // `ls-files` prints one line per index entry, and an unmerged path has
    // three. Quick open shows files, not index entries.
    const result = await serviceFor({
      stdout: 'a.txt\0conflict.txt\0conflict.txt\0conflict.txt\0b.txt\0',
    }).listPaths();
    expect(result.ok && result.value).toEqual(['a.txt', 'conflict.txt', 'b.txt']);
  });

  it('reads an empty repository as no paths', async () => {
    const result = await serviceFor({ stdout: '' }).listPaths();
    expect(result.ok && result.value).toEqual([]);
  });
});
