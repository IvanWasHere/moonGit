import { describe, expect, it } from 'vitest';
import type { DiffFile, DiffHunk, DiffLine } from '@/services/git';
import { buildPatch, countSelectable, hunkLineKeys, lineKey, quotePath } from './patch';

function line(kind: DiffLine['kind'], content: string): DiffLine {
  return { kind, content, oldLineNo: null, newLineNo: null };
}

function hunk(oldStart: number, newStart: number, lines: DiffLine[]): DiffHunk {
  return { oldStart, oldLines: 0, newStart, newLines: 0, header: '', lines };
}

function file(path: string, hunks: DiffHunk[]): DiffFile {
  return {
    path,
    kind: 'modified',
    oldMode: '100644',
    newMode: '100644',
    oldOid: 'a',
    newOid: 'b',
    hunks,
    additions: 0,
    deletions: 0,
    isBinary: false,
    isSubmodule: false,
    isModeChangeOnly: false,
    isCombined: false,
    parentCount: 1,
  };
}

/** `retries: 3` → `retries: 5`, with a line of context either side. */
const SIMPLE = file('src/config.ts', [
  hunk(10, 10, [
    line('context', 'const config = {'),
    line('deletion', '  retries: 3,'),
    line('addition', '  retries: 5,'),
    line('context', '};'),
  ]),
]);

const all = (target: DiffFile) =>
  new Set(target.hunks.flatMap((each, index) => hunkLineKeys(each, index)));

describe('buildPatch, whole hunk', () => {
  it('emits a patch git can read', () => {
    expect(buildPatch(SIMPLE, all(SIMPLE), 'stage')).toBe(
      [
        'diff --git a/src/config.ts b/src/config.ts',
        '--- a/src/config.ts',
        '+++ b/src/config.ts',
        '@@ -10,3 +10,3 @@',
        ' const config = {',
        '-  retries: 3,',
        '+  retries: 5,',
        ' };',
        '',
      ].join('\n'),
    );
  });

  it('ends with a newline, without which git reports a corrupt patch', () => {
    expect(buildPatch(SIMPLE, all(SIMPLE), 'stage')?.endsWith('\n')).toBe(true);
  });

  it('returns null for an empty selection', () => {
    expect(buildPatch(SIMPLE, new Set(), 'stage')).toBeNull();
  });

  it('returns null when the selection changes nothing', () => {
    // Selecting only a context line — which the UI cannot do, but the patch
    // builder should not manufacture an empty patch for git to reject.
    expect(buildPatch(SIMPLE, new Set([lineKey(0, 0)]), 'stage')).toBeNull();
  });
});

/**
 * The asymmetry that makes partial staging correct, and that staged the wrong
 * thing when it was the other way round: `--cached` matches the patch's old
 * side against the index, `--reverse` matches its new side.
 */
describe('unselected lines, by direction', () => {
  const partial = file('f.txt', [
    hunk(1, 1, [
      line('deletion', 'old one'),
      line('addition', 'new one'),
      line('deletion', 'old two'),
      line('addition', 'new two'),
    ]),
  ]);
  // Only the second pair.
  const selection = new Set([lineKey(0, 2), lineKey(0, 3)]);

  it('staging drops the unselected addition and keeps the deletion as context', () => {
    const patch = buildPatch(partial, selection, 'stage');
    expect(patch).toContain(' old one');
    expect(patch).not.toContain('+new one');
    expect(patch).toContain('-old two');
    expect(patch).toContain('+new two');
  });

  it('unstaging drops the unselected deletion and keeps the addition as context', () => {
    const patch = buildPatch(partial, selection, 'unstage');
    expect(patch).toContain(' new one');
    expect(patch).not.toContain('-old one');
    expect(patch).toContain('-old two');
    expect(patch).toContain('+new two');
  });

  it('recomputes the counts from what it actually emitted', () => {
    // Staged: context `old one`, then -old two/+new two → old 2, new 2.
    expect(buildPatch(partial, selection, 'stage')).toContain('@@ -1,2 +1,2 @@');
  });
});

/**
 * Skipping a hunk shifts everything after it. A header that ignores that is a
 * patch git applies in the wrong place, or refuses.
 */
