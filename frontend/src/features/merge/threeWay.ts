/**
 * Three-way merge regions: what ours and theirs each did to the base, laid
 * over one another so every difference becomes a decision the user can make.
 *
 * **Git does the diffing, not us.** Both sides are diffed against the merge
 * base with `git diff -U0 <baseOid> <sideOid>`, which returns hunks numbered
 * against the base — and *that* is what makes the two edit lists comparable.
 * Two edits that touch the same base lines are a conflict; two that do not are
 * independent, and git already merged them. Writing our own line differ would
 * have meant a second opinion about a merge git has already performed.
 *
 * `-U0` is essential: with context lines the hunks grow until they touch, and
 * two independent edits three lines apart would be reported as one region.
 *
 * Verified against a real conflict: base lines 1–7, ours editing lines 2 and 4,
 * theirs editing 2 and 7. Line 2 overlaps and is exactly the block git marked;
 * lines 4 and 7 are the two it resolved on its own, and both appear here as
 * regions with a side already chosen.
 */

import type { DiffHunk } from '@/services/git';

/** A replacement of a base line range, in base coordinates. */
export interface BaseEdit {
  /** 0-based, inclusive. */
  readonly start: number;
  /** 0-based, exclusive. `start === end` for a pure insertion. */
  readonly end: number;
  readonly lines: readonly string[];
}

export type RegionKind =
  /** Neither side touched it. */
  | 'identical'
  /** Only ours changed it — git took ours. */
  | 'ours'
  /** Only theirs changed it — git took theirs. */
  | 'theirs'
  /** Both changed it to the same thing. */
  | 'agreed'
  /** Both changed it, differently. This is what git could not decide. */
  | 'conflict';

export type Choice = 'ours' | 'theirs' | 'base' | 'oursThenTheirs' | 'theirsThenOurs';

export interface MergeRegion {
  readonly id: number;
  readonly kind: RegionKind;
  readonly base: readonly string[];
  readonly ours: readonly string[];
  readonly theirs: readonly string[];
  /**
   * What git did, or would have done — the pre-selected answer.
   *
   * Null only for a conflict, and that null is the point: a conflict has no
   * defensible default, and picking one silently is how a merge tool loses
   * somebody's work. The save is blocked until every null has an answer.
   */
  readonly suggested: Choice | null;
}

/**
 * Hunks from `git diff -U0 <base> <side>` as edits in base coordinates.
 *
 * The subtle case is a pure insertion, where git reports `@@ -N,0 +M,K @@`:
 * `N` is the line the text goes *after*, not a line being replaced. In 0-based
 * terms that is index `N`, whereas a replacement starting at line `N` is index
 * `N - 1`. Getting this backwards shifts every insertion by one line.
 */
export function editsFromHunks(hunks: readonly DiffHunk[]): BaseEdit[] {
  return hunks.map((hunk) => {
    const start = hunk.oldLines === 0 ? hunk.oldStart : hunk.oldStart - 1;
    return {
      start,
      end: start + hunk.oldLines,
      lines: hunk.lines.filter((line) => line.kind === 'addition').map((line) => line.content),
    };
  });
}

interface Group {
  start: number;
  end: number;
  ours: BaseEdit[];
  theirs: BaseEdit[];
}

/**
 * Cluster edits from both sides into the ranges that have to be decided together.
 *
 * Overlapping *or touching* ranges merge, which is what diff3 does: an edit
 * that deletes base lines 3–4 and one that inserts at line 4 are not
 * independent, even though their intervals only meet at a point.
 */
function groupEdits(ours: readonly BaseEdit[], theirs: readonly BaseEdit[]): Group[] {
  const all = [
    ...ours.map((edit) => ({ edit, side: 'ours' as const })),
    ...theirs.map((edit) => ({ edit, side: 'theirs' as const })),
  ].sort((a, b) => a.edit.start - b.edit.start || a.edit.end - b.edit.end);

  const groups: Group[] = [];
  for (const { edit, side } of all) {
    const last = groups[groups.length - 1];
    if (last !== undefined && edit.start <= last.end) {
      last.end = Math.max(last.end, edit.end);
      last[side].push(edit);
    } else {
      groups.push({
        start: edit.start,
        end: edit.end,
        ours: side === 'ours' ? [edit] : [],
        theirs: side === 'theirs' ? [edit] : [],
      });
    }
  }
  return groups;
}

