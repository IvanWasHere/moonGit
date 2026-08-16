import { useRef } from 'react';
import { Button } from '@/components/Button';
import { Icons } from '@/components/icons';
import { Panel, PanelAction, PanelHeader } from '@/components/Panel';
import { Resizer } from '@/components/Resizer';
import { BranchList } from '@/features/branches/BranchList';
import { useBranchActions } from '@/features/branches/useBranchActions';
import { DiffPane } from '@/features/diff/DiffPane';
import { useCopyDiff } from '@/features/diff/useCopyDiff';
import { JournalView } from '@/features/history/JournalView';
import { RepoList } from '@/features/repositories/RepoList';
import { CommitBox } from '@/features/working-tree/CommitBox';
import { FilesPane } from '@/features/explorer/FilesPane';

import { useQueryClient } from '@tanstack/react-query';
import { gitKeys } from '@/queries/keys';
import { useFetch, useStageAll } from '@/queries/mutations';
import { useOpenRepository } from '@/queries/repositories';
import { showToast } from '@/stores/notificationStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import styles from './Layout.module.css';

/**
 * Main view (ui-example L716–761): Repositories over Branches on the left,
 * Files over Changes over Journal on the right.
 *
 * The resizer arithmetic is the mockup's, kept literally. The third resizer
 * (L753) is the subtle one: it reads the *sum* of the Files and Changes
 * heights and sets Changes to the difference, so dragging it moves the
 * Changes/Journal boundary without disturbing Files above it.
 */
