/**
 * `git status --porcelain=v2 -z --branch --untracked-files=all`.
 *
 * Two choices in that command line carry the whole design:
 *
 * **`--porcelain=v2`** over v1 because v1 collapses information the UI needs —
 * it gives two status letters and nothing else, while v2 carries file modes
 * (so an exec-bit or symlink change is visible), blob hashes (so a diff can be
 * requested without re-asking git), submodule state, and rename scores.
 *
 * **`-z`** because without it git *quotes* any path containing a space,
 * quote, backslash or control character — `"newline\nin\tname.txt"` — and
 * every client that parses the unquoted form eventually corrupts a filename.
 * With `-z` records are NUL-terminated and paths are emitted raw, so a path
 * may itself contain newlines and tabs. Nothing here may split on whitespace.
 *
 * Fields are separated by exactly one space, and a path may begin or end with
 * one: `git status` on a file named " leading.txt" emits two spaces in a row.
 * So splitting is positional — count N single-space separators, then take the
 * entire remainder as the path — never `split(/\s+/)`.
 */

/**
 * The canonical status query.
 *
 * `--untracked-files=all` lists files inside untracked directories rather than
 * collapsing them to `dir/`, which the Files panel needs in order to stage one
 * of them. Ignored files are *not* requested: they are only ever shown on
 * demand, and listing them on a repository with a large `node_modules` costs
 * more than everything else in this command put together.
 */
export const STATUS_ARGS: readonly string[] = [
  'status',
  '--porcelain=v2',
  '-z',
  '--branch',
  '--untracked-files=all',
];

/**
 * The ignored-files query — a second command, not a flag on the first.
 *
 * Three things about it were measured against git 2.47.1 rather than reasoned
 * about, and each one is load-bearing:
 *
 * 1. **`--untracked-files=normal`, not `all`.** Only `traditional` ignore
 *    reporting collapses a wholly-ignored directory to a single `node_modules/`
 *    row, and `--untracked-files=all` defeats that collapse. On this repository
 *    the difference is **6 rows against 18,163**.
 * 2. **There is no `--directory` option on `git status`.** It belongs to
 *    `ls-files`; passing it here is `error: unknown option 'directory'`. The
 *    collapse comes entirely from point 1.
 * 3. **The output still contains every ordinary entry.** `--ignored` adds the
 *    `!` records to a normal status rather than replacing it, so the caller has
 *    to select them — which is what `RepositoryService.ignored` does.
 *
 * `--branch` is deliberately absent: the branch header is already known from
 * `STATUS_ARGS`, and this query is asked far less often than that one.
 */
export const IGNORED_STATUS_ARGS: readonly string[] = [
  'status',
  '--porcelain=v2',
  '-z',
  '--ignored',
  '--untracked-files=normal',
];

/**
 * A porcelain v2 status letter. `.` is "unchanged in this half of the pair";
 * `?` and `!` are moonGit's stand-ins for untracked and ignored, which git
 * reports as their own record types rather than as XY codes.
 */
export type StatusCode = '.' | 'M' | 'T' | 'A' | 'D' | 'R' | 'C' | 'U' | '?' | '!';

const STATUS_CODES = new Set<string>(['.', 'M', 'T', 'A', 'D', 'R', 'C', 'U']);

export type StatusEntryKind =
  'ordinary' | 'renamed' | 'copied' | 'unmerged' | 'untracked' | 'ignored';

/** Decoded from the `S<c><m><u>` sub-field; absent when the entry is not a submodule. */
export interface SubmoduleState {
  readonly commitChanged: boolean;
  readonly hasModifiedContent: boolean;
  readonly hasUntracked: boolean;
}

/** Octal file modes. `000000` means the file is absent from that stage. */
export interface FileModes {
  readonly head: string;
  readonly index: string;
  readonly worktree: string;
}

