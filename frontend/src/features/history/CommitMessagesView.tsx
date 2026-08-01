import { EmptyState } from '@/components/EmptyState';
import { Icons } from '@/components/icons';
import { PanelBody } from '@/components/Panel';
import { commitsForRepo } from '@/fixtures/workspace';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { timeAgo } from '@/utils/format';
import styles from './History.module.css';

/**
 * Commit Messages pane in the Review view (ui-example L688–711).
 *
 * The same journal entry shape as `JournalView`, but rows are not selectable
 * and each carries an author-and-file-count footer instead of an inline author.
 */
export function CommitMessagesView() {
  const selectedRepoId = useWorkspaceStore((state) => state.selectedRepoId);

  if (selectedRepoId === null) {
    return (
      <PanelBody>
        <EmptyState icon={Icons.CommitMessages} message="No commits" />
      </PanelBody>
    );
  }

  return (
    <PanelBody>
      {commitsForRepo(selectedRepoId).map((commit) => (
        <div key={commit.id} className={styles.entry}>
          <div className={styles.head}>
            <div className={styles.hash}>{commit.hash}</div>
            <div className={styles.time}>{timeAgo(commit.date)}</div>
          </div>
          <div className={styles.message}>{commit.message}</div>
          <div className={styles.footer}>
            <Icons.Author size={11} />
            <span>{commit.author}</span>
            <span className={styles.fileCount}>{commit.fileCount} files</span>
          </div>
        </div>
      ))}
    </PanelBody>
  );
}
