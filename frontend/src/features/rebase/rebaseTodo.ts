/**
 * The interactive rebase todo list — what git would open an editor for.
 *
 * moonGit has no terminal to open one in, so it hands git a **sequence editor
 * that is not an editor**: `GIT_SEQUENCE_EDITOR` is set to a command that
 * copies a file this module produced over the todo git generated. Git then
 * carries on as though the user had saved it.
 *
 * This file is only the list and its rules. Writing it out and running git
 * belongs to the service; the interesting part — which orderings and actions
 * git will accept — is a pure question and is tested as one.
 */

import type { Commit } from '@/services/git';

/**
 * The actions offered.
 *
 * **`reword` is deliberately absent.** It stops the rebase and opens
 * `GIT_EDITOR` on the message; with no terminal, that editor has to be a
 * no-op, which makes reword silently keep the message unchanged — a menu item
 * that does nothing while claiming otherwise. `edit` gives the same power
 * honestly: the rebase stops, and the commit composer can amend the message
 * along with anything else.
 *
 * `squash` and `fixup` need no editor. Git combines the messages itself and
 * only *offers* to edit the result, so a no-op editor accepts its default.
 */
export type RebaseAction = 'pick' | 'edit' | 'squash' | 'fixup' | 'drop';

export interface TodoEntry {
  readonly oid: string;
  readonly shortOid: string;
  readonly subject: string;
  readonly action: RebaseAction;
}

export const ACTION_LABELS: Readonly<Record<RebaseAction, string>> = {
  pick: 'Pick',
  edit: 'Edit',
  squash: 'Squash',
  fixup: 'Fixup',
  drop: 'Drop',
};

export const ACTION_HINTS: Readonly<Record<RebaseAction, string>> = {
  pick: 'Keep the commit as it is',
  edit: 'Stop here so the commit can be amended',
  squash: 'Fold into the commit above, keeping both messages',
  fixup: 'Fold into the commit above, discarding this message',
  drop: 'Leave the commit out entirely',
};

/**
 * Build the initial list from the commits that would be replayed.
 *
 * Git's todo runs **oldest first**, the order it applies them in. Every list
 * shown to a user has to be in that order too, or "fold into the commit above"
 * means the opposite of what it says.
 */
export function todoFromCommits(commits: readonly Commit[]): TodoEntry[] {
  return [...commits].reverse().map((commit) => ({
    oid: commit.oid,
    shortOid: commit.shortOid,
    subject: commit.subject,
    action: 'pick',
  }));
}

/** Move an entry, returning a new list. Out-of-range moves are no-ops. */
export function moveEntry(entries: readonly TodoEntry[], from: number, to: number): TodoEntry[] {
  if (from === to || from < 0 || to < 0 || from >= entries.length || to >= entries.length) {
    return [...entries];
  }
  const next = [...entries];
  const [moved] = next.splice(from, 1);
  if (moved !== undefined) next.splice(to, 0, moved);
  return next;
}

export function setAction(
  entries: readonly TodoEntry[],
  index: number,
  action: RebaseAction,
): TodoEntry[] {
  return entries.map((entry, position) => (position === index ? { ...entry, action } : entry));
}

/**
 * Why git would refuse this list, or null when it would accept it.
 *
 * The rule that actually bites: **the first commit that survives cannot fold
 * into the one above it**, because there is no commit above it — git stops
 * with "cannot 'squash' without a previous commit" *after* it has already
 * begun rewriting history, which is a far worse place to find out than a
 * disabled button.
 */
export function todoProblem(entries: readonly TodoEntry[]): string | null {
  const kept = entries.filter((entry) => entry.action !== 'drop');
  if (kept.length === 0) return 'Every commit is dropped — there would be nothing to rebase.';

  const first = kept[0];
  if (first !== undefined && (first.action === 'squash' || first.action === 'fixup')) {
    return `${ACTION_LABELS[first.action]} needs a commit above it to fold into.`;
  }
  return null;
}

/**
 * Serialise to git's todo format.
 *
 * One entry per line, `<action> <oid> <subject>`. The subject is a comment as
 * far as git is concerned — it reads the action and the object id and ignores
 * the rest — but it is what makes the file legible if anything ever needs to
 * be inspected mid-rebase.
 */
export function serialiseTodo(entries: readonly TodoEntry[]): string {
  const lines = entries.map((entry) => `${entry.action} ${entry.oid} ${entry.subject}`);
  return `${lines.join('\n')}\n`;
}

/**
 * Quote a path for the shell git runs the sequence editor through.
 *
 * Git does not exec the editor directly — it hands the string to `sh -c` — so
 * a repository under a path with a space in it produces a command that copies
 * the wrong file, or nothing. Single quotes with the usual `'\''` escape are
 * the only form that is safe for every byte a path may contain.
 */
export function shellQuote(path: string): string {
  return `'${path.replaceAll("'", `'\\''`)}'`;
}
