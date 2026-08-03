import { useMemo, useState } from 'react';
import { StatusBadge } from '@/components/Badges';
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from '@/components/ContextMenu';
import { EmptyState } from '@/components/EmptyState';
import { Icons } from '@/components/icons';
import { PanelBody } from '@/components/Panel';
import { useDirectory, useStatus, type DirEntry } from '@/queries/git';
import { sidesOf, type EntrySides } from '@/features/working-tree/statusDisplay';
import { useWorkspaceStore, type FileSide } from '@/stores/workspaceStore';
import { useTreeMenuActions } from './useTreeMenuActions';
import styles from './FileTree.module.css';

/**
 * The whole working directory, lazily expanded (PLAN.md §9 item 7).
 *
 * **Read from disk, not from git.** `git ls-files` would give a tidier tree in
 * one call, and it would be missing every file the user has just created — the
 * exact files someone opens an explorer to find. So each level is a
 * `listDir` plus a `check-ignore`, fetched only when its directory is opened.
 *
 * Status badges are looked up from the same `git status` the Changes tab
 * renders, so a file cannot be modified in one tab and clean in the other.
 */
export function FileTree() {
  const repoPath = useWorkspaceStore((state) => state.repoPath);
  const { data: status } = useStatus(repoPath);

  // Path → its two status halves, built once per status change rather than
  // scanned per row: the tree can show hundreds of rows over a status list of
  // hundreds of entries, and that product is felt on every expand.
  const statusByPath = useMemo(() => {
    const map = new Map<string, EntrySides>();
    for (const entry of status?.entries ?? []) {
      if (entry.kind !== 'ignored') map.set(entry.path, sidesOf(entry));
    }
    return map;
  }, [status]);

  const [menu, setMenu] = useState<{ entry: DirEntry; x: number; y: number } | null>(null);

  if (repoPath === null) {
    return (
      <PanelBody>
        <EmptyState icon={Icons.File} message="Select a repository" />
      </PanelBody>
    );
  }

  return (
    <PanelBody>
      <Level dir="" depth={0} statusByPath={statusByPath} onContextMenu={setMenu} />
      {menu !== null && (
        <TreeContextMenu entry={menu.entry} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />
      )}
    </PanelBody>
  );
}

interface LevelProps {
  readonly dir: string;
  readonly depth: number;
  readonly statusByPath: ReadonlyMap<string, EntrySides>;
  readonly onContextMenu: (menu: { entry: DirEntry; x: number; y: number }) => void;
}

/**
 * One directory's children.
 *
 * A component per level rather than one flattened list, because that is what
 * makes the fetch lazy — an unmounted `Level` runs no query, so a collapsed
 * directory costs nothing at all.
 */
function Level({ dir, depth, statusByPath, onContextMenu }: LevelProps) {
  const repoPath = useWorkspaceStore((state) => state.repoPath);
  const { data: entries, isPending, error } = useDirectory(repoPath, dir);

  if (error !== null) {
    return (
      <div className={styles.message} style={indent(depth)} title={error.message}>
        Could not read this directory
      </div>
    );
  }
  if (isPending) {
    return (
      <div className={styles.message} style={indent(depth)}>
        Reading…
      </div>
    );
  }
  if (entries.length === 0) {
    return (
      <div className={styles.message} style={indent(depth)}>
        Empty
      </div>
    );
  }

  return (
    <>
      {entries.map((entry) => (
        <Row
          key={entry.relPath}
          entry={entry}
          depth={depth}
          statusByPath={statusByPath}
          onContextMenu={onContextMenu}
        />
      ))}
    </>
  );
}

/** A row carries no `dir` of its own — it *is* an entry of the level above. */
type RowProps = Omit<LevelProps, 'dir'> & { readonly entry: DirEntry };

