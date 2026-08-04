import { describe, expect, it } from 'vitest';
import {
  isSafeConfigValue,
  isValidConfigKey,
  parseConfigList,
  type ConfigEntry,
} from './ConfigService';
import { isSafeRemoteUrl, isValidRemoteName } from './RemoteService';
import { parseCheckIgnore } from './IgnoreService';

/** `key\nvalue\0` per entry, which is what `config --list -z` emits. */
const record = (key: string, value?: string) =>
  value === undefined ? `${key}\0` : `${key}\n${value}\0`;

describe('parseConfigList', () => {
  it('reads keys and values', () => {
    expect(parseConfigList(record('user.name', 'Ivan') + record('core.bare', 'false'))).toEqual([
      { key: 'user.name', value: 'Ivan' },
      { key: 'core.bare', value: 'false' },
    ]);
  });

  /*
   * The reason for `-z`. A config value may legally span lines — a multi-line
   * alias is common — and the line-oriented default would split one entry into
   * several with garbage keys.
   */
  it('keeps a multi-line value in one entry', () => {
    const alias = '!f() { git log --oneline; }; f';
    const entries = parseConfigList(
      record('alias.l', `line one\nline two`) + record('alias.f', alias),
    );

    expect(entries).toEqual<ConfigEntry[]>([
      { key: 'alias.l', value: 'line one\nline two' },
      { key: 'alias.f', value: alias },
    ]);
  });

  it('reads a valueless key as an empty value', () => {
    // `[section]\n  flag` with nothing after it: git emits the key alone.
    expect(parseConfigList(record('core.flag'))).toEqual([{ key: 'core.flag', value: '' }]);
  });

  it('reads no output as no entries', () => {
    expect(parseConfigList('')).toEqual([]);
  });

  it('preserves a value that is the empty string', () => {
    expect(parseConfigList(record('core.editor', ''))).toEqual([{ key: 'core.editor', value: '' }]);
  });
});

describe('isValidConfigKey', () => {
  it.each(['user.name', 'core.autocrlf', 'remote.origin.url', 'branch.feature/x.remote'])(
    'accepts %s',
    (key) => {
      expect(isValidConfigKey(key)).toBe(true);
    },
  );

  /*
   * The one that matters. `git config --local` takes its key positionally, so
   * a "key" of `--global` would be read as an *option* and write to the user's
   * global file instead of this repository's.
   */
  it('refuses anything that would be read as an option', () => {
    expect(isValidConfigKey('--global')).toBe(false);
    expect(isValidConfigKey('-f')).toBe(false);
  });

  it.each(['user', '', 'user.', '.name', 'user.name\nmore', '1bad.key'])('refuses %j', (key) => {
    expect(isValidConfigKey(key)).toBe(false);
  });
});

describe('isSafeConfigValue', () => {
  it('accepts ordinary values', () => {
    expect(isSafeConfigValue('ivan@example.com')).toBe(true);
    expect(isSafeConfigValue('')).toBe(true);
  });

  it('refuses a value git would read as an option', () => {
    // No `--` separator exists for `git config`, so a leading dash cannot be
    // escaped — only refused.
    expect(isSafeConfigValue('--unset')).toBe(false);
  });
});

describe('isValidRemoteName', () => {
  it.each(['origin', 'upstream', 'fork2', 'my-remote'])('accepts %s', (name) => {
    expect(isValidRemoteName(name)).toBe(true);
  });

  it('refuses a name that would be read as an option', () => {
    expect(isValidRemoteName('--mirror')).toBe(false);
  });

  it.each([
    ['', 'empty'],
    ['two words', 'whitespace'],
    ['a~b', 'a ref metacharacter'],
    ['a^b', 'a ref metacharacter'],
    ['a:b', 'a ref metacharacter'],
    ['a?b', 'a ref metacharacter'],
    ['a*b', 'a ref metacharacter'],
    ['a[b', 'a ref metacharacter'],
    ['a\\b', 'a backslash'],
    ['a..b', 'a double dot'],
    ['.hidden', 'a leading dot'],
    ['thing.lock', 'the .lock suffix'],
    [`a${String.fromCharCode(7)}b`, 'a control character'],
  ])('refuses %j — %s', (name) => {
    expect(isValidRemoteName(name)).toBe(false);
  });
});

describe('isSafeRemoteUrl', () => {
  /*
   * Deliberately permissive about *format*: all of these are things git
   * accepts and people use, and a stricter validator would reject real work.
   */
  it.each([
    'https://github.com/owner/repo.git',
    'git@github.com:owner/repo.git',
    'ssh://git@host:2222/srv/repo.git',
    'file:///srv/git/repo.git',
    '../sibling-repo',
    '/absolute/path/repo.git',
  ])('accepts %s', (url) => {
    expect(isSafeRemoteUrl(url)).toBe(true);
  });

  it.each(['', '   ', '--upload-pack=touch /tmp/x', 'https://host/a b.git', 'https://host/a\nb'])(
    'refuses %j',
    (url) => {
      expect(isSafeRemoteUrl(url)).toBe(false);
    },
  );
});

describe('parseCheckIgnore', () => {
  const group = (source: string, line: string, pattern: string, path: string) =>
    `${source}\0${line}\0${pattern}\0${path}\0`;

  it('reads the rule that ignores a path', () => {
    expect(parseCheckIgnore(group('.gitignore', '3', '*.log', 'debug.log'))).toEqual([
      { source: '.gitignore', line: 3, pattern: '*.log', path: 'debug.log' },
    ]);
  });

  it('reads several paths at once', () => {
    const stdout =
      group('.gitignore', '1', 'node_modules/', 'node_modules/x') +
      group('.git/info/exclude', '2', 'scratch/', 'scratch/y');

    expect(parseCheckIgnore(stdout).map((rule) => rule.source)).toEqual([
      '.gitignore',
      '.git/info/exclude',
    ]);
  });

  /*
   * Why `-z` rather than the `<source>:<line>:<pattern>\t<path>` default: both
   * a source path and a pattern may contain a colon, and splitting on one
   * would attribute the rule to the wrong file.
   */
  it('keeps a pattern containing a colon intact', () => {
    expect(parseCheckIgnore(group('.gitignore', '1', 'weird:name', 'weird:name'))[0]).toEqual({
      source: '.gitignore',
      line: 1,
      pattern: 'weird:name',
      path: 'weird:name',
    });
  });

  it('skips a path that no rule matched', () => {
    // git still emits a group, with the first three fields empty.
    expect(parseCheckIgnore(group('', '', '', 'tracked.ts'))).toEqual([]);
  });

  it('reads no output as no rules', () => {
    expect(parseCheckIgnore('')).toEqual([]);
  });
});