export interface StatusEntry {
  readonly kind: StatusEntryKind;
  /** Raw path from git: relative to the repository root, may contain any byte but NUL. */
  readonly path: string;
  /** Staged half of the pair (git's X). `?`/`!` for untracked/ignored. */
  readonly index: StatusCode;
  /** Unstaged half of the pair (git's Y). */
  readonly worktree: StatusCode;
  /** Source path of a rename or copy. */
  readonly origPath?: string;
  /** Rename/copy similarity, 0–100. */
  readonly score?: number;
  readonly submodule?: SubmoduleState;
  /** Absent for untracked and ignored entries, which git reports without modes. */
  readonly modes?: FileModes;
  /** HEAD and index blob hashes. Absent for untracked, ignored and unmerged entries. */
  readonly headHash?: string;
  readonly indexHash?: string;
  /** Conflict stages 1–3 (base, ours, theirs) — unmerged entries only. */
  readonly stages?: {
    readonly modes: readonly [string, string, string];
    readonly hashes: readonly [string, string, string];
    readonly worktreeMode: string;
  };
}

export interface BranchInfo {
  /** Commit at HEAD, or null on an unborn branch (a fresh `git init`). */
  readonly oid: string | null;
  /** Branch name, or null when HEAD is detached. */
  readonly head: string | null;
  readonly detached: boolean;
  /** True before the first commit, when `branch.oid` reads `(initial)`. */
  readonly unborn: boolean;
  /** Upstream ref such as `origin/main`, or null when the branch tracks nothing. */
  readonly upstream: string | null;
  /** Commits ahead of / behind upstream. Both 0 when there is no upstream. */
  readonly ahead: number;
  readonly behind: number;
}

export interface RepoStatus {
  readonly branch: BranchInfo;
  readonly entries: readonly StatusEntry[];
  /** Only present when the command included `--show-stash`. */
  readonly stashCount?: number;
}

/**
 * Thrown when git's output does not match the documented format.
 *
 * That is a programming error — the wrong flags, or a format change — not a
 * user-facing condition, so it is not a `GitError`. Domain services catch it
 * at the boundary and report it as `Unknown` rather than letting it escape.
 */
export class StatusParseError extends Error {
  constructor(
    message: string,
    readonly record: string,
  ) {
    super(`${message}: ${JSON.stringify(record)}`);
    this.name = 'StatusParseError';
  }
}

const EMPTY_BRANCH: BranchInfo = {
  oid: null,
  head: null,
  detached: false,
  unborn: false,
  upstream: null,
  ahead: 0,
  behind: 0,
};

/**
 * Take exactly `count` space-separated fields, returning the untouched
 * remainder as the last value. Positional by construction: consecutive spaces
 * produce an empty field rather than being collapsed, which is what keeps a
 * path like " leading.txt" intact.
 */
function takeFields(record: string, count: number): { fields: string[]; rest: string } | null {
  const fields: string[] = [];
  let start = 0;
  for (let i = 0; i < count; i += 1) {
    const space = record.indexOf(' ', start);
    if (space === -1) return null;
    fields.push(record.slice(start, space));
    start = space + 1;
  }
  return { fields, rest: record.slice(start) };
}

function statusCode(value: string | undefined, record: string): StatusCode {
  if (value === undefined || !STATUS_CODES.has(value)) {
    throw new StatusParseError(`unrecognised status code ${JSON.stringify(value)}`, record);
  }
  return value as StatusCode;
}

function parseXY(field: string | undefined, record: string): [StatusCode, StatusCode] {
  if (field === undefined || field.length !== 2) {
    throw new StatusParseError('expected a two-character XY field', record);
  }
  return [statusCode(field[0], record), statusCode(field[1], record)];
}

/** `N...` for an ordinary path, `S<c><m><u>` for a submodule. */
function parseSubmodule(field: string | undefined, record: string): SubmoduleState | undefined {
  if (field === undefined || field.length !== 4) {
    throw new StatusParseError('expected a four-character submodule field', record);
  }
  if (field.startsWith('N')) return undefined;
  if (!field.startsWith('S')) {
    throw new StatusParseError('expected submodule field to start with N or S', record);
  }
  return {
    commitChanged: field[1] === 'C',
    hasModifiedContent: field[2] === 'M',
    hasUntracked: field[3] === 'U',
  };
}

