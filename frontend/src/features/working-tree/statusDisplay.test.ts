import { describe, expect, it } from 'vitest';
import { parseStatus, type StatusEntry } from '@/services/git';
import {
  STATUS_EVERYTHING,
  STATUS_IGNORED_DIRS,
  STATUS_RENAMES_AND_DELETES,
} from '@/services/git/parsers/__fixtures__/status';
import { branchType } from '@/features/branches/branchType';
import {
  defaultSide,
  displayPath,
  displayStatus,
  sidesOf,
  sortEntries,
  splitPath,
} from './statusDisplay';

const entries = parseStatus(STATUS_EVERYTHING).entries;

function byPath(path: string): StatusEntry {
  const found = entries.find((entry) => entry.path === path);
  if (found === undefined) throw new Error(`no entry ${path}`);
  return found;
}

const moved = parseStatus(STATUS_RENAMES_AND_DELETES).entries;

function movedByPath(path: string): StatusEntry {
  const found = moved.find((entry) => entry.path === path);
  if (found === undefined) throw new Error(`no entry ${path}`);
  return found;
}

describe('displayStatus', () => {
  it('reads each side of a file that is staged and modified again', () => {
    // `AM`: added to the index, then edited. The Staged row should say "added"
    // and the Changes row "modified" — the same file, two different truths.
    const entry = byPath('added.txt');

    expect(displayStatus(entry, 'staged')).toBe('added');
    expect(displayStatus(entry, 'worktree')).toBe('modified');
  });

  it('reads a rename', () => {
    expect(displayStatus(byPath('renamed.txt'), 'staged')).toBe('renamed');
  });

  it('reads untracked', () => {
    expect(displayStatus(byPath('.gitignore'), 'worktree')).toBe('untracked');
  });

  // Not "untracked": neither is in the index, but one is waiting to be added
  // and the other has been told to stay out, which are opposite intentions.
  it('reads ignored as its own status', () => {
    expect(displayStatus(byPath('ignored.log'), 'worktree')).toBe('ignored');
  });

  // A conflict shown as "modified" would invite staging a file that still has
  // conflict markers in it.
  it('reads a conflict as conflicted, whichever side is asked', () => {
    const entry = byPath('conflict.txt');

    expect(displayStatus(entry, 'staged')).toBe('conflicted');
    expect(displayStatus(entry, 'worktree')).toBe('conflicted');
  });

  it('falls back to modified for an unrecognised code', () => {
    const entry = { ...byPath('modifyme.txt'), worktree: 'Z' } as unknown as StatusEntry;
    expect(displayStatus(entry, 'worktree')).toBe('modified');
  });
});

describe('sidesOf', () => {
  /**
   * The reason the status column carries two badges rather than one. `AM` is
   * one file with two different truths, and either badge alone is a lie about
   * the other half — they are also two different patches.
   */
  it('reports both halves of a file staged and then edited', () => {
    expect(sidesOf(byPath('added.txt'))).toEqual({ staged: 'added', worktree: 'modified' });
  });

  it('leaves the working-tree half empty for a purely staged change', () => {
    expect(sidesOf(byPath('renamed.txt'))).toEqual({ staged: 'renamed', worktree: null });
  });

  it('leaves the index half empty for an untracked file', () => {
    expect(sidesOf(byPath('.gitignore'))).toEqual({ staged: null, worktree: 'untracked' });
  });

  it('marks a conflict on both halves, since it blocks either', () => {
    expect(sidesOf(byPath('conflict.txt'))).toEqual({
      staged: 'conflicted',
      worktree: 'conflicted',
    });
  });
});

describe('defaultSide', () => {
  // The unstaged half is the change still being worked on; the staged half is
  // already decided. Clicking a badge overrides this.
  it('opens the working tree when a file has changes on both sides', () => {
    expect(defaultSide(byPath('added.txt'))).toBe('worktree');
  });

  it('opens the index when that is the only side with a change', () => {
    expect(defaultSide(byPath('renamed.txt'))).toBe('staged');
  });
});

describe('displayPath', () => {
  it('shows both ends of a rename', () => {
    // Showing only the new path makes the old name's disappearance look like a
    // deletion somewhere else in the list.
    expect(displayPath(byPath('renamed.txt'))).toBe('renameme.txt → renamed.txt');
  });

  it('shows one path for everything else', () => {
    expect(displayPath(byPath('modifyme.txt'))).toBe('modifyme.txt');
  });
});

