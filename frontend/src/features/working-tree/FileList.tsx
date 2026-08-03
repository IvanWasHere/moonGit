import { useState } from 'react';
import { StatusBadge } from '@/components/Badges';
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextSubmenu,
} from '@/components/ContextMenu';
import { EmptyState } from '@/components/EmptyState';
import { Icons } from '@/components/icons';
import { PanelBody } from '@/components/Panel';
import { useStatus } from '@/queries/git';
import { FilterBox } from '@/features/search/FilterBox';
import { filterBy } from '@/features/search/matchText';
import { isConflicted, type StatusEntry } from '@/services/git';
import { useWorkspaceStore, type FileSide } from '@/stores/workspaceStore';
import { fileDir, fileName } from '@/utils/format';
import {
  defaultSide,
  displayPath,
  sidesOf,
  sortEntries,
  type DisplayStatus,
} from './statusDisplay';
import { fileMenuFor, type FileMenuItem } from './fileMenu';
import { useFileMenuActions } from './useFileMenuActions';
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
  const filter = useWorkspaceStore((state) => state.panelFilters.files);
  const { data: status, isPending, error } = useStatus(repoPath);

  // The open menu, and where. Held here rather than per row so only one can be
  // open at a time without every row having to know about the others.
  const [menu, setMenu] = useState<{ entry: StatusEntry; x: number; y: number } | null>(null);
  const openMenu = (entry: StatusEntry, x: number, y: number) => setMenu({ entry, x, y });

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
      <>
        <FilterBox panel="files" placeholder="Filter files" />
        <PanelBody>
          <EmptyState icon={Icons.Clean} message="No changes in working directory" />
        </PanelBody>
      </>
    );
  }

  // Matched on the display path, which for a rename is `old → new` — so either
  // half of a rename finds it, and that is the row the user is looking for.
  const visible = filterBy(files, filter, (entry) => [displayPath(entry)]);

  return (
    <>
      <FilterBox
        panel="files"
        placeholder="Filter files"
        matched={visible.length}
        total={files.length}
      />
      <PanelBody>
        <div className={styles.columns}>
          <div className={styles.statusCell}>Status</div>
          <div>File</div>
        </div>
        {visible.length === 0 && (
          <EmptyState icon={Icons.File} message="No files match this filter" />
        )}
        {visible.map((entry) => (
          <FileRow key={entry.path} entry={entry} onContextMenu={openMenu} />
        ))}
        {menu !== null && (
          <FileContextMenu
            entry={menu.entry}
            x={menu.x}
            y={menu.y}
            onClose={() => setMenu(null)}
            repoPath={repoPath}
          />
        )}
      </PanelBody>
    </>
  );
}

/**
 * The right-click menu for one file.
 *
 * Its contents come from `fileMenu.ts`, which decides them from git status
 * alone — so what a conflicted file offers versus an untracked one is a tested
 * property rather than a branch buried in this render.
 */
function FileContextMenu({
  entry,
  x,
  y,
  onClose,
  repoPath,
}: {
  readonly entry: StatusEntry;
  readonly x: number;
  readonly y: number;
  readonly onClose: () => void;
  readonly repoPath: string;
}) {
  const run = useFileMenuActions(repoPath);
  const entries = fileMenuFor(entry);

  const choose = (menuItem: FileMenuItem) => {
    onClose();
    run(entry, menuItem);
  };

  return (
    <ContextMenu x={x} y={y} onClose={onClose}>
      {entries.map((menuEntry, index) => {
        if (menuEntry.kind === 'separator') {
          return <ContextMenuSeparator key={`sep-${index}`} />;
        }
        if (menuEntry.kind === 'submenu') {
          return (
            <ContextSubmenu key={menuEntry.label} label={menuEntry.label}>
              {menuEntry.items.map((child) => (
                <ContextMenuItem
                  key={child.action}
                  label={child.label}
                  onSelect={() => choose(child)}
                />
              ))}
            </ContextSubmenu>
          );
        }
        return (
          <ContextMenuItem
            key={menuEntry.action}
            label={menuEntry.label}
            {...(menuEntry.disabled !== undefined && { disabled: menuEntry.disabled })}
            {...(menuEntry.hint !== undefined && { hint: menuEntry.hint })}
            {...(menuEntry.destructive !== undefined && { destructive: menuEntry.destructive })}
            onSelect={() => choose(menuEntry)}
          />
        );
      })}
    </ContextMenu>
  );
}

function FileRow({
  entry,
  onContextMenu,
}: {
  readonly entry: StatusEntry;
  readonly onContextMenu: (entry: StatusEntry, x: number, y: number) => void;
}) {
  const selected = useWorkspaceStore((state) => state.selectedFile);
  const selectFile = useWorkspaceStore((state) => state.selectFile);
  const openMerge = useWorkspaceStore((state) => state.openMerge);

  const path = displayPath(entry);
  const dir = fileDir(path);
  const sides = sidesOf(entry);
  const isSelected = selected?.path === entry.path;

  return (
    <div
      className={`${styles.file} ${isSelected ? styles.selected : ''}`}
      onClick={() => selectFile({ path: entry.path, side: defaultSide(entry) })}
      onContextMenu={(event) => {
        event.preventDefault();
        // Select as well as open: every action in the menu is about this file,
        // and leaving the diff pane showing a different one is disorienting.
        selectFile({ path: entry.path, side: defaultSide(entry) });
        onContextMenu(entry, event.clientX, event.clientY);
      }}
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
      {/* A conflict needs somewhere to go. The badge alone says "this is
          broken" without saying what to do about it. */}
      {isConflicted(entry) && (
        <button
          type="button"
          className={styles.resolve}
          title="Resolve this conflict"
          onClick={(event) => {
            event.stopPropagation();
            openMerge();
          }}
        >
          Resolve
        </button>
      )}
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
