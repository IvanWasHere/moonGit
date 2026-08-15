import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The wiring around the tuning rules, as opposed to the rules themselves —
 * `tuning.test.ts` covers those as pure functions.
 *
 * This file exists because the rules were never the bug. Phase 7 measured the
 * commit-graph at 25×, wrote it, and shipped it behind a trigger that could
 * only ever fire on a slow *status* — so `big-history`, a million commits that
 * answers status instantly, was the one repository that would never be given
 * one (PLAN.md §10, 7.1). Every assertion below is about which git commands
 * come out of which measurement, which is precisely what that gap was.
 */

const ran = { ok: true, value: { stdout: '', stderr: '' } };
const exec = vi.fn((_args: readonly string[], _options?: unknown) => Promise.resolve(ran));
const setPreference = vi.fn((_key: string, _value: unknown) => Promise.resolve());

vi.mock('./GitRunner', () => ({ getGitRunner: () => ({ exec }) }));
vi.mock('@/services/db/keyValue', () => ({
  getPreference: (_key: string, fallback: unknown) => Promise.resolve(fallback),
  setPreference: (key: string, value: unknown) => setPreference(key, value),
}));

const { loadTuning, noteLogDuration, noteStatusDuration, resetTuning, SLOW_LOG_MS } = await import(
  './tuning'
);

const REPO = '/repos/big-history';

/** The commands issued so far, as plain strings, for readable assertions. */
function issued(): string[] {
  return exec.mock.calls.map((call) => call[0].join(' '));
}

function wroteGraph(): boolean {
  return issued().some((command) => command.startsWith('commit-graph write'));
}

/**
 * `noteLogDuration` deliberately returns void and does its work in a detached
 * promise, so a test has to yield to the microtask queue rather than await it.
 * Draining a fixed number of turns is enough here: the chain is two awaited
 * calls deep and every mock resolves immediately.
 */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 10; turn++) await Promise.resolve();
}

beforeEach(async () => {
  exec.mockClear();
  setPreference.mockClear();
  resetTuning();
  await loadTuning(REPO);
});

describe('noteLogDuration', () => {
  it('writes a commit-graph after a slow log', async () => {
    noteLogDuration(REPO, 6893);
    await settle();

    expect(issued()).toContain('commit-graph write --reachable');
    // Without this git would never refresh the graph again, and the 25× would
    // decay as the repository grew past what was written today.
    expect(issued()).toContain('config --local fetch.writeCommitGraph true');
  });

  it('does nothing at all for a fast one', async () => {
    noteLogDuration(REPO, SLOW_LOG_MS - 1);
    await settle();

    expect(exec).not.toHaveBeenCalled();
    expect(setPreference).not.toHaveBeenCalled();
  });

  it('persists the flag, so a relaunch does not rewrite the graph', async () => {
    noteLogDuration(REPO, 6893);
    await settle();

    expect(setPreference).toHaveBeenCalledWith(
      `tuning.${REPO}`,
      expect.objectContaining({ graphed: true }),
    );
  });

  it('persists only after the write, so a crash mid-write is retried', async () => {
    // Order matters more than it looks. Recording "this repository has a graph"
    // first would make an interrupted write permanent: every later session
    // reads the flag, skips the write, and stays slow forever with no graph.
    let graphWrittenAt = -1;
    exec.mockImplementation((args: readonly string[]) => {
      if (args[0] === 'commit-graph') graphWrittenAt = setPreference.mock.calls.length;
      return Promise.resolve(ran);
    });

    noteLogDuration(REPO, 6893);
    await settle();

    expect(graphWrittenAt).toBe(0);
    expect(setPreference).toHaveBeenCalledTimes(1);
  });

  /*
   * The Journal re-runs its log on every keystroke in the search box, and every
   * one of those is slow while the graph is still missing. Each returns long
   * before the 13-second write it would start has finished, so without the
   * in-flight guard a typed word is a word's worth of concurrent
   * `commit-graph write` processes against one object store.
   */
  it('starts one write however many slow logs land while it runs', async () => {
    noteLogDuration(REPO, 6893);
    noteLogDuration(REPO, 6893);
    noteLogDuration(REPO, 6893);
    await settle();

    expect(issued().filter((command) => command.startsWith('commit-graph write'))).toHaveLength(1);
  });

  it('does not write a second time once the repository is graphed', async () => {
    noteLogDuration(REPO, 6893);
    await settle();
    exec.mockClear();

    noteLogDuration(REPO, 6893);
    await settle();

    expect(wroteGraph()).toBe(false);
  });
});

/*
 * The split, from the other side. These two assertions are the whole point of
 * separating `configureForStatus` from `configureForHistory`: "big" is two
 * unrelated properties, and one measurement must not configure the axis it did
 * not measure. `big-history` is 256 files — an fsmonitor daemon and a modified
 * index format buy it nothing — and `big-files` is one commit, where a graph
 * is equally beside the point.
 */
describe('the two axes stay separate', () => {
  it('a slow log does not touch fsmonitor or the untracked cache', async () => {
    noteLogDuration(REPO, 6893);
    await settle();

    expect(issued().some((command) => command.includes('fsmonitor'))).toBe(false);
    expect(issued().some((command) => command.includes('untracked-cache'))).toBe(false);
  });

  it('a slow status does not write a commit-graph', async () => {
    await noteStatusDuration(REPO, 4442);

    expect(issued()).toContain('config --local core.fsmonitor true');
    expect(wroteGraph()).toBe(false);
  });
});
