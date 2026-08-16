import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatusEntry } from '@/services/git';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type * as StatusDisplayModule from './statusDisplay';

/**
 * That typing in the filter box does not re-sort the whole file list
 * (PLAN.md §10, item 4 — "assert render counts in tests for the big lists").
 *
 * This is the half of that item worth having. The other half — whether every
 * visible row re-renders when one is selected — was measured at 23 rows and
 * left alone, because a windowed list re-rendering its window is bounded work
 * (`features/history/JournalView.rerender.test.tsx`). This one is not bounded
 * by the viewport: `sortEntries` runs over every entry the panel holds, with
 * `localeCompare`, and **measured 14.2ms at 50,000 entries** — which is the
 * "List every file" escape hatch (7.2), one click away on the benchmark
 * repository. The filter pass that a keystroke is actually for is 2.1ms.
 *
 * The regression this guards is silent and easy: hoisting a `useMemo` out, or
 * adding a dependency that changes per keystroke, restores the 14ms without
 * changing a single pixel of what renders.
 */

const entries: StatusEntry[] = ['zebra.txt', 'alpha.txt', 'middle.txt'].map((path) => ({
  path,
  kind: 'ordinary',
  index: '.',
  worktree: 'M',
}));

let sortCalls = 0;

vi.mock('./statusDisplay', async (importOriginal) => {
  const actual = await importOriginal<typeof StatusDisplayModule>();
  return {
    ...actual,
    sortEntries: (input: readonly StatusEntry[]): StatusEntry[] => {
      sortCalls += 1;
      return actual.sortEntries(input);
    },
  };
});

/*
 * Returned by reference, not rebuilt per call — because that is what TanStack
 * Query does.
 *
 * Written the obvious way (a fresh object literal inside the hook) this test
 * fails, and fails *honestly-looking*: the memo below really does recompute,
 * because its `status` dependency really is a new object every render. But
 * that would be measuring the mock. TanStack keeps `data` referentially stable
 * between renders — structural sharing is one of its load-bearing features,
 * and the memo in `FileList` depends on it. A double that reallocated on every
 * call would make the memo untestable and would also be lying about the
 * library.
 */
const statusResult = {
  data: { entries, branch: 'main', ahead: 0, behind: 0 },
  isPending: false,
  error: null,
};
let ignoredResult: { data: StatusEntry[]; isFetching: boolean } = { data: [], isFetching: false };

vi.mock('@/queries/git', () => ({
  useStatus: () => statusResult,
  useIgnoredFiles: () => ignoredResult,
}));
vi.mock('./useFileMenuActions', () => ({ useFileMenuActions: () => vi.fn() }));

const { FileList } = await import('./FileList');

/** jsdom has no layout, and the list inside is virtualized. See `JournalView.test.tsx`. */
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
      return this.getAttribute('data-index') === null ? 600 : 24;
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
  sortCalls = 0;
  ignoredResult = { data: [], isFetching: false };
  useWorkspaceStore.setState({
    repoPath: '/repos/big-files',
    panelFilters: { files: null, branches: null, remotes: null },
    statusFilters: [],
    selectedFile: null,
  });
});

afterEach(() => {
  restoreLayout();
});

describe('FileList render cost', () => {
  it('does not re-sort when the filter text changes', () => {
    render(<FileList />);
    const afterMount = sortCalls;
    expect(afterMount).toBeGreaterThan(0);

    // Three keystrokes' worth. The sorted order cannot have changed — the
    // entries did not — so the sort must not run again.
    act(() => {
      useWorkspaceStore.getState().setPanelFilter('files', 'a');
    });
    act(() => {
      useWorkspaceStore.getState().setPanelFilter('files', 'al');
    });
    act(() => {
      useWorkspaceStore.getState().setPanelFilter('files', 'alp');
    });

    expect(sortCalls).toBe(afterMount);
  });

  it('does not re-sort when the selection changes either', () => {
    // Selecting a file re-renders the panel and changes nothing about which
    // files there are or what order they go in.
    render(<FileList />);
    const afterMount = sortCalls;

    act(() => {
      useWorkspaceStore.getState().selectFile({ path: 'alpha.txt', side: 'worktree' });
    });

    expect(sortCalls).toBe(afterMount);
  });

  it('says the Ignored chip is still working, even with rows already on screen', () => {
    /*
     * The gap this closes (PLAN.md §10, 7.9). The old condition rendered the
     * "Listing ignored files…" notice only when the list was *empty*, so the
     * one repository where the query is genuinely slow — 3434ms on the 500k
     * benchmark, which also has 50,000 untracked files and therefore a very
     * non-empty list — was exactly the repository that got no notice at all.
     */
    ignoredResult = { data: [], isFetching: true };
    render(<FileList />);

    expect(screen.getByText('Listing ignored files…')).toBeTruthy();
  });

  it('still re-sorts when the status filter chips change', () => {
    /*
     * The memo has to depend on the things that genuinely change the answer,
     * and a test that only proves it never recomputes would pass against a
     * memo with an empty dependency array — which is the other way to get this
     * wrong, and the one that shows stale files on screen.
     */
    render(<FileList />);
    const afterMount = sortCalls;

    act(() => {
      useWorkspaceStore.getState().setStatusFilters(['ignored']);
    });

    expect(sortCalls).toBeGreaterThan(afterMount);
  });
});
