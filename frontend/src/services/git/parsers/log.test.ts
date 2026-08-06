import { describe, expect, it } from 'vitest';
import { FIXTURE_FORMAT, LOG_EMPTY, LOG_HISTORY, LOG_SINGLE } from './__fixtures__/log';
import {
  createLogParser,
  LOG_FORMAT,
  LogParseError,
  parseLog,
  visibleDecorations,
  wasRewritten,
  type Commit,
} from './log';

const commits = parseLog(LOG_HISTORY);

function bySubject(subject: string): Commit {
  const found = commits.find((commit) => commit.subject === subject);
  if (found === undefined) throw new Error(`no commit with subject ${JSON.stringify(subject)}`);
  return found;
}

/** Guards every other test here — see the same check in refs.test.ts. */
describe('format', () => {
  it('still matches the format the fixtures were captured with', () => {
    expect(LOG_FORMAT).toBe(FIXTURE_FORMAT);
  });
});

describe('parseLog', () => {
  it('reads every commit in the history', () => {
    expect(commits).toHaveLength(6);
    expect(commits.every((commit) => /^[0-9a-f]{40}$/.test(commit.oid))).toBe(true);
  });

  it('returns commits newest first, as git emits them', () => {
    const first = commits[0];
    expect(first?.subject).toBe('multi line subject');
  });

  it('reads a root commit as having no parents', () => {
    const root = bySubject('first commit');

    expect(root.parents).toEqual([]);
    expect(root.isRoot).toBe(true);
    expect(root.isMerge).toBe(false);
  });

  it('reads both parents of a merge', () => {
    const merge = bySubject('merge side into main');

    expect(merge.parents).toHaveLength(2);
    expect(merge.isMerge).toBe(true);
    expect(merge.parents.every((parent) => /^[0-9a-f]{40}$/.test(parent))).toBe(true);
    // The first parent is the branch merged into — the difference matters for
    // first-parent history and for graph lane assignment.
    expect(merge.parents[0]).not.toBe(merge.parents[1]);
  });

  it('reads author and committer separately', () => {
    const commit = bySubject('first commit');

    expect(commit.author.name).toBe('Ivan Marinković');
    expect(commit.author.email).toBe('a@b.c');
    expect(commit.author.date).toBeGreaterThan(1_700_000_000);
    expect(commit.committer.name).toBe('Ivan Marinković');
  });

  it('round-trips a non-ASCII author name', () => {
    // Latin-2 characters survive the format, the NUL splitting and the trip
    // through the bridge as UTF-8.
    expect(bySubject('first commit').author.name).toBe('Ivan Marinković');
  });

  it('keeps newlines inside a body but drops the trailing one', () => {
    const commit = bySubject('subject here');

    // git terminates %b with a newline; keeping it puts a blank line under
    // every message in the UI.
    expect(commit.body).toBe('body line one\nbody line two');
  });

  it('reports an empty body as an empty string', () => {
    expect(bySubject('side commit').body).toBe('');
  });

  it('takes the folded subject git gives it', () => {
    // The message's first paragraph was three lines; git folds it into one.
    const commit = bySubject('multi line subject');
    expect(commit.subject).toBe('multi line subject');
    expect(commit.body).toBe('real body');
  });

  it('parses a single-commit query', () => {
    expect(parseLog(LOG_SINGLE)).toHaveLength(1);
  });

  it('parses empty output as no commits', () => {
    expect(parseLog(LOG_EMPTY)).toEqual([]);
    expect(parseLog('')).toEqual([]);
  });
});

describe('decorations', () => {
  it('reads HEAD -> branch as a branch that HEAD is on', () => {
    const decorations = bySubject('multi line subject').decorations;
    const branch = decorations.find((decoration) => decoration.kind === 'branch');

    expect(branch).toEqual({
      name: 'refs/heads/main',
      shortName: 'main',
      kind: 'branch',
      isHead: true,
    });
  });

  it('distinguishes a tag from a remote branch', () => {
    // This is why --decorate=full is required: the short form renders the
    // remote as "origin/main", which a local branch could also be called.
    const decorations = bySubject('merge side into main').decorations;

    expect(decorations).toContainEqual({
      name: 'refs/tags/v1.0',
      shortName: 'v1.0',
      kind: 'tag',
      isHead: false,
    });
    expect(decorations).toContainEqual({
      name: 'refs/remotes/origin/main',
      shortName: 'origin/main',
      kind: 'remote',
      isHead: false,
    });
  });

  it('leaves undecorated commits with an empty list', () => {
    expect(bySubject('main commit').decorations).toEqual([]);
  });

  it('decorates a commit that a branch tip happens to sit on', () => {
    expect(bySubject('side commit').decorations).toEqual([
      { name: 'refs/heads/side', shortName: 'side', kind: 'branch', isHead: false },
    ]);
  });

  it('reads a bare HEAD as a detached head', () => {
    const [commit] = parseLog(
      LOG_SINGLE.replace('HEAD -> refs/heads/main', 'HEAD, refs/heads/main'),
    );
    const kinds = commit?.decorations.map((decoration) => decoration.kind);

    expect(kinds).toContain('head');
    expect(commit?.decorations[0]?.isHead).toBe(true);
  });

  it('sorts HEAD to the front for display', () => {
    const commit = bySubject('multi line subject');
    expect(visibleDecorations(commit)[0]?.isHead).toBe(true);
  });
});

