import { beforeEach, describe, expect, it } from 'vitest';
import type { GitRunRequest, GitRunResult } from '../wails';
import { GitRunner, type GitBridge } from './GitRunner';
import { MergeService, RebaseService } from './IntegrationService';
import { BLAME_FILE, STASH_LIST } from './parsers/__fixtures__/stashblame';
import { BlameService, RemoteService, TagService } from './RemoteService';
import { resetRepoLocks } from './RepoLock';
import { StashService } from './StashService';

const REPO = '/repos/test-repo1';

function runnerFor(stdout: string, overrides: Partial<GitRunResult> = {}) {
  const requests: GitRunRequest[] = [];
  const bridge: GitBridge & { requests: GitRunRequest[] } = {
    requests,
    run: (request) => {
      requests.push(request);
      return Promise.resolve({
        stdout,
        stderr: '',
        exitCode: 0,
        durationMs: 1,
        timedOut: false,
        ...overrides,
      });
    },
    runStream: () =>
      Promise.resolve({
        stderr: '',
        exitCode: 0,
        durationMs: 1,
        timedOut: false,
        canceled: false,
        bytesOut: 0,
        chunks: 0,
      }),
  };
  return { bridge, runner: new GitRunner(REPO, { bridge }) };
}

beforeEach(() => {
  resetRepoLocks();
});

describe('StashService', () => {
  it('parses the stash stack', async () => {
    const { runner } = runnerFor(STASH_LIST);
    const result = await new StashService(runner).list();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(4);
    expect(result.value[1]?.includesUntracked).toBe(true);
  });

  // git exits 0 and says "No local changes to save"; without checking the
  // output this reads as a stash that then never appears in the list.
  it('reports a no-op push as false rather than success', async () => {
    const { runner } = runnerFor('No local changes to save\n');
    const result = await new StashService(runner).push();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(false);
  });

  it('reports a real push as true', async () => {
    const { runner } = runnerFor('Saved working directory and index state WIP on main: abc\n');
    const result = await new StashService(runner).push({ message: 'wip' });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(true);
  });

  it('passes the message and untracked flag through', async () => {
    const { runner, bridge } = runnerFor('');
    await new StashService(runner).push({ message: 'my work', includeUntracked: true });

    const args = bridge.requests[0]?.args ?? [];
    expect(args).toContain('--include-untracked');
    expect(args[args.indexOf('--message') + 1]).toBe('my work');
  });

  it('operates on the selector it was given, not a formatted index', async () => {
    const { runner, bridge } = runnerFor('');
    await new StashService(runner).pop('stash@{2}');

    expect(bridge.requests[0]?.args).toEqual(['stash', 'pop', 'stash@{2}']);
  });
});

describe('MergeService', () => {
  it('reads a fast-forward', async () => {
    const { runner } = runnerFor('Updating 5c002d3..f0f3d98\nFast-forward\n f.txt | 1 +\n');
    const result = await new MergeService(runner).merge('side');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe('fastForward');
  });

  it('reads an up-to-date merge', async () => {
    const { runner } = runnerFor('Already up to date.\n');
    const result = await new MergeService(runner).merge('side');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe('upToDate');
  });

  it('reads a completed merge', async () => {
    const { runner } = runnerFor("Merge made by the 'ort' strategy.\n f.txt | 2 +-\n");
    const result = await new MergeService(runner).merge('side');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe('completed');
  });

  // The point of this whole service: exit 1 with conflicts is an outcome the
  // user must be shown, not an error to report and forget.
  it('reads a conflict as an outcome, not an error', async () => {
    const { runner } = runnerFor(
      'Auto-merging f.txt\nCONFLICT (content): Merge conflict in f.txt\n' +
        'Automatic merge failed; fix conflicts and then commit the result.\n',
      { exitCode: 1 },
    );
    const result = await new MergeService(runner).merge('side');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('conflicted');
    expect(result.value.summary).toBe('Auto-merging f.txt');
  });

  // Every exit code below was measured against git 2.47. The unknown-ref case
  // is the dangerous one: it shares exit 1 with a real conflict, so classifying
  // on the code alone would open a conflict-resolution flow over a working tree
  // that has nothing conflicted in it.
  it('does not mistake an unknown ref for a conflict, despite the shared exit code', async () => {
    const { runner } = runnerFor('', {
      exitCode: 1,
      stderr: 'merge: nosuchbranch - not something we can merge\n',
    });
    const result = await new MergeService(runner).merge('nosuchbranch');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/not something we can merge/);
  });

  it('reports a refusal over a dirty working tree as an error', async () => {
    const { runner } = runnerFor('', {
      exitCode: 2,
      stderr: 'error: Your local changes to the following files would be overwritten by merge:\n',
    });
    const result = await new MergeService(runner).merge('side');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('MergeConflict');
  });

  it('reports an --ff-only refusal as an error', async () => {
    const { runner } = runnerFor('', {
      exitCode: 128,
      stderr: "hint: Diverging branches can't be fast-forwarded, you need to either:\n",
    });
    const result = await new MergeService(runner).merge('side', { fastForwardOnly: true });

    expect(result.ok).toBe(false);
  });

  it('never opens an editor', async () => {
    const { runner, bridge } = runnerFor('');
    await new MergeService(runner).merge('side');

    // There is no terminal behind this process; an editor prompt would hang
    // until the command timed out.
    expect(bridge.requests[0]?.args).toContain('--no-edit');
  });

  it('passes merge strategy flags', async () => {
    const { runner, bridge } = runnerFor('');
    await new MergeService(runner).merge('side', { noFastForward: true, message: 'merged' });

    const args = bridge.requests[0]?.args ?? [];
    expect(args).toContain('--no-ff');
    expect(args[args.indexOf('--message') + 1]).toBe('merged');
  });
});

