import { useQuery } from '@tanstack/react-query';
import { EmptyState } from '@/components/EmptyState';
import { Icons } from '@/components/icons';
import { PanelBody } from '@/components/Panel';
import { useDialog } from '@/components/useDialog';
import { useCurrentBranch } from '@/queries/git';
import { diffService, type DiffFile } from '@/services/git';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import styles from './CompareDialog.module.css';

/**
 * What differs between this branch and a remote one (PLAN.md §11, 8.9).
 *
 * The Review view's Compare button had no handler at all — and could not have
 * had one, because remote branch rows were not selectable, so there was nothing
 * to name as the other side. 8.9 made them selectable; this is what the button
 * now does.
 *
 * **A file list, not a diff viewer.** `DiffService.between` returns the same
 * `DiffFile[]` the Changes pane renders, and showing every hunk of a branch
 * comparison would be a second diff viewer competing with the real one. The
 * question this answers is "how far apart are these, and in what" — a file list
 * with counts answers it in one screen; opening a file's patch is what the
 * Changes pane is already for.
 *
 * Direction is **remote → local**: additions are what this branch has and the
 * remote does not. Stated on screen, because a diff with the sides swapped is
 * indistinguishable from a correct one until you act on it.
 */
export function CompareDialog({ onClose }: { readonly onClose: () => void }) {
  const repoPath = useWorkspaceStore((state) => state.repoPath);
  const remoteBranch = useWorkspaceStore((state) => state.selectedRemoteBranch);
  const { data: current } = useCurrentBranch(repoPath);
  const dialog = useDialog('Compare with remote branch', onClose);

  const {
    data: files,
    isPending,
    error,
  } = useQuery<DiffFile[], Error>({
    queryKey: [repoPath ?? '', 'compare', remoteBranch, current],
    queryFn: async () => {
      const result = await diffService(repoPath ?? '').between(remoteBranch ?? '', 'HEAD');
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
    enabled: repoPath !== null && remoteBranch !== null,
  });

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} {...dialog} onClick={(event) => event.stopPropagation()}>
        <header className={styles.header}>
          <Icons.ReviewView size={14} color="var(--accent)" />
          <span className={styles.title}>Compare</span>
          <span className={styles.pair}>
            {remoteBranch ?? '—'} <span className={styles.arrow}>→</span> {current ?? 'HEAD'}
          </span>
          <button type="button" className={styles.close} title="Close" onClick={onClose}>
            <Icons.Close size={14} />
          </button>
        </header>

        {remoteBranch === null ? (
          <EmptyState
            icon={Icons.Branch}
            message="Select a remote branch in the Origin Branch panel first"
          />
        ) : (
          <>
            {isPending && <EmptyState icon={Icons.Sync} message="Comparing…" />}
            {error !== null && error !== undefined && (
              <EmptyState icon={Icons.Abort} message={error.message} />
            )}
            {files !== undefined && files.length === 0 && (
              <EmptyState icon={Icons.Clean} message="These branches are identical" />
            )}
            {files !== undefined && files.length > 0 && (
              <PanelBody>
                <div className={styles.summary}>
                  {files.length} file{files.length === 1 ? '' : 's'} differ — additions are on{' '}
                  {current ?? 'HEAD'}
                </div>
                {files.map((file) => (
                  <div key={file.path} className={styles.row}>
                    <span className={styles.status}>{file.kind.slice(0, 1).toUpperCase()}</span>
                    <span className={styles.path}>{file.path}</span>
                    <span className={styles.added}>+{file.additions}</span>
                    <span className={styles.removed}>−{file.deletions}</span>
                  </div>
                ))}
              </PanelBody>
            )}
          </>
        )}
      </div>
    </div>
  );
}
