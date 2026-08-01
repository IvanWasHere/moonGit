import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitRunRequest, GitRunResult, GitStreamResult } from '../wails';
import { GitRunner, getGitRunner, resetGitRunners, type GitBridge } from './GitRunner';
import { resetRepoLocks } from './RepoLock';

const REPO = '/repos/test-repo1';

function runResult(overrides: Partial<GitRunResult> = {}): GitRunResult {
  return { stdout: '', stderr: '', exitCode: 0, durationMs: 4, timedOut: false, ...overrides };
}

function streamResult(overrides: Partial<GitStreamResult> = {}): GitStreamResult {
  return {
    stderr: '',
    exitCode: 0,
    durationMs: 9,
    timedOut: false,
    canceled: false,
    bytesOut: 0,
    chunks: 0,
    ...overrides,
  };
}

/** Records every request and lets a test decide when each one finishes. */
function fakeBridge(): GitBridge & {
  requests: GitRunRequest[];
  onRun: (fn: (req: GitRunRequest) => Promise<GitRunResult>) => void;
  onStream: (fn: () => Promise<GitStreamResult>) => void;
  chunkTo: (data: string) => void;
} {
  const requests: GitRunRequest[] = [];
  let run: (req: GitRunRequest) => Promise<GitRunResult> = () => Promise.resolve(runResult());
  let stream: () => Promise<GitStreamResult> = () => Promise.resolve(streamResult());
  let emit: ((data: string, seq: number) => void) | undefined;

  return {
    requests,
    onRun: (fn) => {
      run = fn;
    },
    onStream: (fn) => {
      stream = fn;
    },
    chunkTo: (data) => emit?.(data, 0),
    run: (req) => {
      requests.push(req);
      return run(req);
    },
    runStream: (req, handlers) => {
      requests.push(req);
      emit = handlers.onChunk;
      return stream();
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  resetRepoLocks();
  resetGitRunners();
});

describe('GitRunner.exec', () => {
  it('passes the repo path, args and a default timeout to the bridge', async () => {
    const bridge = fakeBridge();
    bridge.onRun(() => Promise.resolve(runResult({ stdout: '## main...origin/main\n' })));
    const runner = new GitRunner(REPO, { bridge });

    const result = await runner.exec(['status', '--porcelain=v2', '-z']);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.stdout).toBe('## main...origin/main\n');
    expect(bridge.requests[0]).toEqual({
      repoPath: REPO,
      args: ['status', '--porcelain=v2', '-z'],
      timeoutMs: 30_000,
    });
  });

  it('forwards stdin, env and an explicit timeout', async () => {
    const bridge = fakeBridge();
    const runner = new GitRunner(REPO, { bridge });

    await runner.exec(['commit', '-F', '-'], {
      stdin: 'a message',
      env: ['GIT_AUTHOR_NAME=Ivan'],
      timeoutMs: 500,
    });

    expect(bridge.requests[0]).toEqual({
      repoPath: REPO,
      args: ['commit', '-F', '-'],
      stdin: 'a message',
      env: ['GIT_AUTHOR_NAME=Ivan'],
      timeoutMs: 500,
    });
  });

  it('turns a non-zero exit into a classified error rather than throwing', async () => {
    const bridge = fakeBridge();
    bridge.onRun(() =>
      Promise.resolve(
        runResult({
          exitCode: 128,
          stderr: 'fatal: not a git repository (or any of the parent directories): .git\n',
        }),
      ),
    );
    const runner = new GitRunner('/not/a/repo', { bridge });

    const result = await runner.exec(['rev-parse', 'HEAD']);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('NotARepository');
    expect(result.error.exitCode).toBe(128);
    expect(result.error.args).toEqual(['rev-parse', 'HEAD']);
    expect(result.error.repoPath).toBe('/not/a/repo');
  });

  // `git diff --quiet` answers "are there changes?" with its exit status.
  // Making the caller catch an error to read a boolean would be absurd.
  it('accepts the exit codes a caller declares as answers', async () => {
    const bridge = fakeBridge();
    bridge.onRun(() => Promise.resolve(runResult({ exitCode: 1 })));
    const runner = new GitRunner(REPO, { bridge });

    const asAnswer = await runner.exec(['diff', '--quiet'], { okExitCodes: [0, 1] });
    expect(asAnswer.ok).toBe(true);
    if (asAnswer.ok) expect(asAnswer.value.exitCode).toBe(1);

    const asFailure = await runner.exec(['diff', '--quiet']);
    expect(asFailure.ok).toBe(false);
  });

  it('reports a timeout as Timeout, not as whatever git managed to print', async () => {
    const bridge = fakeBridge();
    bridge.onRun(() =>
      Promise.resolve(
        runResult({ exitCode: -1, timedOut: true, stderr: 'fatal: the remote end hung up\n' }),
      ),
    );
    const runner = new GitRunner(REPO, { bridge });

    const result = await runner.exec(['fetch', '--all']);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('Timeout');
  });

  it('reports a rejected bridge call as SpawnFailed and keeps the cause', async () => {
    const bridge = fakeBridge();
    const cause = new Error('git binary not found at /usr/bin/git');
    bridge.onRun(() => Promise.reject(cause));
    const runner = new GitRunner(REPO, { bridge });

    const result = await runner.exec(['status']);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('SpawnFailed');
    expect(result.error.message).toBe('git binary not found at /usr/bin/git');
    expect(result.error.cause).toBe(cause);
  });

  it('does not spawn git for an already-aborted call', async () => {
    const bridge = fakeBridge();
    const runner = new GitRunner(REPO, { bridge });

    const result = await runner.exec(['log'], { signal: AbortSignal.abort() });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('Canceled');
    expect(bridge.requests).toHaveLength(0);
  });

  it('classifies a merge conflict announced on stdout', async () => {
    const bridge = fakeBridge();
    bridge.onRun(() =>
      Promise.resolve(
        runResult({
          exitCode: 1,
          stdout:
            'Auto-merging README.md\nCONFLICT (content): Merge conflict in README.md\nAutomatic merge failed; fix conflicts and then commit the result.\n',
        }),
      ),
    );
    const runner = new GitRunner(REPO, { bridge });

    const result = await runner.exec(['merge', 'origin/main']);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('MergeConflict');
  });
});

