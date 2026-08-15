import { describe, expect, it } from 'vitest';
import { nextGraphTuning, nextTuning, SLOW_LOG_MS, SLOW_STATUS_MS, type Tuning } from './tuning';
import { statusArgs, STATUS_ARGS } from './parsers';

const fresh: Tuning = { untracked: 'all', configured: false, graphed: false, forcedAll: false };
const degraded: Tuning = {
  untracked: 'normal',
  configured: true,
  graphed: false,
  forcedAll: false,
};

describe('statusArgs', () => {
  it('spells both untracked modes', () => {
    expect(statusArgs('all')).toContain('--untracked-files=all');
    expect(statusArgs('normal')).toContain('--untracked-files=normal');
  });

  /*
   * `STATUS_ARGS` is now derived rather than written out, and a great deal of
   * the app — every parser fixture, `services.test.ts`, the Go tests — was
   * captured against its exact wording. This is the assertion that the
   * refactor did not quietly change the command.
   */
  it('leaves the canonical query byte-identical', () => {
    expect(STATUS_ARGS).toEqual([
      'status',
      '--porcelain=v2',
      '-z',
      '--branch',
      '--untracked-files=all',
    ]);
  });

  it('differs from the ignored query only where it should', () => {
    // Both are porcelain v2 and NUL-delimited; a divergence there would mean
    // one of them needs a different parser, which is not the intent.
    expect(statusArgs('normal').slice(0, 3)).toEqual(['status', '--porcelain=v2', '-z']);
  });
});

describe('nextTuning', () => {
  it('leaves a fast repository alone', () => {
    expect(nextTuning(fresh, 20)).toBeNull();
    expect(nextTuning(fresh, SLOW_STATUS_MS - 1)).toBeNull();
  });

  it('degrades a slow one and marks it configured', () => {
    expect(nextTuning(fresh, SLOW_STATUS_MS)).toEqual<Tuning>({
      untracked: 'normal',
      configured: true,
      graphed: false,
      forcedAll: false,
    });
  });

  /*
   * The measured case. `--untracked-files=all` over 500k files took 4442ms
   * cold and still 2047ms with fsmonitor, which is what this threshold exists
   * to catch (PLAN.md §10).
   */
  it('degrades at the duration the bench repository actually produced', () => {
    expect(nextTuning(fresh, 4442)).not.toBeNull();
    expect(nextTuning(fresh, 2047)).not.toBeNull();
  });

  it('does nothing once already degraded and configured', () => {
    expect(nextTuning(degraded, 9999)).toBeNull();
  });

  /*
   * Idempotence matters more than it looks: `noteStatusDuration` runs on every
   * status, which is every watcher tick. A rule that kept returning a change
   * would rewrite a preference row and re-run `commit-graph write` on each
   * keystroke in an editor.
   */
  it('is idempotent — the second slow status changes nothing', () => {
    const first = nextTuning(fresh, 5000);
    expect(first).not.toBeNull();
    expect(nextTuning(first as Tuning, 5000)).toBeNull();
  });

  /*
   * A repository whose config was applied but which was somehow left on `all`
   * — the app quit between the two writes, say — must still degrade. Asserting
   * `configured` alone would leave it slow forever.
   */
  it('degrades a repository that was configured but never switched', () => {
    expect(nextTuning({ ...fresh, configured: true }, 5000)).toEqual<Tuning>({
      untracked: 'normal',
      configured: true,
      graphed: false,
      forcedAll: false,
    });
  });

  it('never overrides the user asking for all back', () => {
    const forced: Tuning = {
      untracked: 'all',
      configured: true,
      graphed: false,
      forcedAll: true,
    };
    expect(nextTuning(forced, 60_000)).toBeNull();
  });
});

describe('nextGraphTuning', () => {
  it('leaves a fast history alone', () => {
    expect(nextGraphTuning(fresh, 99)).toBeNull();
    expect(nextGraphTuning(fresh, SLOW_LOG_MS - 1)).toBeNull();
  });

  it('writes a graph for a slow one', () => {
    expect(nextGraphTuning(fresh, SLOW_LOG_MS)).toEqual<Tuning>({ ...fresh, graphed: true });
  });

  /*
   * The measured case, from `big-history` (PLAN.md §10, 7.1). 6893ms is the
   * ungraphed first page of `log --topo-order`; 275ms is the same query once a
   * graph exists, and is what must *not* trigger a second write.
   */
  it('triggers at the duration the bench repository actually produced', () => {
    expect(nextGraphTuning(fresh, 6893)).not.toBeNull();
    expect(nextGraphTuning({ ...fresh, graphed: true }, 275)).toBeNull();
  });

  /*
   * The Journal re-runs its log on every search keystroke, each one slow until
   * the graph lands. A rule that kept returning a change would queue a
   * 13-second `commit-graph write` per character typed.
   */
  it('is idempotent — the second slow log changes nothing', () => {
    const first = nextGraphTuning(fresh, 6893);
    expect(first).not.toBeNull();
    expect(nextGraphTuning(first as Tuning, 6893)).toBeNull();
  });

  /*
   * `forcedAll` is a statement about untracked files. Reading it as "leave this
   * repository untuned in general" would punish someone who asked to keep
   * seeing their new folders' contents with a Journal that stays 25× slower —
   * two unrelated things joined by nothing but living in the same record.
   */
  it('ignores the untracked-files override, which is about a different axis', () => {
    expect(nextGraphTuning({ ...fresh, forcedAll: true }, 6893)).not.toBeNull();
  });

  /*
   * The whole point of splitting the trigger. `big-history` answers status
   * instantly and `big-files` answers log instantly, so each rule has to leave
   * the other's fields alone — otherwise one measurement configures an axis it
   * never measured, which is the bug this pair of functions exists to fix.
   */
  it('is independent of the status rule in both directions', () => {
    // A slow log must not degrade untracked mode: `big-history` has 256 files.
    const graphed = nextGraphTuning(fresh, 6893) as Tuning;
    expect(graphed.untracked).toBe('all');
    expect(graphed.configured).toBe(false);

    // A slow status must not claim a graph: `big-files` has one commit, and
    // marking it graphed would suppress the write if history ever grew.
    const slow = nextTuning(fresh, 4442) as Tuning;
    expect(slow.graphed).toBe(false);
  });
});
