import { describe, expect, it } from 'vitest';
import {
  STATUS_AWKWARD_PATHS,
  STATUS_CLEAN,
  STATUS_DETACHED,
  STATUS_EVERYTHING,
  STATUS_UNBORN,
} from './__fixtures__/status';
import {
  isClean,
  isConflicted,
  isModeOnlyChange,
  isStaged,
  isUnstaged,
  parseStatus,
  StatusParseError,
  type StatusEntry,
} from './status';

function byPath(entries: readonly StatusEntry[], path: string): StatusEntry {
  const found = entries.find((entry) => entry.path === path);
  if (found === undefined) throw new Error(`no entry for ${JSON.stringify(path)}`);
  return found;
}

describe('parseStatus — branch headers', () => {
  it('reads name, upstream and ahead/behind', () => {
    const { branch } = parseStatus(STATUS_EVERYTHING);

    expect(branch).toEqual({
      oid: 'a57cf68f7bbec713a1d008ea6c68689804505599',
      head: 'main',
      detached: false,
      unborn: false,
      upstream: 'origin/main',
      ahead: 2,
      behind: 0,
    });
  });

  it('treats (initial) as an unborn branch rather than a commit named "(initial)"', () => {
    const { branch, entries } = parseStatus(STATUS_UNBORN);

    expect(branch.unborn).toBe(true);
    expect(branch.oid).toBeNull();
    expect(branch.head).toBe('main');
    expect(entries).toEqual([]);
  });

  it('treats (detached) as no branch rather than a branch named "(detached)"', () => {
    const { branch } = parseStatus(STATUS_DETACHED);

    expect(branch.detached).toBe(true);
    expect(branch.head).toBeNull();
    expect(branch.oid).toBe('a85ff03d07c37ee4189d059cca27e12ba254a7c4');
  });

  it('reports no upstream as null with zero ahead/behind', () => {
    const { branch } = parseStatus(STATUS_CLEAN);

    expect(branch.upstream).toBeNull();
    expect(branch.ahead).toBe(0);
    expect(branch.behind).toBe(0);
  });

  it('drops the signs from branch.ab and reports behind as a positive count', () => {
    const { branch } = parseStatus('# branch.head main\x00# branch.ab +12 -34\x00');

    expect(branch.ahead).toBe(12);
    expect(branch.behind).toBe(34);
  });

  it('returns empty branch info when --branch was not passed', () => {
    const { branch } = parseStatus('? untracked.txt\x00');

    expect(branch.head).toBeNull();
    expect(branch.oid).toBeNull();
    expect(branch.detached).toBe(false);
    expect(branch.unborn).toBe(false);
  });

  it('ignores headers it does not know', () => {
    const { branch } = parseStatus('# branch.head main\x00# something.new whatever\x00');

    expect(branch.head).toBe('main');
  });
});

describe('parseStatus — entries', () => {
  const { entries } = parseStatus(STATUS_EVERYTHING);

  it('reads a staged addition that was modified again afterwards', () => {
    const entry = byPath(entries, 'added.txt');

    expect(entry.kind).toBe('ordinary');
    expect(entry.index).toBe('A');
    expect(entry.worktree).toBe('M');
    expect(entry.modes).toEqual({ head: '000000', index: '100644', worktree: '100644' });
    expect(entry.headHash).toBe('0000000000000000000000000000000000000000');
    expect(isStaged(entry)).toBe(true);
    expect(isUnstaged(entry)).toBe(true);
  });

  it('reads a rename, taking the source path from the following record', () => {
    const entry = byPath(entries, 'renamed.txt');

    expect(entry.kind).toBe('renamed');
    expect(entry.origPath).toBe('renameme.txt');
    expect(entry.score).toBe(100);
    expect(entry.index).toBe('R');
    expect(entry.worktree).toBe('.');
  });

  // The source path is a separate NUL-terminated field, so a parser that
  // treats every record as one entry would silently turn it into a bogus one.
  it('does not leave a rename source behind as its own entry', () => {
    expect(entries.some((entry) => entry.path === 'renameme.txt')).toBe(false);
    expect(entries.some((entry) => entry.path === 'deleteme.txt')).toBe(false);
  });

  it('reads a merge conflict with all three stages', () => {
    const entry = byPath(entries, 'conflict.txt');

    expect(entry.kind).toBe('unmerged');
    expect(entry.index).toBe('A');
    expect(entry.worktree).toBe('A');
    expect(isConflicted(entry)).toBe(true);
    expect(entry.stages).toEqual({
      modes: ['000000', '100644', '100644'],
      worktreeMode: '100644',
      hashes: [
        '0000000000000000000000000000000000000000',
        'ba2906d0666cf726c7eaadd2cd3db615dedfdf3a',
        'c7747099cf9e073babc68f52cdfb4d280ba5689f',
      ],
    });
  });

  it('decodes submodule state from the sub-field', () => {
    const entry = byPath(entries, 'sub');

    expect(entry.submodule).toEqual({
      commitChanged: false,
      hasModifiedContent: true,
      hasUntracked: false,
    });
    expect(entry.modes?.head).toBe('160000');
  });

  it('leaves submodule undefined for ordinary files', () => {
    expect(byPath(entries, 'modifyme.txt').submodule).toBeUndefined();
  });

  it('separates untracked from ignored', () => {
    expect(byPath(entries, '.gitignore').kind).toBe('untracked');
    expect(byPath(entries, 'ignored.log').kind).toBe('ignored');

    const ignored = byPath(entries, 'ignored.log');
    expect(isStaged(ignored)).toBe(false);
    expect(isUnstaged(ignored)).toBe(false);
  });

  it('counts every record exactly once', () => {
    // 6 tracked + 4 untracked + 1 ignored; the two rename sources are not entries.
    expect(entries).toHaveLength(11);
  });
});

