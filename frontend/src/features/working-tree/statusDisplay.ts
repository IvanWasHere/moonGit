import { isStaged, isUnstaged, type StatusEntry } from '@/services/git';
import type { FileSide } from '@/stores/workspaceStore';
import { fileDir, fileName } from '@/utils/format';

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
  | 'conflicted'
  | 'ignored';

const CODES: Record<string, DisplayStatus> = {
  M: 'modified',
  A: 'added',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  T: 'typechange',
  U: 'conflicted',
};

export function displayStatus(entry: StatusEntry, side: FileSide): DisplayStatus {
  if (entry.kind === 'untracked') return 'untracked';
  // Its own status rather than "untracked", which it is not: an ignored file is
  // one git has been told to leave alone, and the two are opposite intentions
  // even though neither is in the index.
  if (entry.kind === 'ignored') return 'ignored';
  // An unmerged path is a conflict whichever half is being looked at; git's
  // XY pair for it describes *how* it conflicts, not what to do about it.
  if (entry.kind === 'unmerged') return 'conflicted';

  const code = side === 'staged' ? entry.index : entry.worktree;
  return CODES[code] ?? 'modified';
}

/**
 * Whether a side has anything to show, and which side a click should open.
 *
 * The file list is flat, so one row now stands for what used to be two — and a
 * file staged and then edited again has a *different* status and a *different*
 * patch on each side. `sidesOf` is what lets one row say both.
 */
export interface EntrySides {
  /** Staged status, or null when the index half is unchanged. */
  readonly staged: DisplayStatus | null;
  /** Unstaged status, or null when the working-tree half is unchanged. */
  readonly worktree: DisplayStatus | null;
}

export function sidesOf(entry: StatusEntry): EntrySides {
  return {
    staged: isStaged(entry) ? displayStatus(entry, 'staged') : null,
    worktree: isUnstaged(entry) ? displayStatus(entry, 'worktree') : null,
  };
}

/**
 * Which diff a click on the row body should open.
 *
 * The working tree wins when both halves exist, because the unstaged change is
 * the one the user is still working on — the staged half is already decided.
 * (Either badge can be clicked directly to override this.)
 */
export function defaultSide(entry: StatusEntry): FileSide {
  return isUnstaged(entry) ? 'worktree' : 'staged';
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

/** The two path columns: the filename, and the directory holding it. */
export interface PathParts {
  /** FILE — a bare filename, or `old → new` when a rename changed it. */
  readonly name: string;
  /** PATH — the directory, or `old → new` when a rename moved it. Empty at the root. */
  readonly dir: string;
}

/**
 * Split an entry across the FILE and PATH columns.
 *
 * Before there were two columns, the row ran `fileDir()` over `displayPath()` —
 * so a rename's "directory" was the whole string `src/legacy/OldWidget.tsx →
 * src/components/`, with the arrow and both filenames inside it. Two columns
 * make the right answer expressible: the name pair and the directory pair are
 * different facts and belong in different cells.
 *
 * **A half that did not change is not repeated.** `Same.tsx → Same.tsx` in the
 * FILE column of a file that only moved directories says nothing, twice; the
 * move is entirely in the PATH column, and that is where the arrow belongs.
 *
 * **No trailing slash**, unlike `fileDir`. The PATH column truncates from the
 * left, which makes a trailing `/` an ellipsis-side bidi-neutral character that
 * the browser relocates to the visual left — `src/x` rendering as `x/src`. Quick
 * open hit this and stripped it at the call site (PLAN.md §9, Phase 6.7); doing
 * it here means the hazard cannot come back through a third caller.
 */
export function splitPath(entry: StatusEntry): PathParts {
  const from = entry.origPath;
  if (from === undefined || from === entry.path) {
    return { name: leafOf(entry.path), dir: dirOf(entry.path) };
  }
  return {
    name: pair(leafOf(from), leafOf(entry.path)),
    dir: pair(dirOf(from), dirOf(entry.path)),
  };
}

/** `old → new`, or just the one value when the rename left this half alone. */
function pair(from: string, to: string): string {
  if (from === to) return to;
  // `.` for the repository root rather than an empty side, which would leave a
  // dangling ` → src` whose arrow reads as pointing at nothing.
  return `${from === '' ? '.' : from} → ${to === '' ? '.' : to}`;
}

/**
 * The trailing segment, keeping git's trailing slash when there is one.
 *
 * The ignored query reports a wholly-ignored directory as one row — `node_
 * modules/` — and that slash is the only thing distinguishing it from a file.
 * A plain `split('/')` on it yields an empty last segment, which would render
 * as a nameless row.
 */
function leafOf(path: string): string {
  return path.endsWith('/') ? `${fileName(path.slice(0, -1))}/` : fileName(path);
}

/** The directory part, without `fileDir`'s trailing slash — see `splitPath`. */
function dirOf(path: string): string {
  return fileDir(path.endsWith('/') ? path.slice(0, -1) : path).replace(/\/$/, '');
}

/** Sorted by path so the list does not reshuffle between refetches. */
export function sortEntries(entries: readonly StatusEntry[]): StatusEntry[] {
  return [...entries].sort((a, b) => a.path.localeCompare(b.path));
}
