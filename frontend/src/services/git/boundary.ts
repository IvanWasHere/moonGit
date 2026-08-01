/**
 * The seam between a parser that throws and a service that never does.
 *
 * Parsers throw on malformed input on purpose: `StatusParseError` and friends
 * mean *we* sent the wrong flags or git changed its format, which is a bug to
 * fix rather than a condition for the user to handle. But nothing above the
 * git layer may throw (PLAN.md, PRD), so exactly one place converts those into
 * a `GitError` — here — and every domain service routes through it.
 *
 * The resulting error is `Unknown` rather than a kind of its own: from the
 * UI's point of view "git said something we could not read" and "git failed in
 * a way we do not recognise" call for the same response — surface the message,
 * do not pretend to know what to do.
 */

import { toGitError, type GitError } from './errors';
import type { GitOutput } from './GitRunner';
import { err, ok, type Result } from './result';

export interface ParseContext {
  readonly args: readonly string[];
  readonly repoPath: string;
}

/** Wrap a thrown parse failure as a `GitError`, keeping the original as `cause`. */
export function parseFailure(cause: unknown, { args, repoPath }: ParseContext): GitError {
  const message = cause instanceof Error ? cause.message : String(cause);
  return toGitError({
    stderr: message,
    // The process itself succeeded; it is the reading of its output that failed.
    exitCode: 0,
    args,
    repoPath,
    kind: 'Unknown',
    cause,
  });
}

/**
 * Apply a parser to a successful run, passing any command failure straight
 * through and catching any parse failure.
 */
export function mapParsed<T>(
  result: Result<GitOutput, GitError>,
  parse: (stdout: string) => T,
  context: ParseContext,
): Result<T, GitError> {
  if (!result.ok) return result;
  try {
    return ok(parse(result.value.stdout));
  } catch (cause) {
    return err(parseFailure(cause, context));
  }
}
