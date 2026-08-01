/**
 * The repository inventory behind the Dashboard (PLAN.md §1.4).
 *
 * This is the one table with real domain meaning: which directories the user
 * has opened, what they called them, which are favourites, and when each was
 * last used. Everything git knows about those directories is asked of git.
 */

import { dbExec, dbQuery, toRecords, type SqlValue } from '../wails';

export interface RepositoryRecord {
  readonly id: number;
  readonly path: string;
  readonly name: string;
  readonly groupId: number | null;
  readonly isFavorite: boolean;
  readonly lastOpenedAt: number | null;
  readonly addedAt: number;
}

interface Row extends Record<string, SqlValue> {
  id: number;
  path: string;
  name: string;
  group_id: number | null;
  is_favorite: number;
  last_opened_at: number | null;
  added_at: number;
}

function toRepository(row: Row): RepositoryRecord {
  return {
    id: row.id,
    path: row.path,
    name: row.name,
    groupId: row.group_id,
    // SQLite has no boolean type; 0/1 crosses the bridge as a number.
    isFavorite: row.is_favorite === 1,
    lastOpenedAt: row.last_opened_at,
    addedAt: row.added_at,
  };
}

const SELECT = `SELECT id, path, name, group_id, is_favorite, last_opened_at, added_at
                FROM repositories`;

/** Most recently opened first; never-opened repositories sort last. */
export async function listRepositories(): Promise<RepositoryRecord[]> {
  const result = await dbQuery(
    `${SELECT} ORDER BY last_opened_at IS NULL, last_opened_at DESC, name COLLATE NOCASE`,
  );
  return toRecords<Row>(result).map(toRepository);
}

export async function findRepositoryByPath(path: string): Promise<RepositoryRecord | null> {
  const result = await dbQuery(`${SELECT} WHERE path = ?`, [path]);
  const row = toRecords<Row>(result)[0];
  return row === undefined ? null : toRepository(row);
}

/**
 * Record a repository, or return the existing row for that path.
 *
 * Adding a directory that is already known is the normal case — the user picks
 * it from a file dialog again — and it must not create a second row or reset
 * the name they gave it. `ON CONFLICT DO NOTHING` keeps the original.
 */
export async function addRepository(
  path: string,
  name: string,
  now: number = Date.now(),
): Promise<RepositoryRecord> {
  await dbExec(
    `INSERT INTO repositories (path, name, added_at) VALUES (?, ?, ?)
     ON CONFLICT(path) DO NOTHING`,
    [path, name, now],
  );

  const record = await findRepositoryByPath(path);
  if (record === null) {
    throw new Error(`failed to record repository at ${path}`);
  }
  return record;
}

/** Called when a repository is opened, so the dashboard's ordering means something. */
export async function touchRepository(id: number, now: number = Date.now()): Promise<void> {
  await dbExec('UPDATE repositories SET last_opened_at = ? WHERE id = ?', [now, id]);
}

export async function renameRepository(id: number, name: string): Promise<void> {
  await dbExec('UPDATE repositories SET name = ? WHERE id = ?', [name, id]);
}

export async function setFavorite(id: number, favorite: boolean): Promise<void> {
  await dbExec('UPDATE repositories SET is_favorite = ? WHERE id = ?', [favorite ? 1 : 0, id]);
}

export async function setRepositoryGroup(id: number, groupId: number | null): Promise<void> {
  await dbExec('UPDATE repositories SET group_id = ? WHERE id = ?', [groupId, id]);
}

/**
 * Forget a repository.
 *
 * Removes the row only — the directory on disk is never touched. "Remove from
 * the list" and "delete my work" must not be the same operation.
 */
export async function removeRepository(id: number): Promise<void> {
  await dbExec('DELETE FROM repositories WHERE id = ?', [id]);
}

// --- groups -----------------------------------------------------------------

export interface RepoGroup {
  readonly id: number;
  readonly name: string;
  readonly sortOrder: number;
}

export async function listGroups(): Promise<RepoGroup[]> {
  const result = await dbQuery(
    'SELECT id, name, sort_order FROM repo_groups ORDER BY sort_order, name COLLATE NOCASE',
  );
  return toRecords<{ id: number; name: string; sort_order: number }>(result).map((row) => ({
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
  }));
}

export async function createGroup(name: string, sortOrder = 0): Promise<void> {
  await dbExec('INSERT INTO repo_groups (name, sort_order) VALUES (?, ?)', [name, sortOrder]);
}

/** Repositories in the group fall back to ungrouped, they are not deleted. */
export async function deleteGroup(id: number): Promise<void> {
  await dbExec('DELETE FROM repo_groups WHERE id = ?', [id]);
}

// --- recent commit messages -------------------------------------------------

export async function recordCommitMessage(
  repoId: number,
  message: string,
  now: number = Date.now(),
): Promise<void> {
  if (message.trim() === '') return;
  await dbExec('INSERT INTO recent_messages (repo_id, message, used_at) VALUES (?, ?, ?)', [
    repoId,
    message,
    now,
  ]);
}

export async function recentCommitMessages(repoId: number, limit = 20): Promise<string[]> {
  const result = await dbQuery(
    `SELECT message FROM recent_messages WHERE repo_id = ?
     ORDER BY used_at DESC LIMIT ?`,
    [repoId, limit],
  );
  return toRecords<{ message: string }>(result).map((row) => row.message);
}
