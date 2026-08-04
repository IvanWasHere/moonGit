import { describe, expect, it, vi } from 'vitest';
import { createInputQueue } from './inputQueue';

/** A send whose promises can be resolved by hand, in any order. */
function controllableSend() {
  const calls: string[] = [];
  const resolvers: Array<() => void> = [];

  const send = (data: string): Promise<void> => {
    calls.push(data);
    return new Promise<void>((resolve) => resolvers.push(resolve));
  };

  return {
    send,
    calls,
    /** Settle the oldest outstanding write. */
    settle: async () => {
      resolvers.shift()?.();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

describe('createInputQueue', () => {
  it('sends the first keystroke immediately', async () => {
    const { send, calls } = controllableSend();
    createInputQueue(send).push('g');
    await Promise.resolve();

    expect(calls).toEqual(['g']);
  });

  /*
   * The bug this exists for. Typing `git status -sb` fast enough put
   * `git sattus  - sb` in the shell: each keystroke was its own promise, and
   * the bridge did not deliver them in the order they were made.
   */
  it('never has two writes in flight at once', async () => {
    const { send, calls, settle } = controllableSend();
    const queue = createInputQueue(send);

    for (const char of 'git status') queue.push(char);
    await Promise.resolve();

    // One call, not ten — the rest of the burst is buffered behind it.
    expect(calls).toEqual(['g']);

    await settle();
    expect(calls).toEqual(['g', 'it status']);
  });

  it('preserves order across several rounds', async () => {
    const { send, calls, settle } = controllableSend();
    const queue = createInputQueue(send);

    queue.push('a');
    await Promise.resolve();
    queue.push('b');
    await settle();
    queue.push('c');
    await settle();
    await settle();

    expect(calls.join('')).toBe('abc');
  });

  it('keeps going after a failed write', async () => {
    // The shell can vanish mid-burst; one rejected write must not wedge the
    // queue for the rest of the session.
    const failures: unknown[] = [];
    let attempt = 0;
    const send = (): Promise<void> =>
      ++attempt === 1 ? Promise.reject(new Error('gone')) : Promise.resolve();

    const queue = createInputQueue(send, (cause) => failures.push(cause));
    queue.push('x');
    await Promise.resolve();
    queue.push('y');
    await vi.waitFor(() => expect(attempt).toBe(2));

    expect(failures).toHaveLength(1);
  });

  it('drops buffered input once disposed', async () => {
    const { send, calls, settle } = controllableSend();
    const queue = createInputQueue(send);

    queue.push('a');
    await Promise.resolve();
    queue.push('b');
    queue.dispose();
    await settle();

    // 'b' was still buffered when the panel unmounted; writing it afterwards
    // would go to a session that is being torn down.
    expect(calls).toEqual(['a']);

    queue.push('c');
    await Promise.resolve();
    expect(calls).toEqual(['a']);
  });
});
