/**
 * `git for-each-ref --format=…`.
 *
 * One command fills the entire Branches panel: local branches with their
 * upstream and ahead/behind counts, remote-tracking branches, and tags. The
 * alternatives are worse — `git branch -vv` prints a human-formatted table
 * that has to be scraped, and asking `rev-list --count` per branch is a
 * process spawn per row.
 *
 * **Field separator is NUL, record separator is newline.** That looks like the
 * mistake `parseStatus` exists to avoid, but it is safe here for a specific
 * reason: refnames may not contain newlines or control characters (git
 * rejects them), and `%(subject)` is a *folded* subject — git joins a
 * multi-paragraph-opening message into a single line, verified against
 * commits and annotated tags whose subject spans two lines. No atom in
 * `FOR_EACH_REF_FORMAT` can emit a newline, so records stay one per line.
 * Adding a free-form atom such as `%(contents)` would break that and require
 * moving to a NUL record terminator.
 */

/** Fields in `FOR_EACH_REF_FORMAT`, in order. Changing one means changing both. */
const FIELDS = [
  'refname',
  'refname:short',
  'objecttype',
  'objectname',
  '*objecttype',
  '*objectname',
  'HEAD',
  'upstream',
  'upstream:short',
  'upstream:track',
  'symref',
  'creatordate:unix',
  'authorname',
  '*authorname',
  'subject',
] as const;

/**
 * The format string this parser expects. Exported so the domain service cannot
 * drift from it — a format and a parser that disagree fail silently, filling
 * the UI with fields shifted by one.
 *
 * `%00` is for-each-ref's hex escape for NUL. `creatordate` is used rather
 * than `committerdate` because it resolves to the tagger date on an annotated
 * tag and the committer date on a commit, so one atom covers both.
 */
export const FOR_EACH_REF_FORMAT = FIELDS.map((field) => `%(${field})`).join('%00');

/** Ref namespaces worth asking for. Notes, stash and replace refs are not UI. */
export const REF_PATTERNS = ['refs/heads/', 'refs/remotes/', 'refs/tags/'] as const;

export type RefKind = 'branch' | 'remote' | 'tag' | 'other';

export interface UpstreamInfo {
  /** Full ref, e.g. `refs/remotes/origin/main`. */
  readonly ref: string;
  /** Display form, e.g. `origin/main`. */
  readonly shortRef: string;
  readonly ahead: number;
  readonly behind: number;
  /** Configured upstream that no longer exists — a deleted remote branch. */
  readonly gone: boolean;
}

export interface GitRef {
  /** Full refname, e.g. `refs/heads/feature/nested-name`. */
  readonly name: string;
  /** Display form, e.g. `feature/nested-name` or `origin/main`. */
  readonly shortName: string;
  readonly kind: RefKind;
  /** The object this ref names. For an annotated tag, the *tag* object. */
  readonly oid: string;
  /**
   * The commit this ref ultimately points at.
   *
   * Equal to `oid` except for annotated tags, where `oid` is the tag object
   * and this is the commit it wraps — the difference matters for anything that
   * wants to check out or diff a tag.
   */
  readonly targetOid: string;
  readonly objectType: string;
  /** True for a tag object; a lightweight tag points straight at a commit. */
  readonly annotated: boolean;
  /** This is the checked-out branch. */
  readonly isHead: boolean;
  readonly upstream: UpstreamInfo | null;
  /** Set for symbolic refs such as `refs/remotes/origin/HEAD`. */
  readonly symrefTarget: string | null;
  /** Unix seconds: committer date for commits, tagger date for annotated tags. */
  readonly date: number | null;
  readonly author: string;
  readonly subject: string;
}

export interface RefCollection {
  readonly branches: readonly GitRef[];
  readonly remotes: readonly GitRef[];
  readonly tags: readonly GitRef[];
  /** The checked-out branch, or null when HEAD is detached. */
  readonly head: GitRef | null;
}

/** See `StatusParseError` — a format mismatch is our bug, not the user's. */
export class RefParseError extends Error {
  constructor(
    message: string,
    readonly record: string,
  ) {
    super(`${message}: ${JSON.stringify(record)}`);
    this.name = 'RefParseError';
  }
}

