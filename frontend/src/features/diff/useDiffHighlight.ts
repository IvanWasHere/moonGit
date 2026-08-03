/**
 * Syntax tokens for both sides of one file's diff.
 *
 * The two sides come from different places, and which place depends on what is
 * being diffed:
 *
 * - Anything git has an object for is read with `cat-file` and cached forever,
 *   because an object id names one sequence of bytes for all time.
 * - The **working-tree side of an unstaged diff has no object** — the file has
 *   not been hashed — so it is read off disk instead. Verified: `git diff
 *   --raw` prints an all-zero destination id for a modified, unstaged file.
 *
 * Everything here degrades to "no highlighting" rather than to an error. A
 * file we cannot colour still renders as a diff, and a red banner over a
 * perfectly readable patch would be a worse outcome than plain text.
 */

import { useQuery } from '@tanstack/react-query';
import { blobService, isNullOid, type DiffFile } from '@/services/git';
import { readFile } from '@/services/wails';
import { useSettingsStore } from '@/stores/settingsStore';
import { highlightFile, type SyntaxLines } from './highlight';
import { languageForPath } from './languages';

/**
 * Files above this are not highlighted.
 *
 * 512 KB is far past any hand-written source file and well short of the
 * generated ones — a bundle or a lockfile diffs fine, it just stays grey. The
 * cost being avoided is not the tokenizer so much as moving the whole file
 * across the Wails bridge to colour a three-line change.
 */
export const MAX_BLOB_BYTES = 512 * 1024;

export interface DiffHighlight {
  /** Tokens for the old file, indexed by `oldLineNo - 1`. */
  readonly old: SyntaxLines | null;
  /** Tokens for the new file, indexed by `newLineNo - 1`. */
  readonly next: SyntaxLines | null;
}

const NOTHING: DiffHighlight = { old: null, next: null };

/** The new side comes off disk exactly when git has no object for it. */
function readsFromDisk(file: DiffFile): boolean {
  return isNullOid(file.newOid) && file.kind !== 'deleted';
}

async function blobText(
  repoPath: string,
  oid: string,
  signal: AbortSignal,
): Promise<string | null> {
  if (isNullOid(oid)) return null;
  const result = await blobService(repoPath).text(oid, MAX_BLOB_BYTES, { signal });
  return result.ok ? result.value : null;
}

async function diskText(path: string): Promise<string | null> {
  try {
    const content = await readFile(path);
    // Binary and truncated reads both arrive with no `text`, so this one check
    // covers every case we cannot colour.
    if (content.isBinary || content.truncated || content.size > MAX_BLOB_BYTES) return null;
    return content.text ?? null;
  } catch {
    // The file moved or vanished between the diff and this read. Not an error
    // worth showing — the diff above it is still perfectly valid.
    return null;
  }
}

export function useDiffHighlight(repoPath: string | null, file: DiffFile | null): DiffHighlight {
  const language = file === null ? null : languageForPath(file.path);
  const enabled = repoPath !== null && repoPath !== '' && file !== null && language !== null;
  const fromDisk = file !== null && readsFromDisk(file);

  /*
   * The resolved theme is part of the cache key, not just an argument.
   *
   * Shiki bakes colours into the tokens it returns, so a run tokenized in dark
   * is a *different value*, not the same value rendered differently. Without
   * this the diff would keep serving dark hex colours after a switch to light
   * and the code would stay unreadable until the file was reselected.
   */
  const theme = useSettingsStore((state) => state.resolved);

  const query = useQuery({
    /**
     * Both sides in one entry — they are always wanted together, and a single
     * entry cannot show a half-updated pair.
     *
     * The disk-backed variant is deliberately keyed *under* `fileText`, so the
     * watcher's existing invalidation for that prefix (`queries/keys.ts`)
     * reaches it. Its object id is all zeros and never changes, so without
     * that this query would happily serve tokens for the previous save.
     */
    queryKey: fromDisk
      ? [repoPath ?? '', 'fileText', file.path, 'highlight', file.oldOid, language ?? '', theme]
      : [
          repoPath ?? '',
          'highlight',
          file?.oldOid ?? '',
          file?.newOid ?? '',
          file?.path ?? '',
          language ?? '',
          theme,
        ],
    queryFn: async ({ signal }): Promise<DiffHighlight> => {
      if (repoPath === null || file === null || language === null) return NOTHING;

      const [oldText, newText] = await Promise.all([
        blobText(repoPath, file.oldOid, signal),
        readsFromDisk(file)
          ? diskText(`${repoPath}/${file.path}`)
          : blobText(repoPath, file.newOid, signal),
      ]);

      const [old, next] = await Promise.all([
        oldText === null ? null : highlightFile(oldText, language, theme),
        newText === null ? null : highlightFile(newText, language, theme),
      ]);
      return { old, next };
    },
    enabled,
    // Content-addressed on both sides; the disk-backed one is invalidated by
    // the watcher instead. Either way there is nothing to poll for.
    staleTime: Infinity,
    retry: false,
  });

  return query.data ?? NOTHING;
}

/** Whether a path is one we could colour at all — cheap, no I/O. */
export function isHighlightable(path: string): boolean {
  return languageForPath(path) !== null;
}
