import { describe, expect, it } from 'vitest';
import type { Commit } from '@/services/git';
import { BASE_ROW_HEIGHT, estimateRowHeight, REFS_ROW_EXTRA } from './rowHeight';

/**
 * The one decision inside the Journal's virtualization that can be asserted
 * without a layout engine.
 *
 * jsdom has no layout — every `getBoundingClientRect` is zeroes — so the
 * virtualizer's own behaviour is not meaningfully testable here, and pretending
 * otherwise would produce a test that passes whatever the component does. What
 * *is* testable is the estimate it starts from, which is the part with a
 * judgement in it.
 */

function commitWith(decorations: Commit['decorations']): Commit {
  return {
    oid: '0'.repeat(40),
    shortOid: '0000000',
    parents: [],
    author: { name: 'A', email: 'a@example.com', date: 0 },
    committer: { name: 'A', email: 'a@example.com', date: 0 },
    subject: 'subject',
    body: '',
    decorations,
    isMerge: false,
    isRoot: true,
  };
}

describe('estimateRowHeight', () => {
  it('is the base height for an undecorated commit', () => {
    expect(estimateRowHeight(commitWith([]))).toBe(BASE_ROW_HEIGHT);
  });

  it('adds one line for a commit carrying refs', () => {
    const decorated = commitWith([
      { name: 'refs/heads/main', shortName: 'main', kind: 'branch', isHead: true },
    ]);
    expect(estimateRowHeight(decorated)).toBe(BASE_ROW_HEIGHT + REFS_ROW_EXTRA);
  });

  /*
   * Deliberate, and the reason `decorations.length` is tested rather than
   * multiplied by. Labels wrap, so the true height depends on the pane width
   * and every ref's name — neither of which an estimator has. Under-estimating
   * the rare heavily tagged commit beats over-estimating the common bare one,
   * because the common one is what the scrollbar is mostly made of.
   */
  it('does not grow with the number of refs', () => {
    const many = commitWith(
      Array.from({ length: 12 }, (_unused, index) => ({
        name: `refs/tags/v${index}`,
        shortName: `v${index}`,
        kind: 'tag' as const,
        isHead: false,
      })),
    );
    expect(estimateRowHeight(many)).toBe(BASE_ROW_HEIGHT + REFS_ROW_EXTRA);
  });

  /*
   * `estimateSize` is called by index, and a virtualizer may ask about an index
   * that no longer exists — the count shrank between a render and a measure.
   * Under `noUncheckedIndexedAccess` that arrives here as `undefined`, and it
   * has to produce a number rather than a `NaN` that would poison the total
   * size and collapse the scrollbar.
   */
  it('answers for a row that is not there', () => {
    expect(estimateRowHeight(undefined)).toBe(BASE_ROW_HEIGHT);
  });

  /*
   * Both heights are whole pixels, and that is load-bearing rather than tidy.
   * The virtualizer measures with `offsetHeight`, an integer, and positions
   * rows at the running total; a fractional row means the recorded height and
   * the real one disagree, and a transparent hairline opens under every row
   * that slices the commit graph's vertical lanes once per row. The stylesheet
   * pins three line-heights to keep this true — see `.entry` in
   * `History.module.css`. Measured 55 and 74 in the running app.
   */
  it('is a whole number of pixels, which the virtualizer depends on', () => {
    expect(Number.isInteger(BASE_ROW_HEIGHT)).toBe(true);
    expect(Number.isInteger(BASE_ROW_HEIGHT + REFS_ROW_EXTRA)).toBe(true);
  });

  it('is always a usable positive height', () => {
    for (const commit of [commitWith([]), commitWith([]), undefined]) {
      expect(estimateRowHeight(commit)).toBeGreaterThan(0);
      expect(Number.isFinite(estimateRowHeight(commit))).toBe(true);
    }
  });
});
