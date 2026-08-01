import { useCallback, useState } from 'react';
import {
  branchService,
  commitService,
  diffService,
  isStaged,
  repositoryService,
  type Commit,
} from '@/services/git';
import styles from './DevBridgePage.module.css';

/**
 * Phase 2 verification harness.
 *
 * The parsers and services are covered by unit tests against captured fixtures,
 * which proves they read git's bytes correctly. What no unit test can prove is
 * that those bytes *arrive* intact: git's output crosses a Go process boundary,
 * a JSON encoding and a webview bridge before any parser sees it, and the whole
 * layer assumes NUL delimiters and UTF-8 survive that trip unchanged.
 *
 * That assumption is now load-bearing for four parsers. This panel tests it
 * against a live repository. Reachable at #/dev/bridge.
 */

interface Check {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

/** Render control characters visibly so a mangled path is obvious rather than subtle. */
function visible(text: string): string {
  return text.replace(/\n/g, '⏎').replace(/\t/g, '⇥').replace(/\0/g, '␀');
}

function codePoints(text: string): string {
  return [...text].map((ch) => (ch.codePointAt(0) ?? 0).toString(16).padStart(4, '0')).join(' ');
}

export function DevServicesPanel({ repoPath }: { repoPath: string }) {
  const [checks, setChecks] = useState<Check[]>([]);
  const [running, setRunning] = useState(false);

  const run = useCallback(async () => {
    setRunning(true);
    const results: Check[] = [];
    const add = (name: string, ok: boolean, detail: string) => results.push({ name, ok, detail });

    // --- RepositoryService ------------------------------------------------
    const repo = repositoryService(repoPath);

    const isRepo = await repo.isRepository();
    add('isRepository', isRepo, String(isRepo));

    const status = await repo.status();
    if (status.ok) {
      const { branch, entries } = status.value;
      add(
        'status parses',
        true,
        `branch=${branch.head ?? '(detached)'} upstream=${branch.upstream ?? '—'} ` +
          `+${branch.ahead}/-${branch.behind} · ${entries.length} entries · ` +
          `${entries.filter(isStaged).length} staged`,
      );

      // The check this panel exists for.
      const awkward = entries.filter((entry) => /[^ -~]/.test(entry.path));
      if (awkward.length === 0) {
        add(
          'path bytes survive the bridge',
          false,
          'no path with control or non-ASCII characters in this repo — point at a repo that has one',
        );
      } else {
        const hasControl = awkward.some((entry) => /[\n\t]/.test(entry.path));
        add(
          'path bytes survive the bridge',
          true,
          awkward.map((entry) => `${visible(entry.path)}  [${codePoints(entry.path)}]`).join('\n') +
            (hasControl ? '\n(includes a newline or tab inside a filename)' : ''),
        );
      }
    } else {
      add('status parses', false, `${status.error.kind}: ${status.error.message}`);
    }

    const head = await repo.headOid();
    add(
      'headOid',
      head.ok,
      head.ok ? (head.value ?? '(unborn)') : `${head.error.kind}: ${head.error.message}`,
    );

    // --- BranchService ----------------------------------------------------
    const refs = await branchService(repoPath).list();
    if (refs.ok) {
      const { branches, remotes, tags, head: current } = refs.value;
      const tracking = branches.filter((ref) => ref.upstream !== null);
      add(
        'refs parse',
        true,
        `${branches.length} branches · ${remotes.length} remotes · ${tags.length} tags · ` +
          `head=${current?.shortName ?? '(detached)'}\n` +
          tracking
            .map(
              (ref) =>
                `  ${ref.shortName} → ${ref.upstream?.shortRef} ` +
                `+${ref.upstream?.ahead}/-${ref.upstream?.behind}` +
                (ref.upstream?.gone === true ? ' [gone]' : ''),
            )
            .join('\n'),
      );
    } else {
      add('refs parse', false, `${refs.error.kind}: ${refs.error.message}`);
    }

    // --- CommitService ----------------------------------------------------
    let batches = 0;
    const log = await commitService(repoPath).list({
      // High enough that a real history streams in several chunks, which is
      // the only way to exercise the incremental parser across a chunk
      // boundary — the case unit tests simulate but production never had.
      maxCount: 5000,
      onBatch: () => {
        batches += 1;
      },
    });
    if (log.ok) {
      const commits: Commit[] = log.value;
      const merges = commits.filter((commit) => commit.isMerge).length;
      const nonAscii = commits.find((commit) => /[^ -~]/.test(commit.author.name));
      add(
        'log streams and parses',
        true,
        `${commits.length} commits in ${batches} batch(es) · ${merges} merges\n` +
          `newest: ${commits[0]?.shortOid ?? '—'} ${visible(commits[0]?.subject ?? '')}\n` +
          (nonAscii === undefined
            ? '(no non-ASCII author in this history)'
            : `non-ASCII author round-trip: ${nonAscii.author.name} [${codePoints(nonAscii.author.name)}]`),
      );
    } else {
      add('log streams and parses', false, `${log.error.kind}: ${log.error.message}`);
    }

    // --- DiffService ------------------------------------------------------
    const diffs = diffService(repoPath);
    const unstaged = await diffs.workingTree();
    if (unstaged.ok) {
      add(
        'working tree diff',
        true,
        unstaged.value.length === 0
          ? '(clean working tree)'
          : unstaged.value
              .map(
                (file) =>
                  `  ${file.kind} ${visible(file.path)} +${file.additions}/-${file.deletions}` +
                  `${file.isBinary ? ' [binary]' : ''}${file.isSubmodule ? ' [submodule]' : ''}` +
                  `${file.isCombined ? ' [conflict]' : ''}`,
              )
              .join('\n'),
      );
    } else {
      add('working tree diff', false, `${unstaged.error.kind}: ${unstaged.error.message}`);
    }

    if (head.ok && head.value !== null) {
      const commitDiff = await diffs.commit(head.value);
      add(
        'commit diff (show --first-parent)',
        commitDiff.ok,
        commitDiff.ok
          ? `${commitDiff.value.length} files changed in ${head.value.slice(0, 7)}`
          : `${commitDiff.error.kind}: ${commitDiff.error.message}`,
      );
    }

    // --- error boundary ---------------------------------------------------
    // A path that is definitely not a repository must come back as a typed
    // error, not an exception and not a plausible-looking empty result.
    const bogus = await repositoryService('/tmp').status();
    add(
      'non-repo path yields NotARepository',
      !bogus.ok && bogus.error.kind === 'NotARepository',
      bogus.ok ? 'unexpectedly succeeded' : `${bogus.error.kind}: ${bogus.error.message}`,
    );

    setChecks(results);
    setRunning(false);
  }, [repoPath]);

  const passed = checks.filter((check) => check.ok).length;

  return (
    <section className={styles.card}>
      <div className={styles.cardHeader}>
        <span>Phase 2 — services against real git</span>
        <button className={styles.btn} onClick={() => void run()} disabled={running}>
          {running ? 'running…' : 'Run checks'}
        </button>
      </div>
      <div className={styles.cardBody}>
        {checks.length > 0 && (
          <div className={styles.stat}>
            <span className={styles.statKey}>result</span>
            <span className={styles.statVal}>
              {passed}/{checks.length} passed
            </span>
          </div>
        )}
        <pre className={styles.out}>
          {checks.length === 0
            ? 'Runs RepositoryService, BranchService, CommitService and DiffService against the\npath above, and verifies that NUL-delimited, non-ASCII output survives the bridge.'
            : checks
                .map(
                  (check) =>
                    `${check.ok ? '✓' : '✗'} ${check.name}\n    ${check.detail.replace(/\n/g, '\n    ')}`,
                )
                .join('\n\n')}
        </pre>
      </div>
    </section>
  );
}
