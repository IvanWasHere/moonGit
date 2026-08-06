/**
 * Making a large repository fast, by asking git to be fast rather than by
 * asking it less often (PLAN.md §10).
 *
 * Everything here came out of the Phase 7 benchmark, and two of the three
 * findings are not in §10's original bullet list:
 *
 * | measured on 500k files / 1M commits | before | after |
 * |---|---|---|
 * | `log --topo-order`, first 200 commits | 6796ms | 275ms (commit-graph) |
 * | `status --untracked-files=all`        | 4442ms | 2047ms (fsmonitor) |
 * | `status --untracked-files=normal`     | 3935ms | 132ms (fsmonitor + untracked cache) |
 *
 * Three things worth stating, because each one changed the design:
 *
 * 1. **The commit-graph is the single biggest win in the phase, and §10 never
 *    mentions it.** `--topo-order` has to prove no parent is emitted before a
 *    child; with no generation numbers to reason with, git can only establish
 *    that by walking the entire history first — so `--max-count=200` bounds the
 *    *output* and not the work. That is why the Journal's first page cost the
 *    same as its five-hundredth. A commit-graph supplies the generation numbers
 *    and the bound starts meaning something.
 *
 * 2. **The untracked cache does nothing in `all` mode.** It caches a verdict per
 *    directory, and `--untracked-files=all` recurses into every directory by
 *    definition, so there is nothing for it to answer from. §10 lists it and the
 *    degrade to `normal` as two separate mitigations; they are one — the cache
 *    is what makes the degrade worth 132ms instead of 680ms, and on its own it
 *    is worth nothing at all (4442ms → 4457ms, which is noise).
 *
 * 3. **Nothing here is applied to a repository that does not need it.** A
 *    daemon, a modified index format and a 60MB sidecar file are a bad trade for
 *    a three-hundred-file project, and moonGit should not leave that behind in
 *    every repository a user happens to open. The trigger is a measurement of
 *    the repository in front of us, not a guess from its size — see
 *    `noteStatusDuration`.
 */

import { getPreference, setPreference } from '@/services/db/keyValue';
import { getGitRunner } from './GitRunner';

/**
 * How git is asked about untracked files.
 *
 * `all` lists every file inside an untracked directory; `normal` collapses the
 * directory to one row, which is git's own default and the same trade the
 * Ignored chip already makes (PLAN.md §9, Phase 6.12).
 */
export type UntrackedMode = 'all' | 'normal';

/**
 * A status slower than this means the repository is big enough to tune.
 *
 * A duration rather than a file count, deliberately. A count is a proxy for the
 * thing we actually care about — whether the panel feels slow — and it is a
 * proxy that means different things on different hardware, so any constant
 * would be right on one machine and wrong on the next. The duration is measured
 * on the machine it applies to, and `GitRunner` already reports it, so nothing
 * extra is run to find out.
 *
 * One second is roughly where a refresh stops reading as instant and starts
 * reading as a wait.
 */
export const SLOW_STATUS_MS = 1000;

/** What has been decided about one repository. */
export interface Tuning {
  readonly untracked: UntrackedMode;
  /** Whether fsmonitor, the untracked cache and the commit-graph were applied. */
  readonly configured: boolean;
  /** Set when the user asked for `all` back, which stops the automatic degrade. */
  readonly forcedAll: boolean;
}

const DEFAULT_TUNING: Tuning = { untracked: 'all', configured: false, forcedAll: false };

/**
 * Read through a memory cache.
 *
 * `statusArgs` is called on every status, which is every watcher tick, and that
 * cannot wait on SQLite. The cache is authoritative once loaded; the database
 * exists so the decision survives a relaunch rather than being re-measured — and
 * re-suffered — every time the app starts.
 */
const cache = new Map<string, Tuning>();

function key(repoPath: string): string {
  return `tuning.${repoPath}`;
}

/** Load a repository's tuning from the database into the cache. */
export async function loadTuning(repoPath: string): Promise<Tuning> {
  const stored = await getPreference<Tuning>(key(repoPath), DEFAULT_TUNING);
  cache.set(repoPath, stored);
  return stored;
}

