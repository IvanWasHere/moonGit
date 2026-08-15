import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Commit } from '@/services/git';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { BASE_ROW_HEIGHT } from './rowHeight';

/**
 * That the Journal renders a *window* of its commits rather than all of them.
 *
 * This is the one claim of the virtualization that nothing else can check.
 * A screenshot cannot: two hundred rows and fifteen rows look identical when
 * only fifteen fit on screen. The rules around it — the height estimate — are
 * covered as pure functions in `rowHeight.test.ts`. What is left is whether the
 * component actually wires them to a virtualizer, and the honest failure mode
 * here is not a crash but a list that quietly renders everything and is exactly
 * as slow as before.
 *
 * **jsdom has no layout**, so the two things a virtualizer reads from the DOM
 * are supplied below: a `ResizeObserver`, and rects. Without them every element
 * is 0×0, the visible range collapses, and the test would pass against a
 * component that does nothing. The stubs are the test's subject, not its
 * scaffolding — see `VIEWPORT_HEIGHT`.
 */

const VIEWPORT_HEIGHT = 600;
const COMMIT_COUNT = 2000;

/** Roughly how many rows fit, which is what the window should be built around. */
const FITTING = Math.ceil(VIEWPORT_HEIGHT / BASE_ROW_HEIGHT);

function commitAt(index: number): Commit {
  const oid = String(index).padStart(40, '0');
  return {
    oid,
    shortOid: oid.slice(0, 7),
    parents: index === 0 ? [] : [String(index - 1).padStart(40, '0')],
    author: { name: 'Author', email: 'a@example.com', date: 1_700_000_000 - index },
    committer: { name: 'Author', email: 'a@example.com', date: 1_700_000_000 - index },
    subject: `commit ${index}`,
    body: '',
    decorations: [],
    isMerge: false,
    isRoot: index === 0,
  };
}

const commits = Array.from({ length: COMMIT_COUNT }, (_unused, index) => commitAt(index));

/**
 * One page of everything, and no next page.
 *
 * The paging itself is not what these tests are about — they exist to prove
 * the list renders a window rather than all of it, and that claim is the same
 * whether the rows arrived in one fetch or ten. Handing over the whole 2,000
 * up front keeps the fixture about virtualization.
 */
const fetchNextPage = vi.fn();
vi.mock('@/queries/git', () => ({
  useLogPages: () => ({
    data: { pages: [commits], pageParams: [0] },
    isPending: false,
    error: null,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage,
  }),
}));
vi.mock('./useCommitMenuActions', () => ({ useCommitMenuActions: () => vi.fn() }));

const { JournalView } = await import('./JournalView');

/**
 * Give jsdom just enough layout for a virtualizer to work against.
 *
 * Heights only, and specifically `offsetHeight` — which is what virtual-core
 * reads, both to size the viewport (`getRect`) and to measure a rendered row
 * (`measureElement`). jsdom hardcodes it to 0, and a viewport of zero means an
 * empty visible range, which would make every assertion below pass against a
 * component that renders nothing at all.
 *
 * `ResizeObserver` is stubbed inert rather than simulated: virtual-core takes
 * an initial measurement directly before ever constructing one, and that first
 * reading is all a test with no resizes needs.
 */
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
      // A row identifies itself the same way `measureElement` finds it.
      return this.getAttribute('data-index') === null ? VIEWPORT_HEIGHT : BASE_ROW_HEIGHT;
    },
  });

  return () => {
    globalThis.ResizeObserver = realObserver;
    // jsdom always defines `offsetHeight` (hardcoded to 0), so there is always
    // a descriptor to put back. The guard is for an environment that does not.
    if (realHeight !== undefined) {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', realHeight);
    }
  };
}

let restoreLayout: () => void;

beforeEach(() => {
  restoreLayout = stubLayout();
  useWorkspaceStore.setState({
    repoPath: '/repos/big-history',
    selectedCommit: null,
    logPath: null,
    logAll: false,
    logQuery: null,
  });
});

afterEach(() => {
  restoreLayout();
});

/**
 * Every commit row currently in the DOM.
 *
 * Found by subject text and then walked up to the positioned row, rather than
 * queried by class: the class names are CSS-Module hashes, and a test that
 * asserted them would break on an unrelated stylesheet edit.
 */
function renderedRows(): HTMLElement[] {
  return screen
    .getAllByText(/^commit \d+$/)
    .map((node) => node.closest<HTMLElement>('[data-index]'))
    .filter((row): row is HTMLElement => row !== null);
}

describe('JournalView virtualization', () => {
  it('renders a window of rows, not the whole history', () => {
    render(<JournalView />);

    const rendered = renderedRows().length;

    // The real assertion. `toBeLessThan(COMMIT_COUNT)` alone would pass on an
    // off-by-one, so the bound is tied to what actually fits plus the overscan
    // above and below — generous enough not to be brittle, tight enough that a
    // component rendering everything cannot slip through.
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(FITTING * 4);
  });

  it('starts at the newest commit', () => {
    render(<JournalView />);

    // Unscrolled, the window is the top of the list. A virtualizer that
    // rendered *some* rows but the wrong ones would satisfy the count check
    // above while showing the user the middle of their history.
    expect(screen.getByText('commit 0')).toBeInTheDocument();
    expect(screen.queryByText(`commit ${COMMIT_COUNT - 1}`)).not.toBeInTheDocument();
  });

  it('sizes the spacer for every commit, so the scrollbar reflects the history', () => {
    const { container } = render(<JournalView />);

    // The rows in the DOM are a screenful; the scrollable height must not be.
    // This is what makes the scrollbar honest, and it is the half of
    // virtualization that silently goes missing when the spacer is forgotten.
    const spacer = container.querySelector<HTMLElement>('[style*="height"]');
    const height = Number.parseInt(spacer?.style.height ?? '0', 10);

    expect(height).toBeGreaterThanOrEqual(COMMIT_COUNT * BASE_ROW_HEIGHT);
  });

  it('positions rows down the spacer rather than stacking them', () => {
    render(<JournalView />);

    const offsets = renderedRows().map((row) => row.style.transform);

    // Absolutely positioned rows all default to the top of the container. If
    // the per-row translate were dropped the list would still "render" — every
    // row drawn on top of the first, which reads as a one-row Journal.
    expect(new Set(offsets).size).toBe(offsets.length);
    expect(offsets[0]).toBe('translateY(0px)');
  });
});