describe('parseStatus — paths that break naive parsers', () => {
  const { entries } = parseStatus(STATUS_EVERYTHING);

  it('keeps newlines and tabs inside a filename', () => {
    // Splitting records on '\n' instead of NUL would turn this one path into
    // two entries, neither of which exists on disk.
    expect(entries.some((entry) => entry.path === 'newline\nin\tname.txt')).toBe(true);
  });

  it('keeps quotes and backslashes unescaped', () => {
    expect(entries.some((entry) => entry.path === 'quote"and\\backslash.txt')).toBe(true);
  });

  it('preserves leading, trailing and doubled spaces', () => {
    const awkward = parseStatus(STATUS_AWKWARD_PATHS).entries;
    const paths = awkward.map((entry) => entry.path);

    expect(paths).toContain(' leading space.txt');
    expect(paths).toContain('trailing space .txt');
    expect(paths).toContain('a b  c.txt');
  });

  it('reads modes for a symlink and an exec-bit change', () => {
    const awkward = parseStatus(STATUS_AWKWARD_PATHS).entries;

    expect(byPath(awkward, 'link.txt').modes?.index).toBe('120000');

    const execBit = byPath(awkward, 'trailing space .txt');
    expect(execBit.modes).toEqual({ head: '100644', index: '100755', worktree: '100755' });
    expect(isModeOnlyChange(execBit)).toBe(true);
    expect(isModeOnlyChange(byPath(awkward, ' leading space.txt'))).toBe(false);
  });
});

describe('parseStatus — malformed input', () => {
  it('rejects an unknown record type instead of skipping it', () => {
    expect(() => parseStatus('X something\x00')).toThrow(StatusParseError);
  });

  it('rejects a truncated entry', () => {
    expect(() => parseStatus('1 .M N... 100644\x00')).toThrow(StatusParseError);
  });

  it('rejects a rename with no source path', () => {
    const record =
      '2 R. N... 100644 100644 100644 0c2aa38e0600e0d2df09c2f84664d8a14f899879 0c2aa38e0600e0d2df09c2f84664d8a14f899879 R100 renamed.txt\x00';
    expect(() => parseStatus(record)).toThrow(/no source path/);
  });

  it('rejects an unrecognised status code', () => {
    expect(() => parseStatus('1 ZZ N... 100644 100644 100644 aaa bbb file.txt\x00')).toThrow(
      StatusParseError,
    );
  });

  it('names the offending record in the message', () => {
    expect(() => parseStatus('X bad\x00')).toThrow(/"X bad"/);
  });

  it('parses empty output as a clean repository', () => {
    const status = parseStatus('');
    expect(status.entries).toEqual([]);
    expect(isClean(status)).toBe(true);
  });
});

describe('isClean', () => {
  it('ignores ignored files', () => {
    expect(isClean(parseStatus(STATUS_CLEAN))).toBe(true);
    expect(isClean(parseStatus('! ignored.log\x00'))).toBe(true);
    expect(isClean(parseStatus(STATUS_EVERYTHING))).toBe(false);
  });
});
