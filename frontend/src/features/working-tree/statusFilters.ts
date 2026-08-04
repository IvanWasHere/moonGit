import { isStaged, isUnstaged, type StatusEntry } from '@/services/git';
import type { DisplayStatus } from './statusDisplay';

/**
 * The Files panel's status filter chips, and the predicate behind them.
 *
 * Pure, and tested against real porcelain rather than hand-written objects: a
 * filter decides what the user is allowed to see, and a fixture that agrees
 * with the implementation because both were written from the same assumption
 * proves nothing. `parsers/__fixtures__/status.ts` holds output captured from
 * git 2.47.1, including the `AM` / `RM` / `UU` rows that are the interesting
 * cases.
 *
 * **Why these seven, and why no Modified or Renamed chip.** Every *tracked*
 * change carries an XY pair, so it is staged or unstaged or both — which means
 * those two chips already reach Modified, Renamed, Copied and Typechange. The
 * only entries with no XY pair are untracked, unmerged and ignored, and those
 * are exactly what the remaining chips add. A chip per badge letter would be
 * enumeration for its own sake. The invariant that matters is that **nothing
 * can be filtered into being unreachable**, and five of the seven establish it
 * — `statusFilters.test.ts` asserts it over the whole fixture corpus rather
 * than trusting the argument.
 */

export type StatusFilter =
  'staged' | 'unstaged' | 'added' | 'untracked' | 'deleted' | 'conflicted' | 'ignored';

export interface StatusFilterSpec {
  readonly id: StatusFilter;
  /** Shown in the chip when it has no glyph, and in every chip's tooltip. */
  readonly label: string;
  /**
   * The `StatusBadge` status whose letter and colour the chip wears, or null
   * for the two that are positions rather than letters.
   *
   * The STATUS column two rows below already teaches `M A D ? R !`. A second
   * vocabulary for the same facts, 30px away from the first, would be two
   * things to learn for one idea — so the chips borrow that one. Staged and
   * Unstaged have no letter to borrow (they are *which half* of the pair, not
   * what happened in it), so they wear their words.
   */
  readonly badge: DisplayStatus | null;
  /** Why someone would reach for it — the chip's title attribute. */
  readonly hint: string;
}

export const STATUS_FILTERS: readonly StatusFilterSpec[] = [
  { id: 'staged', label: 'Staged', badge: null, hint: 'Changes going into the next commit' },
  {
    id: 'unstaged',
    label: 'Unstaged',
    badge: null,
    hint: 'Changes not going into the next commit',
  },
  { id: 'added', label: 'Added', badge: 'added', hint: 'Newly added to the index' },
  { id: 'untracked', label: 'Untracked', badge: 'untracked', hint: 'Not in the index at all' },
  { id: 'deleted', label: 'Deleted', badge: 'deleted', hint: 'Deleted on either side' },
  {
    id: 'conflicted',
    label: 'Conflicted',
    badge: 'conflicted',
    hint: 'Unresolved merge conflicts',
  },
  { id: 'ignored', label: 'Ignored', badge: 'ignored', hint: 'Matched by an ignore rule' },
];

/**
 * **A chip matches an entry when the entry's own row could wear that chip's
 * glyph**, which is what keeps the two rows of vocabulary agreeing.
 *
 * The case that forces the rule is a conflict. Git reports "added by both" as
 * `AA`, so a naive `index === 'A'` puts it under Added — while the row itself
 * shows `!` on both sides, because `displayStatus` already decided that an
 * unmerged path's XY letters describe *how* it conflicts rather than what
 * happened to it. A conflict is therefore reachable by Conflicted and not by
 * Added or Deleted.
 *
 * The two axis chips still match it, and deliberately: the row does show a
 * badge on both sides, and a merge in progress is the worst possible time for
 * conflicts to drop out of a list because the user had filtered to Staged.
 */
const PREDICATES: Record<StatusFilter, (entry: StatusEntry) => boolean> = {
  staged: isStaged,
  // Includes untracked files, which are the definitive case of a change that is
  // not staged — even though git reports them without an XY pair.
  unstaged: isUnstaged,
  added: (entry) => entry.kind !== 'unmerged' && entry.index === 'A',
  untracked: (entry) => entry.kind === 'untracked',
  // Either half: a file deleted and staged (`D.`) and one deleted in the
  // working tree (`.D`) are both "deleted" to someone looking for it.
  deleted: (entry) => entry.kind !== 'unmerged' && (entry.index === 'D' || entry.worktree === 'D'),
  conflicted: (entry) => entry.kind === 'unmerged',
  ignored: (entry) => entry.kind === 'ignored',
};

/**
 * Whether an entry survives the selected chips.
 *
 * **None selected shows everything**, which is the natural reading of "show
 * only what I picked" when nothing is picked. **Any selected is an OR**, so
 * Staged + Deleted shows staged-anything *plus* deleted-anything rather than
 * staged deletions. If that intersection is ever wanted, the two side chips and
 * the five kind chips become two groups ANDed together — a change to this
 * function and nothing else.
 */
export function matchesStatusFilters(
  entry: StatusEntry,
  selected: readonly StatusFilter[],
): boolean {
  if (selected.length === 0) return true;
  return selected.some((id) => PREDICATES[id](entry));
}

const IDS = new Set<string>(STATUS_FILTERS.map((spec) => spec.id));

/**
 * Read a persisted selection back, dropping anything this build does not know.
 *
 * The value comes out of SQLite as unvalidated JSON that an older or newer
 * build wrote, and it feeds a predicate lookup — an unrecognised id would index
 * `PREDICATES` with `undefined` and throw while rendering the file list. Same
 * discipline as `layoutPersistence`'s diff-mode check, for the same reason.
 */
export function parseStatusFilters(value: unknown): StatusFilter[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<StatusFilter>();
  for (const item of value) {
    if (typeof item === 'string' && IDS.has(item)) seen.add(item as StatusFilter);
  }
  return [...seen];
}
