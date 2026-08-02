import { beforeEach, describe, expect, it } from 'vitest';
import type { GitRunRequest, GitRunResult } from '../wails';
import { BlobService, isNullOid } from './BlobService';
import { GitRunner, type GitBridge } from './GitRunner';
import { resetRepoLocks } from './RepoLock';

const REPO = '/repos/test-repo1';

/**
 * A bridge that answers each invocation from a queue, so a two-call method
 * (`cat-file -s` then `cat-file blob`) can be driven precisely.
 */
function runnerFor(answers: string[], options: { base64?: boolean } = {}) {
  const requests: GitRunRequest[] = [];
  const base64Requests: GitRunRequest[] = [];

  const reply = (request: GitRunRequest): Promise<GitRunResult> => {
    requests.push(request);
    return Promise.resolve({
      stdout: answers.shift() ?? '',
      stderr: '',
      exitCode: 0,
      durationMs: 1,
      timedOut: false,
    });
  };

  const bridge: GitBridge = {
    run: reply,
    ...(options.base64 !== false && {
      runBase64: (request: GitRunRequest) => {
        base64Requests.push(request);
        return reply(request);
      },
    }),
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

  return { requests, base64Requests, service: new BlobService(new GitRunner(REPO, { bridge })) };
}

beforeEach(() => {
  resetRepoLocks();
});

describe('isNullOid', () => {
  // The working-tree side of an unstaged diff, which git has no object for.
  it('recognises the all-zero id whatever its length', () => {
    expect(isNullOid('0000000')).toBe(true);
    expect(isNullOid('0'.repeat(40))).toBe(true);
    expect(isNullOid('')).toBe(true);
  });

  it('does not mistake a real id that starts with zeros', () => {
    expect(isNullOid('0f68844')).toBe(false);
  });
});

describe('BlobService', () => {
  it('asks for the size before the contents', async () => {
    const { requests, service } = runnerFor(['12\n', 'hello world\n']);

    const result = await service.text('abc123', 1024);

    expect(result.ok && result.value).toBe('hello world\n');
    expect(requests.map((request) => request.args)).toEqual([
      ['cat-file', '-s', 'abc123'],
      ['cat-file', 'blob', 'abc123'],
    ]);
  });

  /**
   * The point of measuring first: an object over the limit must not cross the
   * bridge at all. A test that only checked the return value would pass even
   * if the whole file had been fetched and then discarded.
   */
  it('refuses an oversized object without reading it', async () => {
    const { requests, service } = runnerFor(['999999\n']);

    const result = await service.text('abc123', 1024);

    expect(result.ok && result.value).toBeNull();
    expect(requests).toHaveLength(1);
  });

  it('reads binary content through the base64 path, never the text one', async () => {
    const { base64Requests, service } = runnerFor(['9\n', 'iVBORw0KGgo=']);

    const result = await service.base64('abc123', 1024);

    expect(result.ok && result.value).toBe('iVBORw0KGgo=');
    // The size call goes through `run`; only the contents need encoding.
    expect(base64Requests.map((request) => request.args)).toEqual([['cat-file', 'blob', 'abc123']]);
  });

  /**
   * Falling back to the text path would return an image full of U+FFFD that
   * renders as broken with nothing anywhere reporting a failure.
   */
  it('fails loudly when the bridge cannot encode, rather than downgrading', async () => {
    const { service } = runnerFor(['9\n', 'anything'], { base64: false });

    const result = await service.base64('abc123', 1024);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/base64/);
  });
});
