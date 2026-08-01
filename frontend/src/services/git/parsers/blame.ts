/**
 * `git blame --porcelain`.
 *
 * The format is stateful, and that is the whole point of it. The first time a
 * commit appears, git prints a full metadata block — author, mail, time, tz,
 * committer, summary, filename. Every later line attributed to that same
 * commit prints **only** the header line and the content:
 *
 *     ffd1b3e… 1 1 2          <- commit seen for the first time
 *     author Ivan Marinković
 *     …
 *     filename a.txt
 *     \t1                     <- content, always tab-prefixed
 *     ffd1b3e… 2 2            <- same commit again: no metadata, no line count
 *     \t2
 *
 * So the parser carries a dictionary of commits and fills each line's
 * attribution from it. `--line-porcelain` would repeat the block on every line
 * and remove the need for state, at the cost of multiplying the output by the
 * size of the metadata — on a long file that is the difference between a
 * responsive blame view and a stalled one.
 *
 * Header lines are `<oid> <origLine> <finalLine> [<lineCount>]`; the count is
 * present only on the first line of each run.
 */

export const BLAME_BASE_ARGS: readonly string[] = ['blame', '--porcelain'];

export interface BlameIdentity {
  readonly name: string;
  readonly email: string;
  /** Unix seconds. */
  readonly date: number;
  /** The author's own UTC offset, e.g. `+0200` — git gives it here, unlike in log. */
  readonly timezone: string;
}

export interface BlameCommit {
  readonly oid: string;
  readonly author: BlameIdentity;
  readonly committer: BlameIdentity;
  readonly summary: string;
  /** No parent was walked past this commit — the start of the traced history. */
  readonly isBoundary: boolean;
  /** The commit and path this content came from before this change. */
  readonly previousOid?: string;
  readonly previousPath?: string;
  /** Path this line had in that commit; differs from the current path after a rename. */
  readonly path?: string;
}

export interface BlameLine {
  readonly oid: string;
  /** 1-based line number in the file as it is now. */
  readonly finalLine: number;
  /** 1-based line number in the commit the line came from. */
  readonly origLine: number;
  readonly content: string;
}

export interface Blame {
  readonly lines: readonly BlameLine[];
  /** Metadata keyed by commit id — each commit appears once however many lines it owns. */
  readonly commits: ReadonlyMap<string, BlameCommit>;
}

/** See `StatusParseError` — a format mismatch is our bug, not the user's. */
export class BlameParseError extends Error {
  constructor(
    message: string,
    readonly record: string,
  ) {
    super(`${message}: ${JSON.stringify(record)}`);
    this.name = 'BlameParseError';
  }
}

const HEADER = /^([0-9a-f]{40,64}) (\d+) (\d+)(?: (\d+))?$/;

interface MutableCommit {
  oid: string;
  authorName: string;
  authorEmail: string;
  authorTime: number;
  authorTz: string;
  committerName: string;
  committerEmail: string;
  committerTime: number;
  committerTz: string;
  summary: string;
  isBoundary: boolean;
  previousOid?: string;
  previousPath?: string;
  path?: string;
}

function blank(oid: string): MutableCommit {
  return {
    oid,
    authorName: '',
    authorEmail: '',
    authorTime: 0,
    authorTz: '',
    committerName: '',
    committerEmail: '',
    committerTime: 0,
    committerTz: '',
    summary: '',
    isBoundary: false,
  };
}

/** git wraps addresses in angle brackets: `<a@b.c>`. */
function unwrapEmail(value: string): string {
  return value.replace(/^<|>$/g, '');
}

function freeze(commit: MutableCommit): BlameCommit {
  return {
    oid: commit.oid,
    author: {
      name: commit.authorName,
      email: commit.authorEmail,
      date: commit.authorTime,
      timezone: commit.authorTz,
    },
    committer: {
      name: commit.committerName,
      email: commit.committerEmail,
      date: commit.committerTime,
      timezone: commit.committerTz,
    },
    summary: commit.summary,
    isBoundary: commit.isBoundary,
    ...(commit.previousOid !== undefined && { previousOid: commit.previousOid }),
    ...(commit.previousPath !== undefined && { previousPath: commit.previousPath }),
    ...(commit.path !== undefined && { path: commit.path }),
  };
}

