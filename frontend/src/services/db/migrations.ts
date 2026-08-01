/**
 * Schema migrations, owned by TypeScript (PLAN.md §1.2).
 *
 * Go holds the file handle and runs statements; every table, index and version
 * bump is defined here. That is what keeps "the database is app state" a
 * property of this file rather than a convention spread across Go and TS.
 *
 * **What is deliberately absent**: `branches`, `files`, `commits`, `changes`.
 * The mockup had those because it had no git. Here they would be a stale
 * mirror of the only source of truth — every one of them is answered by a
 * command in `services/git` in single-digit milliseconds. The SHA-keyed
 * caches (`commit_cache`, `graph_cache`, FTS) arrive in Phase 7 when there is
 * a *measured* reason, not before.
 *
 * Migrations are forward-only and append-only: once a version has shipped its
 * statements are never edited, because someone's database has already run
 * them. Fixing a mistake means adding the next version.
 */

import { dbExec, dbExecBatch, dbQuery, toRecords } from '../wails';

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly statements: readonly string[];
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'initial app state',
    statements: [
      // --- repository inventory -------------------------------------------
      // `path` is the identity: two rows for the same directory would give the
      // dashboard duplicate entries that drift apart as they are opened.
      `CREATE TABLE repositories (
         id             INTEGER PRIMARY KEY,
         path           TEXT    NOT NULL UNIQUE,
         name           TEXT    NOT NULL,
         group_id       INTEGER REFERENCES repo_groups(id) ON DELETE SET NULL,
         is_favorite    INTEGER NOT NULL DEFAULT 0,
         last_opened_at INTEGER,
         added_at       INTEGER NOT NULL
       )`,
      // The dashboard's default ordering.
      `CREATE INDEX idx_repositories_last_opened ON repositories(last_opened_at DESC)`,

      `CREATE TABLE repo_groups (
         id         INTEGER PRIMARY KEY,
         name       TEXT    NOT NULL UNIQUE,
         sort_order INTEGER NOT NULL DEFAULT 0
       )`,

      // --- UI state --------------------------------------------------------
      // Layout percentages and preferences are both key/value with a JSON
      // payload: their shape belongs to the component that owns them, and
      // giving each pane a column would mean a migration per layout change.
      `CREATE TABLE layout_state (
         key        TEXT    PRIMARY KEY,
         value      TEXT    NOT NULL,
         updated_at INTEGER NOT NULL
       )`,

      `CREATE TABLE preferences (
         key        TEXT    PRIMARY KEY,
         value      TEXT    NOT NULL,
         updated_at INTEGER NOT NULL
       )`,

      // One row, enforced by the CHECK — a window has one position.
      `CREATE TABLE window_state (
         id        INTEGER PRIMARY KEY CHECK (id = 1),
         x         INTEGER,
         y         INTEGER,
         width     INTEGER NOT NULL,
         height    INTEGER NOT NULL,
         maximized INTEGER NOT NULL DEFAULT 0
       )`,

      // --- commit authoring -----------------------------------------------
      `CREATE TABLE commit_templates (
         id         INTEGER PRIMARY KEY,
         name       TEXT    NOT NULL,
         body       TEXT    NOT NULL,
         sort_order INTEGER NOT NULL DEFAULT 0
       )`,

      // Scoped per repository: "the message I used last" is only useful in the
      // repository it was written for.
      `CREATE TABLE recent_messages (
         id      INTEGER PRIMARY KEY,
         repo_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
         message TEXT    NOT NULL,
         used_at INTEGER NOT NULL
       )`,
      `CREATE INDEX idx_recent_messages_repo ON recent_messages(repo_id, used_at DESC)`,
    ],
  },
];

/** The version the code expects; `migrate()` brings any database up to it. */
export const TARGET_VERSION = MIGRATIONS.reduce(
  (highest, migration) => Math.max(highest, migration.version),
  0,
);

export async function currentVersion(): Promise<number> {
  const result = await dbQuery('PRAGMA user_version');
  const rows = toRecords<{ user_version: number }>(result);
  return Number(rows[0]?.user_version ?? 0);
}

export interface MigrationOutcome {
  readonly from: number;
  readonly to: number;
  readonly applied: readonly string[];
}

/**
 * Bring the database up to `TARGET_VERSION`.
 *
 * Each migration runs as one transaction (`dbExecBatch`), so a failure part way
 * through leaves the database at its previous version rather than half
 * migrated. `PRAGMA user_version` is set inside that same batch, which is what
 * makes "applied" and "recorded as applied" the same event.
 *
 * Unlike the git layer, this throws. A schema that will not migrate is a
 * broken installation, not a condition the user can act on — the app should
 * fail loudly at startup rather than run against a database it does not
 * understand.
 */
export async function migrate(): Promise<MigrationOutcome> {
  const from = await currentVersion();

  if (from > TARGET_VERSION) {
    throw new Error(
      `database is at version ${from} but this build only knows ${TARGET_VERSION} — ` +
        'it was written by a newer version of moonGit',
    );
  }

  const applied: string[] = [];
  for (const migration of MIGRATIONS) {
    if (migration.version <= from) continue;

    await dbExecBatch([
      ...migration.statements.map((sql) => ({ sql })),
      // Not parameterisable — PRAGMA takes a literal. The value is a number
      // from this file, never user input.
      { sql: `PRAGMA user_version = ${migration.version}` },
    ]);
    applied.push(`${migration.version}: ${migration.name}`);
  }

  return { from, to: TARGET_VERSION, applied };
}

/** Test-only: drop everything and re-migrate. Never called by the app. */
export async function resetDatabase(): Promise<void> {
  const tables = toRecords<{ name: string }>(
    await dbQuery(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    ),
  );
  for (const table of tables) {
    await dbExec(`DROP TABLE IF EXISTS "${table.name}"`);
  }
  await dbExec('PRAGMA user_version = 0');
  await migrate();
}