describe('GitRunner serialization', () => {
  it('never lets two writes overlap', async () => {
    const bridge = fakeBridge();
    const inFlight: string[] = [];
    let peak = 0;
    let release: (() => void) | undefined;

    bridge.onRun(async (req) => {
      inFlight.push(req.args[0] ?? '');
      peak = Math.max(peak, inFlight.length);
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      inFlight.pop();
      return runResult();
    });

    const runner = new GitRunner(REPO, { bridge });
    const first = runner.exec(['commit', '-m', 'one']);
    const second = runner.exec(['add', 'file.txt']);

    await settle();
    expect(bridge.requests).toHaveLength(1);

    release?.();
    await settle();
    release?.();
    await Promise.all([first, second]);

    expect(peak).toBe(1);
    expect(bridge.requests.map((r) => r.args[0])).toEqual(['commit', 'add']);
  });

  it('lets reads run together', async () => {
    const bridge = fakeBridge();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    bridge.onRun(async () => {
      await gate;
      return runResult();
    });

    const runner = new GitRunner(REPO, { bridge });
    const reads = [runner.exec(['status']), runner.exec(['log']), runner.exec(['for-each-ref'])];

    await settle();
    expect(bridge.requests).toHaveLength(3);

    release?.();
    const results = await Promise.all(reads);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it('holds a read behind an in-flight write', async () => {
    const bridge = fakeBridge();
    let release: (() => void) | undefined;
    bridge.onRun(async (req) => {
      if (req.args[0] === 'commit') {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return runResult();
    });

    const runner = new GitRunner(REPO, { bridge });
    const write = runner.exec(['commit', '-m', 'one']);
    const read = runner.exec(['status']);

    await settle();
    expect(bridge.requests.map((r) => r.args[0])).toEqual(['commit']);

    release?.();
    await Promise.all([write, read]);
    expect(bridge.requests.map((r) => r.args[0])).toEqual(['commit', 'status']);
  });

  it('shares the lock between runners pointed at the same repository', async () => {
    const bridge = fakeBridge();
    let release: (() => void) | undefined;
    bridge.onRun(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return runResult();
    });

    const first = new GitRunner(REPO, { bridge });
    const second = new GitRunner(REPO, { bridge });
    const a = first.exec(['commit', '-m', 'one']);
    const b = second.exec(['commit', '-m', 'two']);

    await settle();
    expect(bridge.requests).toHaveLength(1);

    release?.();
    await settle();
    release?.();
    await Promise.all([a, b]);
    expect(bridge.requests).toHaveLength(2);
  });

  it('respects an explicit mode override', async () => {
    const bridge = fakeBridge();
    const runner = new GitRunner(REPO, { bridge });

    await runner.exec(['status'], { mode: 'write' });
    expect(bridge.requests).toHaveLength(1);
  });
});

describe('GitRunner.execStream', () => {
  it('forwards chunks and reports what the stream produced', async () => {
    const bridge = fakeBridge();
    bridge.onStream(() => Promise.resolve(streamResult({ bytesOut: 12, chunks: 2 })));
    const runner = new GitRunner(REPO, { bridge });
    const seen: string[] = [];

    const pending = runner.execStream(['log', '-z'], (data) => seen.push(data), {
      delimiter: 'nul',
    });
    // The runner acquires the repository lock before it spawns anything, so
    // there is no handler to emit to until that has settled.
    await settle();
    bridge.chunkTo('commit-a\0');
    const result = await pending;

    expect(seen).toEqual(['commit-a\0']);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.bytesOut).toBe(12);
    expect(result.value.chunks).toBe(2);
    expect(bridge.requests[0]).toMatchObject({ delimiter: 'nul', args: ['log', '-z'] });
  });

  it('reports a cancelled stream as Canceled, not as a failed command', async () => {
    const bridge = fakeBridge();
    bridge.onStream(() => Promise.resolve(streamResult({ canceled: true, exitCode: -1 })));
    const runner = new GitRunner(REPO, { bridge });

    const result = await runner.execStream(['log'], () => {});

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('Canceled');
    expect(result.error.message).toBe('git log was canceled');
  });

  it('passes the abort signal down so the process can actually be killed', async () => {
    const bridge = fakeBridge();
    const seen = vi.fn();
    const controller = new AbortController();
    const withSignal: GitBridge = {
      run: bridge.run.bind(bridge),
      runStream: (req, handlers) => {
        seen(handlers.signal);
        return bridge.runStream(req, handlers);
      },
    };
    const runner = new GitRunner(REPO, { bridge: withSignal });

    await runner.execStream(['log'], () => {}, { signal: controller.signal });

    expect(seen).toHaveBeenCalledWith(controller.signal);
  });
});

describe('getGitRunner', () => {
  it('returns one runner per repository path', () => {
    const a = getGitRunner(REPO);
    expect(getGitRunner(REPO)).toBe(a);
    expect(getGitRunner('/repos/test-repo2')).not.toBe(a);
  });
});
