import { describe, expect, it } from 'vitest';
import { parseStatus, type StatusEntry } from '@/services/git';
import { STATUS_EVERYTHING } from '@/services/git/parsers/__fixtures__/status';
import { branchType } from '@/features/branches/branchType';
import { defaultSide, displayPath, displayStatus, sidesOf, sortEntries } from './statusDisplay';

const entries = parseStatus(STATUS_EVERYTHING).entries;

function byPath(path: string): StatusEntry {
  const found = entries.find((entry) => entry.path === path);
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
