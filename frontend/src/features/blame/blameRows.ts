import type { Blame, BlameCommit, BlameLine } from '@/services/git';

/**
 * One rendered line of a blame, and whether it begins a new run.
 *
 * git reports a commit for *every* line. Drawn literally, a file edited in
 * blocks shows the same hash, author and date repeated down forty consecutive
 * rows, and the eye cannot find where authorship actually changes — which is
 * the only question a blame view exists to answer. `startsRun` marks the rows
 * that draw metadata; the rest leave those columns blank, so every label on
 * screen is a boundary.
 */
export interface BlameRow {
  readonly line: BlameLine;
  readonly commit: BlameCommit | undefined;
  readonly startsRun: boolean;
}

/**
 * Flatten a blame into rows, marking where the owning commit changes.
 *
 * Its own module rather than a helper inside the component: it is the only
 * logic in the view, and it is the kind that looks obviously right and is off
 * by one. The first line always starts a run — there is nothing above it to
 * continue from — which is the case worth stating because `previous` starting
 * as `null` is what makes it true, not an explicit branch.
 */
export function toBlameRows(blame: Blame): BlameRow[] {
  let previous: string | null = null;
  return blame.lines.map((line) => {
    const startsRun = line.oid !== previous;
    previous = line.oid;
    return { line, commit: blame.commits.get(line.oid), startsRun };
  });
}
