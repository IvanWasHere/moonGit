import { describe, expect, it } from 'vitest';
import { parseDiff } from '@/services/git';
import {
  buildRegions,
  choiceFor,
  editsFromHunks,
  fromLines,
  resolvedLines,
  toLines,
  undecided,
  type BaseEdit,
} from './threeWay';

function edit(start: number, end: number, ...lines: string[]): BaseEdit {
  return { start, end, lines };
}

const BASE = ['one', 'two', 'three', 'four', 'five', 'six', 'seven'];

describe('editsFromHunks', () => {
  /**
   * The one that bites: for an insertion git reports the line the text goes
   * *after*, not a line being replaced, so the 0-based index is `oldStart`
   * rather than `oldStart - 1`. Off by one here shifts every insertion.
   */
  it('reads an insertion as a zero-width edit at the right index', () => {
    const [result] = editsFromHunks([
      {
        oldStart: 3,
        oldLines: 0,
        newStart: 4,
        newLines: 1,
        header: '',
        lines: [{ kind: 'addition', content: 'new', oldLineNo: null, newLineNo: 4 }],
      },
    ]);
    expect(result).toEqual({ start: 3, end: 3, lines: ['new'] });
  });

  it('reads a replacement as spanning the lines it replaces', () => {
    const [result] = editsFromHunks([
      {
        oldStart: 2,
        oldLines: 2,
        newStart: 2,
        newLines: 1,
        header: '',
        lines: [
          { kind: 'deletion', content: 'two', oldLineNo: 2, newLineNo: null },
          { kind: 'deletion', content: 'three', oldLineNo: 3, newLineNo: null },
          { kind: 'addition', content: 'merged', oldLineNo: null, newLineNo: 2 },
        ],
      },
    ]);
    expect(result).toEqual({ start: 1, end: 3, lines: ['merged'] });
  });
});

describe('buildRegions', () => {
  it('reproduces what git did to a real conflict', () => {
    // Ours edited base lines 2 and 4; theirs edited 2 and 7. Git marked line 2
    // and resolved 4 and 7 on its own — this is that, region by region.
    const regions = buildRegions(
      BASE,
      [edit(1, 2, 'TWO-ours'), edit(3, 4, 'FOUR-ours')],
      [edit(1, 2, 'TWO-theirs'), edit(6, 7, 'SEVEN-theirs')],
    );

    expect(regions.map((region) => region.kind)).toEqual([
      'identical', // one
      'conflict', // two
      'identical', // three
      'ours', // four
      'identical', // five, six
      'theirs', // seven
    ]);

    const conflict = regions[1];
    expect(conflict?.ours).toEqual(['TWO-ours']);
    expect(conflict?.theirs).toEqual(['TWO-theirs']);
    expect(conflict?.suggested).toBeNull();
    expect(regions[3]?.suggested).toBe('ours');
    expect(regions[5]?.suggested).toBe('theirs');
  });

  it('accepting every suggestion outside the conflict rebuilds git own merge', () => {
    const regions = buildRegions(
      BASE,
      [edit(1, 2, 'TWO-ours'), edit(3, 4, 'FOUR-ours')],
      [edit(1, 2, 'TWO-theirs'), edit(6, 7, 'SEVEN-theirs')],
    );
    const conflict = regions.find((region) => region.kind === 'conflict');

    expect(resolvedLines(regions, { [conflict?.id ?? -1]: 'ours' })).toEqual([
      'one',
      'TWO-ours',
      'three',
      'FOUR-ours',
      'five',
      'six',
      'SEVEN-theirs',
    ]);
  });

  it('calls it agreed, not conflicted, when both sides made the same change', () => {
    const regions = buildRegions(BASE, [edit(1, 2, 'same')], [edit(1, 2, 'same')]);
    const changed = regions.filter((region) => region.kind !== 'identical');
    expect(changed.map((region) => region.kind)).toEqual(['agreed']);
    expect(changed[0]?.suggested).toBe('ours');
  });

  /**
   * Two edits that only meet at a point are still one decision — a deletion of
   * lines 3–4 and an insertion at line 4 cannot be applied independently.
   */
  it('groups edits that touch without overlapping', () => {
    const regions = buildRegions(BASE, [edit(2, 4)], [edit(4, 4, 'inserted')]);
    expect(regions.filter((region) => region.kind === 'conflict')).toHaveLength(1);
  });

  it('keeps independent edits apart', () => {
    const regions = buildRegions(BASE, [edit(0, 1, 'a')], [edit(6, 7, 'z')]);
    expect(regions.map((region) => region.kind)).toEqual(['ours', 'identical', 'theirs']);
  });

  it('handles a side that only deletes', () => {
    // The edit starts at base index 1, so region 0 is the leading shared line.
    const regions = buildRegions(BASE, [edit(1, 3)], []);
    expect(regions[1]?.kind).toBe('ours');
    expect(regions[1]?.ours).toEqual([]);
    expect(regions[1]?.base).toEqual(['two', 'three']);
    expect(resolvedLines(regions, {})).toEqual(['one', 'four', 'five', 'six', 'seven']);
  });

  it('produces one identical region for a file neither side touched', () => {
    const regions = buildRegions(BASE, [], []);
    expect(regions).toHaveLength(1);
    expect(regions[0]?.kind).toBe('identical');
  });
});

