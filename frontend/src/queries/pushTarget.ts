import type { RepoStatus } from '@/services/git';

/**
 * Work out exactly what to push.
 *
 * A bare `git push` is never used, because what it does depends on
 * `push.default`, on whether an upstream is configured, and on whether that
 * upstream's *name* matches the local branch's. All three were true at once
 * during Phase 5 verification: a branch created with `switch -c work
 * origin/main` inherits `origin/main` as its upstream, and `git push -u` then
 * fails with
 *
 *     fatal: The upstream branch of your current branch does not match
 *     the name of your current branch.
 *
 * which is git protecting the user from pushing `work` onto `main`. Naming the
 * remote and the branch explicitly removes the ambiguity entirely, and makes
 * the command the user sees the command that ran.
 */

export interface PushTarget {
  readonly remote: string;
  readonly branch: string;
  /** Configure the upstream as part of this push. */
  readonly setUpstream: boolean;
}

export type PushTargetProblem = 'detached' | 'no-remote';

export type PushTargetResult =
  | { readonly ok: true; readonly target: PushTarget }
  | { readonly ok: false; readonly problem: PushTargetProblem };

/** `origin/main` → `origin`; a remote name cannot contain a slash. */
function remoteOf(upstreamShortRef: string): string | null {
  const slash = upstreamShortRef.indexOf('/');
  return slash === -1 ? null : upstreamShortRef.slice(0, slash);
}

/** `origin/feature/x` → `feature/x`. */
function branchOf(upstreamShortRef: string): string {
  const slash = upstreamShortRef.indexOf('/');
  return slash === -1 ? upstreamShortRef : upstreamShortRef.slice(slash + 1);
}

export function pushTarget(
  status: RepoStatus | undefined,
  remotes: readonly { readonly name: string }[],
): PushTargetResult {
  const branch = status?.branch.head;
  // Detached HEAD has no branch to push; pushing the commit alone needs a
  // refspec the user has to choose.
  if (branch === undefined || branch === null || branch === '') {
    return { ok: false, problem: 'detached' };
  }

  const upstream = status?.branch.upstream ?? null;

  if (upstream !== null && upstream !== '') {
    const remote = remoteOf(upstream);
    if (remote !== null) {
      // An upstream whose branch name differs from this branch's is the case
      // git refuses; re-point it at the matching remote branch instead.
      const mismatched = branchOf(upstream) !== branch;
      return { ok: true, target: { remote, branch, setUpstream: mismatched } };
    }
  }

  // No usable upstream: pick a remote and set one on the way.
  const remote = remotes.find((candidate) => candidate.name === 'origin') ?? remotes[0];
  if (remote === undefined) return { ok: false, problem: 'no-remote' };

  return { ok: true, target: { remote: remote.name, branch, setUpstream: true } };
}
