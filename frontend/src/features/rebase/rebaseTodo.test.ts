import { describe, expect, it } from 'vitest';
import type { Commit } from '@/services/git';
import {
  moveEntry,
  serialiseTodo,
  setAction,
  shellQuote,
  todoFromCommits,
  todoProblem,
  type TodoEntry,
} from './rebaseTodo';

function commit(oid: string, subject: string): Commit {
  return {
    oid: oid.padEnd(40, '0'),
    shortOid: oid.slice(0, 7),
    parents: [],
    author: { name: 'T', email: 't@t', date: 0 },
    committer: { name: 'T', email: 't@t', date: 0 },
    subject,
    body: '',
    decorations: [],
    isMerge: false,
    isRoot: false,
  };
}

function entry(action: TodoEntry['action'], oid = 'aaaaaaa'): TodoEntry {
  return { oid: oid.padEnd(40, '0'), shortOid: oid, subject: 's', action };
}

describe('todoFromCommits', () => {
  /**
   * `git log` hands back newest first; git's todo applies oldest first. Getting
   * this backwards makes "fold into the commit above" mean the opposite.
   */
  it('reverses log order into apply order', () => {
    const todo = todoFromCommits([
      commit('ccc', 'newest'),
      commit('bbb', 'middle'),
      commit('aaa', 'oldest'),
    ]);
    expect(todo.map((item) => item.subject)).toEqual(['oldest', 'middle', 'newest']);
  });

  it('starts everything as pick', () => {
    const todo = todoFromCommits([commit('aaa', 'one'), commit('bbb', 'two')]);
    expect(todo.every((item) => item.action === 'pick')).toBe(true);
  });

  it('handles an empty range', () => {
    expect(todoFromCommits([])).toEqual([]);
  });
});

describe('reordering', () => {
  const list = [entry('pick', 'aaa'), entry('pick', 'bbb'), entry('pick', 'ccc')];

  it('moves an entry down', () => {
    expect(moveEntry(list, 0, 2).map((item) => item.shortOid)).toEqual(['bbb', 'ccc', 'aaa']);
  });

  it('moves an entry up', () => {
    expect(moveEntry(list, 2, 0).map((item) => item.shortOid)).toEqual(['ccc', 'aaa', 'bbb']);
  });

  it('leaves the list alone for a no-op or an out-of-range move', () => {
    expect(moveEntry(list, 1, 1)).toEqual(list);
    expect(moveEntry(list, 0, 9)).toEqual(list);
    expect(moveEntry(list, -1, 0)).toEqual(list);
  });

  it('does not mutate its input', () => {
    const before = list.map((item) => item.shortOid);
    moveEntry(list, 0, 2);
    expect(list.map((item) => item.shortOid)).toEqual(before);
  });
});

describe('setAction', () => {
  it('changes one entry and leaves the rest', () => {
    const list = [entry('pick', 'aaa'), entry('pick', 'bbb')];
    const next = setAction(list, 1, 'fixup');
    expect(next.map((item) => item.action)).toEqual(['pick', 'fixup']);
    expect(list.map((item) => item.action)).toEqual(['pick', 'pick']);
  });
});

describe('todoProblem', () => {
  /**
   * The rule that actually bites. Git only complains *after* it has started
   * rewriting history, which is a far worse place to find out.
   */
  it('rejects a list whose first surviving commit folds upward', () => {
    expect(todoProblem([entry('squash'), entry('pick')])).toMatch(/needs a commit above/);
    expect(todoProblem([entry('fixup'), entry('pick')])).toMatch(/needs a commit above/);
  });

  /** Dropped entries are not there, so the *second* line can be the first. */
  it('looks past dropped entries when finding the first', () => {
    expect(todoProblem([entry('drop'), entry('squash'), entry('pick')])).toMatch(
      /needs a commit above/,
    );
    expect(todoProblem([entry('drop'), entry('pick'), entry('squash')])).toBeNull();
  });

  it('rejects dropping everything', () => {
    expect(todoProblem([entry('drop'), entry('drop')])).toMatch(/nothing to rebase/);
    expect(todoProblem([])).toMatch(/nothing to rebase/);
  });

  it('accepts an ordinary list', () => {
    expect(todoProblem([entry('pick'), entry('squash'), entry('fixup'), entry('edit')])).toBeNull();
  });
});

describe('serialiseTodo', () => {
  it('writes one line per entry in git format', () => {
    const todo = [
      { oid: 'a'.repeat(40), shortOid: 'aaaaaaa', subject: 'first', action: 'pick' as const },
      { oid: 'b'.repeat(40), shortOid: 'bbbbbbb', subject: 'second', action: 'squash' as const },
    ];
    expect(serialiseTodo(todo)).toBe(
      `pick ${'a'.repeat(40)} first\nsquash ${'b'.repeat(40)} second\n`,
    );
  });

  it('keeps drop lines, which git understands', () => {
    expect(serialiseTodo([entry('drop', 'aaa')])).toMatch(/^drop /);
  });

  it('ends with a newline', () => {
    expect(serialiseTodo([entry('pick')]).endsWith('\n')).toBe(true);
  });
});

describe('shellQuote', () => {
  /**
   * Git hands the sequence editor to `sh -c`, so a repository under a path
   * with a space produces a command that copies the wrong file — or nothing.
   */
  it('quotes a path with spaces', () => {
    expect(shellQuote('/Users/me/my repo/.git/todo')).toBe("'/Users/me/my repo/.git/todo'");
  });

  it('escapes an embedded single quote', () => {
    expect(shellQuote("/tmp/it's/todo")).toBe(`'/tmp/it'\\''s/todo'`);
  });

  it('leaves an ordinary path safely quoted', () => {
    expect(shellQuote('/tmp/repo/.git/todo')).toBe("'/tmp/repo/.git/todo'");
  });
});
