/**
 * Filtering the lists the app already holds in memory — branches, remote
 * branches, working-tree files.
 *
 * These need no git command, so the only real decision is how forgiving the
 * match is. Plain substring is too strict for paths: typing `git log` to find
 * `services/git/parsers/log.ts` fails on the space, and typing the full path
 * defeats the point. Full fuzzy matching is too loose — every list stays
 * non-empty, and a filter that never says "nothing" is one you stop trusting.
 *
 * The middle is **substring per space-separated term, ANDed**. `git log`
 * matches `services/git/parsers/log.ts` and not `services/git/GitRunner.ts`,
 * which is what people expect from a filter box without being told.
 */

/** Case-insensitive; every whitespace-separated term must appear somewhere. */
export function matchesFilter(haystack: string, filter: string): boolean {
  const terms = filter
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term !== '');
  if (terms.length === 0) return true;
  const target = haystack.toLowerCase();
  return terms.every((term) => target.includes(term));
}

/**
 * Filter a list by one or more fields of each item.
 *
 * Fields are joined before matching rather than tested one at a time, so a
 * query can span them — `feat origin` finds `origin/feature/search` when the
 * remote name and the branch name are separate fields.
 */
export function filterBy<T>(
  items: readonly T[],
  filter: string | null,
  fields: (item: T) => readonly (string | undefined)[],
): T[] {
  if (filter === null || filter.trim() === '') return [...items];
  return items.filter((item) =>
    matchesFilter(
      fields(item)
        .filter((field): field is string => field !== undefined)
        .join(' '),
      filter,
    ),
  );
}
