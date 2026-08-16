import { useEffect, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import styles from './VirtualList.module.css';

/**
 * A list that renders only the rows in view (PLAN.md §10).
 *
 * Extracted from `JournalView` once the Files panel needed the same thing.
 * Deliberately not extracted when the Journal was the only caller: an
 * abstraction shaped by one consumer is a guess, and the two turned out to
 * differ in exactly the way that matters — the Journal's rows vary in height
 * and the Files panel's do not — which is why measurement is unconditional
 * below rather than an option.
 *
 * **It does not own the scroll element.** The caller passes its own
 * `PanelBody`, because `PanelBody` being the only scrolling element in a panel
 * is what keeps the panel header pinned; a list that made its own scroller
 * would nest a second one and the header would scroll away with the content.
 * That also lets the caller put a sticky column header, a filter banner or a
 * loading footer around the rows as ordinary siblings.
 *
 * **It is passed as state, not as a ref, and that is load-bearing.** React
 * attaches a child's refs before its parent's, so this component's effects run
 * while a parent `ref` object is still null — the virtualizer resolves a null
 * scroller, measures a zero-height viewport, and renders no rows at all. A
 * list that re-renders for other reasons recovers on the next pass and hides
 * the bug; a static one never does, which is exactly how it presented — the
 * paging Journal worked and the Files panel came up blank with a correctly
 * sized scrollbar. A callback ref writing to `useState` re-renders on attach,
 * so the virtualizer always gets a second look.
 *
 * **Rows must be a whole number of pixels tall.** virtual-core measures with
 * `offsetHeight`, an integer, and lays rows out at the running total of those
 * measurements, so a row that is really 72.8px gets recorded as 73 and the
 * next one starts 0.2px after this one ends. The resulting hairline is
 * invisible in text and very visible through anything drawn across the row
 * boundary — it is what sliced the commit graph's lanes once per row. Pin
 * line-heights rather than leaving them to font metrics; see `.entry` in
 * `features/history/History.module.css` for the worked example.
 */
export interface VirtualListProps<T> {
  readonly items: readonly T[];
  /**
   * The scrolling ancestor — normally a `PanelBody`, held in state by the
   * caller via a callback ref. See the note above on why not a ref object.
   */
  readonly scrollElement: HTMLElement | null;
  /**
   * A stable identity for a row, used to cache its measured height.
   *
   * Not the index, which is what virtual-core would use by default and is
   * wrong wherever the list can be re-filtered: a tall row at position 3
   * leaves its height behind for whatever short row replaces it, and the list
   * lays out with gaps and overlaps until each one happens to be re-measured.
   */
  readonly getKey: (item: T) => string;
  /** A starting guess per row; the rendered ones are measured and correct it. */
  readonly estimateHeight: (item: T | undefined) => number;
  readonly renderRow: (item: T, index: number) => ReactNode;
  /** Rows rendered beyond the viewport, above and below. */
  readonly overscan?: number;
  /**
   * Called while the rendered window is within `endThreshold` rows of the end.
   *
   * For paging. A sentinel element at the bottom of the list would be the
   * usual way, and cannot work here: in a virtualized list the end is not in
   * the DOM until you are already looking at it, so it would fire only once
   * the user had hit the bottom and was already waiting.
   *
   * Called repeatedly while the condition holds — the caller decides whether
   * there is anything to fetch.
   */
  readonly onEndReached?: () => void;
  readonly endThreshold?: number;
}

const DEFAULT_OVERSCAN = 12;

export function VirtualList<T>({
  items,
  scrollElement,
  getKey,
  estimateHeight,
  renderRow,
  overscan = DEFAULT_OVERSCAN,
  onEndReached,
  endThreshold = 0,
}: VirtualListProps<T>) {
  /*
   * `react-hooks/incompatible-library` warns that the React Compiler cannot
   * memoize what this returns — the virtualizer hands back functions whose
   * results change without their arguments changing, which is the whole
   * mechanism of reading a live scroll position.
   *
   * Suppressed rather than worked around because the compiler is not enabled
   * in this build (`vite.config.ts` uses the plain React plugin), so the
   * warning describes a hazard that does not exist yet. Whoever turns the
   * compiler on needs to opt this component out with a `'use no memo'`
   * directive, and will find this comment when the warning becomes an error.
   */
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollElement,
    estimateSize: (index) => estimateHeight(items[index]),
    getItemKey: (index) => {
      const item = items[index];
      return item === undefined ? index : getKey(item);
    },
    overscan,
  });

  const virtualRows = virtualizer.getVirtualItems();
  const lastIndex = virtualRows[virtualRows.length - 1]?.index ?? 0;

  useEffect(() => {
    if (onEndReached === undefined) return;
    if (lastIndex >= items.length - endThreshold) onEndReached();
  }, [lastIndex, items.length, endThreshold, onEndReached]);

  return (
    <div className={styles.viewport} style={{ height: virtualizer.getTotalSize() }}>
      {virtualRows.map((virtualRow) => {
        const item = items[virtualRow.index];
        if (item === undefined) return null;
        return (
          <div
            key={virtualRow.key}
            // Both are `measureElement`'s contract: it reads the index off the
            // node to know which row it just measured.
            data-index={virtualRow.index}
            ref={virtualizer.measureElement}
            className={styles.row}
            style={{ transform: `translateY(${virtualRow.start}px)` }}
          >
            {renderRow(item, virtualRow.index)}
          </div>
        );
      })}
    </div>
  );
}
