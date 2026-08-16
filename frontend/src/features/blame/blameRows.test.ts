import { describe, expect, it } from 'vitest';
import type { Blame, BlameCommit, BlameLine } from '@/services/git';
import { toBlameRows } from './blameRows';

/**
 * Run detection for the blame view (PLAN.md §11, 8.8).
 *
 * The whole readability of a blame rests on this: metadata is drawn only where
 * authorship changes. Off by one and either every row repeats the same hash —
 * the thing the collapsing exists to prevent — or the first line of each block
 * loses its label and the boundary moves one row down.
 */

function commit(oid: string): BlameCommit {
  return {
    oid,
    author: { name: `Author ${oid}`, email: 'a@example.com', date: 1_700_000_000, timezone: '+0000' },
    committer: {
      name: `Author ${oid}`,
      email: 'a@example.com',
      date: 1_700_000_000,
      timezone: '+0000',
    },
    summary: `commit ${oid}`,
    isBoundary: false,
  };
}

function blameOf(oids: readonly string[]): Blame {
  const lines: BlameLine[] = oids.map((oid, index) => ({
    oid,
    finalLine: index + 1,
    origLine: index + 1,
    content: `line ${index + 1}`,
  }));
  const commits = new Map(oids.map((oid) => [oid, commit(oid)]));
  return { lines, commits };
}

describe('toBlameRows', () => {
  it('starts a run on the first line', () => {
    // Nothing above it to continue from. This falls out of `previous` starting
    // as null rather than from a special case, which is why it is asserted.
    const [first] = toBlameRows(blameOf(['aaa']));
    expect(first?.startsRun).toBe(true);
  });

  it('marks only the first line of a consecutive block', () => {
    const rows = toBlameRows(blameOf(['aaa', 'aaa', 'aaa']));
    expect(rows.map((r) => r.startsRun)).toEqual([true, false, false]);
  });

  it('starts a new run wherever the commit changes', () => {
    const rows = toBlameRows(blameOf(['aaa', 'aaa', 'bbb', 'aaa']));
    expect(rows.map((r) => r.startsRun)).toEqual([true, false, true, true]);
  });

  it('treats a commit that returns later as a new run, not a continuation', () => {
    // `aaa` owns lines 1 and 4 with `bbb` between them. Line 4 is a boundary on
    // screen even though its commit has been seen before — comparing against
    // "have I ever seen this oid" instead of "the line above" would blank it.
    const rows = toBlameRows(blameOf(['aaa', 'bbb', 'aaa']));
    expect(rows[2]?.startsRun).toBe(true);
  });

  it('attaches each line to its commit metadata', () => {
    const rows = toBlameRows(blameOf(['aaa', 'bbb']));
    expect(rows[0]?.commit?.summary).toBe('commit aaa');
    expect(rows[1]?.commit?.summary).toBe('commit bbb');
  });

  it('survives a line whose commit is missing from the map', () => {
    // A truncated or unexpected blame should render as lines without metadata,
    // not throw while showing them.
    const base = blameOf(['aaa']);
    const orphan: Blame = { lines: base.lines, commits: new Map() };
    expect(toBlameRows(orphan)[0]?.commit).toBeUndefined();
  });

  it('returns nothing for an empty file', () => {
    expect(toBlameRows({ lines: [], commits: new Map() })).toEqual([]);
  });
});
