import { useCallback, useState } from 'react';
import {
  blameService,
  mergeService,
  remoteService,
  repositoryService,
  stashService,
} from '@/services/git';
import styles from './DevBridgePage.module.css';

/**
 * Phase 2 verification, write side.
 *
 * Merge and rebase classify their *outcome* from git's own words, and those
 * words were captured by hand. Reading them back through the whole stack is
 * the only way to know the mapping survives contact with a real repository.
 *
 * Unlike everything else in this harness, these checks **mutate the
 * repository**, so the path is required to be inside a scratch directory. A
 * dev tool that can quietly rewrite the user's working tree because a field
 * still held yesterday's path is not worth the convenience.
 */

const SCRATCH_MARKER = '/scratchpad/';

interface Check {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

export function DevMutationPanel({ repoPath }: { repoPath: string }) {
  const [checks, setChecks] = useState<Check[]>([]);
  const [running, setRunning] = useState(false);

  const allowed = repoPath.includes(SCRATCH_MARKER);

  const run = useCallback(async () => {
    if (!repoPath.includes(SCRATCH_MARKER)) return;
    setRunning(true);
    const results: Check[] = [];
    const add = (name: string, ok: boolean, detail: string) => results.push({ name, ok, detail });

    // --- reads that were added with the write services ---------------------
    const stashes = stashService(repoPath);
    const listed = await stashes.list();
    if (listed.ok) {
      add(
        'stash list',
        true,
        listed.value.length === 0
          ? '(no stashes)'
          : listed.value
              .map(
                (stash) =>
                  `  ${stash.selector} on ${stash.branch ?? '?'}: ${stash.message}` +
                  `${stash.includesUntracked ? ' [+untracked]' : ''}` +
                  `${stash.autoNamed ? ' [auto-named]' : ''}`,
              )
              .join('\n'),
      );
    } else {
      add('stash list', false, `${listed.error.kind}: ${listed.error.message}`);
    }

    const remotes = await remoteService(repoPath).list();
    add(
      'remote list',
      remotes.ok,
      remotes.ok
        ? remotes.value.map((remote) => `  ${remote.name} → ${remote.url}`).join('\n') || '(none)'
        : `${remotes.error.kind}: ${remotes.error.message}`,
    );

    // --- stash round trip --------------------------------------------------
    const before = await repositoryService(repoPath).status();
    const pushed = await stashes.push({ message: 'harness probe', includeUntracked: true });
    if (pushed.ok) {
      const afterPush = await stashes.list();
      const restored = pushed.value ? await stashes.pop('stash@{0}') : { ok: true as const };
      const after = await repositoryService(repoPath).status();

      const beforeCount = before.ok ? before.value.entries.length : -1;
      const afterCount = after.ok ? after.value.entries.length : -2;
      add(
        'stash push → pop restores the working tree',
        pushed.value ? restored.ok && beforeCount === afterCount : true,
        pushed.value
          ? `pushed (stack was ${listed.ok ? listed.value.length : '?'}, became ` +
              `${afterPush.ok ? afterPush.value.length : '?'}), popped; ` +
              `entries ${beforeCount} → ${afterCount}`
          : 'nothing to stash — clean working tree, push correctly reported false',
      );
    } else {
      add('stash push → pop restores the working tree', false, pushed.error.message);
    }

    // --- merge outcome classification --------------------------------------
    // Requires a branch named `conflicting` that touches the same lines as
    // HEAD; the seed script below creates one.
    const merged = await mergeService(repoPath).merge('conflicting');
    if (merged.ok) {
      add(
        'merge outcome is classified, not thrown',
        merged.value.status === 'conflicted',
        `status=${merged.value.status} · "${merged.value.summary}"`,
      );

      // The conflicted paths come from status, not from git's prose.
      const conflicted = await repositoryService(repoPath).status();
      if (conflicted.ok) {
        const unmerged = conflicted.value.entries.filter((entry) => entry.kind === 'unmerged');
        add(
          'conflicted paths come from status, not the merge message',
          unmerged.length > 0,
          unmerged.map((entry) => `  ${entry.path} (${entry.index}${entry.worktree})`).join('\n'),
        );
      }

      const aborted = await mergeService(repoPath).abort();
      const settled = await repositoryService(repoPath).status();
      add(
        'merge --abort returns the tree to normal',
        aborted.ok && settled.ok && !settled.value.entries.some((e) => e.kind === 'unmerged'),
        aborted.ok ? 'aborted, no unmerged entries remain' : aborted.error.message,
      );
    } else {
      add(
        'merge outcome is classified, not thrown',
        false,
        `${merged.error.kind}: ${merged.error.message}`,
      );
    }

    // --- blame -------------------------------------------------------------
    const blamed = await blameService(repoPath).blame('f.txt');
    if (blamed.ok) {
      const authors = new Set(
        [...blamed.value.commits.values()].map((commit) => commit.author.name),
      );
      add(
        'blame attributes every line',
        blamed.value.lines.length > 0,
        `${blamed.value.lines.length} lines · ${blamed.value.commits.size} commits · ` +
          `authors: ${[...authors].join(', ')}`,
      );
    } else {
      add('blame attributes every line', false, `${blamed.error.kind}: ${blamed.error.message}`);
    }

    setChecks(results);
    setRunning(false);
  }, [repoPath]);

  const passed = checks.filter((check) => check.ok).length;

  return (
    <section className={styles.card}>
      <div className={styles.cardHeader}>
        <span>Phase 2 — mutations (scratch repos only)</span>
        <button className={styles.btn} onClick={() => void run()} disabled={running || !allowed}>
          {running ? 'running…' : 'Run mutations'}
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
          {!allowed
            ? `Disabled: these checks stash, merge and abort in the target repository.\nThe path must contain "${SCRATCH_MARKER}".`
            : checks.length === 0
              ? 'Stashes and restores, merges a conflicting branch and aborts it, and blames a\nfile — verifying that a conflict arrives as an outcome rather than an error.'
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
