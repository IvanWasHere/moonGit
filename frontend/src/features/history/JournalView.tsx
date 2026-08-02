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
  const logPath = useWorkspaceStore((state) => state.logPath);
  const setLogPath = useWorkspaceStore((state) => state.setLogPath);
  const {
    data: commits,
    isPending,
    error,
  } = useLog(repoPath, {
    maxCount: PAGE_SIZE,
    ...(logPath !== null && { paths: [logPath] }),
  });

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
