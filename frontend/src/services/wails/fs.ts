import {
  Exists,
  HomeDir,
  ListDir,
  ReadFile,
  ReadFileBase64,
  Stat,
  WriteFile,
} from '../../../wailsjs/go/fsapi/Service';
import type { FileContent, FileInfo } from './types';

export function readFile(path: string): Promise<FileContent> {
  return ReadFile(path);
}

/** Raw bytes as base64 — for image diffs and anything handed to a data URI. */
export function readFileBase64(path: string): Promise<FileContent> {
  return ReadFileBase64(path);
}

/** Writes atomically via a temp file + rename, so a crash cannot truncate. */
export function writeFile(path: string, contents: string): Promise<void> {
  return WriteFile(path, contents);
}

export function statPath(path: string): Promise<FileInfo> {
  return Stat(path);
}

export function pathExists(path: string): Promise<boolean> {
  return Exists(path);
}

/** Entries sorted directories-first, then by name. */
export function listDir(path: string): Promise<FileInfo[]> {
  return ListDir(path);
}

export function homeDir(): Promise<string> {
  return HomeDir();
}
