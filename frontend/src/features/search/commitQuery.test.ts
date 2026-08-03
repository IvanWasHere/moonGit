import { describe, expect, it } from 'vitest';
import { describeQuery, parseCommitQuery, toLogParams } from './commitQuery';

/** The end-to-end shape: what a typed string becomes as git arguments. */
function params(input: string) {
  return toLogParams(parseCommitQuery(input));
}

describe('parseCommitQuery', () => {
  it('treats a blank query as empty', () => {
    expect(parseCommitQuery('').isEmpty).toBe(true);
    expect(parseCommitQuery('   ').isEmpty).toBe(true);
    expect(params('')).toEqual({});
  });

  it('splits bare words into separate message patterns', () => {
    const query = parseCommitQuery('fix parser');
    expect(query.message).toEqual([
      { text: 'fix', isRegex: false },
      { text: 'parser', isRegex: false },
    ]);
  });

  it('reads qualifiers and their aliases', () => {
    const query = parseCommitQuery('author:ivan path:src since:yesterday until:today');
    expect(query.author).toEqual({ text: 'ivan', isRegex: false });
    expect(query.paths).toEqual([':(icase)*src*']);
    expect(query.since).toBe('yesterday');
    expect(query.until).toBe('today');

    const aliased = parseCommitQuery('by:ivan file:src after:yesterday before:today');
    expect(aliased).toEqual(query);
  });

  it('keeps quoted values whole, including after the colon', () => {
    const query = parseCommitQuery('author:"Ivan Marinković" since:"2 weeks ago"');
    expect(query.author).toEqual({ text: 'Ivan Marinković', isRegex: false });
    expect(query.since).toBe('2 weeks ago');
  });

  it('only splits on the first colon, so timestamps survive', () => {
    expect(parseCommitQuery('since:2026-01-02T10:30:00').since).toBe('2026-01-02T10:30:00');
  });

  it('searches an unknown qualifier as text, colon included', () => {
    // `TODO:refactor` is a real thing to look for in a message, and a search
    // box that rejects input is worse than one that takes it literally.
    const query = parseCommitQuery('TODO:refactor');
    expect(query.message).toEqual([{ text: 'TODO:refactor', isRegex: false }]);
    expect(query.author).toBeNull();
  });

  it('keeps a quoted qualifier-looking token as text', () => {
    expect(parseCommitQuery('"author:ivan"').message).toEqual([
      { text: 'author:ivan', isRegex: false },
    ]);
  });

  it('marks /…/ as a regex and strips the slashes', () => {
    expect(parseCommitQuery('/parse.*error/').message).toEqual([
      { text: 'parse.*error', isRegex: true },
    ]);
    expect(parseCommitQuery('author:/^ivan/').author).toEqual({ text: '^ivan', isRegex: true });
  });

  it('runs an unterminated quote to the end rather than failing', () => {
    // The user is still typing it.
    expect(parseCommitQuery('author:"Ivan M').author).toEqual({ text: 'Ivan M', isRegex: false });
  });
});

describe('toLogParams', () => {
  it('defaults to fixed strings, case-insensitive', () => {
    expect(params('fix')).toMatchObject({ patternType: 'fixed', ignoreCase: true, grep: ['fix'] });
  });

  it('ANDs multiple message terms', () => {
    // Git ORs multiple --grep by default, which is not what typing two words
    // into a search box means.
    expect(params('fix parser')).toMatchObject({ grep: ['fix', 'parser'], allMatch: true });
  });

  it('does not send --all-match for a single pattern', () => {
    expect(params('fix').allMatch).toBeUndefined();
  });

  it('switches the whole command to regex when any term is one', () => {
    expect(params('/parse.*/').patternType).toBe('extended');
  });

  it('escapes literal terms once the command is in regex mode', () => {
    // The pattern type is one flag for the whole invocation, so a literal
    // sharing a query with a regex has to survive being read as a regex —
    // otherwise `v1.2` would match `v1x2`.
    expect(params('v1.2 /parse.*/')).toMatchObject({
      patternType: 'extended',
      grep: ['v1\\.2', 'parse.*'],
    });
  });

  it('escapes the author too, since one flag governs every pattern', () => {
    expect(params('author:a.b /x+/')).toMatchObject({
      patternType: 'extended',
      author: 'a\\.b',
    });
  });

  it('leaves a literal query unescaped', () => {
    expect(params('v1.2')).toMatchObject({ patternType: 'fixed', grep: ['v1.2'] });
  });

  it('wraps a bare path in wildcards but passes a real pathspec through', () => {
    expect(params('file:log').paths).toEqual([':(icase)*log*']);
    expect(params('path:src/git').paths).toEqual(['src/git']);
    expect(params('path:*.ts').paths).toEqual(['*.ts']);
  });

  it('collects several path qualifiers', () => {
    expect(params('path:src file:test').paths).toEqual([':(icase)*src*', ':(icase)*test*']);
  });
});

describe('describeQuery', () => {
  it('names every recognised part, so a typo is visible by its absence', () => {
    expect(describeQuery(parseCommitQuery('fix author:ivan path:src'))).toEqual([
      'message: fix',
      'author: ivan',
      'path: :(icase)*src*',
    ]);
    // A mistyped qualifier shows up as message text rather than as an author.
    expect(describeQuery(parseCommitQuery('autor:ivan'))).toEqual(['message: autor:ivan']);
  });
});