function current(repoPath: string): Tuning {
  return cache.get(repoPath) ?? DEFAULT_TUNING;
}

async function update(repoPath: string, patch: Partial<Tuning>): Promise<void> {
  const next = { ...current(repoPath), ...patch };
  cache.set(repoPath, next);
  await setPreference(key(repoPath), next);
}

/** The untracked mode to run with right now. Synchronous by necessity. */
export function untrackedMode(repoPath: string): UntrackedMode {
  return current(repoPath).untracked;
}

/** Whether this repository degraded itself, for the Files panel to say so. */
export function isDegraded(repoPath: string): boolean {
  const tuning = current(repoPath);
  return tuning.untracked === 'normal' && !tuning.forcedAll;
}

/**
 * The whole adaptive rule, as a pure function.
 *
 * Separated from the I/O around it for the same reason `statusDisplay.ts`
 * separates its path splitting: this is the part with decisions in it, and
 * decisions should be assertable without a database, a git process or a clock.
 * Returns the new tuning, or null when nothing should change.
 *
 * A repository that answers quickly is left alone forever; one that does not
 * degrades once and stays degraded, because the alternative — re-measuring —
 * means paying the slow cost again to rediscover something already known.
 */
export function nextTuning(tuning: Tuning, ms: number): Tuning | null {
  if (ms < SLOW_STATUS_MS) return null;
  // The user asked for `all` back, and a slow status is precisely what they
  // were told they were choosing. Overriding the override would be the app
  // arguing with a decision it already surfaced.
  if (tuning.forcedAll) return null;
  if (tuning.untracked === 'normal' && tuning.configured) return null;
  return { ...tuning, untracked: 'normal', configured: true };
}

/**
 * Feed back how long a status actually took, applying `nextTuning`.
 *
 * Returns true when something changed, so the caller can invalidate.
 */
export async function noteStatusDuration(repoPath: string, ms: number): Promise<boolean> {
  const next = nextTuning(current(repoPath), ms);
  if (next === null) return false;

  await update(repoPath, next);
  await configureRepository(repoPath);
  return true;
}

/** Put a repository back to listing every untracked file, and keep it there. */
export async function forceUntrackedAll(repoPath: string): Promise<void> {
  await update(repoPath, { untracked: 'all', forcedAll: true });
}

/** Undo `forceUntrackedAll`, letting the next slow status degrade again. */
export async function clearUntrackedOverride(repoPath: string): Promise<void> {
  await update(repoPath, { forcedAll: false });
}

/**
 * Apply git's own large-repository settings.
 *
 * Every failure is swallowed. These are optimisations, and a repository where
 * one of them will not apply — an older git, a filesystem the fsmonitor daemon
 * cannot watch, a read-only object store — is a repository that should still
 * open and work, just no faster than it did before. Reporting "could not write
 * a commit-graph" to someone who never asked for one would be noise.
 */
export async function configureRepository(repoPath: string): Promise<void> {
  const runner = getGitRunner(repoPath);

  // Local scope, never global: this is a judgement about this repository, and
  // writing it to the user's global config would apply it to every repository
  // they own, including the ones moonGit has never seen.
  await runner.exec(['config', '--local', 'core.fsmonitor', 'true']);
  await runner.exec(['config', '--local', 'core.untrackedCache', 'true']);
  // The config alone does not create the cache; the index has to be told to
  // carry one. Without this the setting is inert and `normal` stays at 680ms.
  await runner.exec(['update-index', '--untracked-cache']);

  // `--reachable` rather than `--append`: it covers every ref rather than only
  // what a fetch just brought in, which matters because the repository may have
  // been sitting on disk for years before moonGit first opened it.
  await runner.exec(['commit-graph', 'write', '--reachable'], { timeoutMs: 5 * 60_000 });
  // Keeps it fresh without a background job of our own — git updates the graph
  // as part of any fetch from here on.
  await runner.exec(['config', '--local', 'fetch.writeCommitGraph', 'true']);
}

/** Test-only. */
export function resetTuning(): void {
  cache.clear();
}
