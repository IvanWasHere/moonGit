/**
 * What a merge would do, before it does it.
 *
 * The whole question is answered by two commit counts, and the counts come
 * from ranges git already understands:
 *
 *     HEAD..<ref>   commits the ref has that we do not   (incoming)
 *     <ref>..HEAD   commits we have that the ref does not (outgoing)
 *
 * - No incoming → already up to date; the merge would do nothing.
 * - Incoming but no outgoing → HEAD is an ancestor, so this fast-forwards.
 * - Both → the branches diverged and a merge commit is needed.
 *
 * This is worth showing rather than letting the user find out afterwards: the
 * difference between a fast-forward and a merge commit is the difference
 * between a linear history and a bubble, and it is invisible until it is done.
 */

export type MergeShape = 'upToDate' | 'fastForward' | 'mergeCommit';

export interface MergePreview {
  readonly shape: MergeShape;
  readonly incoming: number;
  readonly outgoing: number;
  /** True when the count hit the query's ceiling and is a floor, not a total. */
  readonly incomingCapped: boolean;
}

/** How many incoming commits to fetch. Enough to list; the count says "N+" past it. */
export const PREVIEW_LIMIT = 50;

export function previewOf(incoming: number, outgoing: number): MergePreview {
  const shape: MergeShape =
    incoming === 0 ? 'upToDate' : outgoing === 0 ? 'fastForward' : 'mergeCommit';
  return {
    shape,
    incoming,
    outgoing,
    incomingCapped: incoming >= PREVIEW_LIMIT,
  };
}

/**
 * Whether `--ff-only` can succeed.
 *
 * Offering it on a diverged branch would produce git's `hint: Diverging
 * branches can't be fast-forwarded` and exit 128 — an error for a choice the
 * UI should never have let the user make.
 */
export function canFastForwardOnly(preview: MergePreview): boolean {
  return preview.shape !== 'mergeCommit';
}

/** The default merge message git would write, so the field starts where git would. */
export function defaultMergeMessage(ref: string, into: string | null): string {
  return into === null ? `Merge ${ref}` : `Merge ${ref} into ${into}`;
}
