/**
 * Lane assignment for the commit graph — turning a list of commits into the
 * columns and lines drawn beside them.
 *
 * The model is a set of **lanes**, each holding the object id of the commit it
 * is next expecting. Walking the log newest-first:
 *
 * - A commit takes the lane already waiting for it. Any *other* lanes waiting
 *   for the same id are its other children, and they converge into that one.
 * - A commit nothing is waiting for is a branch tip, and opens a new lane.
 * - Its **first parent continues in the same lane**, which is what makes a
 *   branch one straight column of one colour all the way down.
 * - Every further parent — a merge — either joins a lane already tracking it or
 *   opens one, and that is the line that peels off to the side.
 *
 * Lanes are never renumbered once assigned. Compacting them after a branch ends
 * would produce a narrower graph at the cost of every line to its right
 * shifting sideways, and a line that moves for reasons unrelated to its own
 * history is worse than an empty column. Freed slots are reused by later
 * branches instead.
 *
 * Only the commits actually loaded exist here. A parent outside the window
 * simply never arrives, and its lane runs off the bottom of the list — which is
 * exactly what it should look like.
 */

import type { Commit } from '@/services/git';

/**
 * Which part of the row's height a line covers.
 *
 * The distinction is not cosmetic. A branch tip has nothing above it and a root
 * has nothing below it, so a model that only knew "lane at the top, lane at the
 * bottom" would draw a line running out of the top of every tip — a line to a
 * commit that is not there.
 */
export type EdgeSpan =
  /** Enters from the row above and stops at the node: a child merging in. */
  | 'top'
  /** Leaves the node for the row below: a parent. */
  | 'bottom'
  /** Passes the row entirely, belonging to neither this commit nor its parents. */
  | 'full';

export interface GraphEdge {
  /** Lane at the top of the row. */
  readonly from: number;
  /** Lane at the bottom of the row. */
  readonly to: number;
  readonly color: number;
  readonly span: EdgeSpan;
}

export interface GraphRow {
  readonly oid: string;
  /** Column the commit's node sits in. */
  readonly lane: number;
  readonly color: number;
  /** Every line crossing this row, including those meeting the node. */
  readonly edges: readonly GraphEdge[];
  readonly isMerge: boolean;
}

export interface CommitGraph {
  readonly rows: readonly GraphRow[];
  /** Number of lanes in use anywhere — the width the renderer needs. */
  readonly lanes: number;
}

/**
 * Lane colours.
 *
 * Eight, from the mockup's palette. They repeat on a busy graph, which is fine:
 * the colour distinguishes *adjacent* branches, and two lanes sharing one are
 * only confusing if they are also next to each other — which needs nine
 * concurrent branches on screen.
 */
export const LANE_COLORS = [
  'var(--accent)',
  'var(--blue)',
  'var(--green)',
  'var(--purple)',
  'var(--cyan)',
  'var(--red)',
  'var(--orange)',
  'var(--text-secondary)',
] as const;

function firstFree(lanes: readonly (string | null)[]): number {
  const index = lanes.indexOf(null);
  return index === -1 ? lanes.length : index;
}

export function buildGraph(commits: readonly Commit[]): CommitGraph {
  /** Per lane: the oid it is waiting for, or null when free. */
  const lanes: (string | null)[] = [];
  const colors: number[] = [];
  const rows: GraphRow[] = [];
  let nextColor = 0;
  let widest = 0;

  const open = (oid: string): number => {
    const lane = firstFree(lanes);
    lanes[lane] = oid;
    colors[lane] = nextColor % LANE_COLORS.length;
    nextColor += 1;
    return lane;
  };

  for (const commit of commits) {
    // Every lane expecting this commit. More than one means it has several
    // children in view, and they all meet here.
    const waiting: number[] = [];
    for (const [index, expected] of lanes.entries()) {
      if (expected === commit.oid) waiting.push(index);
    }

    const lane = waiting.length > 0 ? (waiting[0] ?? 0) : open(commit.oid);
    const color = colors[lane] ?? 0;
    const edges: GraphEdge[] = [];

    // Converging: the other children's lanes end at this node. Each keeps its
    // own colour on the way in, so a branch stays its colour until it merges.
    for (const other of waiting) {
      edges.push({
        from: other,
        to: lane,
        color: other === lane ? color : (colors[other] ?? color),
        span: 'top',
      });
      if (other !== lane) lanes[other] = null;
    }
    // With `waiting` empty this is a branch tip, and no line reaches it from
    // above — which is precisely what the absence of a 'top' edge means.

    // Straight-through lanes: untouched by this commit, drawn as they pass.
    for (const [index, expected] of lanes.entries()) {
      if (expected === null || waiting.includes(index) || index === lane) continue;
      edges.push({ from: index, to: index, color: colors[index] ?? 0, span: 'full' });
    }

    // The first parent inherits the lane — the reason a branch is one column.
    const parents = [...new Set(commit.parents)];
    const [first, ...rest] = parents;
    lanes[lane] = first ?? null;
    if (first !== undefined) {
      edges.push({ from: lane, to: lane, color, span: 'bottom' });
    }

    // Merges: every further parent peels off into its own lane, and takes that
    // lane's colour rather than this commit's.
    for (const parent of rest) {
      const existing = lanes.indexOf(parent);
      const target = existing === -1 ? open(parent) : existing;
      edges.push({ from: lane, to: target, color: colors[target] ?? 0, span: 'bottom' });
    }

    widest = Math.max(widest, lanes.length);
    rows.push({
      oid: commit.oid,
      lane,
      color,
      edges,
      isMerge: parents.length > 1,
    });
  }

  return { rows, lanes: widest };
}
