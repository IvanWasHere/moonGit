import { useStatus } from '@/queries/git';
import { FileList } from '@/features/working-tree/FileList';
import { useWorkspaceStore, type FilesTab } from '@/stores/workspaceStore';
import { FileTree } from './FileTree';
import styles from './FilesPane.module.css';

/**
 * The Files panel's two halves: what changed, and everything.
 *
 * A tab strip rather than a second panel — the mockup's layout has no room for
 * one, and both tabs answer the same question ("which file"), one of them
 * filtered to the files with changes. Keeping them under one header also keeps
 * one selection: picking a file in either tab drives the same Changes pane.
 *
 * The Changes tab carries a count and the Tree does not, deliberately. "How
 * many files have I touched" is a number worth being told; "how many files are
 * in this repository" is not, and computing it would mean walking a tree whose
 * entire design is to avoid being walked.
 */
export function FilesPane() {
  const repoPath = useWorkspaceStore((state) => state.repoPath);
  const filesTab = useWorkspaceStore((state) => state.filesTab);
  const setFilesTab = useWorkspaceStore((state) => state.setFilesTab);
  const { data: status } = useStatus(repoPath);

  const changed = (status?.entries ?? []).filter((entry) => entry.kind !== 'ignored').length;

  return (
    <>
      <div className={styles.tabs} role="tablist">
        <Tab
          tab="changes"
          active={filesTab}
          onSelect={setFilesTab}
          label="Changes"
          count={changed}
        />
        <Tab tab="tree" active={filesTab} onSelect={setFilesTab} label="Tree" />
      </div>
      {filesTab === 'changes' ? <FileList /> : <FileTree />}
    </>
  );
}

function Tab({
  tab,
  active,
  onSelect,
  label,
  count,
}: {
  readonly tab: FilesTab;
  readonly active: FilesTab;
  readonly onSelect: (tab: FilesTab) => void;
  readonly label: string;
  readonly count?: number;
}) {
  const isActive = active === tab;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      className={`${styles.tab} ${isActive ? styles.active : ''}`}
      onClick={() => onSelect(tab)}
    >
      {label}
      {count !== undefined && <span className={styles.count}>{count}</span>}
    </button>
  );
}
