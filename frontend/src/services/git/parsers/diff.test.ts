import { describe, expect, it } from 'vitest';
import {
  DIFF_AWKWARD_PATHS,
  DIFF_CONFLICT,
  DIFF_EMPTY,
  DIFF_EVERYTHING,
  FIXTURE_ARGS,
} from './__fixtures__/diff';
import {
  DIFF_BASE_ARGS,
  DiffParseError,
  diffStats,
  hasRenderableDiff,
  parseDiff,
  type DiffFile,
} from './diff';

const files = parseDiff(DIFF_EVERYTHING);

function byPath(list: readonly DiffFile[], path: string): DiffFile {
  const found = list.find((file) => file.path === path);
  if (found === undefined) throw new Error(`no diff for ${JSON.stringify(path)}`);
  return found;
}

/** Guards every other test here — see the same check in refs and log. */
describe('arguments', () => {
  it('still match the arguments the fixtures were captured with', () => {
    expect(DIFF_BASE_ARGS.join(' ')).toBe(FIXTURE_ARGS);
  });

  it('pins context size rather than inheriting diff.context', () => {
    expect(DIFF_BASE_ARGS).toContain('-U3');
  });
});

describe('parseDiff — paths', () => {
  // The entire reason this parser reads --raw instead of the patch headers.
  it('recovers paths that patch headers mangle', () => {
    const paths = parseDiff(DIFF_AWKWARD_PATHS).map((file) => file.path);

    // Unquoted in the header, so "a/X b/Y" cannot be split reliably.
    expect(paths).toContain('space in name.txt');
    // C-quoted in the header.
    expect(paths).toContain('quote"and\\backslash.txt');
    expect(paths).toContain('tab\there.txt');
    // Octal-escaped UTF-8 bytes in the header.
    expect(paths).toContain('ünïcode.txt');
  });

  it('reads every file in the diff exactly once', () => {
    expect(files).toHaveLength(7);
    expect(new Set(files.map((file) => file.path)).size).toBe(7);
  });
});

