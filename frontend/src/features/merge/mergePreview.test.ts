import { describe, expect, it } from 'vitest';
import { canFastForwardOnly, defaultMergeMessage, previewOf, PREVIEW_LIMIT } from './mergePreview';

describe('previewOf', () => {
  it('calls it up to date when nothing is incoming', () => {
    expect(previewOf(0, 4).shape).toBe('upToDate');
    // Even with nothing on either side — merging a branch into itself.
    expect(previewOf(0, 0).shape).toBe('upToDate');
  });

  /**
   * The distinction the wizard exists to show: a fast-forward leaves history
   * linear, a merge commit adds a bubble, and git only says which *after* it
   * has done it.
   */
  it('calls it a fast-forward when HEAD has nothing of its own', () => {
    expect(previewOf(3, 0).shape).toBe('fastForward');
  });

  it('calls it a merge commit when both sides have moved', () => {
    expect(previewOf(3, 2).shape).toBe('mergeCommit');
  });

  // The count comes from a capped `git log`, so at the ceiling it is a floor.
  it('marks the count as capped at the query limit', () => {
    expect(previewOf(PREVIEW_LIMIT - 1, 0).incomingCapped).toBe(false);
    expect(previewOf(PREVIEW_LIMIT, 0).incomingCapped).toBe(true);
  });
});

describe('canFastForwardOnly', () => {
  /**
   * Offering `--ff-only` on diverged branches would produce git's `hint:
   * Diverging branches can't be fast-forwarded` and exit 128 — an error for a
   * choice the UI should never have allowed.
   */
  it('is false exactly when a merge commit would be needed', () => {
    expect(canFastForwardOnly(previewOf(3, 2))).toBe(false);
    expect(canFastForwardOnly(previewOf(3, 0))).toBe(true);
    expect(canFastForwardOnly(previewOf(0, 5))).toBe(true);
  });
});

describe('defaultMergeMessage', () => {
  it('matches the shape git writes itself', () => {
    expect(defaultMergeMessage('feature/x', 'main')).toBe('Merge feature/x into main');
  });

  it('drops the target on a detached HEAD, which has no name', () => {
    expect(defaultMergeMessage('feature/x', null)).toBe('Merge feature/x');
  });
});
