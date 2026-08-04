import { describe, expect, it } from 'vitest';
import { addRule, ensureTrailingNewline, ignoreFile, IGNORE_FILES, ruleForPath } from './ignoreFiles';

describe('addRule', () => {
  it('appends to an empty file', () => {
    expect(addRule('', '*.log')).toBe('*.log\n');
  });

  it('appends after a file that ends without a newline', () => {
    // The case that corrupts the previous line if it is got wrong.
    expect(addRule('node_modules', '*.log')).toBe('node_modules\n*.log\n');
  });

  it('appends after a file that already ends with one', () => {
    expect(addRule('node_modules\n', '*.log')).toBe('node_modules\n*.log\n');
  });

  it('returns null when the rule is already present', () => {
    expect(addRule('node_modules\n*.log\ndist\n', '*.log')).toBeNull();
  });

  it('ignores surrounding whitespace when comparing', () => {
    expect(addRule('  *.log  \n', '*.log')).toBeNull();
  });

  /*
   * Negations and anchors are different rules, not formatting. `!build` keeps a
   * path that an earlier rule excluded, and `/dist` matches only the root one —
   * treating either as a duplicate would silently drop a rule the user asked
   * for.
   */
  it.each([
    ['build\n', '!build'],
    ['dist\n', '/dist'],
    ['*.log\n', '*.log.gz'],
  ])('treats %j and %j as different rules', (existing, rule) => {
    expect(addRule(existing, rule)).not.toBeNull();
  });

  it('refuses a blank rule', () => {
    expect(addRule('x\n', '   ')).toBeNull();
    expect(addRule('x\n', '')).toBeNull();
  });
});

describe('ensureTrailingNewline', () => {
  it('leaves an empty file empty rather than writing a bare newline', () => {
    expect(ensureTrailingNewline('')).toBe('');
  });

  it('adds one when missing and does not double it', () => {
    expect(ensureTrailingNewline('a')).toBe('a\n');
    expect(ensureTrailingNewline('a\n')).toBe('a\n');
  });
});

describe('ruleForPath', () => {
  it('anchors to the repository root', () => {
    // Without the slash this would also ignore test/fixtures/config.ts.
    expect(ruleForPath('src/config.ts')).toBe('/src/config.ts');
  });
});

describe('IGNORE_FILES', () => {
  it('offers the shared file and the private one, in that order', () => {
    expect(IGNORE_FILES.map((file) => file.relative)).toEqual([
      '.gitignore',
      '.git/info/exclude',
    ]);
  });

  it('resolves an id to its file', () => {
    expect(ignoreFile('local').relative).toBe('.git/info/exclude');
  });
});
