/**
 * Everything the merge modal needs for one conflicted file.
 *
 * The three sides come straight out of the index: `status --porcelain=v2`
 * reports an unmerged path with its three stage hashes — 1 base, 2 ours,
 * 3 theirs — and each is an ordinary blob. No parsing of conflict markers is
 * involved anywhere, which matters: the markers in the working-tree file are
 * git's *rendering* of the conflict, and a user who has already edited that
 * file would have broken them. The stages cannot be edited by accident.
 *
 * A missing stage is a real case, not an error. Both sides adding the same
 * path have no base; a modify/delete conflict is missing ours or theirs. Each
 * absent stage becomes an empty side, which is exactly what it means.
 */

import { useQuery } from '@tanstack/react-query';
import { blobService, diffService, isNullOid, type StatusEntry } from '@/services/git';
import { buildRegions, editsFromHunks, toLines, type MergeRegion } from './threeWay';

/** Same ceiling as the diff viewer's highlighting: past this it is not a file to merge by hand. */
const MAX_MERGE_BYTES = 512 * 1024;

export interface MergeFile {
  readonly path: string;
  readonly regions: readonly MergeRegion[];
  /** Present when the file was too large, binary, or otherwise unmergeable here. */
  readonly problem: string | null;
}

async function stageText(
  repoPath: string,
  oid: string,
  signal: AbortSignal,
): Promise<string | null> {
  if (isNullOid(oid)) return '';
  const result = await blobService(repoPath).text(oid, MAX_MERGE_BYTES, { signal });
  if (!result.ok) return null;
  return result.value;
}

export function useMergeFile(repoPath: string | null, entry: StatusEntry | null) {
  const stages = entry?.stages;

  return useQuery({
    queryKey: [repoPath ?? '', 'merge', entry?.path ?? '', ...(stages?.hashes ?? [])],
    queryFn: async ({ signal }): Promise<MergeFile> => {
      if (repoPath === null || entry === null || stages === undefined) {
        throw new Error('no conflicted file selected');
      }
      const [base, ours, theirs] = stages.hashes;

      const texts = await Promise.all([
        stageText(repoPath, base, signal),
        stageText(repoPath, ours, signal),
        stageText(repoPath, theirs, signal),
      ]);
      if (texts.some((text) => text === null)) {
        return {
          path: entry.path,
          regions: [],
          problem: `${entry.path} is binary or too large to merge here`,
        };
      }
      const [baseText] = texts as [string, string, string];

      // Both sides diffed against the base, so their hunks share a coordinate
      // system and can be laid over one another. `context: 0` keeps
      // independent edits from growing until they touch (see threeWay.ts).
      const diffs = diffService(repoPath);
      const [ourDiff, theirDiff] = await Promise.all([
        isNullOid(ours) ? null : diffs.blobs(base, ours, { context: 0, signal }),
        isNullOid(theirs) ? null : diffs.blobs(base, theirs, { context: 0, signal }),
      ]);

      const hunksOf = (result: Awaited<ReturnType<typeof diffs.blobs>> | null) =>
        result !== null && result.ok ? (result.value[0]?.hunks ?? []) : [];

      return {
        path: entry.path,
        regions: buildRegions(
          toLines(baseText),
          editsFromHunks(hunksOf(ourDiff)),
          editsFromHunks(hunksOf(theirDiff)),
        ),
        problem: null,
      };
    },
    enabled: repoPath !== null && entry !== null && stages !== undefined,
    // Stage blobs are immutable; the query key changes if the index does.
    staleTime: Infinity,
    retry: false,
  });
}
