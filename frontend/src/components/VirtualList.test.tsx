import { render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VirtualList } from './VirtualList';

/**
 * The two ways a virtualized list fails silently.
 *
 * Neither shows up as an error, and both look identical to a correct list in
 * jsdom unless the layout it reads is supplied — which is what `stubLayout`
 * below is for. Without it every element is 0×0, the visible range collapses,
 * and these tests would pass against a component that renders nothing.
 *
 * That is not hypothetical: rendering nothing is exactly how the Files panel
 * came up when this component was first wired in — a correctly sized scrollbar
 * over a completely empty list, because the scroll element arrived one commit
 * too late. See `mountsAfterItsParent` below.
 */

const VIEWPORT_HEIGHT = 400;
const ROW_HEIGHT = 25;
const COUNT = 1000;

const items = Array.from({ length: COUNT }, (_unused, index) => ({
  id: `item-${index}`,
  label: `row ${index}`,
}));

function stubLayout(): () => void {
  const realObserver = globalThis.ResizeObserver;
  const realHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');

  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };

  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement): number {
      return this.getAttribute('data-index') === null ? VIEWPORT_HEIGHT : ROW_HEIGHT;
    },
  });

  return () => {
    globalThis.ResizeObserver = realObserver;
    if (realHeight !== undefined) {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', realHeight);
    }
  };
}

/**
 * A host shaped like the real callers: the scrolling element is an *ancestor*
 * of the list, not the list itself.
 *
 * The nesting is the point. React attaches a child's refs before its parent's,
 * so a `VirtualList` inside a scroller sees a null element on its first pass —
 * which is the whole hazard this file exists to pin down.
 */
function Host() {
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  return (
    <div ref={setScrollElement} data-testid="scroller">
      <VirtualList
        items={items}
        scrollElement={scrollElement}
        getKey={(item) => item.id}
        estimateHeight={() => ROW_HEIGHT}
        renderRow={(item) => <div>{item.label}</div>}
      />
    </div>
  );
}

let restore: () => void;
beforeEach(() => {
  restore = stubLayout();
});
afterEach(() => {
  restore();
});

describe('VirtualList', () => {
  /*
   * The bug this component shipped with for one commit, and the reason
   * `scrollElement` is state rather than a ref.
   *
   * With a ref object the parent's `.current` is still null while this
   * component's effects run, so the virtualizer resolves a null scroller,
   * measures a zero-height viewport, and renders nothing at all — under a
   * spacer sized for the full list, so the scrollbar looks perfectly healthy.
   * A list that re-renders for other reasons recovers on the next pass and
   * hides it, which is why the paging Journal worked and the static Files
   * panel did not.
   */
  it('renders rows even though it mounts before its parent ref attaches', () => {
    render(<Host />);

    expect(screen.getByText('row 0')).toBeInTheDocument();
    expect(screen.getAllByText(/^row \d+$/).length).toBeGreaterThan(0);
  });

  it('renders a window, not every row', () => {
    render(<Host />);

    const rendered = screen.getAllByText(/^row \d+$/).length;
    const fitting = VIEWPORT_HEIGHT / ROW_HEIGHT;

    expect(rendered).toBeLessThan(fitting * 4);
    expect(screen.queryByText(`row ${COUNT - 1}`)).not.toBeInTheDocument();
  });

  it('sizes the spacer for every row, so the scrollbar is honest', () => {
    const { container } = render(<Host />);

    const spacer = container.querySelector<HTMLElement>('[style*="height"]');
    expect(Number.parseInt(spacer?.style.height ?? '0', 10)).toBe(COUNT * ROW_HEIGHT);
  });

  /*
   * Absolutely positioned rows all default to the top of the container, so a
   * dropped transform still "renders" — every row stacked on the first, which
   * reads as a one-row list rather than as a bug.
   */
  it('gives every row a distinct offset', () => {
    const { container } = render(<Host />);

    const offsets = [...container.querySelectorAll<HTMLElement>('[data-index]')].map(
      (row) => row.style.transform,
    );

    expect(offsets.length).toBeGreaterThan(1);
    expect(new Set(offsets).size).toBe(offsets.length);
    expect(offsets[0]).toBe('translateY(0px)');
  });

  it('renders nothing at all for an empty list, without collapsing', () => {
    function EmptyHost() {
      const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
      return (
        <div ref={setScrollElement}>
          <VirtualList
            items={[]}
            scrollElement={scrollElement}
            getKey={() => 'none'}
            estimateHeight={() => ROW_HEIGHT}
            renderRow={() => <div>never</div>}
          />
        </div>
      );
    }
    const { container } = render(<EmptyHost />);

    expect(screen.queryByText('never')).not.toBeInTheDocument();
    expect(container.querySelectorAll('[data-index]')).toHaveLength(0);
  });
});
