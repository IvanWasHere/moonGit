import { EmptyState } from '@/components/EmptyState';
import { Icons } from '@/components/icons';
import { PanelBody } from '@/components/Panel';
import { commitsForRepo } from '@/fixtures/workspace';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { timeAgo } from '@/utils/format';
import styles from './History.module.css';

/** Commit journal in the Main view (ui-example L633–659). */
export function JournalView() {
  const selectedRepoId = useWorkspaceStore((state) => state.selectedRepoId);
  const selectedCommitId = useWorkspaceStore((state) => state.selectedCommitId);
  const selectCommit = useWorkspaceStore((state) => state.selectCommit);

  if (selectedRepoId === null) {
    return (
      <PanelBody>
        <EmptyState icon={Icons.Journal} message="Select a repository to view journal" />
      </PanelBody>
    );
  }

  const commits = commitsForRepo(selectedRepoId);
  if (commits.length === 0) {
    return (
      <PanelBody>
        <EmptyState icon={Icons.Journal} message="No commits in journal" />
      </PanelBody>
    );
  }

  return (
    <PanelBody>
      {commits.map((commit) => (
        <div
          key={commit.id}
          className={`${styles.entry} ${selectedCommitId === commit.id ? styles.selected : ''}`}
          onClick={() => selectCommit(commit.id)}
        >
          <div className={styles.head}>
            <div className={styles.hash}>{commit.hash}</div>
            <div className={styles.author}>{commit.author}</div>
            <div className={styles.time}>{timeAgo(commit.date)}</div>
          </div>
          <div className={styles.message}>{commit.message}</div>
        </div>
      ))}
    </PanelBody>
  );
}
