import { describe, expect, it } from 'vitest';
import { parseStatus, type StatusEntry } from '@/services/git';
import {
  STATUS_EVERYTHING,
  STATUS_RENAMES_AND_DELETES,
  STATUS_WITH_IGNORED,
} from '@/services/git/parsers/__fixtures__/status';
import {
  matchesStatusFilters,
  parseStatusFilters,
  STATUS_FILTERS,
  type StatusFilter,
} from './statusFilters';

/**
 * Asserted against real porcelain rather than hand-written objects: the whole
 * point of the corpus is that a fixture agreeing with the implementation
 * because both were written from the same assumption proves nothing.
 */
const everything = parseStatus(STATUS_EVERYTHING).entries;
const moved = parseStatus(STATUS_RENAMES_AND_DELETES).entries;
const withIgnored = parseStatus(STATUS_WITH_IGNORED).entries;

function paths(entries: readonly StatusEntry[], selected: readonly StatusFilter[]): string[] {
  return entries.filter((entry) => matchesStatusFilters(entry, selected)).map((e) => e.path);
}

describe('matchesStatusFilters', () => {
  it('shows everything when nothing is selected', () => {
    expect(paths(everything, [])).toHaveLength(everything.length);
  });

  it('splits the XY pair down the staged / unstaged axis', () => {
    // `added.txt` is `AM` — staged *and* modified since, so it is in both.
    expect(paths(everything, ['staged'])).toContain('added.txt');
    expect(paths(everything, ['unstaged'])).toContain('added.txt');
    // `renamed.txt` is `R.`: staged only.
    expect(paths(everything, ['staged'])).toContain('renamed.txt');
    expect(paths(everything, ['unstaged'])).not.toContain('renamed.txt');
    // `modifyme.txt` is `.M`: unstaged only.
    expect(paths(everything, ['unstaged'])).toContain('modifyme.txt');
    expect(paths(everything, ['staged'])).not.toContain('modifyme.txt');
  });

  // An untracked file has no XY pair, but it is the definitive case of a change
  // that is not going into the commit.
  it('counts untracked files as unstaged', () => {
    expect(paths(everything, ['unstaged'])).toContain('.gitignore');
    expect(paths(everything, ['staged'])).not.toContain('.gitignore');
  });

  it('finds a deletion on either half of the pair', () => {
    // `docs/gone.md` is `D.` (staged), `root.txt` is `.D` (working tree).
    expect(paths(moved, ['deleted']).sort()).toEqual(['docs/gone.md', 'root.txt']);
  });

  it('matches added, untracked and conflicted by their own kind', () => {
    expect(paths(everything, ['added'])).toEqual(['added.txt']);
    expect(paths(everything, ['conflicted'])).toEqual(['conflict.txt']);
    expect(paths(everything, ['untracked'])).not.toContain('ignored.log');
  });

  /**
   * `conflict.txt` is `AA` — "added by both" — so a chip reading the letter
   * alone would file it under Added, while the row itself shows `!` on both
   * sides. The chips have to agree with the badges beside them.
   */
  it('does not let a conflict wear a letter its own row does not show', () => {
    expect(paths(everything, ['added'])).not.toContain('conflict.txt');
    expect(paths(everything, ['deleted'])).not.toContain('conflict.txt');
  });

  // The exception, and it is about a merge being the worst time to lose sight
  // of a conflict: the row *does* show a badge on both sides, so both axis
  // chips reach it.
  it('keeps a conflict on the staged / unstaged axis', () => {
    expect(paths(everything, ['staged'])).toContain('conflict.txt');
    expect(paths(everything, ['unstaged'])).toContain('conflict.txt');
  });

  it('reaches ignored entries only through the ignored chip', () => {
    expect(paths(withIgnored, ['ignored'])).toEqual(['debug.log']);
    expect(paths(withIgnored, ['unstaged'])).not.toContain('debug.log');
    expect(paths(withIgnored, ['staged'])).not.toContain('debug.log');
  });

  it('ORs the selected chips rather than intersecting them', () => {
    // Staged + Deleted is staged-anything *plus* deleted-anything, not staged
    // deletions — `root.txt` is `.D`, deleted but not staged, and it is in.
    const both = paths(moved, ['staged', 'deleted']);
    expect(both).toContain('root.txt');
    expect(both).toContain('docs/Same.tsx');
  });

  /**
   * The invariant the chip set exists to satisfy: **nothing on screen can be
   * filtered into being unreachable.** Seven chips are enough precisely because
   * every entry git can report matches at least one of them — an eighth kind of
   * entry added to the parser without a chip would fail here rather than
   * silently becoming invisible with every chip switched on.
   */
  it('leaves no entry unreachable with every chip selected', () => {
    const all = STATUS_FILTERS.map((spec) => spec.id);
    for (const entry of [...everything, ...moved, ...withIgnored]) {
      expect(matchesStatusFilters(entry, all), `${entry.kind} ${entry.path}`).toBe(true);
    }
  });
});

describe('parseStatusFilters', () => {
  it('keeps the ids this build knows', () => {
    expect(parseStatusFilters(['staged', 'ignored'])).toEqual(['staged', 'ignored']);
  });

  // The value is unchecked JSON out of SQLite feeding a predicate lookup, so an
  // id from another build would index the table with undefined and throw while
  // the file list renders.
  it('drops anything it does not recognise', () => {
    expect(parseStatusFilters(['staged', 'modified', 42, null])).toEqual(['staged']);
  });

  it('de-duplicates, since the value drives a toggle', () => {
    expect(parseStatusFilters(['staged', 'staged'])).toEqual(['staged']);
  });

  it('falls back to nothing selected for a value that is not a list', () => {
    expect(parseStatusFilters(undefined)).toEqual([]);
    expect(parseStatusFilters('staged')).toEqual([]);
  });
});
