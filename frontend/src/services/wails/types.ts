/**
 * Hand-written mirrors of the Go structs crossing the Wails bridge.
 *
 * These deliberately duplicate `wailsjs/go/models.ts` rather than re-exporting
 * it. The generated file is classes with constructors, is regenerated on every
 * build, and is Wails-v2 shaped. Owning plain interfaces here means the rest of
 * the app never sees generated code, and a Wails v2 → v3 migration only has to
 * keep this directory's exports stable (PLAN.md §1.1).
 *
 * Keep in sync with the `json:` tags on the Go structs under `internal/`.
 */

// --- gitexec -------------------------------------------------------------

export interface GitRunRequest {
  repoPath: string;
  args: string[];
  stdin?: string;
  env?: string[];
  timeoutMs?: number;
}

/**
 * Note the absence of an error field. A non-zero exitCode is an answer, not a
 * failure — `git merge` exits 1 on conflict, `git diff --quiet` exits 1 when
 * there are changes. Only a failure to spawn git rejects the promise.
 */
export interface GitRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
}

/** How streamed output is cut so a chunk never splits a record. */
export type GitDelimiter = 'nul' | 'lf' | 'raw';

export interface GitStreamRequest extends GitRunRequest {
  delimiter?: GitDelimiter;
  chunkSize?: number;
}

export interface GitStreamResult {
  stderr: string;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
  canceled: boolean;
  bytesOut: number;
  chunks: number;
}

export interface GitChunkEvent {
  runId: string;
  seq: number;
  data: string;
}

export interface GitInfo {
  path: string;
  version: string;
  available: boolean;
}

// --- watcher -------------------------------------------------------------

export type ChangeReason = 'worktree' | 'index' | 'refs' | 'head' | 'state';

export interface RepoChangeEvent {
  repoPath: string;
  reasons: ChangeReason[];
}

export interface WatchInfo {
  repoPath: string;
  dirs: number;
  /** True when the working tree was too large to watch and only .git is monitored. */
  degraded: boolean;
}

// --- fsapi ---------------------------------------------------------------

export interface FileContent {
  path: string;
  size: number;
  text?: string;
  base64?: string;
  isBinary: boolean;
  truncated: boolean;
}

export interface FileInfo {
  name: string;
  path: string;
  size: number;
  isDir: boolean;
  modTime: number;
  mode: string;
}

// --- store ---------------------------------------------------------------

export type SqlValue = string | number | boolean | null;

export interface QueryResult {
  columns: string[];
  rows: SqlValue[][];
}

export interface ExecResult {
  rowsAffected: number;
  lastInsertId: number;
}

export interface SqlStatement {
  sql: string;
  args?: SqlValue[];
}

export interface DBInfo {
  path: string;
  open: boolean;
  version: string;
  hasFts5: boolean;
  pageCount: number;
  sizeOnDisk: number;
  journalMode: string;
}

// --- dialogs -------------------------------------------------------------

export interface MessageOptions {
  kind: 'info' | 'warning' | 'error' | 'question';
  title: string;
  message: string;
  buttons?: string[];
  defaultButton?: string;
  cancelButton?: string;
}

// --- creds ---------------------------------------------------------------

export interface Secret {
  found: boolean;
  value?: string;
}

// --- app -----------------------------------------------------------------

export interface Environment {
  platform: string;
  arch: string;
  version: string;
}
