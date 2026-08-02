import { describe, expect, it } from 'vitest';
import { parseDiff, type DiffHunk, type DiffLine } from '@/services/git';
import { alignHunk, isLargeDiff, renderedLineCount, LARGE_DIFF_LINES } from './diffView';

function line(
  kind: DiffLine['kind'],
  content: string,
  oldLineNo: number | null,
  newLineNo: number | null,
): DiffLine {
  return { kind, content, oldLineNo, newLineNo };
}

function hunk(lines: DiffLine[]): DiffHunk {
  return { oldStart: 1, oldLines: 0, newStart: 1, newLines: 0, header: '', lines };
}

/** Rows as a compact shape: what is on the left, what is on the right. */
function shape(rows: readonly { left: unknown; right: unknown }[]): string[] {
  return rows.map((row) => `${row.left === null ? '·' : 'L'}${row.right === null ? '·' : 'R'}`);
}

describe('alignHunk', () => {
  it('puts a context line on both sides of one row', () => {
    const { rows, lines } = alignHunk(hunk([line('context', 'same', 1, 1)]));
    expect(shape(rows)).toEqual(['LR']);
    expect(rows[0]?.left).toBe(rows[0]?.right);
    expect(lines).toHaveLength(1);
  });

  it('pairs a deletion with the addition that replaced it', () => {
    const { rows } = alignHunk(
      hunk([line('deletion', 'let a = 1;', 5, null), line('addition', 'let a = 2;', null, 5)]),
    );
    expect(shape(rows)).toEqual(['LR']);
    expect(rows[0]?.left?.line.kind).toBe('deletion');
    expect(rows[0]?.right?.line.kind).toBe('addition');
  });

  it('pads the short side when a block is unbalanced', () => {
    const { rows } = alignHunk(
      hunk([
        line('deletion', 'a', 1, null),
        line('addition', 'b', null, 1),
        line('addition', 'c', null, 2),
      ]),
    );
    expect(shape(rows)).toEqual(['LR', '·R']);
  });

  it('keeps git order in the unified list — every deletion, then every addition', () => {
    const { lines } = alignHunk(
      hunk([
        line('deletion', 'a', 1, null),
        line('deletion', 'b', 2, null),
        line('addition', 'A', null, 1),
        line('addition', 'B', null, 2),
      ]),
    );
    expect(lines.map((view) => view.line.content)).toEqual(['a', 'b', 'A', 'B']);
  });

  it('word-diffs a paired line and leaves an unpaired one plain', () => {
    const { rows } = alignHunk(
      hunk([
        line('deletion', 'total = price * 2;', 1, null),
        line('addition', 'total = price * 3;', null, 1),
        line('addition', 'log(total);', null, 2),
      ]),
    );
    expect(rows[0]?.left?.segments).toBeDefined();
    expect(rows[0]?.right?.segments).toBeDefined();
    expect(rows[1]?.right?.segments).toBeUndefined();
  });

  /**
   * The marker annotates the line above it, so it belongs to that line's side.
   * Putting it on both would claim the *new* file also lacks a final newline.
   */
  it('keeps a "no newline" marker on the side of the line it annotates', () => {
    const { rows, lines } = alignHunk(
      hunk([
        line('deletion', 'last', 1, null),
        line('noNewline', 'No newline at end of file', null, null),
        line('addition', 'last', null, 1),
      ]),
    );
    expect(shape(rows)).toEqual(['LR', 'L·']);
    expect(rows[1]?.left?.line.kind).toBe('noNewline');
    // The marker follows its deletion in the unified list, not the addition.
    expect(lines.map((view) => view.line.kind)).toEqual(['deletion', 'noNewline', 'addition']);
  });

  it('aligns a real patch end to end', () => {
    // Raw section (NUL-delimited), an extra NUL, then the patch.
    const raw = ':100644 100644 aaaa bbbb M\0src/app.ts\0';
    const patch = [
      'diff --git a/src/app.ts b/src/app.ts',
      'index aaaa..bbbb 100644',
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -1,4 +1,4 @@',
      ' const config = {',
      '-  retries: 3,',
      '+  retries: 5,',
      '   timeout: 1000,',
      ' };',
      '',
    ].join('\n');

    const [file] = parseDiff(`${raw}\0${patch}`);
    expect(file).toBeDefined();
    const [aligned] = (file?.hunks ?? []).map(alignHunk);

    expect(shape(aligned?.rows ?? [])).toEqual(['LR', 'LR', 'LR', 'LR']);
    // Line numbers stay per-side: the changed row is old 2 against new 2.
    expect(aligned?.rows[1]?.left?.line.oldLineNo).toBe(2);
    expect(aligned?.rows[1]?.right?.line.newLineNo).toBe(2);
    // And only the number that changed is marked.
    const marked = aligned?.rows[1]?.right?.segments?.filter((segment) => segment.changed);
    expect(marked?.map((segment) => segment.text)).toEqual(['5']);
  });
});

describe('the large-diff guard', () => {
  it('counts every line in every hunk', () => {
    const file = {
      hunks: [hunk([line('context', 'a', 1, 1)]), hunk([line('addition', 'b', null, 2)])],
    };
    expect(renderedLineCount(file as never)).toBe(2);
  });

  it('trips only above the threshold', () => {
    const lines = Array.from({ length: LARGE_DIFF_LINES }, (_, index) =>
      line('addition', 'x', null, index + 1),
    );
    expect(isLargeDiff({ hunks: [hunk(lines)] } as never)).toBe(false);
    expect(
      isLargeDiff({ hunks: [hunk([...lines, line('addition', 'x', null, 1)])] } as never),
    ).toBe(true);
  });
});
