/**
 * `git diff --raw -z --patch`.
 *
 * The unusual part of this command is asking for **both** the raw summary and
 * the patch in one invocation, and it is the whole reason this parser can be
 * trusted with real filenames.
 *
 * Patch headers cannot be parsed for paths. Git renders `a/space in name.txt
 * b/space in name.txt` without quoting, so there is no way to tell where the
 * old path ends and the new one begins; it C-quotes paths containing quotes,
 * backslashes or tabs (`"a/quote\"and\\backslash.txt"`); and it octal-escapes
 * non-ASCII bytes (`"a/\303\274n\303\257code.txt"`). Every one of those was
 * confirmed against git 2.47. The `--raw -z` section, by contrast, is
 * NUL-delimited and completely unescaped.
 *
 * So paths, modes, object ids and change kinds come from the raw section, and
 * the patch contributes only hunks. The two sections are emitted in the same
 * order, which is what lets them be paired — with one exception handled below.
 *
 * Layout, verified byte by byte: raw records are `:<meta>NUL<path>NUL`, the
 * section is terminated by an **extra NUL**, and the patch text follows
 * immediately.
 */

/**
 * Arguments every diff query starts from.
 *
 * `-U3` is explicit rather than defaulted because `diff.context` in the user's
 * config silently changes it — verified: `-c diff.context=7` turns three
 * context lines into seven. A parser that assumed the default would still work,
 * but any UI logic keyed to context size would quietly disagree with reality.
 * `--no-ext-diff` and `--no-textconv` keep a configured external differ or
 * textconv filter from replacing the output with something unparseable.
 */
export const DIFF_OUTPUT_ARGS: readonly string[] = [
  '--raw',
  '-z',
  '--patch',
  '--no-color',
  '--no-ext-diff',
  '--no-textconv',
  '--find-renames',
  // Clamped to the repository's hash length, so this is also correct for SHA-256.
  '--abbrev=64',
  '-U3',
];

/**
 * The same flags as a complete `git diff` invocation.
 *
 * Kept separate from `DIFF_OUTPUT_ARGS` because `git show` produces this
 * identical two-section layout and is the only way to diff a *root* commit —
 * `git diff <root>^ <root>` has no parent to name.
 */
export const DIFF_BASE_ARGS: readonly string[] = ['diff', ...DIFF_OUTPUT_ARGS];

export type FileChangeKind =
  'added' | 'copied' | 'deleted' | 'modified' | 'renamed' | 'typeChanged' | 'unmerged' | 'unknown';

const STATUS_KINDS: Readonly<Record<string, FileChangeKind>> = {
  A: 'added',
  C: 'copied',
  D: 'deleted',
  M: 'modified',
  R: 'renamed',
  T: 'typeChanged',
  U: 'unmerged',
  X: 'unknown',
};

export type DiffLineKind = 'context' | 'addition' | 'deletion' | 'noNewline';

export interface DiffLine {
  readonly kind: DiffLineKind;
  /** Line text without git's leading marker character. */
  readonly content: string;
  /** 1-based line number on the old side, or null for an added line. */
  readonly oldLineNo: number | null;
  /** 1-based line number on the new side, or null for a deleted line. */
  readonly newLineNo: number | null;
}

export interface DiffHunk {
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  /** Trailing text on the `@@` line — usually the enclosing function. */
  readonly header: string;
  readonly lines: readonly DiffLine[];
}

export interface DiffFile {
  /** New path, or the old one for a deletion. Raw and unescaped. */
  readonly path: string;
  /** Source path of a rename or copy. */
  readonly oldPath?: string;
  readonly kind: FileChangeKind;
  /** Rename/copy similarity, 0–100. */
  readonly score?: number;
  readonly oldMode: string;
  readonly newMode: string;
  readonly oldOid: string;
  readonly newOid: string;
  readonly hunks: readonly DiffHunk[];
  readonly additions: number;
  readonly deletions: number;
  /** Git refused to diff the content; there are no hunks to show. */
  readonly isBinary: boolean;
  /** Mode 160000 — the "content" is a commit id, not a file. */
  readonly isSubmodule: boolean;
  /** The only change is the file mode, so there are no hunks. */
  readonly isModeChangeOnly: boolean;
  /**
   * An unmerged path, reported as a combined diff against several parents.
   *
   * These carry no patch section at all — `git diff` needs `--cc` to render
   * one — so `hunks` is empty and rendering a conflict needs a second query.
   */
  readonly isCombined: boolean;
  /** Number of parents in a combined diff; 1 for an ordinary one. */
  readonly parentCount: number;
}

/** See `StatusParseError` — a format mismatch is our bug, not the user's. */
export class DiffParseError extends Error {
  constructor(
    message: string,
    readonly record: string,
  ) {
    super(`${message}: ${JSON.stringify(record)}`);
    this.name = 'DiffParseError';
  }
}

interface RawRecord {
  path: string;
  oldPath?: string;
  kind: FileChangeKind;
  score?: number;
  oldMode: string;
  newMode: string;
  oldOid: string;
  newOid: string;
  isCombined: boolean;
  parentCount: number;
}

