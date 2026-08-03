import { useEffect, useRef } from 'react';
import { Icons } from '@/components/icons';
import { useWorkspaceStore, type FilterablePanel } from '@/stores/workspaceStore';
import styles from './Search.module.css';

/**
 * The inline filter strip above a panel's list.
 *
 * Renders nothing when the panel's filter is null — the panel header's funnel
 * button is what opens it. That keeps 30px of a small pane free until it is
 * asked for, which matters: Branches and Files can both be a few rows tall.
 *
 * Escape closes *and* clears, because the two are the same field (see
 * `workspaceStore.panelFilters`). A filter that survived its own dismissal
 * would leave a list quietly truncated with nothing on screen explaining why.
 */
export function FilterBox({
  panel,
  placeholder,
  matched,
  total,
}: {
  readonly panel: FilterablePanel;
  readonly placeholder: string;
  /** Rows after filtering, shown as `n of m` so an over-narrow filter is legible. */
  readonly matched?: number;
  readonly total?: number;
}) {
  const filter = useWorkspaceStore((state) => state.panelFilters[panel]);
  const setPanelFilter = useWorkspaceStore((state) => state.setPanelFilter);
  const inputRef = useRef<HTMLInputElement>(null);
  const isOpen = filter !== null;

  // Focus on open. Without it the button is a two-step: click, then click again
  // into the box that just appeared.
  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  if (filter === null) return null;

  return (
    <div className={styles.bar}>
      <span className={styles.icon}>
        <Icons.Filter size={11} />
      </span>
      <input
        ref={inputRef}
        className={styles.input}
        placeholder={placeholder}
        value={filter}
        onChange={(event) => setPanelFilter(panel, event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setPanelFilter(panel, null);
        }}
      />
      {filter !== '' && matched !== undefined && total !== undefined && (
        <span className={styles.count}>
          {matched} of {total}
        </span>
      )}
      <button
        type="button"
        className={styles.clear}
        title="Close filter"
        onClick={() => setPanelFilter(panel, null)}
      >
        <Icons.Close size={11} />
      </button>
    </div>
  );
}
