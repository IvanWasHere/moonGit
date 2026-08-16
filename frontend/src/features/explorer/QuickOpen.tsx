import { useEffect, useMemo, useRef, useState } from 'react';
import { Icons } from '@/components/icons';
import { filterBy } from '@/features/search/matchText';
import { usePaths, useStatus } from '@/queries/git';
import { sidesOf } from '@/features/working-tree/statusDisplay';
import { StatusBadge } from '@/components/Badges';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { fileDir, fileName } from '@/utils/format';
import styles from './QuickOpen.module.css';
import { useDialog } from '@/components/useDialog';

/**
 * Jump to any file by name (⌘P).
 *
 * The corpus is one `git ls-files` rather than a walk of the tree, and that is
 * the entire reason quick open exists alongside the tree: at the PRD's target
 * size, browsing to a file is thousands of rows of scrolling and typing three
 * characters is not.
 *
 * Matching is `matchText`'s — substring per space-separated term, ANDed —
 * shared with the panel filters rather than reimplemented, so `git log`
 * behaves identically here and in the Files filter box.
 */
const LIMIT = 50;

/**
 * Rendered only while open (`Workspace` mounts it conditionally), which is what
 * keeps the query and the highlight fresh: unmounting resets them, so there is
 * no "clear everything on open" effect to keep in step with the open state.
 */
export function QuickOpen() {
  const close = useWorkspaceStore((state) => state.closeQuickOpen);
  const repoPath = useWorkspaceStore((state) => state.repoPath);
  const selectFile = useWorkspaceStore((state) => state.selectFile);

  const { data: paths, isPending } = usePaths(repoPath);
  const { data: status } = useStatus(repoPath);

  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialog = useDialog('Go to file', close);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const sidesByPath = useMemo(() => {
    const map = new Map<string, ReturnType<typeof sidesOf>>();
    for (const entry of status?.entries ?? []) {
      if (entry.kind !== 'ignored') map.set(entry.path, sidesOf(entry));
    }
    return map;
  }, [status]);

  /*
   * Capped at 50 rows. A two-character query in a large repository matches
   * thousands of paths, and rendering all of them costs more than the search
   * that produced them — while nobody scrolls past the first screen of a
   * fuzzy-finder. The footer says when the list was cut, because a silent cap
   * reads as "that's all there is".
   */
  const matches = useMemo(() => filterBy(paths ?? [], query, (path) => [path]), [paths, query]);
  const shown = matches.slice(0, LIMIT);

  const choose = (path: string) => {
    const sides = sidesByPath.get(path);
    selectFile({ path, side: sides?.worktree != null ? 'worktree' : 'staged' });
    close();
  };

  return (
    <div className={styles.backdrop} onClick={close}>
      <div
        className={styles.panel}
        {...dialog}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.inputRow}>
          <Icons.Search size={13} />
          <input
            ref={inputRef}
            className={styles.input}
            placeholder="Go to file"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              // Any change to the list makes the old highlight meaningless.
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') close();
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActive((index) => Math.min(index + 1, shown.length - 1));
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActive((index) => Math.max(index - 1, 0));
              }
              if (event.key === 'Enter') {
                const path = shown[active];
                if (path !== undefined) choose(path);
              }
            }}
          />
        </div>

        <div className={styles.results}>
          {isPending && <div className={styles.message}>Reading file list…</div>}
          {!isPending && shown.length === 0 && (
            <div className={styles.message}>
              {query === '' ? 'No files in this repository' : 'No files match'}
            </div>
          )}
          {shown.map((path, index) => {
            const sides = sidesByPath.get(path);
            return (
              <div
                key={path}
                className={`${styles.row} ${index === active ? styles.active : ''}`}
                onClick={() => choose(path)}
                // Pointer and keyboard drive one highlight, so a click always
                // lands on the row the user is looking at.
                onMouseEnter={() => setActive(index)}
              >
                <Icons.File size={12} color="var(--text-muted)" />
                <span className={styles.name}>{fileName(path)}</span>
                {/* The trailing slash `fileDir` adds has to go. This column
                    truncates from the left via `direction: rtl`, and a `/` is
                    a bidi-neutral character — at the end of the string it gets
                    reordered to the visual left, rendering `src/components/`
                    as `/src/components`. */}
                <span className={styles.dir}>{fileDir(path).replace(/\/$/, '')}</span>
                {sides !== undefined && (
                  <span className={styles.badges}>
                    {sides.staged !== null && <StatusBadge status={sides.staged} />}
                    {sides.worktree !== null && <StatusBadge status={sides.worktree} />}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {matches.length > shown.length && (
          <div className={styles.footer}>
            Showing {shown.length} of {matches.length} — keep typing to narrow
          </div>
        )}
      </div>
    </div>
  );
}