describe('choices', () => {
  const regions = buildRegions(BASE, [edit(1, 2, 'ours')], [edit(1, 2, 'theirs')]);
  const conflictId = regions.find((region) => region.kind === 'conflict')?.id ?? -1;

  it('blocks a save while a conflict is unanswered', () => {
    expect(undecided(regions, {}).map((region) => region.id)).toEqual([conflictId]);
    expect(undecided(regions, { [conflictId]: 'ours' })).toEqual([]);
  });

  // Silently defaulting a conflict is how a merge tool loses somebody's work.
  it('leaves an undecided conflict out of the result rather than guessing', () => {
    expect(resolvedLines(regions, {})).toEqual(['one', 'three', 'four', 'five', 'six', 'seven']);
  });

  it('keeps both sides in the order asked for', () => {
    expect(resolvedLines(regions, { [conflictId]: 'oursThenTheirs' })[1]).toBe('ours');
    expect(resolvedLines(regions, { [conflictId]: 'oursThenTheirs' })[2]).toBe('theirs');
    expect(resolvedLines(regions, { [conflictId]: 'theirsThenOurs' })[1]).toBe('theirs');
  });

  it('lets a user override what git chose', () => {
    const oursOnly = buildRegions(BASE, [edit(1, 2, 'mine')], []);
    const changed = oursOnly.find((region) => region.kind === 'ours');
    if (changed === undefined) throw new Error('expected an ours-only region');

    expect(choiceFor(changed, {})).toBe('ours');
    expect(resolvedLines(oursOnly, {})[1]).toBe('mine');
    // Taking the base back out is a legitimate answer: "neither, revert it".
    expect(choiceFor(changed, { [changed.id]: 'base' })).toBe('base');
    expect(resolvedLines(oursOnly, { [changed.id]: 'base' })[1]).toBe('two');
  });
});

describe('line handling', () => {
  // Without the pop, every save would grow the file by one blank line.
  it('round trips a file with a trailing newline', () => {
    expect(fromLines(toLines('a\nb\n'))).toBe('a\nb\n');
  });

  it('adds the trailing newline a file was missing', () => {
    expect(toLines('a\nb')).toEqual(['a', 'b']);
    expect(fromLines(['a', 'b'])).toBe('a\nb\n');
  });

  it('leaves an empty file empty', () => {
    expect(fromLines(toLines(''))).toBe('');
  });
});

/** End to end from real `git diff -U0` output, as the app will feed it. */
describe('against real git output', () => {
  it('turns two blob diffs into the regions git resolved and the one it did not', () => {
    const patch = (hunks: string) =>
      `:100644 100644 aaa bbb M\0base\0\0diff --git a/base b/side\nindex aaa..bbb 100644\n--- a/base\n+++ b/side\n${hunks}`;

    const ours = parseDiff(
      patch('@@ -2 +2 @@ one\n-two\n+TWO-ours\n@@ -4 +4 @@ three\n-four\n+FOUR-ours\n'),
    );
    const theirs = parseDiff(
      patch('@@ -2 +2 @@ one\n-two\n+TWO-theirs\n@@ -7 +7 @@ six\n-seven\n+SEVEN-theirs\n'),
    );

    const regions = buildRegions(
      BASE,
      editsFromHunks(ours[0]?.hunks ?? []),
      editsFromHunks(theirs[0]?.hunks ?? []),
    );

    expect(regions.filter((region) => region.kind === 'conflict')).toHaveLength(1);
    expect(regions.filter((region) => region.kind === 'ours')).toHaveLength(1);
    expect(regions.filter((region) => region.kind === 'theirs')).toHaveLength(1);
  });
});
