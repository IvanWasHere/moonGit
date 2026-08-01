/**
 * Per-repository serialization for git commands.
 *
 * Two commands that write the index at the same time is a real bug, not a
 * theoretical one: git guards `.git/index` with `index.lock`, and the loser
 * doesn't queue — it dies with "Another git process seems to be running".
 * A UI that stages a file while a background fetch is running would hit this
 * regularly, and the user would see a lock error they did nothing to cause.
 *
 * Reads are a different story. `status`, `log`, `diff` and friends take no
 * lock (the Go layer also pins `GIT_OPTIONAL_LOCKS=0`, so even `status` won't
 * refresh the index on disk), so they may run concurrently with each other —
 * which matters, because the workspace fires several reads to paint a single
 * screen. They must not overlap a write, or a panel renders a half-applied
 * state.
 *
 * That makes this a readers-writer lock. It grants strictly in FIFO order:
 * a queued write is never starved by a steady trickle of reads, which would
 * otherwise let a busy repository postpone a commit indefinitely.
 */

export type LockMode = 'read' | 'write';

interface Waiter {
  readonly write: boolean;
  readonly grant: () => void;
}

export class RepoLock {
  /** Number of holders currently running. >1 only ever means concurrent readers. */
  private held = 0;
  private heldByWriter = false;
  private readonly queue: Waiter[] = [];

  /** Diagnostics for tests and the dev bridge; not used for control flow. */
  get active(): number {
    return this.held;
  }

  get waiting(): number {
    return this.queue.length;
  }

  /**
   * Run `fn` under the lock, releasing it however `fn` settles.
   *
   * The lock is released on rejection too — a command that throws must not
   * wedge the repository for the rest of the session.
   */
  async run<T>(mode: LockMode, fn: () => Promise<T>): Promise<T> {
    await this.acquire(mode === 'write');
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(write: boolean): Promise<void> {
    return new Promise<void>((resolve) => {
      this.queue.push({ write, grant: resolve });
      this.drain();
    });
  }

  private release(): void {
    this.held -= 1;
    if (this.held === 0) this.heldByWriter = false;
    this.drain();
  }

  private drain(): void {
    while (this.queue.length > 0) {
      const head = this.queue[0];
      if (head === undefined) return;

      // A writer needs the repository to itself; a reader only needs the
      // absence of a writer. Anything else waits, and because we always
      // inspect the head of the queue, later arrivals cannot jump it.
      if (this.held > 0 && (head.write || this.heldByWriter)) return;

      this.queue.shift();
      this.held += 1;
      this.heldByWriter = head.write;
      head.grant();

      // An exclusive holder is the only holder — stop granting.
      if (head.write) return;
    }
  }
}

/**
 * Locks are keyed by repository path rather than owned by a runner instance.
 *
 * Otherwise two `GitRunner`s pointed at the same repository — which is what
 * happens the moment a feature constructs its own instead of taking the shared
 * one — would each hold a private lock and serialize nothing.
 */
const locks = new Map<string, RepoLock>();

export function repoLockFor(repoPath: string): RepoLock {
  let lock = locks.get(repoPath);
  if (lock === undefined) {
    lock = new RepoLock();
    locks.set(repoPath, lock);
  }
  return lock;
}

/** Test-only: drop every lock so suites don't leak state into one another. */
export function resetRepoLocks(): void {
  locks.clear();
}
