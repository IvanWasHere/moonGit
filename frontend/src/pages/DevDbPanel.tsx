import { useCallback, useState } from 'react';
import { currentVersion, TARGET_VERSION } from '@/services/db/migrations';
import { getLayout, getPreference, setLayout, setPreference } from '@/services/db/keyValue';
import {
  addRepository,
  findRepositoryByPath,
  listRepositories,
  removeRepository,
  setFavorite,
  touchRepository,
} from '@/services/db/repositories';
import { dbQuery, toRecords } from '@/services/wails';
import styles from './DevBridgePage.module.css';

/**
 * Phase 3 verification harness.
 *
 * The schema, the migration runner and the key/value round trip are all
 * assertions about a real SQLite file that no unit test touches — Go owns the
 * handle, so there is no in-process database to test against. This exercises
 * them against the live one.
 *
 * Writes go to purpose-made rows and are cleaned up, so running it repeatedly
 * leaves the user's actual repository list untouched.
 */

interface Check {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

const PROBE_PATH = '/moongit-harness/probe-repository';

export function DevDbPanel() {
  const [checks, setChecks] = useState<Check[]>([]);
  const [running, setRunning] = useState(false);

  const run = useCallback(async () => {
    setRunning(true);
    const results: Check[] = [];
    const add = (name: string, ok: boolean, detail: string) => results.push({ name, ok, detail });

    try {
      // --- schema ---------------------------------------------------------
      const version = await currentVersion();
      add(
        'migrations applied at startup',
        version === TARGET_VERSION,
        `user_version=${version}, expected ${TARGET_VERSION}`,
      );

      const tables = toRecords<{ name: string }>(
        await dbQuery(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        ),
      ).map((row) => row.name);

      const expected = [
        'commit_templates',
        'layout_state',
        'preferences',
        'recent_messages',
        'repo_groups',
        'repositories',
        'window_state',
      ];
      const missing = expected.filter((name) => !tables.includes(name));
      add('every table exists', missing.length === 0, tables.join(', '));

      // The mirror tables the mockup had must NOT be here (PLAN.md §1.2).
      const mirrors = ['branches', 'files', 'commits', 'changes'].filter((name) =>
        tables.includes(name),
      );
      add(
        'no git state is mirrored',
        mirrors.length === 0,
        mirrors.length === 0
          ? 'branches / files / commits / changes are absent, as intended'
          : `found ${mirrors.join(', ')}`,
      );

      // --- repositories ----------------------------------------------------
      const added = await addRepository(PROBE_PATH, 'probe');
      const again = await addRepository(PROBE_PATH, 'a different name');
      add(
        'adding the same path twice does not duplicate it',
        added.id === again.id && again.name === 'probe',
        `id ${added.id} both times, name stayed "${again.name}"`,
      );

      await touchRepository(added.id, 1_700_000_000_000);
      await setFavorite(added.id, true);
      const reread = await findRepositoryByPath(PROBE_PATH);
      add(
        'repository fields round-trip',
        reread?.isFavorite === true && reread.lastOpenedAt === 1_700_000_000_000,
        `favorite=${String(reread?.isFavorite)} lastOpened=${String(reread?.lastOpenedAt)}`,
      );

      const listed = await listRepositories();
      add(
        'listing includes the probe',
        listed.some((repo) => repo.path === PROBE_PATH),
        `${listed.length} repositories recorded`,
      );

      // --- key/value -------------------------------------------------------
      await setPreference('harness.probe', { nested: { value: 42 }, list: [1, 2, 3] });
      const pref = await getPreference<{ nested: { value: number } }>('harness.probe', {
        nested: { value: -1 },
      });
      add('preferences round-trip JSON', pref.nested.value === 42, JSON.stringify(pref));

      const fallback = await getPreference('harness.does-not-exist', { fell: 'back' });
      add('a missing key returns the fallback', fallback.fell === 'back', JSON.stringify(fallback));

      // A row corrupted by a crash must reset one setting, not break startup.
      await dbQuery('SELECT 1');
      await setPreference('harness.corrupt', 'placeholder');
      const { dbExec } = await import('@/services/wails');
      await dbExec('UPDATE preferences SET value = ? WHERE key = ?', [
        '{not json',
        'harness.corrupt',
      ]);
      const corrupted = await getPreference('harness.corrupt', 'default-used');
      add(
        'unparseable JSON falls back instead of throwing',
        corrupted === 'default-used',
        `got ${JSON.stringify(corrupted)}`,
      );

      // --- layout ----------------------------------------------------------
      const savedLayout = await getLayout<{ leftW: number } | null>('workspace.main', null);
      add(
        'layout persisted from the workspace',
        savedLayout !== null,
        savedLayout === null
          ? 'nothing saved yet — open the workspace and drag a resizer first'
          : `workspace.main = ${JSON.stringify(savedLayout)}`,
      );
      await setLayout('harness.layout', { probe: true });

      // --- cleanup ---------------------------------------------------------
      await removeRepository(added.id);
      const gone = await findRepositoryByPath(PROBE_PATH);
      add('probe rows cleaned up', gone === null, 'harness left no repository behind');
    } catch (cause) {
      add('unexpected failure', false, cause instanceof Error ? cause.message : String(cause));
    }

    setChecks(results);
    setRunning(false);
  }, []);

  const passed = checks.filter((check) => check.ok).length;

  return (
    <section className={styles.card}>
      <div className={styles.cardHeader}>
        <span>Phase 3 — schema &amp; persistence</span>
        <button className={styles.btn} onClick={() => void run()} disabled={running}>
          {running ? 'running…' : 'Run DB checks'}
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
            ? 'Checks the migration ran, every table exists, no git state is mirrored,\nand that repositories and key/value settings round-trip through SQLite.'
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
