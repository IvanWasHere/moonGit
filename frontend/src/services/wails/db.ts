import { Exec, ExecBatch, Info, Query } from '../../../wailsjs/go/store/Service';
import type { DBInfo, ExecResult, QueryResult, SqlStatement, SqlValue } from './types';

/**
 * SQLite access. Go owns the file handle; every statement, migration, and model
 * lives in TypeScript (PLAN.md §1.2).
 *
 * Arguments are always bound, never interpolated into the SQL string.
 */
export function dbQuery(sql: string, args: SqlValue[] = []): Promise<QueryResult> {
  return Query(sql, args);
}

export function dbExec(sql: string, args: SqlValue[] = []): Promise<ExecResult> {
  return Exec(sql, args);
}

/** Runs in one transaction, rolling back entirely on the first failure. */
export function dbExecBatch(statements: SqlStatement[]): Promise<ExecResult> {
  return ExecBatch(statements);
}

export function dbInfo(): Promise<DBInfo> {
  return Info();
}

/** Convenience: map a QueryResult into objects keyed by column name. */
export function toRecords<T extends Record<string, SqlValue>>(result: QueryResult): T[] {
  return result.rows.map((row) => {
    const record: Record<string, SqlValue> = {};
    result.columns.forEach((col, i) => {
      record[col] = row[i] ?? null;
    });
    return record as T;
  });
}
