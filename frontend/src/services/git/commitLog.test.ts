/**
 * When `CommitService.list` is allowed to say "no commits".
 *
 * An empty history and a lost stream look identical to a caller, and the
 * Journal renders both as "No commits yet" — so the distinction has to be made
 * here, and it has to stay made. Every exit code and message below was
 * measured against git 2.47 rather than assumed.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { GitRunRequest, GitStreamResult } from '../wails';
import { CommitService } from './CommitService';
import { GitRunner, type GitBridge } from './GitRunner';
import { resetRepoLocks } from './RepoLock';

const REPO = '/repos/example';

/** One complete log record, NUL-delimited exactly as `-z` produces. */
function record(oid: string): string {
  return [
    oid,
    oid.slice(0, 7),
    '', // parents
    'T',
    't@t',
    '1700000000',
    'T',
    't@t',
    '1700000000',
    '', // decorations
    `subject for ${oid.slice(0, 7)}`,
    '',
  ].join('\0');
}

interface StreamPlan {
  /** Chunks handed to the caller's `onChunk`. */
  readonly deliver: readonly string[];
  /** What Go says it emitted. Larger than `deliver` means events were lost. */
  readonly chunks?: number;
  readonly exitCode?: number;
  readonly stderr?: string;
  readonly bytesOut?: number;
}

function serviceFor(plan: StreamPlan) {
  const bridge: GitBridge = {
    run: () =>
      Promise.resolve({ stdout: '', stderr: '', exitCode: 0, durationMs: 1, timedOut: false }),
    runStream: (_request: GitRunRequest, handlers): Promise<GitStreamResult> => {
      for (const [index, chunk] of plan.deliver.entries()) handlers.onChunk(chunk, index);
      return Promise.resolve({
        stderr: plan.stderr ?? '',
        exitCode: plan.exitCode ?? 0,
        durationMs: 1,
        timedOut: false,
        canceled: false,
        bytesOut: plan.bytesOut ?? plan.deliver.join('').length,
        chunks: plan.chunks ?? plan.deliver.length,
      });
    },
  };
  return new CommitService(new GitRunner(REPO, { bridge }));
}

beforeEach(() => {
  resetRepoLocks();
});

describe('a genuinely empty history', () => {
  /** `git init`, then `git log`: exit 128, and this exact sentence. */
  it('reads an unborn branch as no commits', async () => {
    const result = await serviceFor({
      deliver: [],
      exitCode: 128,
      stderr: "fatal: your current branch 'main' does not have any commits yet",
      bytesOut: 0,
    }).list();

    expect(result.ok && result.value).toEqual([]);
  });

  /** `git log --all` on the same repository exits 0 and says nothing at all. */
  it('reads a silent exit 0 as no commits', async () => {
    const result = await serviceFor({ deliver: [], bytesOut: 0 }).list();
    expect(result.ok && result.value).toEqual([]);
  });
});

describe('failures that used to read as an empty history', () => {
  /**
   * The one that mattered: a branch deleted between the ref list and the log
   * made the merge wizard report "already up to date" for a branch that was
   * gone, because "unknown revision" was treated as an empty history.
   */
  it('fails on an unknown revision rather than returning nothing', async () => {
    const result = await serviceFor({
      deliver: [],
      exitCode: 128,
      stderr:
        "fatal: ambiguous argument 'gone-branch': unknown revision or path not in the working tree.",
      bytesOut: 0,
    }).list({ revisions: ['HEAD..gone-branch'] });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/unknown revision/);
  });

  /** A ref pointing at an object that is not there — `--all` hits this. */
  it('fails on a bad object', async () => {
    const result = await serviceFor({
      deliver: [],
      exitCode: 128,
      stderr: 'fatal: bad object refs/stash',
      bytesOut: 0,
    }).list({ revisions: ['--all'] });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/bad object/);
  });
});

describe('a stream that lost part of itself', () => {
  /**
   * Chunks travel as events, and an event bus can drop one — a reconnecting
   * WebSocket in browser dev mode does exactly that. The process still exits
   * 0, so the only evidence is Go's count against ours.
   */
  it('fails when git emitted more chunks than arrived', async () => {
    const result = await serviceFor({
      deliver: [],
      chunks: 3,
      bytesOut: 4096,
    }).list();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toMatch(/3 chunks but 0 arrived/);
      expect(result.error.message).toMatch(/4096 bytes/);
    }
  });

  it('fails even when some commits did arrive', async () => {
    const result = await serviceFor({
      deliver: [`${record('a'.repeat(40))}\0`],
      chunks: 2,
    }).list();

    expect(result.ok).toBe(false);
  });

  it('accepts a stream whose counts agree', async () => {
    const result = await serviceFor({
      deliver: [`${record('a'.repeat(40))}\0`, `${record('b'.repeat(40))}\0`],
    }).list();

    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.value.map((commit) => commit.shortOid)).toEqual(['aaaaaaa', 'bbbbbbb']);
  });
});
