import { describe, expect, it } from 'vitest';
import type { Commit } from '@/services/git';
import { buildGraph, LANE_COLORS, type GraphRow } from './graph';

/** A commit is only its id and its parents as far as the graph is concerned. */
function commit(oid: string, ...parents: string[]): Commit {
  return {
    oid,
    shortOid: oid.slice(0, 7),
    parents,
    author: { name: 'T', email: 't@t', date: 0 },
    committer: { name: 'T', email: 't@t', date: 0 },
    subject: oid,
    body: '',
    decorations: [],
    isMerge: parents.length > 1,
    isRoot: parents.length === 0,
  };
}

const lanesOf = (rows: readonly GraphRow[]) => rows.map((row) => row.lane);
const edge = (row: GraphRow, from: number, to: number) =>
  row.edges.some((candidate) => candidate.from === from && candidate.to === to);
const spans = (row: GraphRow) => row.edges.map((candidate) => candidate.span);

describe('a linear history', () => {
  // a → b → c, newest first.
  const graph = buildGraph([commit('a', 'b'), commit('b', 'c'), commit('c')]);

  it('keeps everything in one lane', () => {
    expect(lanesOf(graph.rows)).toEqual([0, 0, 0]);
    expect(graph.lanes).toBe(1);
  });

  it('draws a straight line through every row but the last', () => {
    expect(edge(graph.rows[0]!, 0, 0)).toBe(true);
    expect(edge(graph.rows[1]!, 0, 0)).toBe(true);
    // The root has no parent, so nothing leaves the bottom of its row.
    expect(spans(graph.rows[2]!)).toEqual(['top']);
  });

  it('gives the whole branch one colour', () => {
    expect(new Set(graph.rows.map((row) => row.color)).size).toBe(1);
  });
});

describe('a merge', () => {
  /**
   *   m        merge of a and b
   *   |\
   *   a |      first parent — stays in the merge's lane
   *   | b      second parent — peels into a lane of its own
   *   |/
   *   base
   */
  const graph = buildGraph([
    commit('m', 'a', 'b'),
    commit('a', 'base'),
    commit('b', 'base'),
    commit('base'),
  ]);

  it('keeps the first parent in the merge lane and opens one for the second', () => {
    expect(lanesOf(graph.rows)).toEqual([0, 0, 1, 0]);
    expect(graph.lanes).toBe(2);
  });

  it('draws the second parent peeling off the merge row', () => {
    expect(edge(graph.rows[0]!, 0, 1)).toBe(true);
    expect(edge(graph.rows[0]!, 0, 0)).toBe(true);
  });

  it('gives the side branch its own colour', () => {
    expect(graph.rows[2]?.color).not.toBe(graph.rows[0]?.color);
  });

  /** The two branches meet again at their common parent. */
  it('converges both lanes into the base commit', () => {
    const base = graph.rows[3]!;
    expect(base.lane).toBe(0);
    expect(edge(base, 1, 0)).toBe(true);
    expect(edge(base, 0, 0)).toBe(true);
  });

  it('marks the merge row as one', () => {
    expect(graph.rows.map((row) => row.isMerge)).toEqual([true, false, false, false]);
  });
});

describe('a side branch that never merges', () => {
  // Two tips over a shared base: the second tip has nothing waiting for it.
  const graph = buildGraph([commit('x', 'base'), commit('y', 'base'), commit('base')]);

  it('opens a lane for the second tip', () => {
    expect(lanesOf(graph.rows)).toEqual([0, 1, 0]);
  });

  it('runs a line through the middle row for the lane it does not touch', () => {
    // Lane 0 is waiting for `base` while row 1 draws `y` in lane 1.
    expect(edge(graph.rows[1]!, 0, 0)).toBe(true);
  });
});

