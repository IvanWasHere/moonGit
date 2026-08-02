import { describe, expect, it } from 'vitest';
import { parseStatus, type StatusEntry } from '@/services/git';
import { STATUS_EVERYTHING } from '@/services/git/parsers/__fixtures__/status';
import { actionsIn, extensionOf, fileMenuFor } from './fileMenu';

const entries = parseStatus(STATUS_EVERYTHING).entries;

function byPath(path: string): StatusEntry {
  const found = entries.find((entry) => entry.path === path);
  if (found === undefined) throw new Error(`no entry ${path}`);
  return found;
}

const menuFor = (path: string) => fileMenuFor(byPath(path));
const actionsFor = (path: string) => actionsIn(menuFor(path));

describe('extensionOf', () => {
  it('reads the last extension', () => {
    expect(extensionOf('src/components/Header.tsx')).toBe('tsx');
    expect(extensionOf('a/archive.tar.gz')).toBe('gz');
  });

  // `*.` is not a pattern; offering it would write a rule matching nothing.
  it('finds none where there is none to find', () => {
    expect(extensionOf('.gitignore')).toBeNull();
    expect(extensionOf('Makefile')).toBeNull();
    expect(extensionOf('weird.')).toBeNull();
  });
});

describe('a conflicted file', () => {
  const actions = actionsFor('conflict.txt');

  it('leads with the ways out of the conflict', () => {
    expect(actions.slice(0, 4)).toEqual([
      'resolveConflict',
      'resolveUsingOurs',
      'resolveUsingTheirs',
      'markResolved',
    ]);
  });

  /**
   * Staging a file with conflict markers still in it is the mistake this menu
   * exists to prevent, and discarding "the" changes is meaningless when there
   * are two sides of them.
   */
  it('offers neither staging nor discarding', () => {
    expect(actions).not.toContain('stage');
    expect(actions).not.toContain('unstage');
    expect(actions).not.toContain('discard');
    expect(actions).not.toContain('revert');
  });
});

describe('an untracked file', () => {
  const actions = actionsFor('.gitignore');

  it('calls staging "Add", as git does', () => {
    const labels = menuFor('.gitignore').flatMap((entry) =>
      entry.kind === 'item' ? [entry.label] : [],
    );
    expect(labels).toContain('Add');
    expect(labels).not.toContain('Stage');
  });

  it('can be ignored and deleted', () => {
    expect(actions).toContain('ignoreByName');
    expect(actions).toContain('delete');
  });

  /** Nothing git tracks means nothing git can unstage, revert, remove or log. */
  it('omits every action that needs a tracked history', () => {
    for (const absent of ['unstage', 'revert', 'remove', 'rename', 'fileLog']) {
      expect(actions).not.toContain(absent);
    }
  });

  // `.gitignore` has no extension, so "Ignore *.<ext>" would be "*." — nothing.
  it('offers no extension rule when there is no extension', () => {
    expect(actions).not.toContain('ignoreByExtension');
    expect(actionsFor('modifyme.txt')).toContain('ignoreByExtension');
  });
});

describe('a staged file', () => {
  // `added.txt` is `AM` — staged as an addition, edited since.
  const actions = actionsFor('added.txt');

  it('offers unstaging and committing', () => {
    expect(actions).toContain('unstage');
    expect(actions).toContain('commitSelected');
  });

  /** A file added in the index has no committed version to revert to. */
  it('offers no revert for a staged addition', () => {
    expect(actions).not.toContain('revert');
  });

  it('still offers discard, because it has unstaged changes too', () => {
    expect(actions).toContain('discard');
  });
});

describe('a modified file', () => {
  const actions = actionsFor('modifyme.txt');

  it('offers the full set', () => {
    for (const expected of ['open', 'showChanges', 'reveal', 'openTerminal', 'stage', 'fileLog']) {
      expect(actions).toContain(expected);
    }
  });

  it('offers revert as well as discard, which are different operations', () => {
    expect(actions).toContain('discard');
    expect(actions).toContain('revert');
  });

  /**
   * Hunk and line staging live in the diff pane, where the hunks are; this
   * entry is the signpost to them, and it is enabled now that they exist.
   */
  it('offers partial staging, enabled', () => {
    const hunk = menuFor('modifyme.txt').find(
      (entry) => entry.kind === 'item' && entry.action === 'stageHunk',
    );
    expect(hunk).toMatchObject({ label: 'Stage Lines or Hunks…' });
    expect(hunk).not.toMatchObject({ disabled: true });
  });
});

describe('partial staging', () => {
  /** Nothing unstaged means nothing to stage a piece of. */
  it('is offered only when there are unstaged changes', () => {
    expect(actionsFor('modifyme.txt')).toContain('stageHunk');
    // `renamed.txt` is staged with a clean working tree.
    expect(actionsFor('renamed.txt')).not.toContain('stageHunk');
    // An untracked file has no diff to pick hunks out of.
    expect(actionsFor('.gitignore')).not.toContain('stageHunk');
  });
});

describe('menu structure', () => {
  it('never starts, ends or doubles a separator', () => {
    for (const entry of entries) {
      const menu = fileMenuFor(entry);
      expect(menu[0]?.kind).not.toBe('separator');
      expect(menu[menu.length - 1]?.kind).not.toBe('separator');
      for (const [index, current] of menu.entries()) {
        if (current.kind !== 'separator') continue;
        expect(menu[index - 1]?.kind).not.toBe('separator');
      }
    }
  });

  it('marks the irreversible actions destructive so they can be confirmed', () => {
    const destructive = menuFor('modifyme.txt')
      .filter((entry) => entry.kind === 'item' && entry.destructive === true)
      .map((entry) => (entry.kind === 'item' ? entry.action : ''));
    expect(destructive).toEqual(['discard', 'revert', 'remove', 'delete']);
  });
});
