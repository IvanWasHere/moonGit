import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Commit } from '@/services/git';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { BASE_ROW_HEIGHT } from './rowHeight';

/**
 * How much of the Journal re-renders when one row's selection changes
 * (PLAN.md §10, item 4 — "assert render counts in tests for the big lists").
 *
 * This is the item the plan listed and never touched, and it is the one most
 * at risk of being "fixed" on intuition: `React.memo` is cheap to sprinkle and
 * its cost — a props comparison per row per render, plus a memoized callback
 * to keep the comparison meaningful — is invisible until someone measures. So
 * this file measures first and asserts a bound second. Phase 7 has withdrawn
 * three items on measurement already; this one gets the same treatment.
 *
 * The probe is `CommitGraph`: exactly one renders per visible row, it is the
 * most expensive thing in a row, and it is a real module boundary rather than
 * an instrument bolted on for the test.
 */

const VIEWPORT_HEIGHT = 600;
const COMMIT_COUNT = 500;

let graphRenders = 0;

vi.mock('./CommitGraph', () => ({
  CommitGraph: () => {
    graphRenders += 1;
    return null;
  },
}));

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

vi.mock('@/queries/git', () => ({
  useLogPages: () => ({
    data: { pages: [commits], pageParams: [0] },
    isPending: false,
    error: null,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  }),
}));
vi.mock('./useCommitMenuActions', () => ({ useCommitMenuActions: () => vi.fn() }));

const { JournalView } = await import('./JournalView');

/** As in `JournalView.test.tsx` — jsdom has no layout and a virtualizer needs one. */
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
      return this.getAttribute('data-index') === null ? VIEWPORT_HEIGHT : BASE_ROW_HEIGHT;
    },
  });

  return () => {
    globalThis.ResizeObserver = realObserver;
    if (realHeight !== undefined) {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', realHeight);
    }
  };
}

let restoreLayout: () => void;

beforeEach(() => {
  restoreLayout = stubLayout();
  graphRenders = 0;
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

describe('Journal render cost', () => {
  it('re-renders every visible row when one row is selected', () => {
    /*
     * The measurement, recorded as an assertion so it cannot rot.
     *
     * Selecting a commit changes one row's className and nothing else about
     * the other rows' output — but the rows are rendered by a `renderRow`
     * closure inside `JournalView`, so a store change re-runs all of them.
     * This is what a memo boundary would cut, and the point of pinning it is
     * that the number is the *justification*: a windowed list re-rendering its
     * window is bounded work, and the bound is what makes it a non-problem.
     */
    render(<JournalView />);

    const afterMount = graphRenders;
    expect(afterMount).toBeGreaterThan(0);

    act(() => {
      useWorkspaceStore.getState().selectCommit(commits[0]?.oid ?? null);
    });

    const onSelect = graphRenders - afterMount;

    // Every visible row re-renders, not just the one that changed.
    expect(onSelect).toBe(afterMount);

    /*
     * And the bound that makes it acceptable: the work is proportional to the
     * viewport, not to the history. 500 commits are loaded; a double-digit
     * number of rows re-render. A regression that un-virtualized the list, or
     * handed `VirtualList` an unbounded window, would fail here long before a
     * human noticed the Journal getting slow.
     */
    expect(onSelect).toBeLessThan(COMMIT_COUNT / 4);
  });

  it('does not re-render rows when unrelated workspace state changes', () => {
    /*
     * The selectors are already atomic — `JournalView` subscribes to seven
     * individual fields rather than to an object — and this is what that buys.
     * A future edit that reaches for `useWorkspaceStore((s) => ({ ... }))`, or
     * drops the selector entirely, makes every panel in the app a subscriber
     * to every keystroke in every other panel, and this is the test that
     * notices.
     */
    render(<JournalView />);
    const afterMount = graphRenders;

    act(() => {
      // Belongs to the Files panel. The Journal reads none of it.
      useWorkspaceStore.getState().setPanelFilter('files', 'README');
    });

    expect(graphRenders - afterMount).toBe(0);
  });
});