describe('splitPath', () => {
  it('splits an ordinary path into its name and directory', () => {
    expect(splitPath(movedByPath('docs/gone.md'))).toEqual({ name: 'gone.md', dir: 'docs' });
  });

  it('leaves the directory empty at the repository root', () => {
    expect(splitPath(movedByPath('root.txt'))).toEqual({ name: 'root.txt', dir: '' });
  });

  /**
   * The bug this column removes. The single-cell row ran `fileDir()` over
   * `displayPath()`, so this entry's "directory" was the whole string
   * `src/legacy/OldWidget.tsx → src/components/` — the arrow and both filenames
   * inside the directory half.
   */
  it('splits a rename into a name pair and a directory pair', () => {
    expect(splitPath(movedByPath('src/components/Widget.tsx'))).toEqual({
      name: 'OldWidget.tsx → Widget.tsx',
      dir: 'src/legacy → src/components',
    });
  });

  // A pure move: repeating `Same.tsx → Same.tsx` in the FILE column says
  // nothing twice, and the move is entirely in the other column.
  it('does not repeat a half the rename left alone', () => {
    expect(splitPath(movedByPath('docs/Same.tsx'))).toEqual({
      name: 'Same.tsx',
      dir: 'src/components → docs',
    });
  });

  // A dangling ` → docs` reads as an arrow pointing from nothing.
  it('names the repository root rather than leaving a side of the arrow empty', () => {
    const entry = { ...movedByPath('docs/Same.tsx'), origPath: 'Same.tsx' };
    expect(splitPath(entry).dir).toBe('. → docs');
  });

  /**
   * No trailing slash, unlike `fileDir`. The PATH column truncates from the
   * left, and a trailing `/` is a bidi-neutral character that the browser
   * relocates to the visual left under an RTL run — the bug quick open hit and
   * fixed at its call site (PLAN.md §9, Phase 6.7). Fixing it in the split
   * means a third caller cannot reintroduce it.
   */
  it('returns a directory with no trailing slash', () => {
    expect(splitPath(movedByPath('src/components/Widget.tsx')).dir).not.toMatch(/\/$/);
    expect(splitPath(movedByPath('docs/gone.md')).dir).not.toMatch(/\/$/);
  });

  /**
   * The ignored query collapses a wholly-ignored directory to a single row, and
   * git's trailing slash is the only thing marking it as one. Splitting on `/`
   * naively yields an empty last segment, which renders as a nameless row.
   */
  it('keeps the trailing slash of a collapsed directory in the name', () => {
    const ignored = parseStatus(STATUS_IGNORED_DIRS).entries;
    const nested = ignored.find((entry) => entry.path === 'frontend/node_modules/');
    const top = ignored.find((entry) => entry.path === 'node_modules/');
    if (nested === undefined || top === undefined) throw new Error('fixture changed');

    expect(splitPath(nested)).toEqual({ name: 'node_modules/', dir: 'frontend' });
    expect(splitPath(top)).toEqual({ name: 'node_modules/', dir: '' });
  });
});

describe('sortEntries', () => {
  it('orders by path so the list does not reshuffle between refetches', () => {
    const sorted = sortEntries(entries).map((entry) => entry.path);
    expect(sorted).toEqual([...sorted].sort((a, b) => a.localeCompare(b)));
  });

  it('does not mutate its input', () => {
    const before = entries.map((entry) => entry.path);
    sortEntries(entries);
    expect(entries.map((entry) => entry.path)).toEqual(before);
  });
});

describe('branchType', () => {
  it('reads the git-flow prefix', () => {
    expect(branchType('feature/auth-flow')).toBe('feature');
    expect(branchType('hotfix/db')).toBe('hotfix');
    expect(branchType('release/2.4.0')).toBe('release');
  });

  it('treats main and develop as their own type', () => {
    expect(branchType('main')).toBe('main');
    expect(branchType('develop')).toBe('develop');
  });

  // Tagging every prefix would fill the panel with meaningless labels.
  it('calls anything unrecognised a branch', () => {
    expect(branchType('ivan/scratch')).toBe('branch');
    expect(branchType('wip')).toBe('branch');
    expect(branchType('')).toBe('branch');
  });

  it('keeps the prefix of a deeply nested name', () => {
    expect(branchType('feature/team/thing')).toBe('feature');
  });
});
