/**
 * What the context menu offers for a file, decided from its status alone.
 *
 * Kept pure and separate from the rendering for the same reason `menuConfig.ts`
 * is: the interesting part of a context menu is *which items appear*, and that
 * is a question about git state — staged, untracked, conflicted — which is
 * worth asserting in tests rather than checking by right-clicking things.
 *
 * The rule throughout is that an item is present when it would do something.
 * "Unstage" on a file with nothing staged, or "Mark Resolved" on a file with
 * no conflict, is an invitation to a no-op or an error; the spec this was built
 * from says as much with its `(if already staged)` and `(if conflicted)` notes.
 *
 * Items whose feature is not built are **absent, not disabled**: a disabled row
 * says "this exists and you cannot have it", which is right for something
 * blocked by state and wrong for something we simply have not written.
 */

import { isConflicted, isStaged, isUnstaged, type StatusEntry } from '@/services/git';

export type FileMenuAction =
  | 'open'
  | 'showChanges'
  | 'reveal'
  | 'openTerminal'
  | 'stage'
  | 'unstage'
  | 'stageHunk'
  | 'commitSelected'
  | 'discard'
  | 'revert'
  | 'resolveConflict'
  | 'resolveUsingOurs'
  | 'resolveUsingTheirs'
  | 'markResolved'
  | 'ignoreByName'
  | 'ignoreByExtension'
  | 'editGitignore'
  | 'remove'
  | 'rename'
  | 'delete'
  | 'fileLog'
  | 'copyPath'
  | 'copyRelativePath'
  | 'copyRepositoryPath'
  | 'refresh';

export interface FileMenuItem {
  readonly kind: 'item';
  readonly action: FileMenuAction;
  readonly label: string;
  /** Present and greyed: the feature exists in the plan but not yet in the app. */
  readonly disabled?: boolean;
  readonly hint?: string;
  /** Needs a confirmation before it runs — destructive and not undoable. */
  readonly destructive?: boolean;
}

export interface FileMenuSubmenu {
  readonly kind: 'submenu';
  readonly label: string;
  readonly items: readonly FileMenuItem[];
}

export type FileMenuEntry = { readonly kind: 'separator' } | FileMenuItem | FileMenuSubmenu;

function item(
  action: FileMenuAction,
  label: string,
  extra: Omit<FileMenuItem, 'kind' | 'action' | 'label'> = {},
): FileMenuItem {
  return { kind: 'item', action, label, ...extra };
}

const SEPARATOR = { kind: 'separator' } as const;

/** Drop leading, trailing and doubled separators left by omitted items. */
function tidy(entries: readonly (FileMenuEntry | null)[]): FileMenuEntry[] {
  const present = entries.filter((entry): entry is FileMenuEntry => entry !== null);
  const out: FileMenuEntry[] = [];
  for (const entry of present) {
    if (
      entry.kind === 'separator' &&
      (out.length === 0 || out[out.length - 1]?.kind === 'separator')
    ) {
      continue;
    }
    out.push(entry);
  }
  while (out[out.length - 1]?.kind === 'separator') out.pop();
  return out;
}

/**
 * Whether the file has an extension worth offering to ignore.
 *
 * `.gitignore` and `Makefile` have none, and `*.` is not a pattern — offering
 * it would write a rule that matches nothing.
 */
export function extensionOf(path: string): string | null {
  const name = path.split('/').pop() ?? '';
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return null;
  return name.slice(dot + 1);
}

export function fileMenuFor(entry: StatusEntry): FileMenuEntry[] {
  const conflicted = isConflicted(entry);
  const staged = isStaged(entry);
  const unstaged = isUnstaged(entry);
  const untracked = entry.kind === 'untracked';
  const extension = extensionOf(entry.path);

  // A conflict is its own menu. Half the ordinary actions are wrong mid-merge
  // — staging a file with markers still in it, discarding one side of it — and
  // burying "resolve" among them would be the opposite of helpful.
  if (conflicted) {
    return tidy([
      item('resolveConflict', 'Conflict Solver…'),
      item('resolveUsingOurs', 'Resolve Using Mine'),
      item('resolveUsingTheirs', 'Resolve Using Theirs'),
      item('markResolved', 'Mark Resolved'),
      SEPARATOR,
      item('showChanges', 'Show Changes'),
      item('open', 'Open'),
      item('reveal', 'Reveal in Finder'),
      item('fileLog', 'File Log'),
      SEPARATOR,
      item('copyPath', 'Copy Path'),
      item('refresh', 'Refresh'),
    ]);
  }

  return tidy([
    item('open', 'Open'),
    item('showChanges', 'Show Changes'),
    item('reveal', 'Reveal in Finder'),
    item('openTerminal', 'Open Terminal Here'),
    SEPARATOR,

    untracked ? item('stage', 'Add') : item('stage', 'Stage'),
    staged ? item('unstage', 'Unstage') : null,
    staged ? item('commitSelected', 'Commit Selected…') : null,
    // Hunk and line staging happen in the diff pane, where the hunks are; this
    // is the signpost to them rather than a second way of doing it.
    untracked || !unstaged ? null : item('stageHunk', 'Stage Lines or Hunks…'),
    SEPARATOR,

    unstaged ? item('discard', 'Discard Changes', { destructive: true }) : null,
    // Only meaningful against a committed version, which an addition has none of.
    untracked || entry.index === 'A'
      ? null
      : item('revert', 'Revert to HEAD', { destructive: true }),
    SEPARATOR,

    {
      kind: 'submenu',
      label: 'Ignore',
      items: [
        item('ignoreByName', 'Ignore by Name'),
        ...(extension === null ? [] : [item('ignoreByExtension', `Ignore *.${extension}`)]),
        item('editGitignore', 'Edit .gitignore'),
      ],
    },
    SEPARATOR,

    untracked ? null : item('remove', 'Remove from Repository', { destructive: true }),
    untracked ? null : item('rename', 'Rename…'),
    item('delete', 'Delete from Disk', { destructive: true }),
    SEPARATOR,

    untracked ? null : item('fileLog', 'File Log'),
    untracked ? null : SEPARATOR,

    item('copyPath', 'Copy Path'),
    item('copyRelativePath', 'Copy Relative Path'),
    item('copyRepositoryPath', 'Copy Repository Path'),
    SEPARATOR,
    item('refresh', 'Refresh'),
  ]);
}

/** Every action a menu offers, for tests and for exhaustiveness checks. */
export function actionsIn(entries: readonly FileMenuEntry[]): FileMenuAction[] {
  return entries.flatMap((entry) =>
    entry.kind === 'item'
      ? [entry.action]
      : entry.kind === 'submenu'
        ? entry.items.map((child) => child.action)
        : [],
  );
}
