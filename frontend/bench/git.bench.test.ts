/**
 * The Phase 7 stopwatch (PLAN.md §10).
 *
 * Runs the app's own git commands against the generated repositories from
 * `scripts/seed-large-repo.sh` and prints what each one costs. Every argument
 * vector here is **imported from the source the app uses**, never retyped — a
 * benchmark measuring a copy of a command is a benchmark that silently stops
 * measuring the product the first time someone edits a flag.
 *
 * Skipped unless the bench repositories exist, so `npm test` is unaffected:
 *
 *     ./scripts/seed-large-repo.sh          # once, ~4 minutes
 *     npm run bench                         # from frontend/, or `make bench`
 *
 * What it does *not* measure: the Wails bridge. These numbers are git and the
 * parsers only, which is the right floor to know first — if git alone takes two
 * seconds, no amount of streaming will make the panel feel instant, and if it
 * takes 40ms then the bridge is where to look next.
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { refArgs } from '@/services/git/BranchService';
import { commitDiffArgs } from '@/services/git/DiffService';
import { LS_FILES_ARGS } from '@/services/git/TreeService';
import {
  createLogParser,
  IGNORED_STATUS_ARGS,
  LOG_BASE_ARGS,
  parseLog,
  parseRefs,
  parseStatus,
  REF_PATTERNS,
  STATUS_ARGS,
} from '@/services/git/parsers';
import { buildGraph } from '@/features/history/graph';

const BENCH_DIR = process.env['MOONGIT_BENCH_DIR'] ?? join(tmpdir(), 'moongit-bench');
const BIG_FILES = join(BENCH_DIR, 'big-files');
const BIG_HISTORY = join(BENCH_DIR, 'big-history');

/**
 * Two gates, not one. The repositories have to exist, *and* the run has to have
 * been asked for — otherwise `npm test` on this machine would quietly grow a
 * two-minute tail the moment someone seeded the bench repos, which is exactly
 * the kind of slow test suite people stop running.
 */
const enabled =
  process.env['MOONGIT_BENCH'] === '1' && existsSync(BIG_FILES) && existsSync(BIG_HISTORY);

/** Where the tables are written, in addition to stdout. Gitignored. */
const RESULTS = join(import.meta.dirname, 'results.md');

/** Runs per measurement. The median is reported, so this wants to be odd. */
const RUNS = 3;

/**
 * Generous, because that is the point. An unbounded `git log` over a million
 * commits takes minutes, and a benchmark that times out before the slowest
 * thing it measures finishes would report only that the slow things are slow.
 */
const BENCH_TIMEOUT = 30 * 60_000;

interface Row {
  what: string;
  ms: number;
  bytes: number;
  note?: string;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/**
 * Time a git command, returning the median wall clock and its output.
 *
 * `maxBuffer` is raised well past the default 1MB deliberately: several of
 * these commands produce tens of megabytes, and the default would turn the
 * measurement into an exception. That the buffer has to be this large is itself
 * one of the findings — it is the same payload the Wails bridge would carry in
 * a single value.
 */
function time(repo: string, args: readonly string[]): { ms: number; out: string } {
  let out = '';
  const runs: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const started = performance.now();
    out = execFileSync('git', ['-C', repo, ...args], {
      encoding: 'utf8',
      maxBuffer: 1 << 30,
    });
    runs.push(performance.now() - started);
  }
  return { ms: median(runs), out };
}

/** Time a pure function over already-fetched output. */
function timeFn(fn: () => void): number {
  const runs: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const started = performance.now();
    fn();
    runs.push(performance.now() - started);
  }
  return median(runs);
}

/**
 * Print the table.
 *
 * Deliberately total: a row it cannot format prints as `?` rather than
 * throwing. Three minutes of measurement should not be thrown away by a typo in
 * the formatting of one cell, which is exactly what happened the first time this
 * ran — and the numbers, unlike the typo, cannot be recovered by reading the
 * code.
 */
