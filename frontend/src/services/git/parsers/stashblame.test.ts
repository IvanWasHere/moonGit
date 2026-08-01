import { describe, expect, it } from 'vitest';
import {
  BLAME_FILE,
  STASH_EMPTY,
  STASH_FIXTURE_FORMAT,
  STASH_LIST,
} from './__fixtures__/stashblame';
import {
  blameAuthorTotals,
  BlameParseError,
  groupBlameRuns,
  parseBlame,
  type Blame,
} from './blame';
import { parseStashList, STASH_FORMAT, StashParseError, type Stash } from './stash';

const stashes = parseStashList(STASH_LIST);

function bySelector(selector: string): Stash {
  const found = stashes.find((stash) => stash.selector === selector);
  if (found === undefined) throw new Error(`no stash ${selector}`);
  return found;
}

describe('format', () => {
  it('still matches the format the fixtures were captured with', () => {
    expect(STASH_FORMAT).toBe(STASH_FIXTURE_FORMAT);
  });
});

describe('parseStashList', () => {
  it('reads the whole stack in order', () => {
    expect(stashes).toHaveLength(4);
    expect(stashes.map((stash) => stash.index)).toEqual([0, 1, 2, 3]);
  });

  it('splits an explicit message from the branch it was made on', () => {
    const stash = bySelector('stash@{2}');

    expect(stash.branch).toBe('main');
    expect(stash.message).toBe('work in progress on the parser');
    expect(stash.autoNamed).toBe(false);
  });

  it('unpicks the auto-generated "WIP on" form', () => {
    const stash = bySelector('stash@{3}');

    expect(stash.autoNamed).toBe(true);
    expect(stash.branch).toBe('main');
    // git's own description: the commit it was based on, plus that subject.
    expect(stash.message).toMatch(/first commit$/);
  });

  it('keeps the branch a stash was made on, not the current one', () => {
    expect(bySelector('stash@{0}').branch).toBe('feature/side');
    expect(bySelector('stash@{1}').branch).toBe('main');
  });

  // Read from the parent count, because the message says nothing about it.
  it('detects a stash that included untracked files', () => {
    expect(bySelector('stash@{1}').includesUntracked).toBe(true);
    expect(bySelector('stash@{0}').includesUntracked).toBe(false);
    expect(bySelector('stash@{2}').includesUntracked).toBe(false);
  });

  it('carries the selector git expects back', () => {
    expect(stashes.map((stash) => stash.selector)).toEqual([
      'stash@{0}',
      'stash@{1}',
      'stash@{2}',
      'stash@{3}',
    ]);
  });

  it('reads dates', () => {
    expect(bySelector('stash@{0}').date).toBeGreaterThan(1_700_000_000);
  });

  it('parses an empty stash list', () => {
    expect(parseStashList(STASH_EMPTY)).toEqual([]);
    expect(parseStashList('')).toEqual([]);
  });

  it('keeps an unrecognisable subject verbatim rather than dropping it', () => {
    const record = ['stash@{0}', 'abc', 'p1 p2', 'something unexpected', '1'].join('\0');
    const [stash] = parseStashList(`${record}\0`);

    expect(stash?.message).toBe('something unexpected');
    expect(stash?.branch).toBeNull();
  });

  it('rejects a truncated record', () => {
    expect(() => parseStashList('stash@{0}\x00abc\x00')).toThrow(StashParseError);
  });

  it('rejects a selector that is not stash@{n}', () => {
    const record = ['refs/stash', 'abc', 'p1 p2', 'On main: x', '1'].join('\0');
    expect(() => parseStashList(`${record}\0`)).toThrow(/stash@\{n\} selector/);
  });
});

