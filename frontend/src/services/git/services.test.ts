import { beforeEach, describe, expect, it } from 'vitest';
import type { GitRunRequest, GitRunResult, GitStreamResult } from '../wails';
import { BranchService } from './BranchService';
import { CommitService } from './CommitService';
import { DiffService } from './DiffService';
import { GitRunner, type GitBridge } from './GitRunner';
import { DIFF_EVERYTHING } from './parsers/__fixtures__/diff';
import { LOG_HISTORY } from './parsers/__fixtures__/log';
import { REFS_EVERYTHING } from './parsers/__fixtures__/refs';
import { STATUS_EVERYTHING } from './parsers/__fixtures__/status';
import { RepositoryService } from './RepositoryService';
import { resetRepoLocks } from './RepoLock';

const REPO = '/repos/test-repo1';

/**
 * A bridge that answers with fixture output, so a service can be tested
 * end-to-end — args in, domain objects out — without a webview.
 */
function bridgeReturning(
  stdout: string,
  overrides: Partial<GitRunResult> = {},
): GitBridge & { requests: GitRunRequest[] } {
  const requests: GitRunRequest[] = [];
  return {
    requests,
    run: (request) => {
      requests.push(request);
      return Promise.resolve({
        stdout,
        stderr: '',
        exitCode: 0,
        durationMs: 1,
        timedOut: false,
        ...overrides,
      });
    },
    runStream: (request, handlers) => {
      requests.push(request);
      handlers.onChunk(stdout, 0);
      return Promise.resolve({
        stderr: overrides.stderr ?? '',
        exitCode: overrides.exitCode ?? 0,
        durationMs: 1,
        timedOut: false,
        canceled: false,
        bytesOut: stdout.length,
        chunks: 1,
      } satisfies GitStreamResult);
    },
  };
}

function runnerFor(stdout: string, overrides: Partial<GitRunResult> = {}) {
  const bridge = bridgeReturning(stdout, overrides);
  return { bridge, runner: new GitRunner(REPO, { bridge }) };
}

beforeEach(() => {
  resetRepoLocks();
});

describe('RepositoryService', () => {
  it('turns status output into a parsed repository state', async () => {
    const { runner, bridge } = runnerFor(STATUS_EVERYTHING);
    const result = await new RepositoryService(runner).status();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.branch.head).toBe('main');
    expect(result.value.entries.length).toBeGreaterThan(0);
    expect(bridge.requests[0]?.args).toEqual([
      'status',
      '--porcelain=v2',
      '-z',
      '--branch',
      '--untracked-files=all',
    ]);
  });

  it('passes a command failure through untouched', async () => {
    const { runner } = runnerFor('', {
      exitCode: 128,
      stderr: 'fatal: not a git repository (or any of the parent directories): .git\n',
    });
    const result = await new RepositoryService(runner).status();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('NotARepository');
  });

  // The boundary this whole layer exists to establish: a parser that throws
  // must not throw past the service.
  it('converts a parse failure into an Unknown error rather than throwing', async () => {
    const { runner } = runnerFor('X this is not porcelain v2\x00');
    const result = await new RepositoryService(runner).status();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('Unknown');
    expect(result.error.message).toMatch(/unrecognised record type/);
    expect(result.error.cause).toBeInstanceOf(Error);
  });

  it('answers isRepository with false instead of an error', async () => {
    const { runner } = runnerFor('', {
      exitCode: 128,
      stderr: 'fatal: not a git repository\n',
    });

    await expect(new RepositoryService(runner).isRepository()).resolves.toBe(false);
  });

  it('reports an unborn HEAD as null', async () => {
    const { runner } = runnerFor('', { exitCode: 1 });
    const result = await new RepositoryService(runner).headOid();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBeNull();
  });

  it('trims the root path', async () => {
    const { runner } = runnerFor('/Volumes/repos/test-repo1\n');
    const result = await new RepositoryService(runner).root();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('/Volumes/repos/test-repo1');
  });
});

describe('BranchService', () => {
  it('groups refs into branches, remotes and tags', async () => {
    const { runner, bridge } = runnerFor(REFS_EVERYTHING);
    const result = await new BranchService(runner).list();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.head?.shortName).toBe('main');
    expect(result.value.tags.length).toBeGreaterThan(0);
    expect(result.value.remotes.every((ref) => ref.symrefTarget === null)).toBe(true);

    // The format must travel with the command, not be rebuilt at the call site.
    expect(bridge.requests[0]?.args[0]).toBe('for-each-ref');
    expect(bridge.requests[0]?.args[1]).toMatch(/^--format=%\(refname\)/);
  });

  it('reports a detached HEAD as no current branch', async () => {
    const { runner } = runnerFor('', { exitCode: 1 });
    const result = await new BranchService(runner).current();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBeNull();
  });
});