export function parseBlame(stdout: string): Blame {
  const lines: BlameLine[] = [];
  const commits = new Map<string, MutableCommit>();

  const rows = stdout.split('\n');
  let i = 0;
  // The commit whose metadata block we are currently inside.
  let current: MutableCommit | undefined;
  let pendingLine: { oid: string; origLine: number; finalLine: number } | undefined;

  while (i < rows.length) {
    const row = rows[i];
    if (row === undefined) break;
    i += 1;
    if (row === '') continue;

    // Content is the only tab-prefixed row, and it closes the current line.
    if (row.startsWith('\t')) {
      if (pendingLine === undefined) {
        throw new BlameParseError('content line with no header', row);
      }
      lines.push({ ...pendingLine, content: row.slice(1) });
      pendingLine = undefined;
      current = undefined;
      continue;
    }

    const header = HEADER.exec(row);
    if (header !== null) {
      const oid = header[1] ?? '';
      pendingLine = {
        oid,
        origLine: Number.parseInt(header[2] ?? '0', 10),
        finalLine: Number.parseInt(header[3] ?? '0', 10),
      };
      // Reuse the metadata if this commit has been described already; git
      // only sends the block once and every later run relies on that memory.
      let commit = commits.get(oid);
      if (commit === undefined) {
        commit = blank(oid);
        commits.set(oid, commit);
      }
      current = commit;
      continue;
    }

    if (current === undefined) {
      throw new BlameParseError('metadata line outside a commit block', row);
    }

    // Metadata: "<key> <value>", or a bare keyword such as "boundary".
    const space = row.indexOf(' ');
    const key = space === -1 ? row : row.slice(0, space);
    const value = space === -1 ? '' : row.slice(space + 1);

    switch (key) {
      case 'author':
        current.authorName = value;
        break;
      case 'author-mail':
        current.authorEmail = unwrapEmail(value);
        break;
      case 'author-time':
        current.authorTime = Number.parseInt(value, 10) || 0;
        break;
      case 'author-tz':
        current.authorTz = value;
        break;
      case 'committer':
        current.committerName = value;
        break;
      case 'committer-mail':
        current.committerEmail = unwrapEmail(value);
        break;
      case 'committer-time':
        current.committerTime = Number.parseInt(value, 10) || 0;
        break;
      case 'committer-tz':
        current.committerTz = value;
        break;
      case 'summary':
        current.summary = value;
        break;
      case 'boundary':
        current.isBoundary = true;
        break;
      case 'filename':
        current.path = value;
        break;
      case 'previous': {
        // "previous <oid> <path>" — the path may contain spaces.
        const gap = value.indexOf(' ');
        current.previousOid = gap === -1 ? value : value.slice(0, gap);
        if (gap !== -1) current.previousPath = value.slice(gap + 1);
        break;
      }
      default:
        // Unrecognised metadata is not worth failing over; git adds keys.
        break;
    }
  }

  if (pendingLine !== undefined) {
    throw new BlameParseError('header with no content line', JSON.stringify(pendingLine));
  }

  const frozen = new Map<string, BlameCommit>();
  for (const [oid, commit] of commits) frozen.set(oid, freeze(commit));

  return { lines, commits: frozen };
}

// --- derived questions ------------------------------------------------------

/**
 * Group consecutive lines that share a commit, which is how blame is rendered:
 * one attribution gutter entry per run rather than per line.
 */
export interface BlameRun {
  readonly oid: string;
  readonly startLine: number;
  readonly lines: readonly BlameLine[];
}

export function groupBlameRuns(blame: Blame): BlameRun[] {
  const runs: BlameRun[] = [];
  let run: { oid: string; startLine: number; lines: BlameLine[] } | undefined;

  for (const line of blame.lines) {
    if (run === undefined || run.oid !== line.oid) {
      if (run !== undefined) runs.push(run);
      run = { oid: line.oid, startLine: line.finalLine, lines: [line] };
    } else {
      run.lines.push(line);
    }
  }
  if (run !== undefined) runs.push(run);

  return runs;
}

/** Distinct authors touching the file, most lines first — the "who owns this" question. */
export function blameAuthorTotals(blame: Blame): { name: string; lines: number }[] {
  const totals = new Map<string, number>();
  for (const line of blame.lines) {
    const name = blame.commits.get(line.oid)?.author.name ?? '';
    totals.set(name, (totals.get(name) ?? 0) + 1);
  }
  return [...totals]
    .map(([name, count]) => ({ name, lines: count }))
    .sort((a, b) => b.lines - a.lines);
}
