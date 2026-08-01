/**
 * `git log -z --format=…`.
 *
 * This is the parser that has to survive scale. At the PRD's target of a
 * million commits the output is hundreds of megabytes, which is why it is fed
 * from `GitRunner.execStream` rather than a buffered `exec` — and why the
 * parser is *incremental*: `createLogParser()` accepts chunks as they arrive
 * and yields whole commits, buffering whatever partial record straddles the
 * boundary. `parseLog()` is the same machinery with push-and-flush wrapped up,
 * for the bounded cases (one commit, one file's history).
 *
 * **Record layout, verified against git 2.47.** With `-z`, git terminates
 * *every* field with NUL, including the last field of the last commit — three
 * commits of five fields produce exactly fifteen NULs. There is no separate
 * record marker: the only thing delimiting one commit from the next is the
 * field count. That is a fragile contract, so `parseLog` verifies that the
 * first field of each record is an object id and rejects the stream if it is
 * not; without that check a single dropped field would shift every subsequent
 * commit's data by one and the UI would render confident nonsense.
 *
 * **Newlines cannot be used for anything.** `%b` keeps the body's internal
 * newlines *and* its trailing one, so any line-oriented handling of this
 * output is wrong. `%s`, by contrast, is folded onto a single line by git.
 */

import type { RefKind } from './refs';

/** Placeholders in `LOG_FORMAT`, in order. Changing this changes the parser. */
const FIELDS = [
  'H', // full object id
  'h', // abbreviated object id
  'P', // parent ids, space separated
  'an',
  'ae',
  'at', // author date, unix seconds
  'cn',
  'ce',
  'ct', // committer date, unix seconds
  'D', // ref decorations
  's', // subject, folded to one line
  'b', // body, may contain newlines — must stay last
] as const;

/**
 * The format this parser expects.
 *
 * Must be run with `-z`, and with `--decorate=full` if `%D` is to be usable:
 * the short form renders a remote-tracking branch as `origin/main`, which is
 * indistinguishable from a local branch literally named `origin/main`. The
 * full form gives `refs/remotes/origin/main` and the ambiguity disappears.
 */
export const LOG_FORMAT = FIELDS.map((field) => `%${field}`).join('%x00');

/** The args every log query starts from. Callers append revisions and limits. */
export const LOG_BASE_ARGS: readonly string[] = [
  'log',
  '-z',
  '--decorate=full',
  `--format=${LOG_FORMAT}`,
];

/** Both SHA-1 and SHA-256 repositories, since git supports the latter. */
const OID_PATTERN = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

export interface Person {
  readonly name: string;
  readonly email: string;
  /** Unix seconds. The original UTC offset is not requested; see the note below. */
  readonly date: number;
}

export type DecorationKind = RefKind | 'head';

export interface Decoration {
  /** Full refname, e.g. `refs/heads/main`. `HEAD` when detached. */
  readonly name: string;
  /** Display form with the namespace stripped, e.g. `main`. */
  readonly shortName: string;
  readonly kind: DecorationKind;
  /** HEAD points here — either `HEAD -> refs/heads/main`, or a detached `HEAD`. */
  readonly isHead: boolean;
}

export interface Commit {
  readonly oid: string;
  readonly shortOid: string;
  /** Empty for a root commit; more than one for a merge. */
  readonly parents: readonly string[];
  readonly author: Person;
  /** Differs from the author after a rebase, amend or cherry-pick. */
  readonly committer: Person;
  readonly subject: string;
  /** Message after the subject, with the trailing newline git adds removed. */
  readonly body: string;
  readonly decorations: readonly Decoration[];
  readonly isMerge: boolean;
  readonly isRoot: boolean;
}

/** See `StatusParseError` — a format mismatch is our bug, not the user's. */
export class LogParseError extends Error {
  constructor(
    message: string,
    readonly record: string,
  ) {
    super(`${message}: ${JSON.stringify(record)}`);
    this.name = 'LogParseError';
  }
}

function shortenRef(name: string): string {
  for (const prefix of ['refs/heads/', 'refs/remotes/', 'refs/tags/']) {
    if (name.startsWith(prefix)) return name.slice(prefix.length);
  }
  return name;
}

function decorationKind(name: string): DecorationKind {
  if (name === 'HEAD') return 'head';
  if (name.startsWith('refs/heads/')) return 'branch';
  if (name.startsWith('refs/remotes/')) return 'remote';
  if (name.startsWith('refs/tags/')) return 'tag';
  return 'other';
}

