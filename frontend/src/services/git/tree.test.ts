/**
 * `TreeService` — the two questions the filesystem cannot answer.
 *
 * Both are exit-code-sensitive in ways that are easy to get wrong and quiet
 * when wrong: `check-ignore` reports its *answer* in the exit status, and
 * `ls-files` lists a conflicted path once per index stage.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { GitRunRequest, GitRunResult, GitStreamResult } from '../wails';
import { GitRunner, type GitBridge } from './GitRunner';
import { resetRepoLocks } from './RepoLock';
import { TreeService } from './TreeService';

const REPO = '/repos/example';

interface Plan {
  readonly stdout?: string;
  readonly exitCode?: number;
  readonly stderr?: string;
  /**
   * Chunks the streaming path delivers. `listPaths` streams, so its plans set
   * this; `ignored` buffers and sets `stdout`.
   */
  readonly deliver?: readonly string[];
  /** What Go claims it sent, when the test needs it to disagree with `deliver`. */
  readonly chunks?: number;
  readonly bytesOut?: number;
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
    runStream: (request: GitRunRequest, handlers): Promise<GitStreamResult> => {
      lastRequest = request;
      const deliver = plan.deliver ?? [];
      for (const [index, chunk] of deliver.entries()) handlers.onChunk(chunk, index);
      return Promise.resolve({
        stderr: plan.stderr ?? '',
        exitCode: plan.exitCode ?? 0,
        durationMs: 1,
        timedOut: false,
        canceled: false,
        bytesOut: plan.bytesOut ?? deliver.join('').length,
        chunks: plan.chunks ?? deliver.length,
      });
    },
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
    await serviceFor({ deliver: [] }).listPaths();
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
      deliver: ['a.txt\0conflict.txt\0conflict.txt\0conflict.txt\0b.txt\0'],
    }).listPaths();
    expect(result.ok && result.value).toEqual(['a.txt', 'conflict.txt', 'b.txt']);
  });

  it('reads an empty repository as no paths', async () => {
    const result = await serviceFor({ deliver: [] }).listPaths();
    expect(result.ok && result.value).toEqual([]);
  });

  it('streams rather than buffering — 11.9MB does not cross the bridge whole', async () => {
    // The point of the audit (PLAN.md §10). If someone reverts this to
    // `exec`, the buffered `run` double returns '' and the paths vanish.
    const result = await serviceFor({ deliver: ['a.txt\0b.txt\0'] }).listPaths();
    expect(result.ok && result.value).toEqual(['a.txt', 'b.txt']);
  });

  it('joins a path split across two chunks', async () => {
    // Go cuts at the last NUL in its window, but flushes mid-record for a
    // path longer than the hard cap, and the final chunk is whatever is left.
    // Splitting each chunk on its own would invent two short paths here.
    const result = await serviceFor({
      deliver: ['src/very/long/', 'path/to/file.txt\0other.txt\0'],
    }).listPaths();
    expect(result.ok && result.value).toEqual(['src/very/long/path/to/file.txt', 'other.txt']);
  });

  it('keeps a tail that arrived without its terminating NUL', async () => {
    // A truncated last record is data, not noise — dropping it would lose a
    // file silently. The chunk-count check is what calls truncation an error.
    const result = await serviceFor({ deliver: ['a.txt\0b.txt'] }).listPaths();
    expect(result.ok && result.value).toEqual(['a.txt', 'b.txt']);
  });

  it('fails when a chunk is lost in transit instead of returning a short corpus', async () => {
    // An event bus can drop a chunk while the process still exits 0. Without
    // this, quick open renders "no matches" over a repository full of files.
    const result = await serviceFor({
      deliver: ['a.txt\0'],
      chunks: 2,
      bytesOut: 4096,
    }).listPaths();
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.stderr).toMatch(/lost in transit/);
  });

  it('still fails on a real error', async () => {
    const result = await serviceFor({
      deliver: [],
      exitCode: 128,
      stderr: 'fatal: not a git repository',
    }).listPaths();
    expect(result.ok).toBe(false);
  });
});