describe('line-number offsets across skipped hunks', () => {
  // Hunk one adds two lines; hunk two changes one.
  const twoHunks = file('f.txt', [
    hunk(5, 5, [line('context', 'a'), line('addition', 'x'), line('addition', 'y')]),
    hunk(40, 42, [line('context', 'b'), line('deletion', 'old'), line('addition', 'new')]),
  ]);

  it('leaves the new side unshifted when the first hunk is included', () => {
    const patch = buildPatch(twoHunks, all(twoHunks), 'stage');
    // One old line, so git's format omits that count entirely.
    expect(patch).toContain('@@ -5 +5,3 @@');
    // Hunk one grows the file by two, so hunk two's new side starts two later.
    expect(patch).toContain('@@ -40,2 +42,2 @@');
  });

  it('does not shift when the earlier hunk is left out', () => {
    const onlySecond = new Set(hunkLineKeys(twoHunks.hunks[1]!, 1));
    const patch = buildPatch(twoHunks, onlySecond, 'stage');
    expect(patch).not.toContain('@@ -5');
    // With hunk one excluded there is no growth before it, so old and new agree.
    expect(patch).toContain('@@ -40,2 +40,2 @@');
  });

  it('shifts the other side when reversing, since git matches the new one', () => {
    const onlySecond = new Set(hunkLineKeys(twoHunks.hunks[1]!, 1));
    const patch = buildPatch(twoHunks, onlySecond, 'unstage');
    // The new side keeps git's numbers; the old side is derived.
    expect(patch).toContain('@@ -42,2 +42,2 @@');
  });
});

describe('hunk headers', () => {
  it('omits a count of one, as git does', () => {
    const single = file('f.txt', [hunk(7, 7, [line('addition', 'only')])]);
    expect(buildPatch(single, all(single), 'stage')).toContain('@@ -7,0 +7 @@');
  });
});

describe('the no-newline marker', () => {
  const noNewline = file('f.txt', [
    hunk(1, 1, [
      line('deletion', 'last'),
      line('noNewline', 'No newline at end of file'),
      line('addition', 'last!'),
      line('noNewline', 'No newline at end of file'),
    ]),
  ]);

  it('keeps the marker with the line it annotates', () => {
    const patch = buildPatch(noNewline, all(noNewline), 'stage');
    expect(patch).toContain('-last\n\\ No newline at end of file');
    expect(patch).toContain('+last!\n\\ No newline at end of file');
  });

  /** A marker with no line above it is meaningless, and git rejects the patch. */
  it('drops the marker when its line was dropped', () => {
    const onlyAddition = new Set([lineKey(0, 2)]);
    const patch = buildPatch(noNewline, onlyAddition, 'unstage');
    // The deletion is dropped in the unstage direction, so its marker goes too.
    expect(patch).not.toContain('last\n\\ No newline');
    expect(patch).toContain('+last!\n\\ No newline at end of file');
  });
});

describe('quotePath', () => {
  it('leaves an ordinary path alone', () => {
    expect(quotePath('src/components/Header.tsx')).toBe('src/components/Header.tsx');
  });

  /**
   * Git only unquotes a name that *starts* with a quote, so quoting a path
   * that does not need it would be as wrong as failing to quote one that does.
   * Spaces resolve through git's a/b heuristic, which works because every
   * patch here names the same path on both sides.
   */
  it('leaves spaces and non-ASCII bare', () => {
    expect(quotePath('my file.txt')).toBe('my file.txt');
    expect(quotePath('ünïcode.txt')).toBe('ünïcode.txt');
  });

  it('quotes and escapes what git would', () => {
    expect(quotePath('say "hi".txt')).toBe('"say \\"hi\\".txt"');
    expect(quotePath('back\\slash.txt')).toBe('"back\\\\slash.txt"');
    expect(quotePath('tab\there.txt')).toBe('"tab\\there.txt"');
  });
});

describe('selection helpers', () => {
  it('selects only changed lines for a hunk', () => {
    expect(hunkLineKeys(SIMPLE.hunks[0]!, 0)).toEqual(['0:1', '0:2']);
  });

  it('counts what can be selected across the file', () => {
    expect(countSelectable(SIMPLE)).toBe(2);
  });
});
