import { useRef } from 'react';
import { Button } from '@/components/Button';
import { Icons } from '@/components/icons';
import { Panel, PanelAction, PanelHeader } from '@/components/Panel';
import { Resizer } from '@/components/Resizer';
import { RemoteBranchList } from '@/features/branches/RemoteBranchList';
import { DiffPane } from '@/features/diff/DiffPane';
import { useCopyDiff } from '@/features/diff/useCopyDiff';
import { CommitMessagesView } from '@/features/history/CommitMessagesView';
import { RepoList } from '@/features/repositories/RepoList';
import { FilesPane } from '@/features/explorer/FilesPane';
import { useStageAll } from '@/queries/mutations';
import { showToast } from '@/stores/notificationStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import styles from './Layout.module.css';

/**
 * Review view (ui-example L766–785): a three-pane top row over a two-pane
 * bottom row.
 *
 * Each resizer here writes *two* percentages, because the rows are sized
 * absolutely rather than with a flexible last pane — dragging the first
 * divider in the top row moves Files' width by the inverse of Repositories'
 * so the third pane stays put (L772–774).
 */
export function ReviewView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const review = useWorkspaceStore((state) => state.review);
  const setReview = useWorkspaceStore((state) => state.setReview);
  const copyDiff = useCopyDiff();
  const panelFilters = useWorkspaceStore((state) => state.panelFilters);
  const togglePanelFilter = useWorkspaceStore((state) => state.togglePanelFilter);
  const repoPath = useWorkspaceStore((state) => state.repoPath);
  const openCommit = useWorkspaceStore((state) => state.openCommit);
  const stageAll = useStageAll(repoPath);
  const openCompare = useWorkspaceStore((state) => state.openCompare);

  return (
    <div className={`${styles.content} ${styles.vertical}`} ref={containerRef}>
      <div className={styles.row} ref={topRef} style={{ height: `${review.topH}%` }}>
        <Panel style={{ width: `${review.topReposW}%` }}>
          <PanelHeader title="Repositories" />
          <RepoList />
        </Panel>

        <Resizer
          axis="v"
          containerRef={topRef}
          min={10}
          max={40}
          onResize={(percent) =>
            setReview({ topReposW: percent, topFilesW: 100 - percent - review.topMsgW })
          }
        />

        <Panel style={{ width: `${review.topFilesW}%` }}>
          <PanelHeader
            title="Files"
            actions={
              <>
                <PanelAction
                  title={panelFilters.files === null ? 'Filter files' : 'Hide filter'}
                  onClick={() => togglePanelFilter('files')}
                >
                  <Icons.Filter
                    size={11}
                    {...(panelFilters.files !== null && { color: 'var(--accent)' })}
                  />
                </PanelAction>
                <PanelAction
                  title="Stage All"
                  onClick={() =>
                    stageAll.mutate(undefined, {
                      onSuccess: () => showToast('Staged every change', 'success'),
                      onError: (error: Error) => showToast(error.message, 'error'),
                    })
                  }
                >
                  <Icons.Stage size={11} />
                </PanelAction>
              </>
            }
          />
          <FilesPane />
        </Panel>

        <Resizer
          axis="v"
          containerRef={topRef}
          min={25}
          max={80}
          onResize={(percent) =>
            setReview({ topFilesW: percent - review.topReposW, topMsgW: 100 - percent })
          }
        />

        <Panel style={{ width: `${review.topMsgW}%` }}>
          <PanelHeader
            title="Commit Messages"
            actions={
              <PanelAction title="New Commit" onClick={openCommit}>
                <Icons.NewCommit size={11} />
              </PanelAction>
            }
          />
          <CommitMessagesView />
        </Panel>
      </div>

      <Resizer
        axis="h"
        containerRef={containerRef}
        min={15}
        max={85}
        onResize={(percent) => setReview({ topH: percent, bottomH: 100 - percent })}
      />

      <div className={styles.row} ref={bottomRef} style={{ height: `${review.bottomH}%` }}>
        <Panel style={{ width: `${review.bottomLeftW}%` }}>
          <PanelHeader
            title="Origin Branch"
            actions={
              <>
                <PanelAction
                  title={panelFilters.remotes === null ? 'Filter remote branches' : 'Hide filter'}
                  onClick={() => togglePanelFilter('remotes')}
                >
                  <Icons.Filter
                    size={11}
                    {...(panelFilters.remotes !== null && { color: 'var(--accent)' })}
                  />
                </PanelAction>
                <PanelAction title="Compare with the current branch" onClick={openCompare}>
                  <Icons.ReviewView size={11} />
                </PanelAction>
              </>
            }
          />
          <RemoteBranchList />
        </Panel>

        <Resizer
          axis="v"
          containerRef={bottomRef}
          min={15}
          max={85}
          onResize={(percent) => setReview({ bottomLeftW: percent, bottomRightW: 100 - percent })}
        />

        <Panel style={{ width: `${review.bottomRightW}%` }}>
          <PanelHeader
            title="Changes"
            actions={
              <Button size="sm" disabled={!copyDiff.enabled} onClick={copyDiff.copy}>
                Copy Diff
              </Button>
            }
          />
          <DiffPane />
        </Panel>
      </div>
    </div>
  );
}