/**
 * Split the stream into its raw and patch halves.
 *
 * The raw section ends with an extra NUL — every record already ends with one,
 * so the terminator shows up as a NUL pair. A stream with no changes is empty,
 * and a stream of only combined records has no patch half at all.
 */
function splitSections(stdout: string): { raw: string; patch: string } {
  const boundary = stdout.indexOf('\0\0');
  if (boundary === -1) {
    // No terminator: either there is nothing at all, or nothing but raw records.
    return { raw: stdout, patch: '' };
  }
  return { raw: stdout.slice(0, boundary), patch: stdout.slice(boundary + 2) };
}

function parseRawSection(raw: string): RawRecord[] {
  const fields = raw.split('\0').filter((field) => field !== '');
  const records: RawRecord[] = [];

  let i = 0;
  while (i < fields.length) {
    const meta = fields[i];
    if (meta === undefined) break;
    if (!meta.startsWith(':')) {
      throw new DiffParseError('expected a raw record to start with ":"', meta);
    }

    // Leading colons count the parents: one for an ordinary diff, two or more
    // for a combined diff of an unmerged path.
    const parentCount = meta.length - meta.replace(/^:+/, '').length;
    const parts = meta.slice(parentCount).split(' ');

    // n+1 modes, n+1 object ids, then one status field.
    const expected = 2 * (parentCount + 1) + 1;
    if (parts.length !== expected) {
      throw new DiffParseError(`expected ${expected} fields in a raw record`, meta);
    }

    const modes = parts.slice(0, parentCount + 1);
    const oids = parts.slice(parentCount + 1, 2 * (parentCount + 1));
    const status = parts[parts.length - 1] ?? '';
    const letter = status[0] ?? '';
    const kind = parentCount > 1 ? 'unmerged' : (STATUS_KINDS[letter] ?? 'unknown');
    const score = /^[RC]\d+$/.test(status) ? Number.parseInt(status.slice(1), 10) : undefined;

    // Renames and copies carry both paths; everything else carries one.
    const pathCount = parentCount === 1 && (letter === 'R' || letter === 'C') ? 2 : 1;
    const paths = fields.slice(i + 1, i + 1 + pathCount);
    if (paths.length !== pathCount) {
      throw new DiffParseError('raw record is missing its path', meta);
    }
    i += 1 + pathCount;

    const path = paths[pathCount - 1] ?? '';
    const oldPath = pathCount === 2 ? paths[0] : undefined;

    records.push({
      path,
      ...(oldPath !== undefined && { oldPath }),
      kind,
      ...(score !== undefined && { score }),
      oldMode: modes[0] ?? '',
      newMode: modes[modes.length - 1] ?? '',
      oldOid: oids[0] ?? '',
      newOid: oids[oids.length - 1] ?? '',
      isCombined: parentCount > 1,
      parentCount,
    });
  }

  return records;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

interface PatchSection {
  hunks: DiffHunk[];
  isBinary: boolean;
  additions: number;
  deletions: number;
}

/**
 * Read one hunk, consuming exactly the number of lines its header declares.
 *
 * Counting rather than scanning for the next `@@` or `diff --git` is what
 * makes this safe: a diff of a diff contains lines that begin with those
 * markers, and only the declared counts say where the hunk really ends.
 */
function readHunk(lines: readonly string[], start: number): { hunk: DiffHunk; next: number } {
  const header = lines[start] ?? '';
  const match = HUNK_HEADER.exec(header);
  if (match === null) throw new DiffParseError('malformed hunk header', header);

  const oldStart = Number.parseInt(match[1] ?? '0', 10);
  const oldLines = match[2] === undefined ? 1 : Number.parseInt(match[2], 10);
  const newStart = Number.parseInt(match[3] ?? '0', 10);
  const newLines = match[4] === undefined ? 1 : Number.parseInt(match[4], 10);

  const body: DiffLine[] = [];
  let oldNo = oldStart;
  let newNo = newStart;
  let oldRemaining = oldLines;
  let newRemaining = newLines;

  let i = start + 1;
  while (i < lines.length && (oldRemaining > 0 || newRemaining > 0)) {
    const line = lines[i];
    if (line === undefined) break;
    const marker = line[0];

    if (marker === '\\') {
      // "\ No newline at end of file" annotates the line above and is not
      // itself part of either side's line count.
      body.push({
        kind: 'noNewline',
        content: line.slice(2),
        oldLineNo: null,
        newLineNo: null,
      });
      i += 1;
      continue;
    }

    if (marker === '+') {
      body.push({ kind: 'addition', content: line.slice(1), oldLineNo: null, newLineNo: newNo });
      newNo += 1;
      newRemaining -= 1;
    } else if (marker === '-') {
      body.push({ kind: 'deletion', content: line.slice(1), oldLineNo: oldNo, newLineNo: null });
      oldNo += 1;
      oldRemaining -= 1;
    } else if (marker === ' ' || line === '') {
      // A context line for an empty line is a lone space, but tools that strip
      // trailing whitespace turn it into an empty string; accept both.
      body.push({
        kind: 'context',
        content: line.slice(1),
        oldLineNo: oldNo,
        newLineNo: newNo,
      });
      oldNo += 1;
      newNo += 1;
      oldRemaining -= 1;
      newRemaining -= 1;
    } else {
      break;
    }
    i += 1;
  }

  // A trailing "\ No newline" can follow the final counted line.
  while (i < lines.length && lines[i]?.startsWith('\\') === true) {
    body.push({
      kind: 'noNewline',
      content: (lines[i] ?? '').slice(2),
      oldLineNo: null,
      newLineNo: null,
    });
    i += 1;
  }

  return {
    hunk: { oldStart, oldLines, newStart, newLines, header: match[5] ?? '', lines: body },
    next: i,
  };
}

/** Split the patch half into one section per file, in order. */
function parsePatchSection(patch: string): PatchSection[] {
  if (patch === '') return [];

  const lines = patch.split('\n');
  const sections: PatchSection[] = [];
  let i = 0;

  // Anything before the first header is not ours to interpret.
  while (i < lines.length && lines[i]?.startsWith('diff --git ') !== true) i += 1;

  while (i < lines.length) {
    i += 1; // consume the "diff --git" line
    const section: PatchSection = { hunks: [], isBinary: false, additions: 0, deletions: 0 };

    // Header lines: mode changes, similarity, index, ---/+++, binary notice.
    while (i < lines.length) {
      const line = lines[i];
      if (line === undefined) break;
      if (line.startsWith('@@') || line.startsWith('diff --git ')) break;
      if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
        section.isBinary = true;
      }
      i += 1;
    }

    while (i < lines.length && lines[i]?.startsWith('@@') === true) {
      if (lines[i]?.startsWith('@@@') === true) {
        // A combined diff; only produced with --cc, which we never pass.
        throw new DiffParseError('unexpected combined hunk header', lines[i] ?? '');
      }
      const { hunk, next } = readHunk(lines, i);
      section.hunks.push(hunk);
      i = next;
    }

    for (const hunk of section.hunks) {
      for (const line of hunk.lines) {
        if (line.kind === 'addition') section.additions += 1;
        else if (line.kind === 'deletion') section.deletions += 1;
      }
    }
    sections.push(section);

    while (i < lines.length && lines[i]?.startsWith('diff --git ') !== true) i += 1;
  }

  return sections;
}