function report(title: string, rows: Row[]): void {
  const pad = (s: string, n: number) => s.padEnd(n);
  const width = Math.max(...rows.map((r) => r.what.length), 10);
  const ms = (n: number) => (typeof n === 'number' && isFinite(n) ? `${n.toFixed(0)}ms` : '?');
  const lines = [
    '',
    `### ${title}`,
    '',
    `| ${pad('what', width)} | median | output | note |`,
    `|${'-'.repeat(width + 2)}|-------:|-------:|------|`,
    ...rows.map(
      (r) => `| ${pad(r.what, width)} | ${ms(r.ms)} | ${formatBytes(r.bytes)} | ${r.note ?? ''} |`,
    ),
  ];
  const text = lines.join('\n');
  console.log(text);
  // Also to a file, because vitest swallows console output from a *passing*
  // test — so the run that works is the one whose numbers vanish, which is a
  // remarkable way to lose four minutes of measurement.
  appendFileSync(RESULTS, `${text}\n`);
}

/** Recorded with the numbers: git's own performance changes between releases. */
function gitVersion(): string {
  return execFileSync('git', ['--version'], { encoding: 'utf8' }).trim().replace('git version ', '');
}

function formatBytes(n: number): string {
  if (n === 0) return '—';
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)}K`;
  return `${(n / (1024 * 1024)).toFixed(1)}M`;
}

describe.skipIf(!enabled)('Phase 7 baseline', () => {
  // Truncated once per run, so results.md is this run and not an accumulation
  // of every run since the file was created.
  if (enabled) writeFileSync(RESULTS, `# Phase 7 bench — git ${gitVersion()}\n`);

  it('status axis — 500k files', () => {
    // Explicitly untuned. Without this the "baseline" is whatever state the
    // last run — or a hand-run experiment — happened to leave behind, and a
    // baseline that silently measures a tuned repository is worse than no
    // baseline: it reports the improvement as the starting point.
    setStatusConfig(BIG_FILES, false, false);
    const rows: Row[] = [];

    const all = time(BIG_FILES, STATUS_ARGS);
    rows.push({
      what: 'status (untracked=all)',
      ms: all.ms,
      bytes: all.out.length,
      note: 'what the app runs today',
    });

    const normal = time(BIG_FILES, [
      ...STATUS_ARGS.filter((a) => a !== '--untracked-files=all'),
      '--untracked-files=normal',
    ]);
    rows.push({
      what: 'status (untracked=normal)',
      ms: normal.ms,
      bytes: normal.out.length,
      note: 'the degraded mode §10 proposes',
    });

    const none = time(BIG_FILES, [
      ...STATUS_ARGS.filter((a) => a !== '--untracked-files=all'),
      '--untracked-files=no',
    ]);
    rows.push({ what: 'status (untracked=no)', ms: none.ms, bytes: none.out.length, note: 'floor' });

    const ignored = time(BIG_FILES, IGNORED_STATUS_ARGS);
    rows.push({
      what: 'status --ignored',
      ms: ignored.ms,
      bytes: ignored.out.length,
      note: 'the Ignored chip',
    });

    const ls = time(BIG_FILES, LS_FILES_ARGS);
    rows.push({
      what: 'ls-files (quick open)',
      ms: ls.ms,
      bytes: ls.out.length,
      note: 'one buffered string',
    });

    // The parse is the half of the cost the plan never mentions.
    const parseMs = timeFn(() => parseStatus(all.out));
    rows.push({
      what: 'parseStatus over the above',
      ms: parseMs,
      bytes: 0,
      note: 'pure JS, no git',
    });

    report('Status axis — 500k tracked files, 50k untracked', rows);
  }, BENCH_TIMEOUT);

  it('history axis — 1M commits', () => {
    // Same reason as the status axis: a commit-graph left behind by the
    // configuration table below turns this baseline into a 25× lie.
    setCommitGraph(BIG_HISTORY, false);
    const rows: Row[] = [];
    const page = ['--max-count=200', '--topo-order'];

    const first = time(BIG_HISTORY, [...LOG_BASE_ARGS, ...page]);
    rows.push({
      what: 'log, first page (200)',
      ms: first.ms,
      bytes: first.out.length,
      note: 'what the Journal runs today',
    });

    // The question that decides the paging design. `--skip` is documented as
    // walking the commits it skips, so page 500 may cost 500 pages of work.
    for (const skip of [1_000, 10_000, 100_000, 500_000]) {
      const paged = time(BIG_HISTORY, [...LOG_BASE_ARGS, ...page, `--skip=${skip}`]);
      rows.push({
        what: `log, --skip=${skip}`,
        ms: paged.ms,
        bytes: paged.out.length,
        note: skip === 1_000 ? 'is --skip O(n)?' : '',
      });
    }

    const all = time(BIG_HISTORY, [...LOG_BASE_ARGS, '--topo-order']);
    rows.push({
      what: 'log, unbounded',
      ms: all.ms,
      bytes: all.out.length,
      note: 'the payload the bridge must never carry whole',
    });

    const refs = time(BIG_HISTORY, refArgs(REF_PATTERNS));
    rows.push({
      what: 'for-each-ref (1.7k refs)',
      ms: refs.ms,
      bytes: refs.out.length,
      note: 'the Branches panel',
    });

    const refsParse = timeFn(() => parseRefs(refs.out));
    rows.push({ what: 'parseRefs', ms: refsParse, bytes: 0, note: 'pure JS' });

    // Parse and lane-assign a page, which is what the Journal actually does on
    // every render of new data.
    const commits = parseLog(first.out);
    rows.push({
      what: 'parseLog (200)',
      ms: timeFn(() => parseLog(first.out)),
      bytes: 0,
      note: `${commits.length} commits`,
    });
    rows.push({
      what: 'buildGraph (200)',
      ms: timeFn(() => buildGraph(commits)),
      bytes: 0,
      note: 'lane assignment',
    });

    // And the same two over a much deeper window, since buildGraph today is
    // handed every commit loaded so far rather than only the new page.
    const deep = time(BIG_HISTORY, [...LOG_BASE_ARGS, '--max-count=20000', '--topo-order']);
    const deepCommits = parseLog(deep.out);
    rows.push({
      what: 'log (20k)',
      ms: deep.ms,
      bytes: deep.out.length,
      note: '100 pages deep',
    });
    rows.push({
      what: 'parseLog (20k)',
      ms: timeFn(() => parseLog(deep.out)),
      bytes: 0,
      note: '',
    });
    rows.push({
      what: 'buildGraph (20k)',
      ms: timeFn(() => buildGraph(deepCommits)),
      bytes: 0,
      note: 'rebuilt from scratch today',
    });

    // The streaming parser, which is what CommitService actually feeds.
    rows.push({
      what: 'createLogParser (20k)',
      ms: timeFn(() => {
        const parser = createLogParser();
        parser.push(deep.out);
        parser.flush();
      }),
      bytes: 0,
      note: 'incremental path',
    });

    report('History axis — 1M commits, ~5 concurrent lanes', rows);
  }, BENCH_TIMEOUT);

  /**
   * The commit-diff axis — added by the Phase 7.7 streaming audit.
   *
   * `useCommitDiff` calls `DiffService.commit(oid)` with **no `paths`**, so
   * selecting a commit fetches that commit's entire patch as one buffered
   * string. The working-tree and staged diff queries both accept a path scope;
   * this one does not, and until now nobody had put a number on what that
   * costs.
   *
   * `big-files` is the worst case and it is not synthetic: the seed script
   * builds it as **one commit containing 500k files**, so `show HEAD` there is
   * the whole corpus rendered as a patch. `big-history`'s HEAD is the opposite
   * end — a small ordinary commit, which is what a Journal click usually is.
   * The third row measures the *proposed fix* rather than only the problem:
   * the same command scoped to a single path, which is what `useCommitDiff`
   * would pass if it behaved like its two siblings.
   */
  it('commit-diff axis — what selecting a commit costs', () => {
    const rows: Row[] = [];

    /*
     * Total, like `report` and for the same reason.
     *
     * `time` raises maxBuffer to 1GB, which was ample for every payload the
     * earlier axes measured. This axis exists precisely because nobody knows
     * how large this one is, so it may be the first to exceed it — and a run
     * that throws here would take the other rows down with it. A row saying
     * "larger than a gigabyte" is a finding, not a failure; it is in fact a
     * more damning one than any number would be.
     */
    const measure = (what: string, repo: string, args: readonly string[], note: string): void => {
      try {
        const r = time(repo, args);
        rows.push({ what, ms: r.ms, bytes: r.out.length, note });
      } catch (cause) {
        const why = cause instanceof Error ? cause.message : String(cause);
        rows.push({
          what,
          ms: NaN,
          bytes: 0,
          note: /maxBuffer/i.test(why) ? 'EXCEEDED 1GB BUFFER' : `failed: ${why.slice(0, 60)}`,
        });
      }
    };

    const head = (repo: string): string =>
      execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

    const bigCommit = head(BIG_FILES);
    measure(
      'show (500k-file commit)',
      BIG_FILES,
      commitDiffArgs(bigCommit),
      'what useCommitDiff runs today',
    );

    // The fix, measured beside the problem. One path out of 500k.
    const onePath = execFileSync('git', ['-C', BIG_FILES, 'ls-files'], {
      encoding: 'utf8',
      maxBuffer: 1 << 30,
    })
      .split('\n')[0]
      ?.trim();
    if (onePath !== undefined && onePath !== '') {
      measure(
        'show, scoped to one path',
        BIG_FILES,
        [...commitDiffArgs(bigCommit), '--', onePath],
        'what the two sibling queries do',
      );
    }

    /*
     * Not the common case, though it was added believing it was.
     *
     * `genrepo -mode=history` writes commit objects with no tree changes —
     * that is how a million of them take two minutes — so every commit in
     * `big-history` has an **empty** diff and this row times `git show`
     * finding nothing on a 1M-commit repository. Useful as a process floor,
     * worthless as a typical patch. **Neither bench repository contains an
     * ordinary multi-file commit**, which is a gap in the corpus (§13a) and
     * not something to paper over by labelling this row as though it were one.
     */
    measure(
      'show (empty commit)',
      BIG_HISTORY,
      commitDiffArgs(head(BIG_HISTORY)),
      'process floor — big-history commits change nothing',
    );

    report('Commit-diff axis — the payload the 7.7 audit found', rows);
  }, BENCH_TIMEOUT);

  /**
   * What repository *configuration* is worth, as opposed to what code is.
   *
   * This is the table that reordered Phase 7. Two settings git already has beat
   * anything the app could do to its own query layer, and one of them — the
   * commit-graph — appears nowhere in §10's original bullet list.
   *
   * Mutates config on the bench repositories and restores it afterwards. Safe
   * only because they are generated and disposable; it would be unacceptable
   * against anything in testGitHere (§13a).
   */
  it('what configuration is worth', () => {
    const rows: Row[] = [];
    const page = ['--max-count=200', '--topo-order'];
    const logArgs = [...LOG_BASE_ARGS, ...page];

    // --- history: the commit-graph ---------------------------------------
    //
    // `--topo-order` has to prove no parent precedes a child, and without
    // generation numbers to reason with, git can only do that by walking the
    // whole history first — so `--max-count=200` bounds the *output* and not
    // the work. A commit-graph supplies the generation numbers.
    setCommitGraph(BIG_HISTORY, false);
    rows.push({
      what: 'log page 1, topo, no commit-graph',
      ms: time(BIG_HISTORY, logArgs).ms,
      bytes: 0,
      note: 'what the Journal runs today',
    });
    rows.push({
      what: 'log page 1, default order',
      ms: time(BIG_HISTORY, [...LOG_BASE_ARGS, '--max-count=200']).ms,
      bytes: 0,
      note: 'ordering is the whole cost',
    });

    setCommitGraph(BIG_HISTORY, true);
    rows.push({
      what: 'log page 1, topo, commit-graph',
      ms: time(BIG_HISTORY, logArgs).ms,
      bytes: 0,
      note: 'same query, same output',
    });
    for (const skip of [100_000, 500_000]) {
      rows.push({
        what: `log --skip=${skip}, commit-graph`,
        ms: time(BIG_HISTORY, [...logArgs, `--skip=${skip}`]).ms,
        bytes: 0,
        note: skip === 100_000 ? 'is --skip paging viable now?' : '',
      });
    }
    rows.push({
      what: 'log page 1, topo --all, commit-graph',
      ms: time(BIG_HISTORY, [...logArgs, '--all']).ms,
      bytes: 0,
      note: 'what search and logAll run',
    });

    // --- status: fsmonitor and the untracked cache ------------------------
    const normalArgs = [
      ...STATUS_ARGS.filter((a) => a !== '--untracked-files=all'),
      '--untracked-files=normal',
    ];
    for (const [fsmonitor, cache] of [
      [false, false],
      [true, false],
      [true, true],
    ] as const) {
      setStatusConfig(BIG_FILES, fsmonitor, cache);
      const label = [fsmonitor ? 'fsmonitor' : '', cache ? 'untrackedCache' : '']
        .filter(Boolean)
        .join(' + ');
      rows.push({
        what: `status all — ${label || 'neither'}`,
        ms: time(BIG_FILES, STATUS_ARGS).ms,
        bytes: 0,
        note: '',
      });
      rows.push({
        what: `status normal — ${label || 'neither'}`,
        ms: time(BIG_FILES, normalArgs).ms,
        bytes: 0,
        note: cache && fsmonitor ? 'the cache only pays off here' : '',
      });
    }
    setStatusConfig(BIG_FILES, false, false);

    report('What configuration is worth', rows);
  }, BENCH_TIMEOUT);
});

