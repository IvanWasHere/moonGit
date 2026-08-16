import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { Icons } from '@/components/icons';
import { PanelBody } from '@/components/Panel';
import { VirtualList } from '@/components/VirtualList';
import { useLogPages } from '@/queries/git';
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
 * - **`PanelBody` is the scroll element**, not a container of our own. It is
 *   the only scrolling element in a panel, which is what keeps the header
 *   pinned; a second scroller nested inside it would scroll the header away.
 *
 * **Paged, not capped.** 200 commits is now a page rather than a ceiling;
 * scrolling toward the end fetches the next one with `--skip`. That is viable
 * only because of the commit-graph (PLAN.md §10, 7.1) — without generation
 * numbers every page re-walks the entire history, so page 500 costs what page
 * 1 costs and paging buys nothing but latency.
 */
const PAGE_SIZE = 200;

/**
 * How close to the end of the loaded rows the window gets before the next page
 * is requested.
 *
 * Half a screenful or so. Large enough that the fetch is usually finished
 * before the user reaches the bottom, and small enough that idly scrolling a
 * few rows does not pull a page nobody was going to read. It is deliberately
 * expressed in rows rather than pixels: rows are what the virtualizer counts,
 * and a pixel threshold would mean something different for a Journal full of
 * tagged commits than for one without.
 */
const PREFETCH_ROWS = 25;

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
    data,
    isPending,
    error,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useLogPages(repoPath, {
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
   * Every page so far, as one list.
   *
   * Flattened here rather than in the hook because the graph, the virtualizer
   * and the row renderer all want a single contiguous walk — page boundaries
   * are an artefact of how the commits were fetched and mean nothing to any of
   * them. Lane assignment in particular would be wrong if it restarted per
   * page: a branch open across a boundary would be given a new lane on the
   * other side of it.
   */
  const commits = useMemo(() => data?.pages.flat(), [data]);

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

  /*
   * The scrolling element, kept twice on purpose.
   *
   * `VirtualList` needs it in state, so that attaching it re-renders and the
   * virtualizer resolves it on a second pass — see that component for why a
   * plain ref renders an empty list. The scroll reset below needs it in a ref,
   * because assigning `scrollTop` on a value held in state is a mutation of
   * state as far as the lint rules are concerned. One callback ref feeds both.
   */
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const attachScroll = useCallback((element: HTMLDivElement | null) => {
    scrollRef.current = element;
    setScrollEl(element);
  }, []);
  const rows = commits ?? [];

  /*
   * Back to the top whenever the list stops being the same list.
   *
   * The virtualizer keeps the scroll offset across a `count` change, which is
   * right for appending a page and wrong for everything here: a new search, a
   * File Log filter, or a different repository replaces the contents outright.
   * Left alone, narrowing a search from a scrolled position lands you somewhere
   * arbitrary in the results, or past the end of them and looking at nothing.
   */
  const listIdentity = `${repoPath ?? ''} ${logQuery ?? ''} ${logPath ?? ''} ${logAll}`;
  useEffect(() => {
    // Assigning `scrollTop` rather than calling `scrollTo`: the two are the
    // same instant jump, and this one exists in jsdom, which is what lets the
    // reset be covered rather than taken on trust.
    if (scrollRef.current !== null) scrollRef.current.scrollTop = 0;
  }, [listIdentity]);

  /*
   * `VirtualList` calls this for as long as the window sits near the end, so
   * the guards are what stop it queueing a fetch per scroll frame.
   * `fetchNextPage` is itself safe to call again while one is in flight.
   */
  const loadMore = useCallback(() => {
    if (!hasNextPage || isFetchingNextPage) return;
    void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

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

  if (rows.length === 0) {
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
      <SearchBar matched={rows.length} hasMore={hasNextPage} />
      <PanelBody ref={attachScroll}>
        {banner}
        <VirtualList
          items={rows}
          scrollElement={scrollEl}
          getKey={(commit) => commit.oid}
          estimateHeight={estimateRowHeight}
          overscan={OVERSCAN}
          onEndReached={loadMore}
          endThreshold={PREFETCH_ROWS}
          renderRow={(commit, index) => {
            const row = graph?.rows[index];
            return (
              <div
                className={`${styles.entry} ${
                  selectedCommit === commit.oid ? styles.selected : ''
                }`}
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
          }}
        />
        {/*
         * Below the spacer, not inside it: the virtualizer owns every offset in
         * there, and an extra child would be positioned at zero and land on top
         * of the first commit.
         *
         * Shown only while a page is actually in flight. A permanent "scroll
         * for more" would be on screen for the entire life of a large
         * repository and would say nothing, since scrolling is how lists work.
         */}
        {isFetchingNextPage && (
          <div className={styles.pageLoading}>
            <Icons.Sync size={11} />
            Loading more commits…
          </div>
        )}
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
