import { useEffect, type ReactNode } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { EmptyState } from '@/components/EmptyState';
import { Icons } from '@/components/icons';
import { MenuBar } from '@/components/MenuBar';
import { TopMenu } from '@/components/menu/TopMenu';
import { useMenuActions } from '@/components/menu/useMenuActions';
import { ToastContainer } from '@/components/ToastContainer';
import { MergeModal } from '@/features/merge/MergeModal';
import { useRepository } from '@/queries/repositories';
import { useRepoWatcher } from '@/queries/useRepoWatcher';
import { useLayoutPersistence } from '@/stores/layoutPersistence';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { fileName } from '@/utils/format';
import styles from './Workspace.module.css';

/**
 * The application shell: menubar, the active view, and the toast stack
 * (ui-example L790–803).
 *
 * The repository comes from the route, so a reload lands back where the user
 * was and the two views share one open repository. Resolving the id to a path
 * is what connects the SQLite inventory to every git command underneath.
 */
export function Workspace({
  view,
  children,
}: {
  readonly view: 'main' | 'review';
  readonly children: ReactNode;
}) {
  const { repoId: repoIdParam } = useParams();
  const repoId = repoIdParam === undefined ? null : Number.parseInt(repoIdParam, 10);
  const valid = repoId !== null && !Number.isNaN(repoId);

  const { data: repository, isPending } = useRepository(valid ? repoId : null);
  const repoPath = useWorkspaceStore((state) => state.repoPath);
  const selectedFile = useWorkspaceStore((state) => state.selectedFile);
  const mergeOpen = useWorkspaceStore((state) => state.mergeOpen);
  const closeMerge = useWorkspaceStore((state) => state.closeMerge);
  const openRepo = useWorkspaceStore((state) => state.openRepo);

  useEffect(() => {
    if (repository === null || repository === undefined) return;
    openRepo(repository.id, repository.path);
  }, [repository, openRepo]);

  useLayoutPersistence();
  useRepoWatcher(repoPath);
  const onMenuAction = useMenuActions();

  // A route pointing at a repository that has been forgotten — or a hand-typed
  // id — goes back to the dashboard rather than rendering empty panels.
  if (!valid || (!isPending && (repository === null || repository === undefined))) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className={styles.app}>
      <TopMenu onAction={onMenuAction} />
      <MenuBar
        view={view}
        selectedFileName={selectedFile === null ? null : fileName(selectedFile.path)}
      />
      {isPending ? (
        <div className={styles.loading}>
          <EmptyState icon={Icons.Sync} message="Opening repository…" />
        </div>
      ) : (
        children
      )}
      {mergeOpen && <MergeModal onClose={closeMerge} />}
      <ToastContainer />
    </div>
  );
}
