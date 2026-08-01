/**
 * Turning git's stderr into something the UI can branch on.
 *
 * Git reports every kind of failure the same way — a non-zero exit and a line
 * of English on stderr. The UI needs more than that: an auth failure should
 * open the credential prompt, a stale `index.lock` should offer to remove it,
 * a merge conflict is not an error at all but a state to render. So the one
 * place that knows how to read stderr is here, and everything above it
 * switches on `kind`.
 *
 * Matching English text is only safe because the Go layer pins `LC_ALL=C`
 * (PLAN.md §4.1) — git's messages are guaranteed untranslated. If that
 * injection is ever dropped, this file silently degrades to `Unknown`.
 */

export type GitErrorKind =
  | 'NotARepository'
  | 'MergeConflict'
  | 'AuthRequired'
  | 'LockExists'
  | 'DetachedHead'
  | 'Timeout'
  | 'Canceled'
  | 'SpawnFailed'
  | 'Unknown';

export interface GitError {
  readonly kind: GitErrorKind;
  /** First meaningful line of stderr, suitable for a toast. */
  readonly message: string;
  readonly stderr: string;
  readonly exitCode: number;
  /** The argv that produced this, minus the binary. For logs and bug reports. */
  readonly args: readonly string[];
  readonly repoPath: string;
  /** Present only for `SpawnFailed`, where the bridge itself rejected. */
  readonly cause?: unknown;
}

/**
 * Ordered most-specific first. Order matters: "Unable to create index.lock"
 * also contains the word "fatal", and a failed push during a conflicted rebase
 * can mention both auth and conflicts, so the more actionable classification
 * has to win.
 */
const PATTERNS: ReadonlyArray<readonly [GitErrorKind, RegExp]> = [
  ['NotARepository', /not a git repository|this operation must be run in a work tree/i],
  [
    'AuthRequired',
    /authentication failed|could not read (?:username|password)|permission denied \(publickey\)|terminal prompts disabled|invalid username or password|support for password authentication was removed|access denied|host key verification failed/i,
  ],
  [
    'LockExists',
    /another git process seems to be running|unable to create '[^']*\.lock': file exists|index\.lock': file exists|cannot lock ref/i,
  ],
  [
    'MergeConflict',
    /^conflict \(|automatic merge failed|fix conflicts and then commit|needs merge|could not apply|your local changes to the following files would be overwritten|resolve all conflicts manually/im,
  ],
  [
    'DetachedHead',
    /head detached|not currently on any branch|ref head is not a symbolic ref|you are in 'detached head' state/i,
  ],
];

/** The first non-blank line — git puts the actionable sentence first and hints after. */
function firstLine(stderr: string): string {
  for (const line of stderr.split('\n')) {
    const trimmed = line.trim();
    if (trimmed !== '') return trimmed;
  }
  return '';
}

export function classifyStderr(stderr: string): GitErrorKind {
  for (const [kind, pattern] of PATTERNS) {
    if (pattern.test(stderr)) return kind;
  }
  return 'Unknown';
}

/**
 * Classify a failed run, falling back to stdout.
 *
 * The fallback exists because git is inconsistent about which stream carries
 * the bad news: `git merge` prints "CONFLICT (content)" and "Automatic merge
 * failed" to *stdout*, while `git cherry-pick` and `git stash pop` print the
 * equivalent to stderr. Without this, a failed merge classifies as `Unknown`.
 *
 * stderr wins whenever it says anything recognisable, so a real error message
 * is never overridden by something that merely appears in normal output.
 * (Commands where a conflict is an expected outcome should not reach this at
 * all — they pass `okExitCodes` and read the state from stdout themselves.)
 */
export function classifyOutput(stderr: string, stdout = ''): GitErrorKind {
  const fromStderr = classifyStderr(stderr);
  if (fromStderr !== 'Unknown' || stdout === '') return fromStderr;
  return classifyStderr(stdout);
}

export interface GitErrorInput {
  stderr: string;
  /** Only used to classify when stderr is unrevealing; never shown to the user. */
  stdout?: string;
  exitCode: number;
  args: readonly string[];
  repoPath: string;
  /** Set by the runner from `RunResult.timedOut` / `StreamResult.canceled`. */
  kind?: GitErrorKind;
  cause?: unknown;
}

/**
 * Build a `GitError` from a finished run.
 *
 * `kind` may be forced by the caller for conditions stderr cannot express —
 * a timeout kills git before it prints anything, and a cancellation is the
 * user's own doing rather than a fault.
 */
export function toGitError({
  stderr,
  stdout,
  exitCode,
  args,
  repoPath,
  kind,
  cause,
}: GitErrorInput): GitError {
  const resolvedKind = kind ?? classifyOutput(stderr, stdout);
  const line = firstLine(stderr) || firstLine(stdout ?? '');
  const message = line !== '' ? line : defaultMessage(resolvedKind, args, exitCode);

  return {
    kind: resolvedKind,
    message,
    stderr,
    exitCode,
    args,
    repoPath,
    ...(cause !== undefined && { cause }),
  };
}

function defaultMessage(kind: GitErrorKind, args: readonly string[], exitCode: number): string {
  const command = `git ${args.join(' ')}`.trim();
  switch (kind) {
    case 'Timeout':
      return `${command} timed out`;
    case 'Canceled':
      return `${command} was canceled`;
    case 'SpawnFailed':
      return `could not start ${command}`;
    default:
      return `${command} exited with code ${exitCode}`;
  }
}
