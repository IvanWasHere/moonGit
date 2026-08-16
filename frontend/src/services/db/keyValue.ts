/**
 * The two key/value tables — `preferences` and `layout_state` — plus window
 * geometry.
 *
 * Both hold JSON. A column per setting would mean a migration every time a
 * pane is added or a toggle appears, and the shape of a layout belongs to the
 * component that owns it, not to the schema. The cost is that reads are
 * unvalidated, so every getter takes a fallback and returns it when the stored
 * value is missing or unparseable — a preferences row corrupted by a crash
 * should reset one setting, not prevent the app from starting.
 */

import { dbExec, dbQuery, toRecords } from '../wails';
import { logger } from '@/services/log';

const log = logger('db');

type Table = 'preferences' | 'layout_state';

async function readJson<T>(table: Table, key: string, fallback: T): Promise<T> {
  const result = await dbQuery(`SELECT value FROM ${table} WHERE key = ?`, [key]);
  const raw = toRecords<{ value: string }>(result)[0]?.value;
  if (raw === undefined) return fallback;

  try {
    return JSON.parse(raw) as T;
  } catch {
    log.warn(`${table}.${key} holds unparseable JSON; using the default`);
    return fallback;
  }
}

async function writeJson(table: Table, key: string, value: unknown): Promise<void> {
  await dbExec(
    `INSERT INTO ${table} (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, JSON.stringify(value), Date.now()],
  );
}

// --- preferences ------------------------------------------------------------

export function getPreference<T>(key: string, fallback: T): Promise<T> {
  return readJson('preferences', key, fallback);
}

export function setPreference(key: string, value: unknown): Promise<void> {
  return writeJson('preferences', key, value);
}

export async function deletePreference(key: string): Promise<void> {
  await dbExec('DELETE FROM preferences WHERE key = ?', [key]);
}

// --- layout -----------------------------------------------------------------

export function getLayout<T>(key: string, fallback: T): Promise<T> {
  return readJson('layout_state', key, fallback);
}

export function setLayout(key: string, value: unknown): Promise<void> {
  return writeJson('layout_state', key, value);
}

// --- window geometry --------------------------------------------------------

export interface WindowState {
  readonly x: number | null;
  readonly y: number | null;
  readonly width: number;
  readonly height: number;
  readonly maximized: boolean;
}

export async function getWindowState(): Promise<WindowState | null> {
  const result = await dbQuery(
    'SELECT x, y, width, height, maximized FROM window_state WHERE id = 1',
  );
  const row = toRecords<{
    x: number | null;
    y: number | null;
    width: number;
    height: number;
    maximized: number;
  }>(result)[0];

  if (row === undefined) return null;
  return {
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    maximized: row.maximized === 1,
  };
}

export async function saveWindowState(state: WindowState): Promise<void> {
  await dbExec(
    `INSERT INTO window_state (id, x, y, width, height, maximized) VALUES (1, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       x = excluded.x, y = excluded.y,
       width = excluded.width, height = excluded.height,
       maximized = excluded.maximized`,
    [state.x, state.y, state.width, state.height, state.maximized ? 1 : 0],
  );
}
