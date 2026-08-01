import { describe, expect, it } from 'vitest';
import { gitKeys, keysToInvalidate } from './keys';

const REPO = '/repos/test-repo1';

function invalidated(...reasons: Parameters<typeof keysToInvalidate>[1]): string[] {
  return keysToInvalidate(REPO, reasons).map((key) => JSON.stringify(key));
}

const key = (k: readonly unknown[]) => JSON.stringify(k);

describe('gitKeys', () => {
  it('leads every key with the repository path', () => {
    // Switching repositories must not show another one's cached data, and
    // closing one must be able to drop its whole cache in a single call.
    expect(gitKeys.status(REPO)[0]).toBe(REPO);
    expect(gitKeys.log(REPO)[0]).toBe(REPO);
    expect(gitKeys.blame(REPO, 'a.txt')[0]).toBe(REPO);
  });

  it('separates diff scopes', () => {
    expect(gitKeys.diff(REPO, 'worktree')).not.toEqual(gitKeys.diff(REPO, 'staged'));
  });

  it('distinguishes blame of the working tree from a revision', () => {
    expect(gitKeys.blame(REPO, 'a.txt')).not.toEqual(gitKeys.blame(REPO, 'a.txt', 'HEAD~1'));
  });
});

describe('keysToInvalidate', () => {
  it('refreshes only the working tree when a file is saved', () => {
    const keys = invalidated('worktree');

    expect(keys).toContain(key(gitKeys.status(REPO)));
    expect(keys).toContain(key(gitKeys.diff(REPO, 'worktree')));
    // Editing a file must not re-read the ref list or re-walk history.
    expect(keys).not.toContain(key(gitKeys.refs(REPO)));
    expect(keys).not.toContain(key(gitKeys.log(REPO)));
  });

  it('refreshes both diffs when the index changes', () => {
    const keys = invalidated('index');

    expect(keys).toContain(key(gitKeys.diff(REPO, 'staged')));
    expect(keys).toContain(key(gitKeys.diff(REPO, 'worktree')));
    expect(keys).toContain(key(gitKeys.status(REPO)));
  });

  // Ahead/behind lives in the status header (`# branch.ab`), so a fetch that
  // moves a remote-tracking ref changes what the status panel should say.
  it('refreshes status when refs move, not just the ref list', () => {
    expect(invalidated('refs')).toContain(key(gitKeys.status(REPO)));
  });

  // The stash is refs/stash, so pushing or popping arrives as a refs change.
  it('refreshes the stash list when refs move', () => {
    expect(invalidated('refs')).toContain(key(gitKeys.stashes(REPO)));
  });

  it('drops the whole repository cache on a HEAD change', () => {
    // A checkout moves the working tree, index, branch and history at once.
    expect(invalidated('head')).toEqual([key(gitKeys.repo(REPO))]);
  });

  it('lets a HEAD change subsume the other reasons', () => {
    expect(invalidated('worktree', 'index', 'refs', 'head')).toEqual([key(gitKeys.repo(REPO))]);
  });

  it('refreshes status when an operation starts or ends', () => {
    expect(invalidated('state')).toContain(key(gitKeys.status(REPO)));
  });

  it('does not repeat a key reported by two reasons', () => {
    const keys = invalidated('worktree', 'index');
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('returns nothing for no reasons', () => {
    expect(invalidated()).toEqual([]);
  });

  it('scopes keys to the repository that changed', () => {
    expect(keysToInvalidate('/other/repo', ['worktree']).every((k) => k[0] === '/other/repo')).toBe(
      true,
    );
  });
});
