/**
 * What the context menu offers for a commit.
 *
 * Same shape and the same reasoning as `fileMenu.ts`: which items appear is a
 * question about git state, and it is worth asserting in tests rather than
 * checking by right-clicking things.
 *
 * The state that matters here is different, though. A file's menu turns on
 * staged/untracked/conflicted; a commit's turns on **whether it is the one
 * currently checked out** and **whether it is a merge**, because those are the
 * two cases where an offered action would fail or mean something else.
 */

import type { Commit } from '@/services/git';

export type CommitMenuAction =
  | 'cherryPick'
  | 'cherryPickNoCommit'
  | 'tagHere'
  | 'copyOid'
  | 'copySubject'
  | 'fileLogFrom'
  | 'showDiff';

export interface CommitMenuItem {
  readonly kind: 'item';
  readonly action: CommitMenuAction;
  readonly label: string;
  readonly destructive?: boolean;
}

export type CommitMenuEntry = { readonly kind: 'separator' } | CommitMenuItem;

function item(action: CommitMenuAction, label: string): CommitMenuItem {
  return { kind: 'item', action, label };
}

const SEPARATOR = { kind: 'separator' } as const;

function tidy(entries: readonly (CommitMenuEntry | null)[]): CommitMenuEntry[] {
  const out: CommitMenuEntry[] = [];
  for (const entry of entries) {
    if (entry === null) continue;
    if (
      entry.kind === 'separator' &&
      (out.length === 0 || out[out.length - 1]?.kind === 'separator')
    )
      continue;
    out.push(entry);
  }
  while (out[out.length - 1]?.kind === 'separator') out.pop();
  return out;
}

/** True when this commit is the tip of the checked-out branch. */
export function isCheckedOut(commit: Commit): boolean {
  return commit.decorations.some((decoration) => decoration.isHead);
}

export function commitMenuFor(commit: Commit): CommitMenuEntry[] {
  // Cherry-picking the commit you are sitting on is always "nothing to do", and
  // git says so with an error rather than a shrug.
  const onHead = isCheckedOut(commit);

  return tidy([
    item('showDiff', 'Show Changes'),
    SEPARATOR,

    /*
     * A merge has no single change to replay — git needs `-m` to say which
     * parent is the mainline, and picking one on the user's behalf is a guess
     * about intent that can quietly bring in an entire branch. Offering it
     * without asking would be worse than not offering it.
     */
    onHead || commit.isMerge ? null : item('cherryPick', 'Cherry-pick onto current branch'),
    onHead || commit.isMerge ? null : item('cherryPickNoCommit', 'Cherry-pick without committing'),
    onHead || commit.isMerge ? null : SEPARATOR,

    item('tagHere', 'Create Tag here…'),
    item('fileLogFrom', 'History from here'),
    SEPARATOR,

    item('copyOid', 'Copy Commit SHA'),
    item('copySubject', 'Copy Subject'),
  ]);
}

/** Every action a menu offers, for tests. */
export function actionsIn(entries: readonly CommitMenuEntry[]): CommitMenuAction[] {
  return entries.flatMap((entry) => (entry.kind === 'item' ? [entry.action] : []));
}
