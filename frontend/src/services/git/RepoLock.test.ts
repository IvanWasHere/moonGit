import { describe, expect, it } from 'vitest';
import { RepoLock, repoLockFor, resetRepoLocks } from './RepoLock';

/** A promise plus the handle to settle it, so a test can hold the lock open. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let every already-resolved microtask run before asserting. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('RepoLock', () => {
  it('runs readers concurrently', async () => {
    const lock = new RepoLock();
    const first = deferred();
    const second = deferred();
    let started = 0;

    const a = lock.run('read', async () => {
      started += 1;
      await first.promise;
    });
    const b = lock.run('read', async () => {
      started += 1;
      await second.promise;
    });

    await settle();
    expect(started).toBe(2);
    expect(lock.active).toBe(2);

    first.resolve();
    second.resolve();
    await Promise.all([a, b]);
    expect(lock.active).toBe(0);
  });

  it('never runs two writers at once', async () => {
    const lock = new RepoLock();
    const first = deferred();
    const order: string[] = [];

    const a = lock.run('write', async () => {
      order.push('a:start');
      await first.promise;
      order.push('a:end');
    });
    const b = lock.run('write', () => {
      order.push('b:start');
      return Promise.resolve();
    });

    await settle();
    expect(order).toEqual(['a:start']);

    first.resolve();
    await Promise.all([a, b]);
    expect(order).toEqual(['a:start', 'a:end', 'b:start']);
  });

  it('holds readers back while a writer is running', async () => {
    const lock = new RepoLock();
    const write = deferred();
    let readStarted = false;

    const writer = lock.run('write', async () => {
      await write.promise;
    });
    const reader = lock.run('read', () => {
      readStarted = true;
      return Promise.resolve();
    });

    await settle();
    expect(readStarted).toBe(false);

    write.resolve();
    await Promise.all([writer, reader]);
    expect(readStarted).toBe(true);
  });

  it('does not starve a queued writer behind a stream of readers', async () => {
    const lock = new RepoLock();
    const firstRead = deferred();
    const order: string[] = [];

    const readA = lock.run('read', async () => {
      order.push('read-a');
      await firstRead.promise;
    });
    const writer = lock.run('write', () => {
      order.push('write');
      return Promise.resolve();
    });
    // Arrives after the writer, so FIFO must make it wait even though a
    // reader is currently active and readers are otherwise compatible.
    const readB = lock.run('read', () => {
      order.push('read-b');
      return Promise.resolve();
    });

    await settle();
    expect(order).toEqual(['read-a']);

    firstRead.resolve();
    await Promise.all([readA, writer, readB]);
    expect(order).toEqual(['read-a', 'write', 'read-b']);
  });

  it('releases the lock when the body rejects', async () => {
    const lock = new RepoLock();

    await expect(lock.run('write', () => Promise.reject(new Error('boom')))).rejects.toThrow(
      'boom',
    );
    expect(lock.active).toBe(0);

    await expect(lock.run('write', () => Promise.resolve('fine'))).resolves.toBe('fine');
  });

  it('keys locks by repository path', () => {
    resetRepoLocks();
    const a = repoLockFor('/repos/one');
    const b = repoLockFor('/repos/one');
    const c = repoLockFor('/repos/two');

    expect(a).toBe(b);
    expect(a).not.toBe(c);

    resetRepoLocks();
    expect(repoLockFor('/repos/one')).not.toBe(a);
  });
});