describe('parseBlame', () => {
  const blame: Blame = parseBlame(BLAME_FILE);

  it('attributes every line in the file', () => {
    expect(blame.lines).toHaveLength(6);
    expect(blame.lines.map((line) => line.finalLine)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('keeps line content verbatim, minus the tab prefix', () => {
    expect(blame.lines.map((line) => line.content)).toEqual(['1', '2', 'three', '4', '5', 'six']);
  });

  // The heart of the porcelain format: metadata is sent once per commit and
  // every later run of that commit relies on the reader having remembered it.
  it('fills attribution for lines whose commit block was elided', () => {
    const first = blame.lines[0];
    const second = blame.lines[1];

    expect(second?.oid).toBe(first?.oid);
    const commit = blame.commits.get(second?.oid ?? '');
    expect(commit?.author.name).toBe('Ivan Marinković');
    expect(commit?.summary).toBe('first commit');
  });

  it('records each commit exactly once however many lines it owns', () => {
    expect(blame.commits.size).toBe(3);
    expect(new Set(blame.lines.map((line) => line.oid)).size).toBe(3);
  });

  it('reads author and committer identities with their timezone', () => {
    const commit = blame.commits.get(blame.lines[2]?.oid ?? '');

    expect(commit?.author.name).toBe('Ivan Marinković');
    expect(commit?.author.email).toBe('a@b.c');
    expect(commit?.author.date).toBeGreaterThan(1_700_000_000);
    // Unlike the log parser, blame gives the author's own UTC offset.
    expect(commit?.author.timezone).toMatch(/^[+-]\d{4}$/);
    expect(commit?.committer.name).toBe('Ivan Marinković');
  });

  it('marks the boundary commit', () => {
    const boundaries = [...blame.commits.values()].filter((commit) => commit.isBoundary);
    expect(boundaries).toHaveLength(1);
    expect(boundaries[0]?.summary).toBe('first commit');
  });

  it('records the previous commit and path for an edited line', () => {
    const edited = blame.commits.get(blame.lines[2]?.oid ?? '');

    expect(edited?.summary).toBe('third commit edits a line');
    expect(edited?.previousOid).toMatch(/^[0-9a-f]{40}$/);
    expect(edited?.previousPath).toBe('a.txt');
  });

  it('tracks the original line number separately from the final one', () => {
    for (const line of blame.lines) {
      expect(line.origLine).toBeGreaterThan(0);
    }
  });

  it('parses empty output as no lines', () => {
    expect(parseBlame('')).toEqual({ lines: [], commits: new Map() });
  });

  it('rejects content with no header', () => {
    expect(() => parseBlame('\torphan line\n')).toThrow(BlameParseError);
  });

  it('rejects a header with no content', () => {
    expect(() => parseBlame(`${'a'.repeat(40)} 1 1 1\nauthor X\n`)).toThrow(
      /header with no content/,
    );
  });

  it('rejects metadata appearing before any header', () => {
    expect(() => parseBlame('author Nobody\n')).toThrow(/outside a commit block/);
  });

  it('ignores metadata keys it does not know', () => {
    const output = `${'a'.repeat(40)} 1 1 1\nauthor X\nsome-future-key whatever\nfilename f.txt\n\tline\n`;
    expect(parseBlame(output).lines).toHaveLength(1);
  });
});

describe('groupBlameRuns', () => {
  const blame = parseBlame(BLAME_FILE);

  it('collapses consecutive lines from the same commit into one run', () => {
    const runs = groupBlameRuns(blame);

    // Lines 1–2 and 4–5 come from the first commit but are not adjacent, so
    // they are separate runs — the gutter draws one entry per run, not per commit.
    expect(runs.length).toBeGreaterThan(blame.commits.size - 1);
    expect(runs.every((run) => run.lines.every((line) => line.oid === run.oid))).toBe(true);
    expect(runs.reduce((sum, run) => sum + run.lines.length, 0)).toBe(blame.lines.length);
  });

  it('starts each run at its first final line number', () => {
    const runs = groupBlameRuns(blame);
    expect(runs[0]?.startLine).toBe(1);
  });

  it('returns nothing for an empty blame', () => {
    expect(groupBlameRuns({ lines: [], commits: new Map() })).toEqual([]);
  });
});

describe('blameAuthorTotals', () => {
  it('counts lines per author, most first', () => {
    const totals = blameAuthorTotals(parseBlame(BLAME_FILE));

    expect(totals[0]?.name).toBe('Ivan Marinković');
    expect(totals.reduce((sum, entry) => sum + entry.lines, 0)).toBe(6);
  });
});