function Row({ entry, depth, statusByPath, onContextMenu }: RowProps) {
  const expandedDirs = useWorkspaceStore((state) => state.expandedDirs);
  const toggleDir = useWorkspaceStore((state) => state.toggleDir);
  const selected = useWorkspaceStore((state) => state.selectedFile);
  const selectFile = useWorkspaceStore((state) => state.selectFile);

  const isOpen = expandedDirs.includes(entry.relPath);
  const sides = statusByPath.get(entry.relPath);

  const open = () => {
    if (entry.isDir) {
      toggleDir(entry.relPath);
      return;
    }
    /*
     * A clean file has no diff to show, and the Changes pane says so rather
     * than this tree refusing the click. Selecting it is still the right
     * outcome — the panel header shows the path, and Copy Diff, blame and the
     * file log all key off the selection.
     */
    selectFile({ path: entry.relPath, side: defaultSideFor(sides) });
  };

  return (
    <>
      <div
        className={`${styles.row} ${selected?.path === entry.relPath ? styles.selected : ''} ${
          entry.ignored ? styles.ignored : ''
        }`}
        style={indent(depth)}
        onClick={open}
        onContextMenu={(event) => {
          event.preventDefault();
          if (!entry.isDir) selectFile({ path: entry.relPath, side: defaultSideFor(sides) });
          onContextMenu({ entry, x: event.clientX, y: event.clientY });
        }}
        title={entry.relPath}
      >
        <span className={styles.chevron}>
          {entry.isDir && (isOpen ? <Icons.TreeOpen size={11} /> : <Icons.TreeClosed size={11} />)}
        </span>
        <span className={styles.icon}>
          {entry.isDir ? (
            <Icons.Repository size={12} color="var(--text-muted)" />
          ) : (
            <Icons.File size={12} color="var(--text-muted)" />
          )}
        </span>
        <span className={styles.name}>{entry.name}</span>
        {/* Ignored is a fact about the file, not a status — saying it in words
            beats inventing a badge that means "git will never look at this". */}
        {entry.ignored && <span className={styles.ignoredTag}>ignored</span>}
        {sides !== undefined && (
          <span className={styles.badges}>
            {sides.staged !== null && <StatusBadge status={sides.staged} />}
            {sides.worktree !== null && <StatusBadge status={sides.worktree} />}
          </span>
        )}
      </div>
      {entry.isDir && isOpen && (
        <Level
          dir={entry.relPath}
          depth={depth + 1}
          statusByPath={statusByPath}
          onContextMenu={onContextMenu}
        />
      )}
    </>
  );
}

/**
 * Which diff a click opens, matching the Changes tab's rule: the working tree
 * when it has changes, since that is the one still being worked on.
 */
function defaultSideFor(sides: EntrySides | undefined): FileSide {
  return sides?.worktree !== null && sides !== undefined ? 'worktree' : 'staged';
}

/** 12px per level, from the row's own left padding. */
function indent(depth: number): React.CSSProperties {
  return { paddingLeft: `${8 + depth * 12}px` };
}

/**
 * The tree's context menu.
 *
 * Deliberately not the Changes tab's menu: that one is built from a
 * `StatusEntry` and offers staging and discarding, neither of which means
 * anything for a file with no changes — and most of this tree has none. These
 * four work on any path.
 */
function TreeContextMenu({
  entry,
  x,
  y,
  onClose,
}: {
  readonly entry: DirEntry;
  readonly x: number;
  readonly y: number;
  readonly onClose: () => void;
}) {
  const run = useTreeMenuActions();
  const choose = (action: Parameters<typeof run>[1]) => {
    onClose();
    void run(entry, action);
  };

  return (
    <ContextMenu x={x} y={y} onClose={onClose}>
      {!entry.isDir && <ContextMenuItem label="Open File" onSelect={() => choose('open')} />}
      <ContextMenuItem label="Reveal in Finder" onSelect={() => choose('reveal')} />
      <ContextMenuSeparator />
      <ContextMenuItem label="Copy Path" onSelect={() => choose('copyPath')} />
      <ContextMenuItem
        label={entry.isDir ? 'Show History for Folder' : 'Show History'}
        onSelect={() => choose('history')}
      />
    </ContextMenu>
  );
}
