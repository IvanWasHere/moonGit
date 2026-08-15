/**
 * Where the Journal's next page starts, or that there isn't one.
 *
 * Separated from `useLogPages` for the same reason `nextTuning` is separated
 * from the status query: this is the part with a decision in it, and a
 * decision should be assertable without a git process, a React tree or a
 * clock. Getting it wrong is quiet — an off-by-one repeats a commit at every
 * page boundary, and a wrong end condition either stops the history early or
 * fetches empty pages forever.
 *
 * The cursor is an offset for `--skip`, counted from what has already arrived
 * rather than from `pages.length * pageSize`. Those are the same number while
 * every page is full, and they stop being the same the moment one is not —
 * multiplying would then skip over the commits the short page did not return.
 */
export function nextLogPageParam(
  pages: readonly (readonly unknown[])[],
  pageSize: number | undefined,
): number | undefined {
  const last = pages[pages.length - 1];
  if (last === undefined) return undefined;

  /*
   * With no page size there is no page after the first: the query asked for
   * the whole history and got it. Returning an offset here would page forever
   * through a list that has no more to give.
   */
  if (pageSize === undefined) return undefined;

  // A short page is the end of the history. Asking git for a count instead
  // would be a second full walk to learn a number the last page reveals for
  // free — and `rev-list --count` over a million commits is exactly the
  // unbounded walk this phase exists to avoid.
  if (last.length < pageSize) return undefined;

  return pages.reduce((total, page) => total + page.length, 0);
}
