import { describe, expect, it } from 'vitest';
import { FIXTURE_FORMAT, REFS_DETACHED, REFS_EMPTY, REFS_EVERYTHING } from './__fixtures__/refs';
import {
  FOR_EACH_REF_FORMAT,
  groupRefs,
  hasDiverged,
  isInSync,
  parseRefs,
  RefParseError,
  type GitRef,
} from './refs';

function byName(refs: readonly GitRef[], shortName: string): GitRef {
  const found = refs.find((ref) => ref.shortName === shortName);
  if (found === undefined) throw new Error(`no ref named ${shortName}`);
  return found;
}

const refs = parseRefs(REFS_EVERYTHING);

/**
 * The one test that protects every other test in this file. A format string
 * and a parser that disagree do not crash — they shift every field by one and
 * fill the Branches panel with plausible nonsense.
 */
describe('format', () => {
  it('still matches the format the fixtures were captured with', () => {
    expect(FOR_EACH_REF_FORMAT).toBe(FIXTURE_FORMAT);
  });
});

describe('parseRefs — branches', () => {
  it('reads a branch with no upstream', () => {
    const ref = byName(refs, 'local-only');

    expect(ref.kind).toBe('branch');
    expect(ref.name).toBe('refs/heads/local-only');
    expect(ref.upstream).toBeNull();
    expect(ref.isHead).toBe(false);
    expect(ref.subject).toBe('local only work');
    expect(ref.author).toBe('t');
    expect(ref.date).toBeGreaterThan(1_700_000_000);
  });

  it('marks the checked-out branch', () => {
    // git renders this atom as a single space for every other ref, so a
    // truthiness check on it would mark every branch as HEAD.
    expect(refs.filter((ref) => ref.isHead).map((ref) => ref.shortName)).toEqual(['main']);
  });

  it('reads ahead and behind counts', () => {
    const main = byName(refs, 'main');
    expect(main.upstream).toEqual({
      ref: 'refs/remotes/origin/main',
      shortRef: 'origin/main',
      ahead: 0,
      behind: 1,
      gone: false,
    });
    expect(isInSync(main)).toBe(false);
    expect(hasDiverged(main)).toBe(false);
  });

  it('reads a diverged branch, which reports both counts in one field', () => {
    const ref = byName(refs, 'feature/nested-name');

    expect(ref.upstream?.ahead).toBe(1);
    expect(ref.upstream?.behind).toBe(1);
    expect(hasDiverged(ref)).toBe(true);
  });

  it('distinguishes a deleted upstream from an in-sync one', () => {
    const gone = byName(refs, 'gone-branch');

    expect(gone.upstream?.gone).toBe(true);
    expect(gone.upstream?.shortRef).toBe('origin/gone-branch');
    // Both are zero for "[gone]" and for a synced branch; `gone` is what
    // separates "nothing to push" from "the remote branch is missing".
    expect(gone.upstream?.ahead).toBe(0);
    expect(gone.upstream?.behind).toBe(0);
    expect(isInSync(gone)).toBe(false);
  });

  it('keeps slashes in nested branch names', () => {
    expect(byName(refs, 'feature/nested-name').name).toBe('refs/heads/feature/nested-name');
  });

  it('folds a multi-line commit subject onto one line', () => {
    // Verified against git: if this were not folded, the record would split
    // across two lines and the parser would reject it.
    expect(byName(refs, 'multiline-subject').subject).toBe('subject line one subject line two');
  });
});

describe('parseRefs — tags', () => {
  it('resolves an annotated tag to the commit it wraps', () => {
    const tag = byName(refs, 'annotated-tag');

    expect(tag.kind).toBe('tag');
    expect(tag.annotated).toBe(true);
    expect(tag.objectType).toBe('tag');
    // The tag object and the commit are different objects — checking out
    // `oid` would put you on a tag, not a commit.
    expect(tag.targetOid).not.toBe(tag.oid);
    expect(tag.targetOid).toMatch(/^[0-9a-f]{40}$/);
  });

  it('treats a lightweight tag as a direct pointer to its commit', () => {
    const tag = byName(refs, 'lightweight-tag');

    expect(tag.annotated).toBe(false);
    expect(tag.objectType).toBe('commit');
    expect(tag.targetOid).toBe(tag.oid);
  });

  it('falls back to the wrapped commit author for an annotated tag', () => {
    // A tag object has a tagger, not an author, so `%(authorname)` is empty.
    expect(byName(refs, 'annotated-tag').author).toBe('t');
  });

  it('folds a multi-line tag subject too', () => {
    expect(byName(refs, 'multiline-tag').subject).toBe('tag subject line one tag subject line two');
  });
});

describe('parseRefs — remotes', () => {
  it('reads remote-tracking branches', () => {
    const ref = byName(refs, 'origin/main');

    expect(ref.kind).toBe('remote');
    expect(ref.name).toBe('refs/remotes/origin/main');
    expect(ref.upstream).toBeNull();
    expect(ref.symrefTarget).toBeNull();
  });

  it('reads origin/HEAD as a symbolic ref', () => {
    const head = refs.find((ref) => ref.name === 'refs/remotes/origin/HEAD');

    expect(head?.symrefTarget).toBe('refs/remotes/origin/main');
  });
});

describe('groupRefs', () => {
  const grouped = groupRefs(refs);

  it("splits refs into the panel's buckets", () => {
    expect(grouped.branches.every((ref) => ref.kind === 'branch')).toBe(true);
    expect(grouped.tags.map((ref) => ref.shortName).sort()).toEqual([
      'annotated-tag',
      'lightweight-tag',
      'multiline-tag',
    ]);
  });

  it('hides origin/HEAD, which only duplicates the branch it points at', () => {
    expect(grouped.remotes.map((ref) => ref.shortName)).not.toContain('origin/HEAD');
    expect(grouped.remotes.map((ref) => ref.shortName)).toContain('origin/main');
  });

  it('finds the current branch', () => {
    expect(grouped.head?.shortName).toBe('main');
  });

  it('reports no current branch when HEAD is detached', () => {
    expect(groupRefs(parseRefs(REFS_DETACHED)).head).toBeNull();
  });
});

describe('parseRefs — edge cases', () => {
  it('parses a repository with no refs', () => {
    expect(parseRefs(REFS_EMPTY)).toEqual([]);
    expect(groupRefs(parseRefs(REFS_EMPTY))).toEqual({
      branches: [],
      remotes: [],
      tags: [],
      head: null,
    });
  });

  it('rejects a record with the wrong field count', () => {
    expect(() => parseRefs('refs/heads/main\x00main\x00commit\n')).toThrow(RefParseError);
  });

  it('names the field counts in the error', () => {
    expect(() => parseRefs('refs/heads/main\x00main\n')).toThrow(/expected 15 fields, got 2/);
  });

  it('rejects a record with an empty refname', () => {
    const empty = new Array(15).fill('').join('\x00');
    expect(() => parseRefs(`${empty}\n`)).toThrow(/no refname/);
  });

  it('classifies refs outside the three known namespaces as other', () => {
    const fields = new Array(15).fill('');
    fields[0] = 'refs/stash';
    fields[1] = 'stash';
    expect(parseRefs(`${fields.join('\x00')}\n`)[0]?.kind).toBe('other');
  });

  it('treats an unparseable date as null rather than NaN', () => {
    const fields = new Array(15).fill('');
    fields[0] = 'refs/heads/x';
    fields[11] = 'not-a-date';
    expect(parseRefs(`${fields.join('\x00')}\n`)[0]?.date).toBeNull();
  });
});
