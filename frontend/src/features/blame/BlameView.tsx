import { useMemo, useState } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { Icons } from '@/components/icons';
import { PanelBody } from '@/components/Panel';
import { useDialog } from '@/components/useDialog';
import { VirtualList } from '@/components/VirtualList';
import { useBlame } from '@/queries/git';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { toBlameRows, type BlameRow } from './blameRows';
import { fileName } from '@/utils/format';
import { timeAgo } from '@/utils/format';
import styles from './BlameView.module.css';

/**
 * Who last touched each line, and when (PLAN.md §11, 8.8).
 *
 * **Everything under this was already built.** `BLAME_BASE_ARGS`, `parseBlame`,
 * `BlameService` and `useBlame` all shipped in Phase 6, with tests — and the
 * only thing that ever called them was a dev panel. The Blame button in the
 * toolbar said "Blame view arrives in Phase 6" for the whole of Phases 6, 7
 * and 8. This file is the missing screen, not missing plumbing.
 *
 * **Runs are collapsed, and that is the whole readability of the thing.** git
 * reports a commit per line; a file edited in blocks then shows the same hash,
 * author and date repeated down forty consecutive rows, and the eye cannot find
 * where authorship actually *changes* — which is the only question a blame view
 * exists to answer. Metadata is drawn on the first line of each run and the
 * rest of the run is blank, so every label marks a boundary.
 *
 * Virtualized, because a blame is one row per line and source files run to
 * thousands. It reuses `VirtualList` from 7.5 rather than a second windowing
 * implementation.
 */
export function BlameView({ path, onClose }: { readonly path: string; readonly onClose: () => void }) {
  const repoPath = useWorkspaceStore((state) => state.repoPath);
  const { data: blame, isPending, error } = useBlame(repoPath, path);
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const dialog = useDialog(`Blame — ${path}`, onClose);

  const rows = useMemo(() => (blame === undefined ? [] : toBlameRows(blame)), [blame]);

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} {...dialog} onClick={(event) => event.stopPropagation()}>
        <header className={styles.header}>
          <Icons.Blame size={14} color="var(--accent)" />
          <span className={styles.title}>{fileName(path)}</span>
          <span className={styles.path}>{path}</span>
          {blame !== undefined && (
            <span className={styles.count}>
              {blame.lines.length} lines · {blame.commits.size} commits
            </span>
          )}
          <button type="button" className={styles.close} title="Close" onClick={onClose}>
            <Icons.Close size={14} />
          </button>
        </header>

        {isPending && <EmptyState icon={Icons.Sync} message="Reading history for this file…" />}
        {error !== null && <EmptyState icon={Icons.Abort} message={error.message} />}
        {blame !== undefined && rows.length === 0 && (
          <EmptyState icon={Icons.NoDiff} message="This file has no committed content to blame" />
        )}

        {rows.length > 0 && (
          <PanelBody ref={setScrollEl}>
            <VirtualList
              items={rows}
              scrollElement={scrollEl}
              getKey={(row) => String(row.line.finalLine)}
              estimateHeight={() => ROW_HEIGHT}
              renderRow={(row) => <Row row={row} />}
            />
          </PanelBody>
        )}
      </div>
    </div>
  );
}

/** Must match `.row` in the stylesheet — see `VirtualList` on whole pixels. */
const ROW_HEIGHT = 18;

function Row({ row }: { readonly row: BlameRow }) {
  const { line, commit, startsRun } = row;
  return (
    <div className={`${styles.row} ${startsRun ? styles.rowStart : ''}`}>
      {/* Blank for continuation lines — see the note on runs above. */}
      <span className={styles.oid}>{startsRun ? line.oid.slice(0, 7) : ''}</span>
      <span className={styles.author}>{startsRun ? (commit?.author.name ?? '') : ''}</span>
      <span className={styles.when}>
        {startsRun && commit !== undefined ? timeAgo(commit.author.date * 1000) : ''}
      </span>
      <span className={styles.lineNo}>{line.finalLine}</span>
      <span className={styles.content}>{line.content}</span>
    </div>
  );
}