function setCommitGraph(repo: string, on: boolean): void {
  if (on) {
    execFileSync('git', ['-C', repo, 'commit-graph', 'write', '--reachable'], { stdio: 'ignore' });
  } else {
    execFileSync('rm', ['-f', join(repo, '.git/objects/info/commit-graph')]);
    execFileSync('rm', ['-rf', join(repo, '.git/objects/info/commit-graphs')]);
  }
}

function setStatusConfig(repo: string, fsmonitor: boolean, untrackedCache: boolean): void {
  execFileSync('git', ['-C', repo, 'config', 'core.fsmonitor', String(fsmonitor)]);
  execFileSync('git', ['-C', repo, 'config', 'core.untrackedCache', String(untrackedCache)]);
  // Both directions. The config alone neither creates the cache nor removes
  // it — it lives in the index — so turning the setting off without this
  // leaves a populated cache behind and the "no cache" row measures one.
  execFileSync(
    'git',
    ['-C', repo, 'update-index', untrackedCache ? '--untracked-cache' : '--no-untracked-cache'],
    { stdio: 'ignore' },
  );
  // Two warm-up runs, not one: the first starts the fsmonitor daemon and the
  // second is the first to benefit from it. Timing the cold run would measure
  // daemon startup and call it the cost of a status.
  for (let i = 0; i < 2; i++) {
    execFileSync('git', ['-C', repo, ...STATUS_ARGS], { stdio: 'ignore', maxBuffer: 1 << 30 });
  }
}
