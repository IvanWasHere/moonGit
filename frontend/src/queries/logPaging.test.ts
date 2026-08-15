import { describe, expect, it } from 'vitest';
import { nextLogPageParam } from './logPaging';

/** A full page, whose contents are irrelevant — only the count is read. */
function page(length: number): unknown[] {
  return Array.from({ length }, (_unused, index) => index);
}

const SIZE = 200;

describe('nextLogPageParam', () => {
  it('follows a full first page with the offset after it', () => {
    expect(nextLogPageParam([page(SIZE)], SIZE)).toBe(200);
  });

  it('accumulates across pages', () => {
    expect(nextLogPageParam([page(SIZE), page(SIZE), page(SIZE)], SIZE)).toBe(600);
  });

  it('stops at a short page', () => {
    expect(nextLogPageParam([page(SIZE), page(37)], SIZE)).toBeUndefined();
  });

  /*
   * The boundary that decides between one wasted round trip and an infinite
   * one. A history that is an exact multiple of the page size cannot be told
   * apart from one with more to come, so it must ask again — and the empty
   * page that comes back is what stops it.
   */
  it('asks once more when the history divides exactly', () => {
    expect(nextLogPageParam([page(SIZE), page(SIZE)], SIZE)).toBe(400);
    expect(nextLogPageParam([page(SIZE), page(SIZE), page(0)], SIZE)).toBeUndefined();
  });

  it('stops on an empty first page — a repository with no commits', () => {
    expect(nextLogPageParam([page(0)], SIZE)).toBeUndefined();
  });

  /*
   * Counting what arrived rather than multiplying `pages.length * SIZE`. The
   * two agree while every page is full and diverge the moment one is not; the
   * multiplication would skip the commits a short page failed to return, so
   * this is the assertion that the cheaper-looking arithmetic stays out.
   */
  it('counts commits received, not pages requested', () => {
    // Not 400, which is what two pages × 200 would give.
    expect(nextLogPageParam([page(150), page(SIZE)], SIZE)).toBe(350);
  });

  /*
   * An unbounded query asked for the whole history and got it. Paging on would
   * fetch the same unbounded log again at an offset, forever.
   */
  it('never pages an unbounded query', () => {
    expect(nextLogPageParam([page(5000)], undefined)).toBeUndefined();
  });

  it('has no next page before a first one exists', () => {
    expect(nextLogPageParam([], SIZE)).toBeUndefined();
  });
});
