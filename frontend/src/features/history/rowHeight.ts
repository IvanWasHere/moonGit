import type { Commit } from '@/services/git';

/**
 * How tall a Journal row is likely to be, before one has been rendered.
 *
 * **The virtualizer measures every row it actually draws**, so nothing here
 * affects a row on screen. What it governs is the rows that are *not* on
 * screen: the scrollbar's length and where a given scroll offset lands. Get it
 * badly wrong and the thumb resizes as you scroll — the list appears to grow
 * or shrink under the cursor, which is the characteristic tell of a virtualized
 * list guessing.
 *
 * That is tolerable at the 200-commit cap this replaces and is not at the
 * hundreds of thousands the paging work will bring, where the overwhelming
 * majority of rows will never have been measured.
 *
 * **Rows are deliberately not a fixed height.** `CommitGraph` is built around
 * that — its SVG stretches to whatever the row turned out to be — because the
 * alternative is truncating ref decorations. So the estimate has to model the
 * one thing that varies rather than assuming it away.
 */

/**
 * A row with nothing but a hash, an author, a time and a subject.
 *
 * **Measured in the running app, not derived from the stylesheet**: 16px of
 * `.entryBody` padding, a 17px `.head`, its 4px margin, a 17px `.message`, and
 * the 1px `.entry` bottom border. Those component numbers are whole on purpose
 * — see the note on `.entry` in `History.module.css` — so this is the row's
 * exact height rather than an approximation of it, and `estimateSize` and
 * `offsetHeight` agree for an undecorated row.
 */
export const BASE_ROW_HEIGHT = 55;

/**
 * Added by the `.refs` block — a 5px margin plus a 14px chip.
 *
 * One line's worth, not one per decoration. The labels wrap, so a commit
 * carrying twelve tags on a narrow pane is taller still, but the count alone
 * cannot say how many lines that becomes without knowing the pane width and
 * the length of every name. Assuming one line under-estimates the rare heavily
 * tagged commit rather than over-estimating the common untagged one, and the
 * common case is what a scrollbar is mostly made of.
 */
export const REFS_ROW_EXTRA = 19;

/** The estimate for one commit. Pure, so the arithmetic above is assertable. */
export function estimateRowHeight(commit: Commit | undefined): number {
  if (commit === undefined) return BASE_ROW_HEIGHT;
  return commit.decorations.length > 0 ? BASE_ROW_HEIGHT + REFS_ROW_EXTRA : BASE_ROW_HEIGHT;
}
