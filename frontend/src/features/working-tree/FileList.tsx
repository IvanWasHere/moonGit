import { StatusBadge } from '@/components/Badges';
import { EmptyState } from '@/components/EmptyState';
import { Icons } from '@/components/icons';
import { ListSectionHeader } from '@/components/ListItem';
import { PanelBody } from '@/components/Panel';
import { useStatus } from '@/queries/git';
import { isStaged, isUnstaged, type StatusEntry } from '@/services/git';
import { useWorkspaceStore, type FileSide } from '@/stores/workspaceStore';
import { fileDir, fileName } from '@/utils/format';
import { displayPath, displayStatus, sortEntries } from './statusDisplay';
import styles from './FileList.module.css';

/**
 * The working tree, from `status --porcelain=v2` (ui-example L577–609).
 *
 * A file can be in both lists at once — staged, then edited again — and each
 * row carries which side it belongs to, because the diff for the staged half
 * and the unstaged half of the same path are different patches.
 */
export function FileList() {
  const repoPath = useWorkspaceStore((state) => state.repoPath);
  const { data: status, isPending, error } = useStatus(repoPath);

  if (repoPath === null) {
    return (
      <PanelBody>
        <EmptyState icon={Icons.File} message="Select a repository" />
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

  // No spinner on a refetch: the watcher fires constantly while the user
  // types, and flashing a loading state over a list they are reading is worse
  // than showing data that is a few milliseconds stale.
  if (isPending) {
    return (
      <PanelBody>
        <EmptyState icon={Icons.Sync} message="Reading working tree…" />
      </PanelBody>
    );
  }

  const staged = sortEntries(status.entries.filter(isStaged));
  const unstaged = sortEntries(status.entries.filter(isUnstaged));

  if (staged.length === 0 && unstaged.length === 0) {
    return (
      <PanelBody>
        <EmptyState icon={Icons.Clean} message="No changes in working directory" />
      </PanelBody>
    );
  }

  return (
    <PanelBody>
      {staged.length > 0 && (
        <>
          <ListSectionHeader tone="staged" label={`Staged Changes (${staged.length})`} />
          {staged.map((entry) => (
            <FileRow key={`staged:${entry.path}`} entry={entry} side="staged" />
          ))}
        </>
      )}
      {unstaged.length > 0 && (
        <>
          <ListSectionHeader tone="unstaged" label={`Changes (${unstaged.length})`} />
          {unstaged.map((entry) => (
            <FileRow key={`worktree:${entry.path}`} entry={entry} side="worktree" />
          ))}
        </>
      )}
    </PanelBody>
  );
}

function FileRow({ entry, side }: { readonly entry: StatusEntry; readonly side: FileSide }) {
  const selected = useWorkspaceStore((state) => state.selectedFile);
  const selectFile = useWorkspaceStore((state) => state.selectFile);

  const path = displayPath(entry);
  const dir = fileDir(path);
  const isSelected = selected?.path === entry.path && selected.side === side;

  return (
    <div
      className={`${styles.file} ${isSelected ? styles.selected : ''}`}
      onClick={() => selectFile({ path: entry.path, side })}
      title={path}
    >
      <StatusBadge status={displayStatus(entry, side)} />
      <div className={styles.path}>
        <span className={styles.filename}>{fileName(path)}</span>
        {dir !== '' && <span className={styles.dir}>{dir}</span>}
      </div>
      {entry.submodule !== undefined && <span className={styles.dir}>submodule</span>}
    </div>
  );
}