describe('createLogParser — streaming', () => {
  /** Feed the fixture in fixed-size pieces, ignoring record boundaries. */
  function parseInChunks(input: string, size: number): Commit[] {
    const parser = createLogParser();
    const out: Commit[] = [];
    for (let i = 0; i < input.length; i += size) {
      out.push(...parser.push(input.slice(i, i + size)));
    }
    out.push(...parser.flush());
    return out;
  }

  // Go cuts chunks on NUL boundaries so a field is never split in production,
  // but a commit is twelve fields and is split constantly. These sizes are
  // deliberately hostile — they split fields mid-word too.
  it.each([1, 2, 7, 64, 500, 100_000])('produces identical commits at chunk size %i', (size) => {
    expect(parseInChunks(LOG_HISTORY, size)).toEqual(commits);
  });

  it('emits a commit as soon as its last field arrives, not at the end', () => {
    const parser = createLogParser();
    const firstCommitEnd = nthNulIndex(LOG_HISTORY, 12) + 1;

    const emitted = parser.push(LOG_HISTORY.slice(0, firstCommitEnd));

    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.subject).toBe('multi line subject');
    expect(parser.pending).toBe(0);
  });

  it('holds back a partial commit until the rest arrives', () => {
    const parser = createLogParser();
    const splitAt = nthNulIndex(LOG_HISTORY, 5) + 1;

    expect(parser.push(LOG_HISTORY.slice(0, splitAt))).toEqual([]);
    expect(parser.pending).toBe(5);
    expect(parser.push(LOG_HISTORY.slice(splitAt))).toHaveLength(6);
  });

  it('rejects a stream that ends mid-commit', () => {
    const parser = createLogParser();
    parser.push(LOG_SINGLE.slice(0, nthNulIndex(LOG_SINGLE, 4)));

    expect(() => parser.flush()).toThrow(LogParseError);
    expect(() => createLogParser().push(LOG_SINGLE.slice(0, 20))).not.toThrow();
  });

  it('reports how many fields it is holding', () => {
    const parser = createLogParser();
    parser.push(LOG_HISTORY.slice(0, nthNulIndex(LOG_HISTORY, 3) + 1));
    expect(parser.pending).toBe(3);
  });

  /**
   * Found by the Phase 7 benchmark (PLAN.md §10), not by reasoning about it.
   *
   * `fields.push(...parts)` passes one argument per field, so a large enough
   * input overflowed the call stack — a `RangeError`, not a slow parse — at
   * roughly 6,500 commits. Go's 64 KB chunks kept `execStream` far below that,
   * so only `parseLog`, which hands over the whole output in a single call,
   * could reach it. Paging is about to make multi-thousand-commit parses
   * ordinary, so the ceiling is asserted here rather than left to be
   * rediscovered.
   *
   * 20,000 is chosen to be comfortably past the limit rather than near it; the
   * exact threshold is an engine detail and not worth pinning a test to.
   */
  it('parses a batch far larger than the argument limit in one call', () => {
    const one = LOG_SINGLE;
    const many = one.repeat(20_000);

    const parsed = parseLog(many);

    expect(parsed).toHaveLength(20_000);
    expect(parsed[0]?.subject).toBe('multi line subject');
    expect(parsed.at(-1)?.subject).toBe('multi line subject');
  });
});

describe('corrupt input', () => {
  // The field count is the only record boundary, so a lost field silently
  // shifts every later commit unless something checks. This is that check.
  it('rejects a stream with a dropped field instead of shifting every commit', () => {
    const fields = LOG_HISTORY.split('\0');
    fields.splice(3, 1);

    expect(() => parseLog(fields.join('\0'))).toThrow(LogParseError);
  });

  it('names the offending value', () => {
    expect(() => parseLog(`not-a-sha\0${'x\0'.repeat(11)}`)).toThrow(/expected an object id/);
  });

  it('accepts a SHA-256 object id', () => {
    const oid = 'a'.repeat(64);
    const record = [oid, 'aaaaaaa', '', 'n', 'e', '1', 'n', 'e', '1', '', 's', ''].join('\0');

    expect(parseLog(`${record}\0`)[0]?.oid).toBe(oid);
  });
});

describe('wasRewritten', () => {
  it('is false for a commit whose author and committer match', () => {
    expect(wasRewritten(bySubject('first commit'))).toBe(false);
  });

  it('is true when the committer differs from the author', () => {
    const [original] = parseLog(LOG_SINGLE);
    if (original === undefined) throw new Error('fixture has no commit');

    const rebased: Commit = {
      ...original,
      committer: { ...original.committer, date: original.author.date + 3600 },
    };
    expect(wasRewritten(rebased)).toBe(true);
  });
});

/** Index of the nth NUL in `input`, so tests can cut at exact field boundaries. */
function nthNulIndex(input: string, n: number): number {
  let index = -1;
  for (let i = 0; i < n; i += 1) {
    index = input.indexOf('\0', index + 1);
    if (index === -1) throw new Error(`fixture has fewer than ${n} NULs`);
  }
  return index;
}
