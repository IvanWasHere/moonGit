import { useEffect, useRef, useState } from 'react';
import { Icons } from '@/components/icons';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { describeQuery, parseCommitQuery } from './commitQuery';
import styles from './Search.module.css';

/**
 * The Journal's search bar (ui-example L755's Search button, made real).
 *
 * **Typing is local; the store lags behind it.** The store value is a query
 * key, so writing to it on every keystroke would start a `git log` per
 * character — eight of them for "parser", seven of which are already stale
 * when they return. The input keeps its own state and pushes to the store on a
 * pause, which is the difference between a search box and a fork bomb.
 *
 * The pause is 250ms: long enough to swallow a burst of typing, short enough
 * that it reads as immediate. Enter commits early for anyone who does not want
 * to wait for it.
 */
const DEBOUNCE_MS = 250;

export function SearchBar({
  matched,
  hasMore,
}: {
  readonly matched?: number;
  /** Whether more results remain unfetched, which makes `matched` a floor. */
  readonly hasMore?: boolean;
}) {
  const logQuery = useWorkspaceStore((state) => state.logQuery);
  const setLogQuery = useWorkspaceStore((state) => state.setLogQuery);
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(logQuery ?? '');
  const [synced, setSynced] = useState(logQuery);

  const isOpen = logQuery !== null;

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  /*
   * Adopt the store's value when it changes underneath us — the Filter button
   * priming the box with `path:`, a repository switch clearing it.
   *
   * Adjusted during render against a remembered copy rather than in an effect:
   * an effect would render once with the stale draft and then again with the
   * new one, and the first of those two renders is a visible flash of the
   * previous repository's query. The inequality guard is what keeps this from
   * fighting the debounce below — when the store is merely catching up to the
   * draft, there is nothing to adopt.
   */
  if (logQuery !== synced) {
    setSynced(logQuery);
    if (logQuery !== null && logQuery !== draft) setDraft(logQuery);
  }

  useEffect(() => {
    if (!isOpen || draft === logQuery) return;
    const timer = setTimeout(() => setLogQuery(draft), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, isOpen, logQuery, setLogQuery]);

  if (!isOpen) return null;

  const query = parseCommitQuery(logQuery);
  const chips = describeQuery(query);

  return (
    <>
      <div className={styles.bar}>
        <span className={styles.icon}>
          <Icons.Search size={11} />
        </span>
        <input
          ref={inputRef}
          className={styles.input}
          placeholder='fix parser · author:ivan · path:src · since:"2 weeks ago"'
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') setLogQuery(draft);
            // Escape closes and clears — one field holds both, so it cannot
            // leave the Journal filtered by a query that is no longer visible.
            if (event.key === 'Escape') setLogQuery(null);
          }}
        />
        {!query.isEmpty && matched !== undefined && (
          <span className={styles.count}>
            {matched}
            {/*
             * The Journal pages, so `matched` is how many results have been
             * loaded and not how many exist. Counting the rest means a second
             * full walk of the history to answer a question nobody asked, so
             * the number says what it knows and the plus says there is more —
             * which is also what stops "200 matches" turning into "400
             * matches" under the reader as they scroll, with no explanation.
             */}
            {hasMore === true && '+'} match{matched === 1 && hasMore !== true ? '' : 'es'}
          </span>
        )}
        <button
          type="button"
          className={styles.clear}
          title="Close search"
          onClick={() => setLogQuery(null)}
        >
          <Icons.Close size={11} />
        </button>
      </div>
      {chips.length > 0 && (
        <div className={styles.chips}>
          {chips.map((chip) => (
            <span key={chip} className={styles.chip}>
              {chip}
            </span>
          ))}
        </div>
      )}
    </>
  );
}
