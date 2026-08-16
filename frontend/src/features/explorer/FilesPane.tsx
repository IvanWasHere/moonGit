import { useQueryClient } from '@tanstack/react-query';
import { StatusBadge } from '@/components/Badges';
import { Icons } from '@/components/icons';
import { useStatus, useTuning } from '@/queries/git';
import { gitKeys } from '@/queries/keys';
import { forceUntrackedAll } from '@/services/git/tuning';
import { FileList } from '@/features/working-tree/FileList';
import {
  STATUS_FILTERS,
  type StatusFilter,
  type StatusFilterSpec,
} from '@/features/working-tree/statusFilters';
import { useWatchState } from '@/stores/watchStore';
import { useWorkspaceStore, type FilesTab } from '@/stores/workspaceStore';
import { FileTree } from './FileTree';
import { watchWarningFor } from './watchBanner';
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
      {/* On both tabs, unlike the one below it: an unwatched part of the tree
          goes stale in the Tree exactly as it does in Changes, and the Tree is
          where a file that has silently stopped updating is most believable. */}
      <WatcherBanner />
      {filesTab === 'changes' && <DegradedBanner />}
      {filesTab === 'changes' ? <FileList /> : <FileTree />}
    </>
  );
}

/**
 * Says so when the file watcher is not covering the whole working tree.
 *
 * The watcher has always known this — `WatchInfo.Degraded` is set when the
 * tree would cost more file descriptors than the process can spare, and
 * `services/wails/watch.ts` has documented it since 7.6 as something "the UI
 * should say". It said nothing: `useRepoWatcher` discarded the return value of
 * `Watch`, so the flag reached a debug stat and no further (PLAN.md §10, 7.6).
 *
 * Whether to warn at all, and in what words, is `watchWarningFor` — the rule
 * has a third state that is invisible on screen when it is right, so it is
 * pinned by tests rather than by a condition in this JSX.
 */
function WatcherBanner() {
  const repoPath = useWorkspaceStore((state) => state.repoPath);
  const watch = useWatchState(repoPath);
  const queryClient = useQueryClient();

  const warning = watchWarningFor(watch);
  if (repoPath === null || warning === null) return null;

  return (
    <div className={styles.degraded}>
      <Icons.Unwatched size={11} />
      <span className={styles.degradedText}>{warning.message}</span>
      <button
        type="button"
        className={styles.degradedAction}
        onClick={() => void queryClient.invalidateQueries({ queryKey: gitKeys.repo(repoPath) })}
      >
        Refresh
      </button>
    </div>
  );
}

/**
 * Says so when the repository degraded itself to `--untracked-files=normal`.
 *
 * Without this the panel would simply stop listing files inside untracked
 * directories, and a Files panel that silently omits files is worse than a slow
 * one — "where did my new folder's contents go" has no answer anywhere on
 * screen. It is the same bargain, and the same banner shape, as the Journal's
 * file-log filter: you are not seeing everything, and here is the button.
 *
 * The escape hatch is one-way on purpose. Someone who asks for every file back
 * on a 500k-file repository has been told what it costs, and `forcedAll` then
 * stops the next slow status from overriding them (`services/git/tuning.ts`).
 */
function DegradedBanner() {
  const repoPath = useWorkspaceStore((state) => state.repoPath);
  const queryClient = useQueryClient();
  const { data: tuning } = useTuning(repoPath);

  if (repoPath === null || tuning === undefined) return null;
  if (tuning.untracked !== 'normal' || tuning.forcedAll) return null;

  const listEverything = async () => {
    await forceUntrackedAll(repoPath);
    await queryClient.invalidateQueries({ queryKey: gitKeys.tuning(repoPath) });
    await queryClient.invalidateQueries({ queryKey: gitKeys.status(repoPath) });
  };

  return (
    <div className={styles.degraded}>
      <Icons.Filter size={11} />
      <span className={styles.degradedText}>
        Large repository — untracked folders are collapsed
      </span>
      <button type="button" className={styles.degradedAction} onClick={() => void listEverything()}>
        List every file
      </button>
    </div>
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