function refKind(name: string): RefKind {
  if (name.startsWith('refs/heads/')) return 'branch';
  if (name.startsWith('refs/remotes/')) return 'remote';
  if (name.startsWith('refs/tags/')) return 'tag';
  return 'other';
}

/**
 * `%(upstream:track)` is prose: "", "[gone]", "[ahead 1]", "[behind 2]",
 * "[ahead 1, behind 2]" — all five shapes verified against git 2.47.
 *
 * An empty string is genuinely ambiguous between "in sync" and "no upstream",
 * which is why the caller decides based on whether an upstream ref exists at
 * all rather than on this field.
 */
function parseTrack(track: string): { ahead: number; behind: number; gone: boolean } {
  if (track === '[gone]') return { ahead: 0, behind: 0, gone: true };

  const ahead = /\[ahead (\d+)/.exec(track);
  const behind = /behind (\d+)\]/.exec(track);
  return {
    ahead: ahead === null ? 0 : Number.parseInt(ahead[1] ?? '0', 10),
    behind: behind === null ? 0 : Number.parseInt(behind[1] ?? '0', 10),
    gone: false,
  };
}

/**
 * Parse `for-each-ref` output produced with `FOR_EACH_REF_FORMAT`.
 *
 * Order is preserved: git sorts by refname unless told otherwise, and the UI
 * re-sorts anyway.
 */
export function parseRefs(stdout: string): GitRef[] {
  const refs: GitRef[] = [];

  for (const record of stdout.split('\n')) {
    if (record === '') continue;

    const fields = record.split('\0');
    if (fields.length !== FIELDS.length) {
      throw new RefParseError(`expected ${FIELDS.length} fields, got ${fields.length}`, record);
    }

    const [
      name = '',
      shortName = '',
      objectType = '',
      oid = '',
      targetType = '',
      targetOid = '',
      head = '',
      upstreamRef = '',
      upstreamShort = '',
      track = '',
      symref = '',
      date = '',
      author = '',
      targetAuthor = '',
      subject = '',
    ] = fields;

    if (name === '') throw new RefParseError('record has no refname', record);

    // Only a tag object has a dereferenced target; for everything else the
    // `*` atoms are empty and the ref points at its object directly.
    const annotated = objectType === 'tag' && targetType !== '';

    refs.push({
      name,
      shortName,
      kind: refKind(name),
      oid,
      targetOid: annotated && targetOid !== '' ? targetOid : oid,
      objectType,
      annotated,
      // git renders this atom as '*' for HEAD and a single space otherwise.
      isHead: head.trim() === '*',
      upstream:
        upstreamRef === ''
          ? null
          : { ref: upstreamRef, shortRef: upstreamShort, ...parseTrack(track) },
      symrefTarget: symref === '' ? null : symref,
      date: date === '' ? null : Number.parseInt(date, 10) || null,
      // An annotated tag has a tagger rather than an author, so fall through
      // to the wrapped commit's author to keep the column populated.
      author: author !== '' ? author : targetAuthor,
      subject,
    });
  }

  return refs;
}

/** Split a flat ref list into the buckets the Branches panel renders. */
export function groupRefs(refs: readonly GitRef[]): RefCollection {
  const branches = refs.filter((ref) => ref.kind === 'branch');
  return {
    branches,
    // `origin/HEAD` is a pointer at another remote branch, not a branch of its
    // own; showing it would duplicate whatever it points at.
    remotes: refs.filter((ref) => ref.kind === 'remote' && ref.symrefTarget === null),
    tags: refs.filter((ref) => ref.kind === 'tag'),
    head: branches.find((ref) => ref.isHead) ?? null,
  };
}

/** True when the branch has an upstream it has diverged from in both directions. */
export function hasDiverged(ref: GitRef): boolean {
  return ref.upstream !== null && ref.upstream.ahead > 0 && ref.upstream.behind > 0;
}

/** Nothing to pull or push: an upstream exists and both counts are zero. */
export function isInSync(ref: GitRef): boolean {
  const { upstream } = ref;
  return upstream !== null && !upstream.gone && upstream.ahead === 0 && upstream.behind === 0;
}