/** `R100` / `C75` — the letter says which, the number is the similarity score. */
function parseScore(field: string | undefined, record: string): { copied: boolean; score: number } {
  if (field === undefined || field.length < 2) {
    throw new StatusParseError('expected a rename/copy score field', record);
  }
  const letter = field[0];
  if (letter !== 'R' && letter !== 'C') {
    throw new StatusParseError('expected score field to start with R or C', record);
  }
  const score = Number.parseInt(field.slice(1), 10);
  if (Number.isNaN(score)) {
    throw new StatusParseError('expected a numeric similarity score', record);
  }
  return { copied: letter === 'C', score };
}

function toModes(fields: readonly string[], from: number): FileModes {
  return {
    head: fields[from] ?? '',
    index: fields[from + 1] ?? '',
    worktree: fields[from + 2] ?? '',
  };
}

function parseAheadBehind(value: string): { ahead: number; behind: number } {
  // "+3 -0" — the signs are part of the format, not of the numbers.
  const [aheadField = '', behindField = ''] = value.split(' ');
  return {
    ahead: Number.parseInt(aheadField, 10) || 0,
    behind: Math.abs(Number.parseInt(behindField, 10) || 0),
  };
}

/**
 * Parse porcelain v2 output.
 *
 * `stdout` is expected to be NUL-delimited (`-z`). Header lines are optional;
 * without `--branch` the branch info comes back empty rather than wrong.
 */
export function parseStatus(stdout: string): RepoStatus {
  const branch: {
    -readonly [K in keyof BranchInfo]: BranchInfo[K];
  } = { ...EMPTY_BRANCH };
  const entries: StatusEntry[] = [];
  let stashCount: number | undefined;

  // A trailing NUL leaves an empty final element; filtering blanks also makes
  // the parser tolerant of being handed non-`-z` output line-by-line.
  const records = stdout.split('\0').filter((record) => record !== '');

  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    if (record === undefined) continue;

    // --- headers ---------------------------------------------------------
    if (record.startsWith('# ')) {
      const header = takeFields(record, 2);
      if (header === null) continue;
      const [, key] = header.fields;
      const value = header.rest;

      switch (key) {
        case 'branch.oid':
          // "(initial)" is git's way of saying the branch has no commits yet.
          branch.unborn = value === '(initial)';
          branch.oid = branch.unborn ? null : value;
          break;
        case 'branch.head':
          branch.detached = value === '(detached)';
          branch.head = branch.detached ? null : value;
          break;
        case 'branch.upstream':
          branch.upstream = value;
          break;
        case 'branch.ab': {
          const { ahead, behind } = parseAheadBehind(value);
          branch.ahead = ahead;
          branch.behind = behind;
          break;
        }
        case 'stash':
          stashCount = Number.parseInt(value, 10) || 0;
          break;
        default:
          // Forward compatibility: a header git adds later is not our problem.
          break;
      }
      continue;
    }

    const type = record[0];

    // --- ordinary changes: 1 XY sub mH mI mW hH hI <path> ------------------
    if (type === '1') {
      const parsed = takeFields(record, 8);
      if (parsed === null) throw new StatusParseError('malformed ordinary entry', record);
      const [, xy, sub] = parsed.fields;
      const [index, worktree] = parseXY(xy, record);
      const submodule = parseSubmodule(sub, record);

      entries.push({
        kind: 'ordinary',
        path: parsed.rest,
        index,
        worktree,
        modes: toModes(parsed.fields, 3),
        headHash: parsed.fields[6] ?? '',
        indexHash: parsed.fields[7] ?? '',
        ...(submodule !== undefined && { submodule }),
      });
      continue;
    }

    // --- renames and copies: 2 XY sub mH mI mW hH hI <X><score> <path> -----
    // The source path is a *separate* NUL-terminated field following the
    // record, which is why this loop consumes two records at a time.
    if (type === '2') {
      const parsed = takeFields(record, 9);
      if (parsed === null) throw new StatusParseError('malformed rename/copy entry', record);
      const [, xy, sub] = parsed.fields;
      const [index, worktree] = parseXY(xy, record);
      const submodule = parseSubmodule(sub, record);
      const { copied, score } = parseScore(parsed.fields[8], record);

      const origPath = records[i + 1];
      if (origPath === undefined) {
        throw new StatusParseError('rename/copy entry has no source path', record);
      }
      i += 1;

      entries.push({
        kind: copied ? 'copied' : 'renamed',
        path: parsed.rest,
        origPath,
        score,
        index,
        worktree,
        modes: toModes(parsed.fields, 3),
        headHash: parsed.fields[6] ?? '',
        indexHash: parsed.fields[7] ?? '',
        ...(submodule !== undefined && { submodule }),
      });
      continue;
    }

    // --- conflicts: u XY sub m1 m2 m3 mW h1 h2 h3 <path> -------------------
    if (type === 'u') {
      const parsed = takeFields(record, 10);
      if (parsed === null) throw new StatusParseError('malformed unmerged entry', record);
      const [, xy, sub] = parsed.fields;
      const [index, worktree] = parseXY(xy, record);
      const submodule = parseSubmodule(sub, record);

      entries.push({
        kind: 'unmerged',
        path: parsed.rest,
        index,
        worktree,
        stages: {
          modes: [parsed.fields[3] ?? '', parsed.fields[4] ?? '', parsed.fields[5] ?? ''],
          worktreeMode: parsed.fields[6] ?? '',
          hashes: [parsed.fields[7] ?? '', parsed.fields[8] ?? '', parsed.fields[9] ?? ''],
        },
        ...(submodule !== undefined && { submodule }),
      });
      continue;
    }

    // --- untracked and ignored: ? <path> / ! <path> ------------------------
    if (type === '?' || type === '!') {
      const parsed = takeFields(record, 1);
      if (parsed === null) throw new StatusParseError('malformed untracked entry', record);
      const code: StatusCode = type === '?' ? '?' : '!';
      entries.push({
        kind: type === '?' ? 'untracked' : 'ignored',
        path: parsed.rest,
        index: code,
        worktree: code,
      });
      continue;
    }

    throw new StatusParseError('unrecognised record type', record);
  }

  return {
    branch,
    entries,
    ...(stashCount !== undefined && { stashCount }),
  };
}

