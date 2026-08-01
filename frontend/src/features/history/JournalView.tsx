import { EmptyState } from '@/components/EmptyState';
import { Icons } from '@/components/icons';
import { PanelBody } from '@/components/Panel';
import { useLog } from '@/queries/git';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { timeAgo } from '@/utils/format';
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
  const { data: commits, isPending, error } = useLog(repoPath, { maxCount: PAGE_SIZE });

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
  if (commits.length === 0) {
    return (
      <PanelBody>
        <EmptyState icon={Icons.Journal} message="No commits yet" />
      </PanelBody>
    );
  }

  return (
    <PanelBody>
      {commits.map((commit) => (
        <div
          key={commit.oid}
          className={`${styles.entry} ${selectedCommit === commit.oid ? styles.selected : ''}`}
          onClick={() => selectCommit(commit.oid)}
        >
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
      ))}
    </PanelBody>
  );
}
