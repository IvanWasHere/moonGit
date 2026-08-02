/**
 * Turning git's one-dimensional patch into the two shapes the viewer renders.
 *
 * A patch is a single ordered list of lines: deletions, then additions, then
 * context. That is exactly what the inline view wants and exactly what the
 * side-by-side view does not — split needs to know which deletion corresponds
 * to which addition so the two can sit on the same row.
 *
 * Both shapes come out of one pass, because the pairing that split needs is
 * also what tells inline which lines are worth a word diff. Computing them
 * separately would run the intra-line diff twice and risk the two views
 * disagreeing about what changed.
 */

import type { DiffFile, DiffHunk, DiffLine } from '@/services/git';
import { wordDiff, type WordSegment } from './wordDiff';

export type DiffViewMode = 'inline' | 'split';

export interface ViewLine {
  readonly line: DiffLine;
  /**
   * Position in the source hunk's `lines`, which is **not** this line's
   * position in the rendered order — a change block is emitted deletions-first
   * for inline and paired for split. Line-level staging keys off the source
   * position, because that is what the patch builder addresses.
   */
  readonly index: number;
  /**
   * Intra-line runs, present only when this line was paired with its
   * counterpart and the two were similar enough to be worth refining.
   */
  readonly segments?: readonly WordSegment[];
}

/** One row of the side-by-side view; a half-empty row is a pure add or delete. */
export interface SplitRow {
  readonly left: ViewLine | null;
  readonly right: ViewLine | null;
}

export interface AlignedHunk {
  readonly hunk: DiffHunk;
  /** Patch order, exactly as git emitted it. */
  readonly lines: readonly ViewLine[];
  readonly rows: readonly SplitRow[];
}

/**
 * Which side a `\ No newline at end of file` marker belongs to.
 *
 * The marker annotates the line above it, so its side is whichever side that
 * line was on. After a context line it is true of both.
 */
type Phase = 'context' | 'deletion' | 'addition';

export function alignHunk(hunk: DiffHunk): AlignedHunk {
  const lines: ViewLine[] = [];
  const rows: SplitRow[] = [];

  let index = 0;
  let phase: Phase = 'context';

  const pushMarker = (line: DiffLine, at: number) => {
    const view: ViewLine = { line, index: at };
    lines.push(view);
    if (phase === 'deletion') rows.push({ left: view, right: null });
    else if (phase === 'addition') rows.push({ left: null, right: view });
    else rows.push({ left: view, right: view });
  };

  while (index < hunk.lines.length) {
    const line = hunk.lines[index];
    if (line === undefined) break;

    if (line.kind === 'noNewline') {
      pushMarker(line, index);
      index += 1;
      continue;
    }

    if (line.kind === 'context') {
      const view: ViewLine = { line, index };
      lines.push(view);
      rows.push({ left: view, right: view });
      phase = 'context';
      index += 1;
      continue;
    }

    // A change block: every consecutive deletion and addition, plus any
    // markers among them. Collected whole so the two sides can be paired.
    // Paired with their source positions, which the rendered order loses.
    const deletions: { line: DiffLine; index: number }[] = [];
    const additions: { line: DiffLine; index: number }[] = [];
    const leftMarkers: { line: DiffLine; index: number }[] = [];
    const rightMarkers: { line: DiffLine; index: number }[] = [];
    let blockPhase: Phase = line.kind === 'deletion' ? 'deletion' : 'addition';

    while (index < hunk.lines.length) {
      const current = hunk.lines[index];
      if (current === undefined || current.kind === 'context') break;
      if (current.kind === 'deletion') {
        deletions.push({ line: current, index });
        blockPhase = 'deletion';
      } else if (current.kind === 'addition') {
        additions.push({ line: current, index });
        blockPhase = 'addition';
      } else if (blockPhase === 'deletion') {
        leftMarkers.push({ line: current, index });
      } else {
        rightMarkers.push({ line: current, index });
      }
      index += 1;
    }

    // Pair by position. Any diff finer than this is a heuristic too, and
    // `wordDiff` declines the pairings that turn out to be unrelated.
    const paired = Math.min(deletions.length, additions.length);
    const leftViews: ViewLine[] = [];
    const rightViews: ViewLine[] = [];

    for (const [i, deletion] of deletions.entries()) {
      const addition = i < paired ? additions[i] : undefined;
      const refined =
        addition === undefined ? null : wordDiff(deletion.line.content, addition.line.content);
      leftViews.push(
        refined === null
          ? { line: deletion.line, index: deletion.index }
          : { line: deletion.line, index: deletion.index, segments: refined.oldSegments },
      );
      if (addition !== undefined) {
        rightViews.push(
          refined === null
            ? { line: addition.line, index: addition.index }
            : { line: addition.line, index: addition.index, segments: refined.newSegments },
        );
      }
    }
    for (const addition of additions.slice(paired)) {
      rightViews.push({ line: addition.line, index: addition.index });
    }

    const leftMarkerViews = leftMarkers.map((marker): ViewLine => ({
      line: marker.line,
      index: marker.index,
    }));
    const rightMarkerViews = rightMarkers.map((marker): ViewLine => ({
      line: marker.line,
      index: marker.index,
    }));

    // Inline keeps git's order: the run of deletions with its marker, then the
    // additions with theirs.
    lines.push(...leftViews, ...leftMarkerViews, ...rightViews, ...rightMarkerViews);

    for (let i = 0; i < Math.max(leftViews.length, rightViews.length); i += 1) {
      rows.push({ left: leftViews[i] ?? null, right: rightViews[i] ?? null });
    }
    for (const view of leftMarkerViews) rows.push({ left: view, right: null });
    for (const view of rightMarkerViews) rows.push({ left: null, right: view });

    phase = blockPhase;
  }

  return { hunk, lines, rows };
}

export function alignFile(file: DiffFile): AlignedHunk[] {
  return file.hunks.map(alignHunk);
}

/**
 * How many rows this file would put in the DOM.
 *
 * Split can need more rows than inline — an unbalanced change block pads the
 * short side — so the guard below counts the larger of the two.
 */
export function renderedLineCount(file: DiffFile): number {
  return file.hunks.reduce((total, hunk) => total + hunk.lines.length, 0);
}

/**
 * Above this, the diff is not rendered until the user asks for it.
 *
 * Nothing is virtualized yet (that is Phase 7), so a 60k-line patch means 60k
 * DOM nodes and a frozen window. The threshold is deliberately generous: it
 * exists to catch generated files and vendored bundles, not to nag about a
 * large refactor. Once the history and diff lists are virtualized this guard
 * can be raised or dropped.
 */
export const LARGE_DIFF_LINES = 2000;

export function isLargeDiff(file: DiffFile): boolean {
  return renderedLineCount(file) > LARGE_DIFF_LINES;
}