export function MainView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);

  const main = useWorkspaceStore((state) => state.main);
  const setMain = useWorkspaceStore((state) => state.setMain);
  const selectedFile = useWorkspaceStore((state) => state.selectedFile);
  const commitOpen = useWorkspaceStore((state) => state.commitOpen);
  const copyDiff = useCopyDiff();
  const logAll = useWorkspaceStore((state) => state.logAll);
  const toggleLogAll = useWorkspaceStore((state) => state.toggleLogAll);
  const logQuery = useWorkspaceStore((state) => state.logQuery);
  const toggleLogSearch = useWorkspaceStore((state) => state.toggleLogSearch);
  const setLogQuery = useWorkspaceStore((state) => state.setLogQuery);
  const panelFilters = useWorkspaceStore((state) => state.panelFilters);
  const togglePanelFilter = useWorkspaceStore((state) => state.togglePanelFilter);
  const repoPath = useWorkspaceStore((state) => state.repoPath);

  /*
   * These four were toasts (PLAN.md §11, 8.8).
   *
   * Every one of them had a working implementation elsewhere in the app and
   * called `showToast('…')` instead of it — "All files staged" was reported as
   * a *success* while staging nothing, which is worse than a button that
   * visibly does nothing.
   */
  const queryClient = useQueryClient();
  const openRepository = useOpenRepository();
  const stageAll = useStageAll(repoPath);
  const fetch = useFetch(repoPath);
  const branch = useBranchActions();
  const collapseDirs = useWorkspaceStore((state) => state.collapseDirs);
  const reportError = (error: Error) => showToast(error.message, 'error');

  return (
    <div className={styles.content} ref={containerRef}>
      <div className={styles.column} ref={leftRef} style={{ width: `${main.leftW}%` }}>
        <Panel style={{ height: `${main.reposH}%` }}>
          <PanelHeader
            title="Repositories"
            actions={
              <>
                <PanelAction title="Add Repository" onClick={() => openRepository.mutate()}>
                  <Icons.Stage size={11} />
                </PanelAction>
                <PanelAction
                  title="Refresh"
                  onClick={() => {
                    if (repoPath === null) return;
                    void queryClient.invalidateQueries({ queryKey: gitKeys.repo(repoPath) });
                  }}
                >
                  <Icons.Sync size={11} />
                </PanelAction>
              </>
            }
          />
          <RepoList />
        </Panel>

        <Resizer
          axis="h"
          containerRef={leftRef}
          min={10}
          max={90}
          onResize={(percent) => setMain({ reposH: percent })}
        />

        <Panel style={{ flex: 1 }}>
          <PanelHeader
            title="Branches"
            actions={
              <>
                <PanelAction title="New Branch" onClick={() => void branch.create()}>
                  <Icons.Stage size={11} />
                </PanelAction>
                <PanelAction
                  title={panelFilters.branches === null ? 'Filter branches' : 'Hide filter'}
                  onClick={() => togglePanelFilter('branches')}
                >
                  <Icons.Filter
                    size={11}
                    {...(panelFilters.branches !== null && { color: 'var(--accent)' })}
                  />
                </PanelAction>
                <PanelAction
                  title="Fetch"
                  onClick={() =>
                    fetch.mutate(
                      { prune: true },
                      {
                        onSuccess: () => showToast('Fetched and pruned', 'success'),
                        onError: reportError,
                      },
                    )
                  }
                >
                  <Icons.Pull size={11} />
                </PanelAction>
              </>
            }
          />
          <BranchList />
        </Panel>
      </div>

      <Resizer
        axis="v"
        containerRef={containerRef}
        min={12}
        max={55}
        onResize={(percent) => setMain({ leftW: percent })}
      />

      <div className={styles.column} ref={rightRef} style={{ flex: 1 }}>
        <Panel style={{ height: `${main.rightFilesH}%` }}>
          <PanelHeader
            title="Files"
            actions={
              <>
                <PanelAction
                  title="Stage All"
                  onClick={() =>
                    stageAll.mutate(undefined, {
                      onSuccess: () => showToast('Staged every change', 'success'),
                      onError: reportError,
                    })
                  }
                >
                  <Icons.Stage size={11} />
                </PanelAction>
                <PanelAction
                  title={panelFilters.files === null ? 'Filter files' : 'Hide filter'}
                  onClick={() => togglePanelFilter('files')}
                >
                  <Icons.Filter
                    size={11}
                    {...(panelFilters.files !== null && { color: 'var(--accent)' })}
                  />
                </PanelAction>
                <PanelAction title="Collapse All" onClick={collapseDirs}>
                  <Icons.CollapseAll size={11} />
                </PanelAction>
              </>
            }
          />
          <FilesPane />
          {commitOpen && <CommitBox />}
        </Panel>

        <Resizer
          axis="h"
          containerRef={rightRef}
          min={8}
          max={85}
          onResize={(percent) => setMain({ rightFilesH: percent })}
        />

        <Panel style={{ height: `${main.rightChangesH}%` }}>
          <PanelHeader
            title="Changes"
            {...(selectedFile !== null && { count: selectedFile.path })}
            actions={
              <Button size="sm" disabled={!copyDiff.enabled} onClick={copyDiff.copy}>
                Copy Diff
              </Button>
            }
          />
          <DiffPane />
        </Panel>

        {/* Reads the combined boundary and writes back the difference (L753). */}
        <Resizer
          axis="h"
          containerRef={rightRef}
          min={10}
          max={92}
          onResize={(percent) => setMain({ rightChangesH: percent - main.rightFilesH })}
        />

        <Panel style={{ flex: 1 }}>
          <PanelHeader
            title="Journal"
            actions={
              <>
                <PanelAction
                  title={logAll ? 'Showing all branches' : 'Showing this branch only'}
                  onClick={toggleLogAll}
                >
                  <Icons.Branch size={11} color={logAll ? 'var(--accent)' : undefined} />
                </PanelAction>
                <PanelAction
                  title={logQuery === null ? 'Search commits' : 'Close search'}
                  onClick={toggleLogSearch}
                >
                  <Icons.Search size={11} {...(logQuery !== null && { color: 'var(--accent)' })} />
                </PanelAction>
                {/* The mockup's second Journal button (L755). It opens the same
                    box primed with the qualifier, because filtering history by
                    path is what a filter means here and the search bar already
                    does it — two independent filter mechanisms over one list
                    would just be able to disagree. */}
                <PanelAction
                  title="Filter by path"
                  onClick={() => setLogQuery(logQuery === null ? 'path:' : null)}
                >
                  <Icons.Filter size={11} />
                </PanelAction>
              </>
            }
          />
          <JournalView />
        </Panel>
      </div>
    </div>
  );
}