/**
 * Parse `git diff --raw -z --patch` output.
 *
 * Raw records and patch sections are paired by position — except for combined
 * records, which produce no patch section at all and are therefore skipped
 * when consuming them. Confirmed against a repository holding one conflicted
 * and one ordinary change: two raw records, one patch section.
 */
export function parseDiff(stdout: string): DiffFile[] {
  const { raw, patch } = splitSections(stdout);
  const records = parseRawSection(raw);
  const sections = parsePatchSection(patch);

  const expectedSections = records.filter((record) => !record.isCombined).length;
  if (sections.length > expectedSections) {
    throw new DiffParseError(
      `patch has ${sections.length} sections but only ${expectedSections} raw records expect one`,
      patch.slice(0, 200),
    );
  }

  let sectionIndex = 0;
  return records.map((record) => {
    // A patch may be absent even for an ordinary record when git had nothing
    // to show — a pure mode change, for instance.
    const section = record.isCombined ? undefined : sections[sectionIndex++];
    const isSubmodule = record.oldMode === '160000' || record.newMode === '160000';

    return {
      path: record.path,
      ...(record.oldPath !== undefined && { oldPath: record.oldPath }),
      kind: record.kind,
      ...(record.score !== undefined && { score: record.score }),
      oldMode: record.oldMode,
      newMode: record.newMode,
      oldOid: record.oldOid,
      newOid: record.newOid,
      hunks: section?.hunks ?? [],
      additions: section?.additions ?? 0,
      deletions: section?.deletions ?? 0,
      isBinary: section?.isBinary ?? false,
      isSubmodule,
      isModeChangeOnly:
        record.oldMode !== record.newMode &&
        record.oldOid === record.newOid &&
        (section?.hunks.length ?? 0) === 0,
      isCombined: record.isCombined,
      parentCount: record.parentCount,
    };
  });
}

// --- derived questions ------------------------------------------------------

export interface DiffStats {
  readonly files: number;
  readonly additions: number;
  readonly deletions: number;
}

export function diffStats(files: readonly DiffFile[]): DiffStats {
  return files.reduce<DiffStats>(
    (stats, file) => ({
      files: stats.files + 1,
      additions: stats.additions + file.additions,
      deletions: stats.deletions + file.deletions,
    }),
    { files: 0, additions: 0, deletions: 0 },
  );
}

/** True when there are hunks to render; false for binary, submodule and mode-only changes. */
export function hasRenderableDiff(file: DiffFile): boolean {
  return file.hunks.length > 0;
}

/** The line count of a hunk as rendered, including "no newline" markers. */
export function hunkLineCount(hunk: DiffHunk): number {
  return hunk.lines.length;
}
