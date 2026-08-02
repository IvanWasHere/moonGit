import { StatusBadge } from '@/components/Badges';
import { EmptyState } from '@/components/EmptyState';
import { Icons } from '@/components/icons';
import { PanelBody } from '@/components/Panel';
import { useStatus } from '@/queries/git';
import { type StatusEntry } from '@/services/git';
import { useWorkspaceStore, type FileSide } from '@/stores/workspaceStore';
import { fileDir, fileName } from '@/utils/format';
import {
  defaultSide,
  displayPath,
  sidesOf,
  sortEntries,
  type DisplayStatus,
} from './statusDisplay';
import styles from './FileList.module.css';

/**
 * The working tree, from `status --porcelain=v2` — one row per file, with a
 * Status column instead of the mockup's "Staged Changes" / "Changes" sections
 * (ui-example L577–609).
 *
 * The column has two badges because git's status does: porcelain reports an
 * **XY** pair, X for the index and Y for the working tree, and a file that was
 * staged and then edited again has a different status in each. One badge would
 * have to drop one of them, and "staged as added, modified since" is not the
 * same fact as "modified" — the two halves are also two different patches.
 *
 * So the column is positional: left badge is what is going into the commit,
 * right badge is what is not, and a dot means that side is unchanged. Clicking
 * either badge opens that side's diff; clicking the row takes the unstaged half
 * when there is one, since that is the change still being worked on.
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

  // An ignored entry has nothing on either side; git only reports it when
  // asked, and it is not a change.
  const files = sortEntries(status.entries.filter((entry) => entry.kind !== 'ignored'));

  if (files.length === 0) {
    return (
      <PanelBody>
        <EmptyState icon={Icons.Clean} message="No changes in working directory" />
      </PanelBody>
    );
  }

  return (
    <PanelBody>
      <div className={styles.columns}>
        <div className={styles.statusCell}>Status</div>
        <div>File</div>
      </div>
      {files.map((entry) => (
        <FileRow key={entry.path} entry={entry} />
      ))}
    </PanelBody>
  );
}

function FileRow({ entry }: { readonly entry: StatusEntry }) {
  const selected = useWorkspaceStore((state) => state.selectedFile);
  const selectFile = useWorkspaceStore((state) => state.selectFile);

  const path = displayPath(entry);
  const dir = fileDir(path);
  const sides = sidesOf(entry);
  const isSelected = selected?.path === entry.path;

  return (
    <div
      className={`${styles.file} ${isSelected ? styles.selected : ''}`}
      onClick={() => selectFile({ path: entry.path, side: defaultSide(entry) })}
      title={path}
    >
      <div className={styles.statusCell}>
        <SideBadge
          status={sides.staged}
          side="staged"
          path={entry.path}
          active={isSelected && selected.side === 'staged'}
          onSelect={selectFile}
        />
        <SideBadge
          status={sides.worktree}
          side="worktree"
          path={entry.path}
          active={isSelected && selected.side === 'worktree'}
          onSelect={selectFile}
        />
      </div>
      <div className={styles.path}>
        <span className={styles.filename}>{fileName(path)}</span>
        {dir !== '' && <span className={styles.dir}>{dir}</span>}
      </div>
      {entry.submodule !== undefined && <span className={styles.dir}>submodule</span>}
    </div>
  );
}

const SIDE_LABEL: Record<FileSide, string> = {
  staged: 'Staged',
  worktree: 'Unstaged',
};

/**
 * One half of the status column.
 *
 * An unchanged side still occupies its slot — as a dot rather than nothing —
 * because the column only reads as "index, then worktree" if both positions
 * are always there. A blank would let the eye slide the badges left and turn
 * an unstaged change into a staged-looking one.
 */
function SideBadge({
  status,
  side,
  path,
  active,
  onSelect,
}: {
  readonly status: DisplayStatus | null;
  readonly side: FileSide;
  readonly path: string;
  readonly active: boolean;
  readonly onSelect: (selection: { path: string; side: FileSide }) => void;
}) {
  if (status === null) {
    return <span className={styles.emptySide} title={`${SIDE_LABEL[side]}: no change`} />;
  }

  return (
    <button
      type="button"
      className={`${styles.sideButton} ${active ? styles.activeSide : ''}`}
      title={`${SIDE_LABEL[side]}: ${status}`}
      onClick={(event) => {
        // Without this the row handler runs too and re-picks the default side,
        // which would make the staged badge unclickable on a file with both.
        event.stopPropagation();
        onSelect({ path, side });
      }}
    >
      <StatusBadge status={status} />
    </button>
  );
}
