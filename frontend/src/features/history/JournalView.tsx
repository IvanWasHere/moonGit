import { useMemo, useState } from 'react';
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
import { CommitGraph } from './CommitGraph';
import { buildGraph } from './graph';
import styles from './History.module.css';

/**
 * Commit history from `git log` (ui-example L633–659).
 *
 * Capped at 200 for now. The virtualized list the PRD wants is Phase 7 work —
 * `CommitService.list` already streams, so the cap is a rendering decision
 * rather than a data one, and lifting it is a change to this component only.
 */
const PAGE_SIZE = 200;

export function JournalView() {
  const repoPath = useWorkspaceStore((state) => state.repoPath);
  const selectedCommit = useWorkspaceStore((state) => state.selectedCommit);
  const selectCommit = useWorkspaceStore((state) => state.selectCommit);
  const logPath = useWorkspaceStore((state) => state.logPath);
  const setLogPath = useWorkspaceStore((state) => state.setLogPath);
  const logAll = useWorkspaceStore((state) => state.logAll);
  const {
    data: commits,
    isPending,
    error,
  } = useLog(repoPath, {
    maxCount: PAGE_SIZE,
    // Topological, so a branch's commits stay together and the graph's lanes
    // do not zig-zag between branches that happen to interleave by date.
    topoOrder: true,
    // `--all` is a revision as far as git is concerned, so it goes where the
    // revisions go rather than becoming a flag of its own.
    ...(logAll && { revisions: ['--all'] }),
    ...(logPath !== null && { paths: [logPath] }),
  });

  // Lane assignment is cheap for a page of commits — a few hundred rows of an
  // O(commits × lanes) walk. Whether it needs a Worker is a question for the
  // full history (PLAN.md §10), and one to answer with a measurement.
  const graph = useMemo(() => buildGraph(commits ?? []), [commits]);

  // One menu at a time, held here rather than per row.
  const [menu, setMenu] = useState<{ commit: Commit; x: number; y: number } | null>(null);
  const runCommitAction = useCommitMenuActions(repoPath);

  if (repoPath === null) {
    return (
      <PanelBody>
        <EmptyState icon={Icons.Journal} message="Select a repository to view journal" />
      </PanelBody>
    );
  }
  if (error !== null) {
    return (
      <PanelBody>
        <EmptyState icon={Icons.Abort} message={error.message} />
      </PanelBody>
    );
  }
  if (isPending) {
    return (
      <PanelBody>
        <EmptyState icon={Icons.Sync} message="Reading history…" />
      </PanelBody>
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
      <PanelBody>
        {banner}
        <EmptyState
          icon={Icons.Journal}
          message={logPath === null ? 'No commits yet' : 'No commits touched this file'}
        />
      </PanelBody>
    );
  }

  return (
    <PanelBody>
      {banner}
      {commits.map((commit, index) => (
        <div
          key={commit.oid}
          className={`${styles.entry} ${selectedCommit === commit.oid ? styles.selected : ''}`}
          onClick={() => selectCommit(commit.oid)}
          onContextMenu={(event) => {
            event.preventDefault();
            // Select as well as open: every action is about this commit, and
            // leaving the selection elsewhere is disorienting.
            selectCommit(commit.oid);
            setMenu({ commit, x: event.clientX, y: event.clientY });
          }}
        >
          {graph.rows[index] !== undefined && (
            <CommitGraph row={graph.rows[index]} lanes={graph.lanes} />
          )}
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
                    className={`${styles.ref} ${decoration.kind === 'tag' ? styles.refTag : ''} ${
                      decoration.isHead ? styles.refHead : ''
                    }`}
                  >
                    {decoration.shortName}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
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
  );
}