describe('lane reuse', () => {
  /**
   * A branch that ends frees its column, and the next one takes it — which is
   * what keeps the graph from growing a lane per branch forever.
   */
  it('reuses a freed lane rather than opening a new one', () => {
    const graph = buildGraph([
      commit('m', 'a', 'b'), // opens lane 1 for b
      commit('a', 'base'),
      commit('b', 'base'), // lane 1 closes into base at the next row
      commit('base', 'older'),
      commit('older', 'p', 'q'), // needs a second lane again
      commit('p', 'root'),
      commit('q', 'root'),
      commit('root'),
    ]);
    expect(graph.lanes).toBe(2);
  });

  it('gives the reused lane a fresh colour, since it is a different branch', () => {
    const graph = buildGraph([
      commit('m', 'a', 'b'),
      commit('a', 'base'),
      commit('b', 'base'),
      commit('base', 'older'),
      commit('older', 'p', 'q'),
      commit('p', 'root'),
      commit('q', 'root'),
      commit('root'),
    ]);
    const firstSide = graph.rows.find((row) => row.oid === 'b');
    const secondSide = graph.rows.find((row) => row.oid === 'q');
    expect(firstSide?.lane).toBe(secondSide?.lane);
    expect(firstSide?.color).not.toBe(secondSide?.color);
  });
});

describe('edge cases', () => {
  it('handles an empty log', () => {
    expect(buildGraph([])).toEqual({ rows: [], lanes: 0 });
  });

  it('handles a single root commit', () => {
    const graph = buildGraph([commit('only')]);
    expect(graph.rows[0]?.lane).toBe(0);
    expect(graph.rows[0]?.edges).toEqual([]);
  });

  /** An octopus merge naming the same parent twice must not open two lanes. */
  it('deduplicates repeated parents', () => {
    const graph = buildGraph([commit('m', 'a', 'a'), commit('a')]);
    expect(graph.lanes).toBe(1);
    expect(graph.rows[0]?.isMerge).toBe(false);
  });

  it('copes with an octopus merge', () => {
    const graph = buildGraph([
      commit('m', 'a', 'b', 'c'),
      commit('a', 'root'),
      commit('b', 'root'),
      commit('c', 'root'),
      commit('root'),
    ]);
    expect(graph.lanes).toBe(3);
    expect(graph.rows[0]?.isMerge).toBe(true);
  });

  /**
   * A parent outside the loaded window never arrives, so its lane simply runs
   * off the bottom — which is what a truncated log should look like.
   */
  it('leaves a dangling line for a parent that was never loaded', () => {
    const graph = buildGraph([commit('a', 'missing')]);
    expect(graph.rows[0]?.edges).toEqual([{ from: 0, to: 0, color: 0, span: 'bottom' }]);
  });

  /** A tip is the top of its line, and a root the bottom of one. */
  it('draws no line above a tip or below a root', () => {
    const graph = buildGraph([commit('tip', 'root'), commit('root')]);
    expect(spans(graph.rows[0]!)).toEqual(['bottom']);
    expect(spans(graph.rows[1]!)).toEqual(['top']);
  });

  it('stays within the palette however many branches there are', () => {
    const many = Array.from({ length: 30 }, (_, index) => commit(`tip${index}`, 'root'));
    const graph = buildGraph([...many, commit('root')]);
    for (const row of graph.rows) {
      expect(row.color).toBeGreaterThanOrEqual(0);
      expect(row.color).toBeLessThan(LANE_COLORS.length);
    }
  });
});

describe('against a real shape', () => {
  /**
   * The `wizlive` repository from the merge verification: main moved on, a
   * feature branched from an older commit and never merged.
   *
   *   e  widget returns 2   (main)
   *   |
   *   d  add widget
   *   |
   *   c  raise retries to 5
   *   | b  raise retries to 10   (feature/diverged)
   *   |/
   *   a  initial
   */
  it('lays out two tips over a shared root', () => {
    const graph = buildGraph([
      commit('e', 'd'),
      commit('d', 'c'),
      commit('c', 'a'),
      commit('b', 'a'),
      commit('a'),
    ]);

    expect(lanesOf(graph.rows)).toEqual([0, 0, 0, 1, 0]);
    // The side branch's line converges into the root.
    expect(edge(graph.rows[4]!, 1, 0)).toBe(true);
    expect(graph.lanes).toBe(2);
  });
});
