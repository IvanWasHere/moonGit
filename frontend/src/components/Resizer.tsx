import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import styles from './Resizer.module.css';

/**
 * Drag-to-resize divider — a port of `createResizer` (ui-example L384–417).
 *
 * The percentage maths is deliberately identical to the mockup's: the pointer
 * position is measured against the *container's* rect, not against the panel
 * being resized, so dragging tracks the cursor exactly rather than drifting by
 * the width of everything before it. Callers pass `onResize` a percentage and
 * do any arithmetic themselves, which is how the mockup's nested resizers
 * (L753, L772–774) subtract sibling sizes.
 *
 * One faithful quirk: `.active` is applied on the first *move*, not on
 * mousedown (L389). A click that never moves therefore never highlights.
 */

export interface ResizerProps {
  /** `v` splits left/right and drags horizontally; `h` splits top/bottom. */
  readonly axis: 'v' | 'h';
  /** The element the percentage is measured against. */
  readonly containerRef: RefObject<HTMLElement | null>;
  readonly min: number;
  readonly max: number;
  readonly onResize: (percent: number) => void;
  readonly title?: string;
}

export function Resizer({ axis, containerRef, min, max, onResize, title }: ResizerProps) {
  const [active, setActive] = useState(false);
  // Held in a ref so the listeners attached on mousedown always see the
  // current callback without being torn down and re-attached mid-drag.
  // Written in an effect, not during render: a layout that re-renders while a
  // drag is in flight would otherwise mutate a ref mid-paint.
  const onResizeRef = useRef(onResize);
  useEffect(() => {
    onResizeRef.current = onResize;
  }, [onResize]);

  const handleMouseDown = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();

      const handleMove = (moveEvent: MouseEvent) => {
        setActive(true);
        const container = containerRef.current;
        if (container === null) return;

        const rect = container.getBoundingClientRect();
        const raw =
          axis === 'v'
            ? ((moveEvent.clientX - rect.left) / rect.width) * 100
            : ((moveEvent.clientY - rect.top) / rect.height) * 100;

        onResizeRef.current(Math.max(min, Math.min(max, raw)));
      };

      const handleUp = () => {
        setActive(false);
        document.removeEventListener('mousemove', handleMove);
        document.removeEventListener('mouseup', handleUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.addEventListener('mousemove', handleMove);
      document.addEventListener('mouseup', handleUp);
      // Held for the whole drag so the cursor does not flicker to a text
      // caret when the pointer crosses a panel.
      document.body.style.cursor = axis === 'v' ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';
    },
    [axis, containerRef, min, max],
  );

  // A drag interrupted by unmount would otherwise leave the document listeners
  // and the body cursor override in place for the rest of the session.
  useEffect(
    () => () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    },
    [],
  );

  return (
    <div
      className={`${axis === 'v' ? styles.vertical : styles.horizontal} ${active ? styles.active : ''}`}
      onMouseDown={handleMouseDown}
      role="separator"
      aria-orientation={axis === 'v' ? 'vertical' : 'horizontal'}
      {...(title !== undefined && { title })}
    />
  );
}
