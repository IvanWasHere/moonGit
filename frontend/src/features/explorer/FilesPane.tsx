import { StatusBadge } from '@/components/Badges';
import { useStatus } from '@/queries/git';
import { FileList } from '@/features/working-tree/FileList';
import {
  STATUS_FILTERS,
  type StatusFilter,
  type StatusFilterSpec,
} from '@/features/working-tree/statusFilters';
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
        {/* Hidden on the Tree tab: the tree is read from the filesystem and is
            not status-driven, so a control that cannot affect what is on screen
            would be a control that lies. */}
        {filesTab === 'changes' && <StatusChips />}
      </div>
      {filesTab === 'changes' ? <FileList /> : <FileTree />}
    </>
  );
}

/**
 * The status filter chips, right-aligned in the tabs row.
 *
 * They wrap to their own line rather than collapsing to icons when the pane is
 * narrow — the Files pane can sit at ~300px, and two of the seven ("Staged",
 * "Unstaged") are *positions* in the XY pair rather than status letters, so
 * they have no glyph to collapse to. Inventing one would add a vocabulary to a
 * row whose whole argument is that it borrows the one below it.
 */
function StatusChips() {
  const selected = useWorkspaceStore((state) => state.statusFilters);
  const toggle = useWorkspaceStore((state) => state.toggleStatusFilter);

  return (
    <div className={styles.chips}>
      {STATUS_FILTERS.map((spec) => (
        <Chip key={spec.id} spec={spec} active={selected.includes(spec.id)} onToggle={toggle} />
      ))}
    </div>
  );
}

function Chip({
  spec,
  active,
  onToggle,
}: {
  readonly spec: StatusFilterSpec;
  readonly active: boolean;
  readonly onToggle: (id: StatusFilter) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={`${spec.label} — ${spec.hint}`}
      className={`${styles.chip} ${active ? styles.chipOn : ''}`}
      onClick={() => onToggle(spec.id)}
    >
      {spec.badge === null ? spec.label : <StatusBadge status={spec.badge} />}
    </button>
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
