import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { EmptyState } from '@/components/EmptyState';
import { Icons } from '@/components/icons';
import { PanelBody } from '@/components/Panel';
import { useLog } from '@/queries/git';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { timeAgo } from '@/utils/format';
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from '@/components/ContextMenu';
import type { Commit } from '@/services/git';
import { commitMenuFor } from './commitMenu';
import { useCommitMenuActions } from './useCommitMenuActions';
import { SearchBar } from '@/features/search/SearchBar';
import { parseCommitQuery, toLogParams } from '@/features/search/commitQuery';
import { CommitGraph } from './CommitGraph';
import { buildGraph } from './graph';
import { estimateRowHeight } from './rowHeight';
import styles from './History.module.css';

/**
 * Commit history from `git log` (ui-example L633–659).
 *
 * **Virtualized** (PLAN.md §10). The list renders only the rows in view plus
 * `OVERSCAN`, so the DOM holds a screenful however long the history is. Three
 * things about how, because each was a choice rather than the obvious default:
 *
 * - **Rows are measured, not assumed.** `estimateSize` is only a starting
 *   guess; every row that renders reports its real height back through
 *   `measureElement`. A fixed row height would be simpler and faster, and it
 *   would mean truncating ref decorations — which `CommitGraph` is explicitly
 *   built to avoid, its SVG stretching to whatever the row turned out to be.
 * - **The positioning goes on `.entry` itself**, not on a wrapper around it.
 *   One node per row rather than two, in the one list where the node count is
 *   the entire point.
 * - **`PanelBody` is the scroll element**, not a container of our own. It is
 *   the only scrolling element in a panel, which is what keeps the header
 *   pinned; a second scroller nested inside it would scroll the header away.
 *
 * The cap stays for now at the same 200 — this change is the rendering half,
 * and `--skip` paging is the data half still to come. What has changed is that
 * the cap is no longer *load-bearing*: raising it now costs DOM nothing.
 */
const PAGE_SIZE = 200;

/**
 * Rows rendered beyond the viewport, above and below.
 *
 * Enough that a flick-scroll on a trackpad does not outrun the renderer and
 * show blank space, and few enough that the DOM stays small. Journal rows are
 * cheap — a handful of spans and one small SVG — so this can be generous
 * without costing much.
 */
const OVERSCAN = 12;

