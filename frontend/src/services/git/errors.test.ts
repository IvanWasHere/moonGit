import { describe, expect, it } from 'vitest';
import { classifyOutput, classifyStderr, toGitError } from './errors';

/**
 * The strings below were captured from git 2.47.1 under `LC_ALL=C` by running
 * the failing command — a paraphrased fixture would make this suite pass while
 * the app fails, since the whole point is matching what git actually prints.
 *
 * The one exception is "Authentication failed for", which needs a real
 * rejected credential against a real host to reproduce; it is git's own
 * message text.
 */
describe('classifyStderr', () => {
  it.each([
    ['NotARepository', 'fatal: not a git repository (or any of the parent directories): .git\n'],
    [
      'AuthRequired',
      "fatal: Authentication failed for 'https://github.com/IvanWasHere/test-repo1.git/'\n",
    ],
    [
      'AuthRequired',
      "fatal: could not read Username for 'https://github.com': terminal prompts disabled\n",
    ],
    [
      'AuthRequired',
      'git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.\n',
    ],
    [
      'LockExists',
      "fatal: Unable to create '/repo/.git/index.lock': File exists.\n\nAnother git process seems to be running in this repository.\n",
    ],
    [
      'LockExists',
      "fatal: cannot lock ref 'refs/heads/feat': Unable to create '/repo/.git/refs/heads/feat.lock': File exists.\n",
    ],
    // Cherry-pick and rebase put the conflict on stderr; the wording differs
    // between them, so both are pinned.
    [
      'MergeConflict',
      'error: could not apply 5b42c95... feat\nhint: After resolving the conflicts, mark them with\nhint: "git add/rm <pathspec>", then run\nhint: "git cherry-pick --continue".\n',
    ],
    [
      'MergeConflict',
      'Rebasing (1/1)error: could not apply bb19a60... other\nhint: Resolve all conflicts manually, mark them as resolved with\n',
    ],
    [
      'MergeConflict',
      'error: Your local changes to the following files would be overwritten by checkout:\n\tsrc/app.ts\n',
    ],
    ['DetachedHead', 'fatal: ref HEAD is not a symbolic ref\n'],
    ['Unknown', "error: pathspec 'nope' did not match any file(s) known to git\n"],
    ['Unknown', ''],
  ])('reads %s', (expected, stderr) => {
    expect(classifyStderr(stderr)).toBe(expected);
  });
});

describe('classifyOutput', () => {
  // `git merge` is the awkward one, and this was confirmed by running it:
  // a conflicted merge exits 1 with the whole announcement on stdout and
  // stderr completely empty, so stderr-only classification returns Unknown.
  it('falls back to stdout when stderr says nothing useful', () => {
    const stdout =
      'Auto-merging README.md\nCONFLICT (content): Merge conflict in README.md\nAutomatic merge failed; fix conflicts and then commit the result.\n';
    expect(classifyStderr(stdout)).toBe('MergeConflict');
    expect(classifyOutput('', stdout)).toBe('MergeConflict');
  });

  it('prefers stderr when both streams are classifiable', () => {
    const stderr = 'fatal: not a git repository (or any of the parent directories): .git\n';
    const stdout = 'CONFLICT (content): Merge conflict in README.md\n';
    expect(classifyOutput(stderr, stdout)).toBe('NotARepository');
  });
});

describe('toGitError', () => {
  it('carries the first stderr line as the message', () => {
    const error = toGitError({
      stderr:
        "fatal: Unable to create '/repo/.git/index.lock': File exists.\n\nAnother git process seems to be running.\n",
      exitCode: 128,
      args: ['commit', '-m', 'wip'],
      repoPath: '/repo',
    });

    expect(error.kind).toBe('LockExists');
    expect(error.message).toBe("fatal: Unable to create '/repo/.git/index.lock': File exists.");
    expect(error.exitCode).toBe(128);
    expect(error.args).toEqual(['commit', '-m', 'wip']);
    expect(error.repoPath).toBe('/repo');
  });

  it('honours a forced kind over what stderr suggests', () => {
    const error = toGitError({
      stderr: 'fatal: not a git repository\n',
      exitCode: -1,
      args: ['status'],
      repoPath: '/repo',
      kind: 'Timeout',
    });

    expect(error.kind).toBe('Timeout');
  });

  it('synthesises a message when git was killed before it printed anything', () => {
    const timedOut = toGitError({
      stderr: '',
      exitCode: -1,
      args: ['fetch'],
      repoPath: '/repo',
      kind: 'Timeout',
    });
    expect(timedOut.message).toBe('git fetch timed out');

    const canceled = toGitError({
      stderr: '',
      exitCode: -1,
      args: ['log'],
      repoPath: '/repo',
      kind: 'Canceled',
    });
    expect(canceled.message).toBe('git log was canceled');

    const unknown = toGitError({ stderr: '', exitCode: 2, args: ['gc'], repoPath: '/repo' });
    expect(unknown.message).toBe('git gc exited with code 2');
  });

  it('omits cause unless one was given', () => {
    const plain = toGitError({ stderr: 'boom', exitCode: 1, args: ['status'], repoPath: '/r' });
    expect('cause' in plain).toBe(false);

    const spawn = toGitError({
      stderr: 'git not found',
      exitCode: -1,
      args: ['status'],
      repoPath: '/r',
      kind: 'SpawnFailed',
      cause: new Error('git not found'),
    });
    expect(spawn.cause).toBeInstanceOf(Error);
  });
});
