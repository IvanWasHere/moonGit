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
 *
 * 4. **The two axes are measured and configured separately.** "Big" is not one
 *    property. `big-files` is 500k files and one commit; `big-history` is a
 *    million commits and 256 files; neither is slow at what the other is slow
 *    at. So a slow *status* buys fsmonitor and the untracked cache, a slow *log*
 *    buys the commit-graph, and neither infers the other. Configuring both from
 *    one measurement would put an fsmonitor daemon on a 256-file repository and
 *    leave a million-commit one — which answers status instantly — without the
 *    graph that is worth 25× to it. That second half is exactly the gap this
 *    file had until the history trigger was added: the graph was written and
 *    measured, and the only thing that ever called for one was a slow status.
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

/**
 * A log slower than this means the history is long enough to want a graph.
 *
 * The same number as `SLOW_STATUS_MS`, for the same reason — a second is where
 * a panel stops reading as instant — but a separate constant, because the two
 * measure different commands against different bottlenecks and there is no
 * reason they should have to move together. Sharing one constant would mean a
 * future adjustment to either silently retunes the other.
 *
 * The margin is wide in both directions: an ungraphed million-commit log
 * measured 6893ms and a graphed one 275ms, so nothing plausible sits near the
 * line.
 */
export const SLOW_LOG_MS = 1000;

/** What has been decided about one repository. */
export interface Tuning {
  readonly untracked: UntrackedMode;
  /** Whether fsmonitor and the untracked cache were applied — the file axis. */
  readonly configured: boolean;
  /** Whether a commit-graph was written — the history axis. */
  readonly graphed: boolean;
  /** Set when the user asked for `all` back, which stops the automatic degrade. */
  readonly forcedAll: boolean;
}

const DEFAULT_TUNING: Tuning = {
  untracked: 'all',
  configured: false,
  graphed: false,
  forcedAll: false,
};

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

/**
 * Load a repository's tuning from the database into the cache.
 *
 * Spread over the defaults rather than used directly, because a row written by
 * an earlier version predates whatever field was added since — `graphed` was
 * the first — and would arrive as `undefined` behind a type that promises a
 * boolean. The spread is the migration: an old row means "not yet", which for
 * every flag here is both the truthful and the safe reading.
 */