describe('parseDiff — change kinds', () => {
  it('reads a rename with edits, keeping both paths and the score', () => {
    const renamed = byPath(files, 'added.txt');

    expect(renamed.kind).toBe('renamed');
    expect(renamed.oldPath).toBe('renamed-from.txt');
    expect(renamed.score).toBe(60);
    expect(renamed.hunks.length).toBeGreaterThan(0);
  });

  it('reads a pure rename as having no content change', () => {
    const renamed = byPath(files, 'renamed-to.txt');

    expect(renamed.kind).toBe('renamed');
    expect(renamed.oldPath).toBe('deleted.txt');
    expect(renamed.score).toBe(100);
    expect(renamed.additions).toBe(0);
    expect(renamed.deletions).toBe(0);
  });

  it('flags a binary file and gives it no hunks', () => {
    const binary = byPath(files, 'image.bin');

    expect(binary.isBinary).toBe(true);
    expect(binary.hunks).toEqual([]);
    expect(hasRenderableDiff(binary)).toBe(false);
  });

  it('reads a mode-only change', () => {
    const mode = byPath(files, 'mode-change.txt');

    expect(mode.oldMode).toBe('100644');
    expect(mode.newMode).toBe('100755');
    expect(mode.oldOid).toBe(mode.newOid);
    expect(mode.isModeChangeOnly).toBe(true);
    expect(mode.hunks).toEqual([]);
  });

  it('reads a submodule pointer move', () => {
    const submodule = byPath(files, 'sub');

    expect(submodule.isSubmodule).toBe(true);
    expect(submodule.oldMode).toBe('160000');
    // git renders the pointer move as a one-line hunk of "Subproject commit".
    expect(
      submodule.hunks[0]?.lines.some((line) => line.content.startsWith('Subproject commit')),
    ).toBe(true);
  });

  it('gives full object ids, not abbreviations', () => {
    expect(byPath(files, 'modified.txt').oldOid).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe('parseDiff — hunks and line numbers', () => {
  const modified = byPath(files, 'modified.txt');

  it('reads every hunk in a multi-hunk file', () => {
    expect(modified.hunks).toHaveLength(2);
    expect(modified.additions).toBe(2);
    expect(modified.deletions).toBe(2);
  });

  it('reads the hunk header ranges', () => {
    const first = modified.hunks[0];

    expect(first?.oldStart).toBeGreaterThan(0);
    expect(first?.oldLines).toBeGreaterThan(0);
    expect(first?.newStart).toBeGreaterThan(0);
  });

  it('numbers lines on the side each one belongs to', () => {
    const lines = modified.hunks[0]?.lines ?? [];
    const addition = lines.find((line) => line.kind === 'addition');
    const deletion = lines.find((line) => line.kind === 'deletion');
    const context = lines.find((line) => line.kind === 'context');

    // An added line exists only on the new side, a deleted line only on the old.
    expect(addition?.oldLineNo).toBeNull();
    expect(addition?.newLineNo).toBeGreaterThan(0);
    expect(deletion?.newLineNo).toBeNull();
    expect(deletion?.oldLineNo).toBeGreaterThan(0);
    expect(context?.oldLineNo).toBeGreaterThan(0);
    expect(context?.newLineNo).toBeGreaterThan(0);
  });

  it('numbers context lines consecutively from the hunk start', () => {
    const hunk = modified.hunks[0];
    const firstLine = hunk?.lines[0];

    expect(firstLine?.kind).toBe('context');
    expect(firstLine?.oldLineNo).toBe(hunk?.oldStart);
    expect(firstLine?.newLineNo).toBe(hunk?.newStart);
  });

  it('strips the marker character from line content', () => {
    const addition = modified.hunks
      .flatMap((hunk) => hunk.lines)
      .find((line) => line.kind === 'addition');

    expect(addition?.content).toBe('three');
  });

  it('consumes exactly the number of lines the header declares', () => {
    for (const hunk of modified.hunks) {
      const oldSide = hunk.lines.filter(
        (line) => line.kind === 'context' || line.kind === 'deletion',
      );
      const newSide = hunk.lines.filter(
        (line) => line.kind === 'context' || line.kind === 'addition',
      );

      expect(oldSide).toHaveLength(hunk.oldLines);
      expect(newSide).toHaveLength(hunk.newLines);
    }
  });

  it('records a missing trailing newline without counting it as a line', () => {
    const noEol = byPath(files, 'no-eol.txt');
    const markers = noEol.hunks.flatMap((hunk) =>
      hunk.lines.filter((line) => line.kind === 'noNewline'),
    );

    expect(markers.length).toBeGreaterThan(0);
    expect(markers[0]?.content).toBe('No newline at end of file');
    // The marker annotates the line above; giving it a number would shift
    // every subsequent line in the gutter.
    expect(markers[0]?.oldLineNo).toBeNull();
    expect(markers[0]?.newLineNo).toBeNull();
  });
});

describe('parseDiff — conflicts', () => {
  const conflicted = parseDiff(DIFF_CONFLICT);

  it('reads a combined record for an unmerged path', () => {
    const conflict = byPath(conflicted, 'cf.txt');

    expect(conflict.isCombined).toBe(true);
    expect(conflict.kind).toBe('unmerged');
    expect(conflict.parentCount).toBe(2);
  });

  // Two raw records, one patch section: pairing by position without skipping
  // the combined record would attach the wrong file's hunks to the conflict.
  it("does not steal the following file's patch section", () => {
    const conflict = byPath(conflicted, 'cf.txt');
    const normal = byPath(conflicted, 'normal.txt');

    expect(conflict.hunks).toEqual([]);
    expect(normal.hunks.length).toBeGreaterThan(0);
    expect(normal.additions).toBeGreaterThan(0);
  });
});

describe('parseDiff — edge cases', () => {
  it('parses an empty diff', () => {
    expect(parseDiff(DIFF_EMPTY)).toEqual([]);
    expect(parseDiff('')).toEqual([]);
  });

  it('rejects a raw record that does not start with a colon', () => {
    expect(() => parseDiff('100644 100644 aaa bbb M\x00file.txt\x00\x00')).toThrow(DiffParseError);
  });

  it('rejects a raw record with the wrong field count', () => {
    expect(() => parseDiff(':100644 100644 M\x00file.txt\x00\x00')).toThrow(/expected 5 fields/);
  });

  it('rejects a rename record missing its second path', () => {
    const record = ':100644 100644 aaa bbb R100\x00only-one.txt\x00\x00';
    expect(() => parseDiff(record)).toThrow(/missing its path/);
  });

  it('rejects more patch sections than raw records account for', () => {
    const raw = ':100644 100644 aaa bbb M\x00one.txt\x00\x00';
    const patch = 'diff --git a/one.txt b/one.txt\ndiff --git a/two.txt b/two.txt\n';

    expect(() => parseDiff(raw + patch)).toThrow(/but only 1 raw records/);
  });

  it('rejects a malformed hunk header', () => {
    const raw = ':100644 100644 aaa bbb M\x00one.txt\x00\x00';
    const patch = 'diff --git a/one.txt b/one.txt\n@@ nonsense @@\n';

    expect(() => parseDiff(raw + patch)).toThrow(/malformed hunk header/);
  });

  it('reads a single-line hunk header, where the count is implied', () => {
    const raw = ':100644 100644 aaa bbb M\x00one.txt\x00\x00';
    const patch = 'diff --git a/one.txt b/one.txt\n@@ -1 +1 @@\n-old\n+new\n';
    const [file] = parseDiff(raw + patch);

    expect(file?.hunks[0]?.oldLines).toBe(1);
    expect(file?.hunks[0]?.newLines).toBe(1);
    expect(file?.additions).toBe(1);
    expect(file?.deletions).toBe(1);
  });

  // A patch of a patch contains lines starting with "diff --git" and "@@".
  // Counting declared lines rather than scanning for markers is what keeps
  // those from being mistaken for structure.
  it('treats diff markers inside hunk content as content', () => {
    const raw = ':100644 100644 aaa bbb M\x00patch.diff\x00\x00';
    const patch =
      'diff --git a/patch.diff b/patch.diff\n' +
      '@@ -1,2 +1,2 @@\n' +
      '-diff --git a/x b/x\n' +
      '+@@ -1 +1 @@\n' +
      ' context\n';
    const [file] = parseDiff(raw + patch);

    expect(file?.hunks).toHaveLength(1);
    expect(file?.hunks[0]?.lines).toHaveLength(3);
    expect(file?.hunks[0]?.lines[0]?.content).toBe('diff --git a/x b/x');
  });
});

describe('diffStats', () => {
  it('totals files and line counts', () => {
    expect(diffStats(files)).toEqual({
      files: 7,
      additions: files.reduce((sum, file) => sum + file.additions, 0),
      deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    });
  });

  it('totals nothing for an empty diff', () => {
    expect(diffStats([])).toEqual({ files: 0, additions: 0, deletions: 0 });
  });
});