describe('RebaseService', () => {
  it('reads a rebase conflict from stderr', async () => {
    const { runner } = runnerFor(
      'Auto-merging f.txt\nCONFLICT (content): Merge conflict in f.txt\n',
      {
        exitCode: 1,
        stderr: 'Rebasing (1/1)error: could not apply b9eb6e3... main\n',
      },
    );
    const result = await new RebaseService(runner).rebase('side');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('conflicted');
    // A rebase announces itself on stderr, unlike a merge.
    expect(result.value.summary).toMatch(/Rebasing/);
  });

  it('reads a clean rebase as completed', async () => {
    const { runner } = runnerFor('', {
      stderr: 'Successfully rebased and updated refs/heads/main.\n',
    });
    const result = await new RebaseService(runner).rebase('main');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe('completed');
  });

  it('builds an --onto rebase in the right order', async () => {
    const { runner, bridge } = runnerFor('');
    await new RebaseService(runner).rebase('upstream', { onto: 'newbase', branch: 'topic' });

    expect(bridge.requests[0]?.args).toEqual(['rebase', '--onto', 'newbase', 'upstream', 'topic']);
  });

  it('reports a conflict again when continue hits the next one', async () => {
    const { runner } = runnerFor('CONFLICT (content): Merge conflict in f.txt\n', { exitCode: 1 });
    const result = await new RebaseService(runner).continueRebase();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe('conflicted');
  });
});

describe('RemoteService', () => {
  it('lists remotes from config', async () => {
    const { runner } = runnerFor(
      'remote.origin.url ../origin.git\nremote.second.url /tmp/other.git\n',
    );
    const result = await new RemoteService(runner).list();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([
      { name: 'origin', url: '../origin.git' },
      { name: 'second', url: '/tmp/other.git' },
    ]);
  });

  it('treats a repository with no remotes as an empty list', async () => {
    const { runner } = runnerFor('', { exitCode: 1 });
    const result = await new RemoteService(runner).list();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([]);
  });

  it('keeps a URL containing spaces intact', async () => {
    const { runner } = runnerFor('remote.origin.url /path with spaces/repo.git\n');
    const result = await new RemoteService(runner).list();

    if (result.ok) expect(result.value[0]?.url).toBe('/path with spaces/repo.git');
  });

  it('gives fetch a longer timeout than an ordinary read', async () => {
    const { runner, bridge } = runnerFor('');
    await new RemoteService(runner).fetch('origin', { prune: true });

    expect(bridge.requests[0]?.timeoutMs).toBe(120_000);
    expect(bridge.requests[0]?.args).toContain('--prune');
  });
});

describe('TagService', () => {
  it('creates a lightweight tag by default', async () => {
    const { runner, bridge } = runnerFor('');
    await new TagService(runner).create('v1.0');

    expect(bridge.requests[0]?.args).toEqual(['tag', 'v1.0']);
  });

  it('creates an annotated tag when given a message', async () => {
    const { runner, bridge } = runnerFor('');
    await new TagService(runner).create('v1.0', { message: 'release', target: 'abc123' });

    expect(bridge.requests[0]?.args).toEqual([
      'tag',
      '--annotate',
      '--message',
      'release',
      'v1.0',
      'abc123',
    ]);
  });
});

describe('BlameService', () => {
  it('parses blame output', async () => {
    const { runner } = runnerFor(BLAME_FILE);
    const result = await new BlameService(runner).blame('a.txt');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lines).toHaveLength(6);
    expect(result.value.commits.size).toBe(3);
  });

  it('separates the path from revisions with --', async () => {
    const { runner, bridge } = runnerFor(BLAME_FILE);
    await new BlameService(runner).blame('main', { revision: 'HEAD' });

    // A file named "main" must not be read as the branch "main".
    const args = bridge.requests[0]?.args ?? [];
    expect(args.slice(-2)).toEqual(['--', 'main']);
    expect(args[args.indexOf('--') - 1]).toBe('HEAD');
  });

  it('passes blame options', async () => {
    const { runner, bridge } = runnerFor(BLAME_FILE);
    await new BlameService(runner).blame('a.txt', {
      ignoreWhitespace: true,
      detectMoves: true,
      lineRange: { start: 10, end: 20 },
    });

    const args = bridge.requests[0]?.args ?? [];
    expect(args).toContain('-w');
    expect(args).toContain('-M');
    expect(args[args.indexOf('-L') + 1]).toBe('10,20');
  });
});