export async function loadTuning(repoPath: string): Promise<Tuning> {
  const stored = await getPreference<Tuning>(key(repoPath), DEFAULT_TUNING);
  const tuning = { ...DEFAULT_TUNING, ...stored };
  cache.set(repoPath, tuning);
  return tuning;
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
 * The history-axis rule, as a pure function. Sibling of `nextTuning`.
 *
 * Deliberately simpler than its sibling, because there is no user-facing
 * degrade on this axis to negotiate with. The commit-graph changes what git
 * answers *with*, never what it answers — the same commits come back in the
 * same order, only sooner — so there is nothing to surface, nothing to offer an
 * undo for, and no override to respect. `forcedAll` is not consulted here for
 * that reason: someone who asked to keep seeing every untracked file has said
 * nothing whatsoever about how they would like their history read.
 *
 * Writes once and never again. Git keeps the graph fresh itself from then on
 * (`fetch.writeCommitGraph`), so a second write would be a 13-second no-op.
 */
export function nextGraphTuning(tuning: Tuning, ms: number): Tuning | null {
  if (ms < SLOW_LOG_MS) return null;
  if (tuning.graphed) return null;
  return { ...tuning, graphed: true };
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
  await configureForStatus(repoPath);
  return true;
}

/**
 * Repositories with a commit-graph write already running, so a second slow log
 * does not start a second one.
 *
 * The status trigger needs no such guard: it awaits its configure inside the
 * query, and a status is one query. A log is not — the Journal re-runs it on
 * every search keystroke, each one slow while the graph is still missing, and
 * each one returning before the 13-second write it started has finished. Three
 * concurrent `commit-graph write` processes on the same object store is a way
 * to make a slow repository slower.
 *
 * Keyed by path and never cleared on success, which is the same thing
 * `graphed` records; it exists for the window before that flag is persisted,
 * and on failure so a repository that cannot write one stops being asked
 * within this session.
 */
const graphing = new Set<string>();

/**
 * Feed back how long a `log` actually took, and write a commit-graph if it was
 * slow. The history-axis counterpart to `noteStatusDuration` (PLAN.md §10, 7.1).
 *
 * **Nothing waits for this**, which is the one structural difference from the
 * status path and the reason it returns void. A degraded status changes the
 * command the next status runs, so its caller has something to invalidate; a
 * commit-graph changes nothing about the result already in hand. Awaiting it
 * would hold the Journal on "Reading history…" for the thirteen seconds the
 * write takes, to deliver commits that were parsed and ready before it started.
 * The payoff is the *next* log, and the next log is not waiting on this either.
 */
export function noteLogDuration(repoPath: string, ms: number): void {
  if (nextGraphTuning(current(repoPath), ms) === null) return;
  if (graphing.has(repoPath)) return;
  graphing.add(repoPath);

  void (async () => {
    // Configure first, persist after. The flag means "this repository has a
    // graph", and setting it before the write would make a crash mid-write
    // permanent: every future session would read the flag and never retry.
    await configureForHistory(repoPath);
    // Re-read rather than reusing the value from above — `update` merges into
    // whatever the status path may have written while the graph was building.
    await update(repoPath, { graphed: true });
  })().catch(() => {
    // Same bargain as `configureForHistory` itself: this is an optimisation,
    // and a repository that cannot be sped up must still work. Left in
    // `graphing` on purpose, so the failure is not retried on every keystroke.
  });
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
 * Apply git's own large-repository settings for the *file* axis.
 *
 * Every failure is swallowed, here and in its sibling below. These are
 * optimisations, and a repository where one of them will not apply — an older
 * git, a filesystem the fsmonitor daemon cannot watch, a read-only object
 * store — is a repository that should still open and work, just no faster than
 * it did before. Reporting "could not enable fsmonitor" to someone who never
 * asked for it would be noise.
 */
export async function configureForStatus(repoPath: string): Promise<void> {
  const runner = getGitRunner(repoPath);

  // Local scope, never global: this is a judgement about this repository, and
  // writing it to the user's global config would apply it to every repository
  // they own, including the ones moonGit has never seen.
  await runner.exec(['config', '--local', 'core.fsmonitor', 'true']);
  await runner.exec(['config', '--local', 'core.untrackedCache', 'true']);
  // The config alone does not create the cache; the index has to be told to
  // carry one. Without this the setting is inert and `normal` stays at 680ms.
  await runner.exec(['update-index', '--untracked-cache']);
}

/**
 * Write a commit-graph — the *history* axis, and the largest single measured
 * win in Phase 7 (6796ms → 275ms on the query the Journal opens with).
 *
 * Split out from `configureForStatus` when the history trigger was built.
 * Before that the two lived in one function that only a slow status called,
 * which meant the biggest win in the phase was reachable only from the axis it
 * has nothing to do with — see note 4 in the header.
 */
export async function configureForHistory(repoPath: string): Promise<void> {
  const runner = getGitRunner(repoPath);

  // `--reachable` rather than `--append`: it covers every ref rather than only
  // what a fetch just brought in, which matters because the repository may have
  // been sitting on disk for years before moonGit first opened it.
  //
  // The generous timeout is measured, not guessed: a million commits takes 13
  // seconds, and the ceiling is there for the repository ten times that size.
  await runner.exec(['commit-graph', 'write', '--reachable'], { timeoutMs: 5 * 60_000 });
  // Keeps it fresh without a background job of our own — git updates the graph
  // as part of any fetch from here on.
  await runner.exec(['config', '--local', 'fetch.writeCommitGraph', 'true']);
}

/** Test-only. */
export function resetTuning(): void {
  cache.clear();
  graphing.clear();
}
