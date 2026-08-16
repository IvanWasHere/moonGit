import { describe, expect, it } from 'vitest';
import {
  clickFile,
  EMPTY_SELECTION,
  pruneSelection,
  selectAll,
  type FileSelection,
} from './fileSelection';

/**
 * The selection rules for the Changes list (PLAN.md §11, 8.17).
 *
 * All of it is invisible in a screenshot and most of it is invisible in casual
 * use — a shift-click that measures from the wrong end looks fine until the
 * second shift-click, and a selection holding filtered-away paths looks fine
 * right up until it stages a file nobody could see.
 */

const FILES = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'];
const plain = { toggle: false, range: false };
const toggle = { toggle: true, range: false };
const range = { toggle: false, range: true };

const paths = (s: FileSelection) => [...s.paths].sort();

describe('a plain click', () => {
  it('replaces whatever was selected', () => {
    const first = clickFile(EMPTY_SELECTION, 'a.ts', FILES, plain);
    const second = clickFile(first, 'c.ts', FILES, plain);
    expect(paths(second)).toEqual(['c.ts']);
  });

  it('sets the anchor and the active row', () => {
    const s = clickFile(EMPTY_SELECTION, 'b.ts', FILES, plain);
    expect(s.anchor).toBe('b.ts');
    expect(s.active).toBe('b.ts');
  });
});

describe('⌘-click', () => {
  it('adds without disturbing the rest', () => {
    let s = clickFile(EMPTY_SELECTION, 'a.ts', FILES, plain);
    s = clickFile(s, 'c.ts', FILES, toggle);
    expect(paths(s)).toEqual(['a.ts', 'c.ts']);
  });

  it('removes a row that was already selected', () => {
    let s = selectAll(FILES);
    s = clickFile(s, 'c.ts', FILES, toggle);
    expect(paths(s)).toEqual(['a.ts', 'b.ts', 'd.ts', 'e.ts']);
  });

  it('moves the diff off a row it just deselected', () => {
    // Otherwise the Changes pane shows a file that is no longer selected.
    let s = clickFile(EMPTY_SELECTION, 'a.ts', FILES, plain);
    s = clickFile(s, 'b.ts', FILES, toggle);
    expect(s.active).toBe('b.ts');
    s = clickFile(s, 'b.ts', FILES, toggle);
    expect(s.active).not.toBe('b.ts');
    expect(s.paths.has(s.active ?? '')).toBe(true);
  });
});

describe('shift-click', () => {
  it('takes everything between the anchor and here', () => {
    let s = clickFile(EMPTY_SELECTION, 'b.ts', FILES, plain);
    s = clickFile(s, 'd.ts', FILES, range);
    expect(paths(s)).toEqual(['b.ts', 'c.ts', 'd.ts']);
  });

  it('works upwards as well as downwards', () => {
    let s = clickFile(EMPTY_SELECTION, 'd.ts', FILES, plain);
    s = clickFile(s, 'b.ts', FILES, range);
    expect(paths(s)).toEqual(['b.ts', 'c.ts', 'd.ts']);
  });

  it('re-measures from the same anchor, so a range can shrink', () => {
    /*
     * The bug this exists for: if the anchor moved to the end of each range,
     * a second shift-click could only ever grow the selection, and pulling
     * back up the list would leave the earlier rows selected forever.
     */
    let s = clickFile(EMPTY_SELECTION, 'a.ts', FILES, plain);
    s = clickFile(s, 'e.ts', FILES, range);
    expect(paths(s)).toEqual(['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts']);
    s = clickFile(s, 'b.ts', FILES, range);
    expect(paths(s)).toEqual(['a.ts', 'b.ts']);
  });

  it('falls back to a plain click when the anchor has been filtered away', () => {
    // Ranges are measured against what is on screen; an anchor that is gone
    // cannot anchor anything.
    let s = clickFile(EMPTY_SELECTION, 'a.ts', FILES, plain);
    const narrowed = ['c.ts', 'd.ts'];
    s = clickFile(s, 'd.ts', narrowed, range);
    expect(paths(s)).toEqual(['d.ts']);
  });

  it('measures against the visible list, not the whole one', () => {
    // With b and d hidden by a filter, a range from a to e is three rows.
    let s = clickFile(EMPTY_SELECTION, 'a.ts', ['a.ts', 'c.ts', 'e.ts'], plain);
    s = clickFile(s, 'e.ts', ['a.ts', 'c.ts', 'e.ts'], range);
    expect(paths(s)).toEqual(['a.ts', 'c.ts', 'e.ts']);
  });
});

describe('select all', () => {
  it('takes every visible row', () => {
    expect(paths(selectAll(FILES))).toEqual([...FILES].sort());
  });

  it('takes only what is visible, not what is filtered out', () => {
    expect(paths(selectAll(['b.ts', 'd.ts']))).toEqual(['b.ts', 'd.ts']);
  });

  it('is empty for an empty list rather than selecting nothing-as-something', () => {
    expect(selectAll([])).toEqual(EMPTY_SELECTION);
  });

  it('anchors at the top so a following shift-click narrows', () => {
    const s = clickFile(selectAll(FILES), 'c.ts', FILES, range);
    expect(paths(s)).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });
});

describe('pruning', () => {
  it('drops paths that are no longer on screen', () => {
    // The watcher re-filters this list on every save. A selection that keeps
    // invisible paths is one that stages files the user cannot see.
    const pruned = pruneSelection(selectAll(FILES), ['a.ts', 'b.ts']);
    expect(paths(pruned)).toEqual(['a.ts', 'b.ts']);
  });

  it('returns the same object when nothing changed', () => {
    // Identity matters: this runs on every render, and a new Set each time
    // would defeat the memo downstream.
    const s = selectAll(FILES);
    expect(pruneSelection(s, FILES)).toBe(s);
  });

  it('clears an anchor and an active row that have gone', () => {
    let s = clickFile(EMPTY_SELECTION, 'e.ts', FILES, plain);
    s = pruneSelection(s, ['a.ts']);
    expect(s.anchor).toBeNull();
    expect(s.active).toBeNull();
  });
});
