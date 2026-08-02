/**
 * Generated patches, run through real git.
 *
 * The only test in the frontend suite that shells out — every other one drives
 * a fake bridge, and that is the right default. This one earns the exception:
 * a patch that is *malformed* fails loudly, but a patch that is merely **wrong**
 * applies cleanly and stages something the user did not ask for, and no fixture
 * can tell the two apart. Asking git is the only way to know.
 *
 * It found exactly that. Staging one line out of a block that replaces `a,b`
 * with `A,B` produced a patch git accepted and that left the index reading
 * `b,A,c` instead of `A,b,c` — see the ordering note in `patch.ts`.
 *
 * Costs about six seconds. Worth it for the one piece of this app that writes
 * to the index by constructing git's own input format.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DIFF_BASE_ARGS, parseDiff, type DiffFile } from '@/services/git';
import { buildPatch, hunkLineKeys, lineKey } from './patch';

/**
 * `latin1` throughout: git's output is bytes, and decoding it as UTF-8 would
 * corrupt exactly the paths `quotePath` exists to handle.
 */
function git(dir: string, args: readonly string[], stdin?: string): string {
  return execFileSync('git', [...args], {
    cwd: dir,
    encoding: 'latin1',
    ...(stdin !== undefined && { input: stdin }),
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'T',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 'T',
      GIT_COMMITTER_EMAIL: 't@t',
    },
  });
}

/** A throwaway repository. Never `testGitHere`, which is real (PLAN.md §13a). */
function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'moongit-patch-'));
  git(dir, ['init', '-q', '-b', 'main']);
  return dir;
}

function commit(dir: string, path: string, contents: string): void {
  writeFileSync(join(dir, path), contents);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'base']);
}

/** Twelve lines with the 2nd and 11th edited — far enough apart to be two hunks. */
function twoHunks(name = 'file.txt') {
  const dir = repo();
  const original = `${Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join('\n')}\n`;
  commit(dir, name, original);
  writeFileSync(
    join(dir, name),
    original.replace('line 2', 'LINE TWO').replace('line 11', 'LINE ELEVEN'),
  );
  return dir;
}

const worktreeDiff = (dir: string) => parseDiff(git(dir, DIFF_BASE_ARGS));
const stagedDiff = (dir: string) => parseDiff(git(dir, [...DIFF_BASE_ARGS, '--cached']));
const allKeys = (file: DiffFile) =>
  new Set(file.hunks.flatMap((hunk, index) => hunkLineKeys(hunk, index)));

function apply(dir: string, patch: string, reverse = false): void {
  const args = ['apply', '--cached', '--whitespace=nowarn'];
  if (reverse) args.push('--reverse');
  git(dir, [...args, '-'], patch);
}

describe('whole hunks', () => {
  it('stages an entire file', () => {
    const dir = twoHunks();
    const [file] = worktreeDiff(dir);
    apply(dir, buildPatch(file!, allKeys(file!), 'stage')!);

    expect(git(dir, ['status', '--porcelain']).trim()).toBe('M  file.txt');
    expect(git(dir, ['diff', '--cached', '--numstat']).trim()).toBe('2\t2\tfile.txt');
  });

  /** What the line-number arithmetic exists for: a skipped hunk shifts the rest. */
  it('stages only the second hunk', () => {
    const dir = twoHunks();
    const [file] = worktreeDiff(dir);
    apply(dir, buildPatch(file!, new Set(hunkLineKeys(file!.hunks[1]!, 1)), 'stage')!);

    expect(git(dir, ['diff', '--cached'])).toContain('LINE ELEVEN');
    expect(git(dir, ['diff', '--cached'])).not.toContain('LINE TWO');
    expect(git(dir, ['diff'])).toContain('LINE TWO');
    // Staged and modified: the two halves now hold different changes.
    expect(git(dir, ['status', '--porcelain']).trim()).toBe('MM file.txt');
  });

  it('stages only the first hunk', () => {
    const dir = twoHunks();
    const [file] = worktreeDiff(dir);
    apply(dir, buildPatch(file!, new Set(hunkLineKeys(file!.hunks[0]!, 0)), 'stage')!);

    expect(git(dir, ['diff', '--cached'])).toContain('LINE TWO');
    expect(git(dir, ['diff', '--cached'])).not.toContain('LINE ELEVEN');
  });

  it('unstages one hunk in reverse, leaving the other staged', () => {
    const dir = twoHunks();
    git(dir, ['add', '-A']);
    const [file] = stagedDiff(dir);
    apply(dir, buildPatch(file!, new Set(hunkLineKeys(file!.hunks[1]!, 1)), 'unstage')!, true);

    expect(git(dir, ['diff', '--cached'])).toContain('LINE TWO');
    expect(git(dir, ['diff', '--cached'])).not.toContain('LINE ELEVEN');
    expect(git(dir, ['diff'])).toContain('LINE ELEVEN');
  });
});

describe('individual lines', () => {
  /**
   * The bug this file was written to catch. `a,b` → `A,B`, staging only the
   * `a → A` half: the taken addition has to land where the deleted line was,
   * not after the line that stayed.
   */
  it('puts a staged line where the line it replaces was', () => {
    const dir = repo();
    commit(dir, 'f.txt', 'a\nb\nc\n');
    writeFileSync(join(dir, 'f.txt'), 'A\nB\nc\n');

    const [file] = worktreeDiff(dir);
    const lines = file!.hunks[0]!.lines;
    const wanted = new Set(
      lines
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => line.content === 'a' || line.content === 'A')
        .map(({ index }) => lineKey(0, index)),
    );

    apply(dir, buildPatch(file!, wanted, 'stage')!);
    expect(git(dir, ['show', ':f.txt'])).toBe('A\nb\nc\n');
    // And the rest is still waiting in the working tree.
    expect(git(dir, ['diff'])).toContain('+B');
  });

  it('unstages a single line back out of the index', () => {
    const dir = repo();
    commit(dir, 'f.txt', 'a\nb\nc\n');
    writeFileSync(join(dir, 'f.txt'), 'A\nB\nc\n');
    git(dir, ['add', '-A']);

    const [file] = stagedDiff(dir);
    const lines = file!.hunks[0]!.lines;
    const wanted = new Set(
      lines
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => line.content === 'a' || line.content === 'A')
        .map(({ index }) => lineKey(0, index)),
    );

    apply(dir, buildPatch(file!, wanted, 'unstage')!, true);
    // `a` came back; `B` stayed staged.
    expect(git(dir, ['show', ':f.txt'])).toBe('a\nB\nc\n');
  });
});

describe('awkward files', () => {
  it('handles a path containing a space', () => {
    const dir = twoHunks('my file.txt');
    const [file] = worktreeDiff(dir);
    apply(dir, buildPatch(file!, allKeys(file!), 'stage')!);
    expect(git(dir, ['status', '--porcelain']).trim()).toBe('M  "my file.txt"');
  });

  it('handles a file with no trailing newline', () => {
    const dir = repo();
    commit(dir, 'f.txt', 'one\ntwo');
    writeFileSync(join(dir, 'f.txt'), 'one\nTWO');

    const [file] = worktreeDiff(dir);
    apply(dir, buildPatch(file!, allKeys(file!), 'stage')!);
    expect(git(dir, ['show', ':f.txt'])).toBe('one\nTWO');
  });
});
