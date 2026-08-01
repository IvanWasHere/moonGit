import type { StatusEntry } from '@/services/git';

/**
 * Porcelain v2 status codes → the badge the Files panel shows.
 *
 * The mockup knew four states (modified, added, deleted, untracked) because it
 * had no git. Real status has more, and collapsing them would be a lie the
 * user can act on: a conflicted file shown as "modified" invites staging it
 * with the conflict markers still in the text.
 *
 * A file appears in both lists when it is staged *and* modified again since
 * (`AM`, `MM`) — so which badge to show depends on which list the row is in,
 * and that is what `side` selects.
 */

export type DisplayStatus =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'untracked'
  | 'renamed'
  | 'copied'
  | 'typechange'
  | 'conflicted';

const CODES: Record<string, DisplayStatus> = {
  M: 'modified',
  A: 'added',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  T: 'typechange',
  U: 'conflicted',
};

export function displayStatus(entry: StatusEntry, side: 'staged' | 'worktree'): DisplayStatus {
  if (entry.kind === 'untracked') return 'untracked';
  if (entry.kind === 'ignored') return 'untracked';
  // An unmerged path is a conflict whichever half is being looked at; git's
  // XY pair for it describes *how* it conflicts, not what to do about it.
  if (entry.kind === 'unmerged') return 'conflicted';

  const code = side === 'staged' ? entry.index : entry.worktree;
  return CODES[code] ?? 'modified';
}

/**
 * The path to render.
 *
 * A rename shows both ends — "the old name is gone and this is where it went"
 * is the one thing the user needs to see, and showing only the new path makes
 * the disappearance look like a deletion elsewhere in the list.
 */
export function displayPath(entry: StatusEntry): string {
  if (entry.origPath !== undefined && entry.origPath !== entry.path) {
    return `${entry.origPath} → ${entry.path}`;
  }
  return entry.path;
}

/** Sorted by path so the list does not reshuffle between refetches. */
export function sortEntries(entries: readonly StatusEntry[]): StatusEntry[] {
  return [...entries].sort((a, b) => a.path.localeCompare(b.path));
}
