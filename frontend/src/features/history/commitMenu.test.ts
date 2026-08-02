import { describe, expect, it } from 'vitest';
import type { Commit, Decoration } from '@/services/git';
import { actionsIn, commitMenuFor, isCheckedOut } from './commitMenu';

function commit(
  overrides: Partial<Commit> & { readonly decorations?: readonly Decoration[] } = {},
): Commit {
  return {
    oid: 'a'.repeat(40),
    shortOid: 'aaaaaaa',
    parents: ['b'.repeat(40)],
    author: { name: 'T', email: 't@t', date: 0 },
    committer: { name: 'T', email: 't@t', date: 0 },
    subject: 'a commit',
    body: '',
    decorations: [],
    isMerge: false,
    isRoot: false,
    ...overrides,
  };
}

const head: Decoration = {
  name: 'refs/heads/main',
  shortName: 'main',
  kind: 'branch',
  isHead: true,
};

describe('isCheckedOut', () => {
  it('reads the HEAD decoration rather than guessing from position', () => {
    expect(isCheckedOut(commit({ decorations: [head] }))).toBe(true);
    expect(isCheckedOut(commit())).toBe(false);
  });
});

describe('an ordinary commit', () => {
  const actions = actionsIn(commitMenuFor(commit()));

  it('offers both cherry-pick forms', () => {
    expect(actions).toContain('cherryPick');
    expect(actions).toContain('cherryPickNoCommit');
  });

  it('offers tagging, history and the copies', () => {
    for (const expected of ['tagHere', 'fileLogFrom', 'copyOid', 'copySubject', 'showDiff']) {
      expect(actions).toContain(expected);
    }
  });
});

/** Cherry-picking the commit you are on is "nothing to do", and git errors. */
describe('the checked-out commit', () => {
  const actions = actionsIn(commitMenuFor(commit({ decorations: [head] })));

  it('offers no cherry-pick', () => {
    expect(actions).not.toContain('cherryPick');
    expect(actions).not.toContain('cherryPickNoCommit');
  });

  it('still offers everything that makes sense', () => {
    expect(actions).toContain('tagHere');
    expect(actions).toContain('copyOid');
  });
});

/**
 * A merge has no single change to replay. Git needs `-m` to say which parent is
 * the mainline, and choosing one silently can bring in a whole branch.
 */
describe('a merge commit', () => {
  const actions = actionsIn(commitMenuFor(commit({ isMerge: true, parents: ['b', 'c'] })));

  it('offers no cherry-pick, since the mainline is the user’s to choose', () => {
    expect(actions).not.toContain('cherryPick');
    expect(actions).not.toContain('cherryPickNoCommit');
  });

  it('can still be tagged and copied', () => {
    expect(actions).toContain('tagHere');
    expect(actions).toContain('copyOid');
  });
});

describe('menu structure', () => {
  it('never starts, ends or doubles a separator', () => {
    for (const subject of [
      commit(),
      commit({ decorations: [head] }),
      commit({ isMerge: true }),
      commit({ isRoot: true, parents: [] }),
    ]) {
      const menu = commitMenuFor(subject);
      expect(menu[0]?.kind).not.toBe('separator');
      expect(menu[menu.length - 1]?.kind).not.toBe('separator');
      for (const [index, entry] of menu.entries()) {
        if (entry.kind !== 'separator') continue;
        expect(menu[index - 1]?.kind).not.toBe('separator');
      }
    }
  });
});