describe('CommitService', () => {
  it('streams history and returns every commit', async () => {
    const { runner, bridge } = runnerFor(LOG_HISTORY);
    const result = await new CommitService(runner).list({ maxCount: 50 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(6);
    expect(bridge.requests[0]?.args).toContain('--max-count=50');
    expect(bridge.requests[0]?.args).toContain('--decorate=full');
  });

  it('pages with --skip', async () => {
    const { runner, bridge } = runnerFor(LOG_HISTORY);
    await new CommitService(runner).list({ maxCount: 200, skip: 400 });

    expect(bridge.requests[0]?.args).toContain('--skip=400');
  });

  /*
   * `--skip=0` and no `--skip` mean the same thing to git, and the first page
   * is by far the most common request in the app. Emitting the flag anyway
   * would make every fixture and Go test captured against the first page
   * disagree with what the app actually runs, for no behaviour change.
   */
  it('leaves the first page unadorned', async () => {
    const { runner, bridge } = runnerFor(LOG_HISTORY);
    await new CommitService(runner).list({ maxCount: 200, skip: 0 });

    expect(bridge.requests[0]?.args.some((arg) => arg.startsWith('--skip'))).toBe(false);
  });

  it('reports batches as they arrive, before resolving', async () => {
    const { runner } = runnerFor(LOG_HISTORY);
    const batches: number[] = [];

    await new CommitService(runner).list({
      onBatch: (batch) => batches.push(batch.length),
    });

    // The fake bridge delivers one chunk, so one batch — the point is that
    // the callback fired at all, which is what makes a large log feel instant.
    expect(batches.reduce((sum, n) => sum + n, 0)).toBe(6);
  });

  it('separates revisions from paths with --', async () => {
    const { runner, bridge } = runnerFor(LOG_HISTORY);
    await new CommitService(runner).list({ revisions: ['main'], paths: ['src/app.ts'] });

    const args = bridge.requests[0]?.args ?? [];
    expect(args.indexOf('main')).toBeLessThan(args.indexOf('--'));
    expect(args[args.indexOf('--') + 1]).toBe('src/app.ts');
  });

  it('treats a repository with no commits as an empty history', async () => {
    const { runner } = runnerFor('', {
      exitCode: 128,
      stderr: "fatal: your current branch 'main' does not have any commits yet\n",
    });
    const result = await new CommitService(runner).list();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([]);
  });

  it('still reports a genuine 128 as an error', async () => {
    const { runner } = runnerFor('', {
      exitCode: 128,
      stderr: "fatal: bad revision 'nope'\n",
    });
    const result = await new CommitService(runner).list();

    expect(result.ok).toBe(false);
  });

  it('converts a mid-stream parse failure into an Unknown error', async () => {
    const { runner } = runnerFor('not-a-sha\x00'.repeat(12));
    const result = await new CommitService(runner).list();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('Unknown');
    expect(result.error.message).toMatch(/expected an object id/);
  });

  it('returns null for a commit id that does not resolve', async () => {
    const { runner } = runnerFor('', { exitCode: 128, stderr: 'fatal: bad object\n' });
    const result = await new CommitService(runner).get('deadbeef');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBeNull();
  });
});

describe('DiffService', () => {
  it('parses a working-tree diff', async () => {
    const { runner, bridge } = runnerFor(DIFF_EVERYTHING);
    const result = await new DiffService(runner).workingTree();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(7);
    expect(bridge.requests[0]?.args[0]).toBe('diff');
    expect(bridge.requests[0]?.args).toContain('-U3');
  });

  it('asks for the index against HEAD when staged', async () => {
    const { runner, bridge } = runnerFor(DIFF_EVERYTHING);
    await new DiffService(runner).staged();

    expect(bridge.requests[0]?.args).toContain('--cached');
  });

  it('scopes a diff to paths after a -- separator', async () => {
    const { runner, bridge } = runnerFor(DIFF_EVERYTHING);
    await new DiffService(runner).workingTree({ paths: ['src/app.ts'] });

    const args = bridge.requests[0]?.args ?? [];
    expect(args.slice(-2)).toEqual(['--', 'src/app.ts']);
  });

  // A merge shows nothing without this, which reads as "changed no files".
  it('uses show --first-parent for a commit, so merges are not silently empty', async () => {
    const { runner, bridge } = runnerFor(DIFF_EVERYTHING);
    await new DiffService(runner).commit('abc123');

    const args = bridge.requests[0]?.args ?? [];
    expect(args[0]).toBe('show');
    expect(args).toContain('--first-parent');
    expect(args).toContain('--format=');
    expect(args[args.length - 1]).toBe('abc123');
    // -m would emit one diff per parent, which the parser cannot read.
    expect(args).not.toContain('-m');
  });
});