// --- derived questions the UI asks -----------------------------------------

/** Has changes in the index — the Staged panel's membership test. */
export function isStaged(entry: StatusEntry): boolean {
  return entry.kind !== 'untracked' && entry.kind !== 'ignored' && entry.index !== '.';
}

/** Has changes in the working tree, including untracked files. */
export function isUnstaged(entry: StatusEntry): boolean {
  if (entry.kind === 'ignored') return false;
  if (entry.kind === 'untracked') return true;
  return entry.worktree !== '.';
}

export function isConflicted(entry: StatusEntry): boolean {
  return entry.kind === 'unmerged';
}

/**
 * True when the *staged* change is a mode change with identical content — an
 * exec-bit flip or a file/symlink swap, which otherwise renders as a
 * modification with an empty diff and looks like a bug in the client.
 *
 * Limited to the staged half deliberately: porcelain v2 reports a worktree
 * *mode* but no worktree hash, so for an unstaged change there is nothing to
 * compare the content against. Answering that needs `git diff`.
 */
export function isModeOnlyChange(entry: StatusEntry): boolean {
  const { modes, headHash, indexHash } = entry;
  if (modes === undefined || headHash === undefined || indexHash === undefined) return false;
  if (modes.head === '000000' || modes.index === '000000') return false;
  return modes.head !== modes.index && headHash === indexHash;
}

/** Whether the working tree is publishable: no changes of any kind, ignoring ignored files. */
export function isClean(status: RepoStatus): boolean {
  return !status.entries.some((entry) => entry.kind !== 'ignored');
}