/** One side's text for a base range: the base lines with that side's edits applied. */
function applyEdits(
  base: readonly string[],
  start: number,
  end: number,
  edits: readonly BaseEdit[],
): string[] {
  const ordered = [...edits].sort((a, b) => a.start - b.start);
  const out: string[] = [];
  let cursor = start;
  for (const edit of ordered) {
    out.push(...base.slice(cursor, edit.start));
    out.push(...edit.lines);
    cursor = Math.max(cursor, edit.end);
  }
  out.push(...base.slice(cursor, end));
  return out;
}

function sameLines(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((line, index) => line === b[index]);
}

export function buildRegions(
  base: readonly string[],
  ourEdits: readonly BaseEdit[],
  theirEdits: readonly BaseEdit[],
): MergeRegion[] {
  const regions: MergeRegion[] = [];
  let id = 0;
  let cursor = 0;

  const push = (region: Omit<MergeRegion, 'id'>) => {
    regions.push({ ...region, id: id++ });
  };

  for (const group of groupEdits(ourEdits, theirEdits)) {
    if (group.start > cursor) {
      const shared = base.slice(cursor, group.start);
      push({ kind: 'identical', base: shared, ours: shared, theirs: shared, suggested: 'base' });
    }

    const baseLines = base.slice(group.start, group.end);
    const ours =
      group.ours.length > 0 ? applyEdits(base, group.start, group.end, group.ours) : [...baseLines];
    const theirs =
      group.theirs.length > 0
        ? applyEdits(base, group.start, group.end, group.theirs)
        : [...baseLines];

    const touchedByOurs = group.ours.length > 0;
    const touchedByTheirs = group.theirs.length > 0;

    let kind: RegionKind;
    let suggested: Choice | null;
    if (touchedByOurs && touchedByTheirs) {
      const agreed = sameLines(ours, theirs);
      kind = agreed ? 'agreed' : 'conflict';
      suggested = agreed ? 'ours' : null;
    } else if (touchedByOurs) {
      kind = 'ours';
      suggested = 'ours';
    } else {
      kind = 'theirs';
      suggested = 'theirs';
    }

    push({ kind, base: baseLines, ours, theirs, suggested });
    cursor = group.end;
  }

  if (cursor < base.length) {
    const shared = base.slice(cursor);
    push({ kind: 'identical', base: shared, ours: shared, theirs: shared, suggested: 'base' });
  }

  return regions;
}

/** The lines a region contributes under a given choice. */
export function linesFor(region: MergeRegion, choice: Choice): readonly string[] {
  switch (choice) {
    case 'ours':
      return region.ours;
    case 'theirs':
      return region.theirs;
    case 'base':
      return region.base;
    case 'oursThenTheirs':
      return [...region.ours, ...region.theirs];
    case 'theirsThenOurs':
      return [...region.theirs, ...region.ours];
  }
}

export type Choices = Readonly<Record<number, Choice>>;

/** The choice in force for a region: the user's, or git's, or none yet. */
export function choiceFor(region: MergeRegion, choices: Choices): Choice | null {
  return choices[region.id] ?? region.suggested;
}

/** Regions with no answer — always conflicts, and always what blocks a save. */
export function undecided(
  regions: readonly MergeRegion[],
  choices: Choices,
): readonly MergeRegion[] {
  return regions.filter((region) => choiceFor(region, choices) === null);
}

/**
 * The resolved file.
 *
 * Undecided regions contribute nothing, so a partially resolved result is
 * still readable in the middle column — it simply has a gap where the decision
 * belongs. Saving is blocked separately, by `undecided`, rather than by
 * emitting something plausible here.
 */
export function resolvedLines(
  regions: readonly MergeRegion[],
  choices: Choices,
): readonly string[] {
  const out: string[] = [];
  for (const region of regions) {
    const choice = choiceFor(region, choices);
    if (choice !== null) out.push(...linesFor(region, choice));
  }
  return out;
}

/**
 * Split a file into lines for merging, dropping the trailing empty string a
 * final newline produces — otherwise every join would grow the file by a line.
 */
export function toLines(text: string): string[] {
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Join back, restoring the trailing newline every well-formed text file has. */
export function fromLines(lines: readonly string[]): string {
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}
