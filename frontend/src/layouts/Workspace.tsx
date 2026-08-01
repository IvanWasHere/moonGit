import { useEffect, type ReactNode } from 'react';
import { MenuBar } from '@/components/MenuBar';
import { ToastContainer } from '@/components/ToastContainer';
import { activeBranchFor, files, repos } from '@/fixtures/workspace';
import { useLayoutPersistence } from '@/stores/layoutPersistence';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { fileName } from '@/utils/format';
import styles from './Workspace.module.css';

/**
 * The application shell: menubar, the active view, and the toast stack
 * (ui-example L790–803).
 *
 * The mockup switched views with a state flag; the port routes instead, so
 * `Workspace` is the shared frame both routes render inside.
 */
export function Workspace({
  view,
  children,
}: {
  readonly view: 'main' | 'review';
  readonly children: ReactNode;
}) {
  const selectedRepoId = useWorkspaceStore((state) => state.selectedRepoId);
  const selectedFileId = useWorkspaceStore((state) => state.selectedFileId);
  const selectRepo = useWorkspaceStore((state) => state.selectRepo);

  useLayoutPersistence();

  // The mockup selected the first repository as soon as the list loaded
  // (L515–521); without it every panel opens on an empty state.
  useEffect(() => {
    if (selectedRepoId !== null) return;
    const first = repos[0];
    if (first === undefined) return;
    selectRepo(first.id, activeBranchFor(first.id)?.id ?? null);
  }, [selectedRepoId, selectRepo]);

  const selectedFile = files.find((file) => file.id === selectedFileId);

  return (
    <div className={styles.app}>
      <MenuBar
        view={view}
        selectedFileName={selectedFile === undefined ? null : fileName(selectedFile.path)}
      />
      {children}
      <ToastContainer />
    </div>
  );
}
