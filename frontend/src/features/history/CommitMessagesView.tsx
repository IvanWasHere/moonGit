import { EmptyState } from '@/components/EmptyState';
import { Icons } from '@/components/icons';
import { PanelBody } from '@/components/Panel';
import { useLog } from '@/queries/git';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { timeAgo } from '@/utils/format';
import styles from './History.module.css';

/**
 * Commit Messages pane in the Review view (ui-example L688–711).
 *
 * The mockup showed a per-commit file count from its seed data. Getting that
 * for real means a diff per commit — one process each — so it is replaced by
 * the commit body, which the log already returns and which is more useful when
 * reviewing messages.
 */
export function CommitMessagesView() {
  const repoPath = useWorkspaceStore((state) => state.repoPath);
  const { data: commits, isPending, error } = useLog(repoPath, { maxCount: 100 });

  if (repoPath === null || error !== null) {
    return (
      <PanelBody>
        <EmptyState icon={Icons.CommitMessages} message={error?.message ?? 'No commits'} />
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

  return (
    <PanelBody>
      {commits.map((commit) => (
        <div key={commit.oid} className={styles.entry}>
          <div className={styles.head}>
            <div className={styles.hash}>{commit.shortOid}</div>
            <div className={styles.time}>{timeAgo(commit.author.date * 1000)}</div>
          </div>
          <div className={styles.message}>{commit.subject}</div>
          {commit.body !== '' && <div className={styles.body}>{commit.body}</div>}
          <div className={styles.footer}>
            <Icons.Author size={11} />
            <span>{commit.author.name}</span>
            {commit.isMerge && <span className={styles.fileCount}>merge</span>}
          </div>
        </div>
      ))}
    </PanelBody>
  );
}