export function JournalView() {
  const repoPath = useWorkspaceStore((state) => state.repoPath);
  const selectedCommit = useWorkspaceStore((state) => state.selectedCommit);
  const selectCommit = useWorkspaceStore((state) => state.selectCommit);
  const logPath = useWorkspaceStore((state) => state.logPath);
  const setLogPath = useWorkspaceStore((state) => state.setLogPath);
  const logAll = useWorkspaceStore((state) => state.logAll);
  const logQuery = useWorkspaceStore((state) => state.logQuery);

  const query = useMemo(() => parseCommitQuery(logQuery ?? ''), [logQuery]);
  const search = useMemo(() => toLogParams(query), [query]);

  /*
   * A search's pathspec and the File Log's path are the same argument to git,
   * so they concatenate rather than override — `path:test` inside a file log
   * narrows it further, which is the only reading that is not a silent
   * discard of one of the two.
   */
  const paths = [...(logPath === null ? [] : [logPath]), ...(search.paths ?? [])];

  const {
    data: commits,
    isPending,
    error,
  } = useLog(repoPath, {
    maxCount: PAGE_SIZE,
    // Topological, so a branch's commits stay together and the graph's lanes
    // do not zig-zag between branches that happen to interleave by date.
    topoOrder: true,
    // A search that only looked at the current branch would miss the commit
    // being hunted for whenever it is on another one — which is most of the
    // time, or the user would already know where it was.
    ...(logAll || !query.isEmpty ? { revisions: ['--all'] } : {}),
    ...search,
    ...(paths.length > 0 && { paths }),
  });

  /*
   * Lane assignment is cheap for a page of commits — a few hundred rows of an
   * O(commits × lanes) walk. Whether it needs a Worker is a question for the
   * full history (PLAN.md §10), and one to answer with a measurement.
   *
   * **Not drawn for a filtered log.** The graph's input is a contiguous walk;
   * given a filtered set almost no commit's parent is present, so every row
   * becomes a branch tip, opens its own lane, and the result is a staircase
   * that widens by one column per result. That is not a graph of anything.
   */
  const isFiltered = !query.isEmpty || logPath !== null;
  const graph = useMemo(
    () => (isFiltered ? null : buildGraph(commits ?? [])),
    [commits, isFiltered],
  );

  // One menu at a time, held here rather than per row.
  const [menu, setMenu] = useState<{ commit: Commit; x: number; y: number } | null>(null);
  const runCommitAction = useCommitMenuActions(repoPath);

  const scrollRef = useRef<HTMLDivElement>(null);
  const rows = commits ?? [];
  /*
   * `react-hooks/incompatible-library` warns that the React Compiler cannot
   * memoize what this returns — the virtualizer hands back functions whose
   * results change without their arguments changing, which is the whole
   * mechanism of reading a live scroll position.
   *
   * Suppressed rather than worked around because the compiler is not enabled
   * in this build (`vite.config.ts` uses the plain React plugin), so the
   * warning describes a hazard that does not exist yet. It is left as a marker:
   * whoever turns the compiler on needs to opt this component out with a
   * `'use no memo'` directive, and will find this comment when the warning
   * comes back as an error.
   */
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => estimateRowHeight(rows[index]),
    /*
     * Cache measured heights against the commit, not the row number.
     *
     * The default key is the index, and the index is not stable here: turning
     * on `--all`, running a search or filtering to a file replaces what sits
     * at every position. A tall decorated commit at index 3 would leave its
     * 74px behind for whatever undecorated 55px commit replaced it, and the
     * list would lay out with 19px gaps and overlaps until each row happened
     * to be re-measured.
     *
     * The oid is the right key for the same reason it is the React key: a
     * commit's height is a property of the commit.
     */
    getItemKey: (index) => rows[index]?.oid ?? index,
    /*
     * `measureElement` is left as virtual-core's own, which reads
     * `offsetHeight` and is therefore an integer. That is only safe because
     * Journal rows are whole pixels by construction — see the note on
     * `.entry` in `History.module.css`, which is what makes the rounding a
     * no-op rather than a hairline gap under every row.
     *
     * Overriding it to measure fractionally was tried and is worse: the
     * fractional rect and the row's settled height disagree by two to three
     * pixels, so rows overlap outright instead of being a fifth of a pixel
     * apart. Integral rows are the fix; sub-pixel measurement is not.
     */
    overscan: OVERSCAN,
  });

  /*
   * Back to the top whenever the list stops being the same list.
   *
   * The virtualizer keeps the scroll offset across a `count` change, which is
   * right for appending a page and wrong for everything here: a new search, a
   * File Log filter, or a different repository replaces the contents outright.
   * Left alone, narrowing a search from a scrolled position lands you somewhere
   * arbitrary in the results, or past the end of them and looking at nothing.
   */
  const listIdentity = `${repoPath ?? ''} ${logQuery ?? ''} ${logPath ?? ''} ${logAll}`;
  useEffect(() => {
    // Assigning `scrollTop` rather than calling `scrollTo`: the two are the
    // same instant jump, and this one exists in jsdom, which is what lets the
    // reset be covered rather than taken on trust.
    if (scrollRef.current !== null) scrollRef.current.scrollTop = 0;
  }, [listIdentity]);

  if (repoPath === null) {
    return (
      <PanelBody>
        <EmptyState icon={Icons.Journal} message="Select a repository to view journal" />
      </PanelBody>
    );
  }
  /*
   * The search bar sits above every state below, not just the successful one.
   * A query that matches nothing renders an empty Journal, and that is exactly
   * the moment the box has to still be on screen to be corrected or closed.
   */
  if (error !== null) {
    return (
      <>
        <SearchBar />
        <PanelBody>
          <EmptyState icon={Icons.Abort} message={error.message} />
        </PanelBody>
      </>
    );
  }
  if (isPending) {
    return (
      <>
        <SearchBar />
        <PanelBody>
          <EmptyState icon={Icons.Sync} message="Reading history…" />
        </PanelBody>
      </>
    );
  }
  // The filter has to be visible and reversible. A journal quietly showing one
  // file's history reads as a repository with almost no commits in it.
  const banner =
    logPath === null ? null : (
      <div className={styles.filterBar}>
        <Icons.Filter size={11} />
        <span className={styles.filterPath}>{logPath}</span>
        <button type="button" className={styles.filterClear} onClick={() => setLogPath(null)}>
          Show all
        </button>
      </div>
    );

  if (commits.length === 0) {
    return (
      <>
        <SearchBar matched={0} />
        <PanelBody>
          {banner}
          <EmptyState icon={Icons.Journal} message={emptyMessage(query.isEmpty, logPath)} />
        </PanelBody>
      </>
    );
  }

  return (
    <>
      <SearchBar matched={commits.length} />
      <PanelBody ref={scrollRef}>
        {banner}
        {/*
         * The spacer. Its height is every row's — measured where they have
         * been, estimated where they have not — so the scrollbar reflects the
         * whole history rather than the dozen rows actually in the DOM.
         */}
        <div className={styles.viewport} style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const commit = rows[item.index];
            if (commit === undefined) return null;
            const row = graph?.rows[item.index];
            return (
              <div
                key={commit.oid}
                // Both are `measureElement`'s contract: it reads the index off
                // the node to know which row it just measured.
                data-index={item.index}
                ref={virtualizer.measureElement}
                className={`${styles.entry} ${styles.virtualRow} ${
                  selectedCommit === commit.oid ? styles.selected : ''
                }`}
                style={{ transform: `translateY(${item.start}px)` }}
                onClick={() => selectCommit(commit.oid)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  // Select as well as open: every action is about this commit, and
                  // leaving the selection elsewhere is disorienting.
                  selectCommit(commit.oid);
                  setMenu({ commit, x: event.clientX, y: event.clientY });
                }}
              >
                {row !== undefined && <CommitGraph row={row} lanes={graph?.lanes ?? 0} />}
                <div className={styles.entryBody}>
                  <div className={styles.head}>
                    <div className={styles.hash}>{commit.shortOid}</div>
                    <div className={styles.author}>{commit.author.name}</div>
                    <div className={styles.time}>{timeAgo(commit.author.date * 1000)}</div>
                  </div>
                  <div className={styles.message}>{commit.subject}</div>
                  {commit.decorations.length > 0 && (
                    <div className={styles.refs}>
                      {commit.decorations.map((decoration) => (
                        <span
                          key={decoration.name}
                          className={`${styles.ref} ${
                            decoration.kind === 'tag' ? styles.refTag : ''
                          } ${decoration.isHead ? styles.refHead : ''}`}
                        >
                          {decoration.shortName}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {menu !== null && (
          <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
            {commitMenuFor(menu.commit).map((entry, index) =>
              entry.kind === 'separator' ? (
                <ContextMenuSeparator key={`sep-${index}`} />
              ) : (
                <ContextMenuItem
                  key={entry.action}
                  label={entry.label}
                  onSelect={() => {
                    setMenu(null);
                    runCommitAction(menu.commit, entry.action);
                  }}
                />
              ),
            )}
          </ContextMenu>
        )}
      </PanelBody>
    </>
  );
}

/**
 * Why the Journal is empty.
 *
 * Three different situations render the same blank list, and "No commits yet"
 * over a repository with a thousand commits — because a search matched none of
 * them — is the kind of message that sends someone looking for a bug in git.
 */
function emptyMessage(queryIsEmpty: boolean, logPath: string | null): string {
  if (!queryIsEmpty) return 'No commits match this search';
  if (logPath !== null) return 'No commits touched this file';
  return 'No commits yet';
}