/**
 * `%D` with `--decorate=full`: "HEAD -> refs/heads/main, tag: refs/tags/v1.0,
 * refs/remotes/origin/main", or a bare "HEAD" when detached.
 */
function parseDecorations(field: string): Decoration[] {
  if (field === '') return [];

  return field.split(', ').map((raw) => {
    let name = raw;
    let isHead = false;

    if (name.startsWith('HEAD -> ')) {
      // The arrow means HEAD is *on* that branch; the branch is what to show.
      name = name.slice('HEAD -> '.length);
      isHead = true;
    } else if (name === 'HEAD') {
      isHead = true;
    }

    // The "tag: " prefix survives even in full mode.
    if (name.startsWith('tag: ')) name = name.slice('tag: '.length);

    return { name, shortName: shortenRef(name), kind: decorationKind(name), isHead };
  });
}

function toDate(field: string): number {
  const seconds = Number.parseInt(field, 10);
  return Number.isNaN(seconds) ? 0 : seconds;
}

function buildCommit(fields: readonly string[]): Commit {
  const [
    oid = '',
    shortOid = '',
    parents = '',
    authorName = '',
    authorEmail = '',
    authorDate = '',
    committerName = '',
    committerEmail = '',
    committerDate = '',
    decorations = '',
    subject = '',
    body = '',
  ] = fields;

  if (!OID_PATTERN.test(oid)) {
    throw new LogParseError('expected an object id in the first field', oid);
  }

  const parentIds = parents === '' ? [] : parents.split(' ');

  return {
    oid,
    shortOid,
    parents: parentIds,
    author: { name: authorName, email: authorEmail, date: toDate(authorDate) },
    committer: { name: committerName, email: committerEmail, date: toDate(committerDate) },
    subject,
    // git always terminates the body with a newline; keeping it would put a
    // blank line under every message in the UI.
    body: body.replace(/\n+$/, ''),
    decorations: parseDecorations(decorations),
    isMerge: parentIds.length > 1,
    isRoot: parentIds.length === 0,
  };
}

export interface LogParser {
  /** Feed a chunk; returns every commit it completed. */
  push(chunk: string): Commit[];
  /** Finish the stream, returning any final commit. Throws on a partial record. */
  flush(): Commit[];
  /** Fields held back waiting for the rest of their commit. For diagnostics. */
  readonly pending: number;
}

/**
 * A parser that can be fed the stream in arbitrary pieces.
 *
 * Go cuts chunks on NUL boundaries, so a chunk never splits a *field* — but it
 * routinely splits a *commit*, since a commit is twelve fields. Everything
 * incomplete is held until the rest arrives.
 */
export function createLogParser(): LogParser {
  // Text after the last NUL in what we have seen: an unfinished field.
  let partial = '';
  // Finished fields not yet forming a whole commit.
  let fields: string[] = [];

  function drain(): Commit[] {
    const commits: Commit[] = [];
    while (fields.length >= FIELDS.length) {
      commits.push(buildCommit(fields.slice(0, FIELDS.length)));
      fields = fields.slice(FIELDS.length);
    }
    return commits;
  }

  return {
    get pending() {
      return fields.length;
    },

    push(chunk: string): Commit[] {
      const parts = (partial + chunk).split('\0');
      // The final piece has no terminating NUL yet, so it is not a field.
      partial = parts.pop() ?? '';
      fields.push(...parts);
      return drain();
    },

    flush(): Commit[] {
      // git terminates every field, so a non-empty tail means the stream was
      // cut short; keep it rather than discarding data, then insist on a
      // whole number of records.
      if (partial !== '') {
        fields.push(partial);
        partial = '';
      }
      const commits = drain();
      if (fields.length > 0) {
        throw new LogParseError(
          `stream ended mid-commit with ${fields.length} of ${FIELDS.length} fields`,
          fields.join('\0'),
        );
      }
      return commits;
    },
  };
}

/** Parse a complete log output. For bounded queries; large ones should stream. */
export function parseLog(stdout: string): Commit[] {
  const parser = createLogParser();
  return [...parser.push(stdout), ...parser.flush()];
}

// --- derived questions ------------------------------------------------------

/** The branch and tag labels to render beside a commit, HEAD first. */
export function visibleDecorations(commit: Commit): readonly Decoration[] {
  return [...commit.decorations].sort((a, b) => Number(b.isHead) - Number(a.isHead));
}

/** True when the commit was rewritten after it was authored — rebase, amend, cherry-pick. */
export function wasRewritten(commit: Commit): boolean {
  return (
    commit.author.date !== commit.committer.date || commit.author.email !== commit.committer.email
  );
}
