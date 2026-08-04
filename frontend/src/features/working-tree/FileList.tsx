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
import { useIgnoredFiles, useStatus } from '@/queries/git';
import { FilterBox } from '@/features/search/FilterBox';
import { filterBy } from '@/features/search/matchText';
import { isConflicted, type StatusEntry } from '@/services/git';
import { useWorkspaceStore, type FileSide } from '@/stores/workspaceStore';
import {
  defaultSide,
  displayPath,
  sidesOf,
  sortEntries,
  splitPath,
  type DisplayStatus,
} from './statusDisplay';
import { matchesStatusFilters } from './statusFilters';
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
 *
 * The other two columns are FILE and PATH. They were one cell until Phase 6.12,
 * which rendered `Header.tsxsrc/components/` — and, for a rename, ran the
 * directory split over the whole `old → new` string. `splitPath` is what makes
 * the right answer expressible; see its comment.
 */
export function FileList() {
  const repoPath = useWorkspaceStore((state) => state.repoPath);
  const filter = useWorkspaceStore((state) => state.panelFilters.files);
  const statusFilters = useWorkspaceStore((state) => state.statusFilters);
  const setStatusFilters = useWorkspaceStore((state) => state.setStatusFilters);
  const { data: status, isPending, error } = useStatus(repoPath);
  // Only fetched while the chip is on — it is the expensive query in the panel.
  const showIgnored = statusFilters.includes('ignored');
  const { data: ignored, isFetching: ignoredLoading } = useIgnoredFiles(repoPath, showIgnored);

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

  // The ordinary status never reports ignored entries — `STATUS_ARGS` does not
  // ask for them — so they arrive from their own query and are merged in here
  // rather than being filtered out of one list.
  const files = sortEntries([
    ...status.entries.filter((entry) => entry.kind !== 'ignored'),
    ...(showIgnored ? (ignored ?? []) : []),
  ]);

  if (files.length === 0 && !ignoredLoading) {
    return (
      <>
        <FilterBox panel="files" placeholder="Filter files" />
        <PanelBody>
          <EmptyState icon={Icons.Clean} message="No changes in working directory" />
        </PanelBody>
      </>
    );
  }

  const byStatus = files.filter((entry) => matchesStatusFilters(entry, statusFilters));
  // Matched on the display path, which for a rename is `old → new` — so either
  // half of a rename finds it, and that is the row the user is looking for.
  const visible = filterBy(byStatus, filter, (entry) => [displayPath(entry)]);

  return (
    <>
      <FilterBox
        panel="files"
        placeholder="Filter files"
        matched={visible.length}
        total={files.length}
      />
      <PanelBody>
        {/* No column header over no columns of data. It also costs 27px of a
            pane that is routinely ~115px tall, which is the difference between
            an empty state's escape hatch being on screen and being below the
            fold — measured, once it was. */}
        {visible.length > 0 && (
          <div className={styles.columns}>
            <div className={styles.statusCell}>Status</div>
            <div className={styles.nameCell}>File</div>
            <div className={styles.pathCell}>Path</div>
          </div>
        )}
        {/* Three empty states, because three different things went wrong and
            only one of them is fixed by clearing the chips. */}
        {ignoredLoading && files.length === 0 && (
          <EmptyState icon={Icons.Sync} message="Listing ignored files…" />
        )}
        {visible.length === 0 && byStatus.length > 0 && (
          <EmptyState icon={Icons.File} message="No files match this filter" />
        )}
        {byStatus.length === 0 && files.length > 0 && (
          <div className={styles.filteredOut}>
            <EmptyState icon={Icons.Filter} message="No files match the selected statuses" />
            <button
              type="button"
              className={styles.clearChips}
              onClick={() => setStatusFilters([])}
            >
              Clear status filters
            </button>
          </div>
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
  const { name, dir } = splitPath(entry);
  const sides = sidesOf(entry);
  const isSelected = selected?.path === entry.path;
  const isIgnored = entry.kind === 'ignored';

  return (
    <div
      className={`${styles.file} ${isSelected ? styles.selected : ''} ${
        isIgnored ? styles.ignoredRow : ''
      }`}
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
        {/* An ignored entry has no XY pair at all, so the two positional slots
            would both render as "unchanged" dots — which reads as a file with
            nothing wrong rather than one git has been told to skip. */}
        {isIgnored ? (
          <StatusBadge status="ignored" />
        ) : (
          <>
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
          </>
        )}
      </div>
      <div className={styles.nameCell}>{name}</div>
      <div className={styles.pathCell}>
        {/* `unicode-bidi: plaintext` takes the run direction from the first
            strong character, so the `→` in a rename cannot be reordered by the
            `direction: rtl` that truncates this cell from the left. */}
        <span className={styles.dirText}>
          <span className={styles.dirBidi}>{dir}</span>
        </span>
        {entry.submodule !== undefined && <span className={styles.marker}>submodule</span>}
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
