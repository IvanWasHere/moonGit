import { describe, expect, it } from 'vitest';
import { isReadOnly, subcommandOf } from './commands';

describe('subcommandOf', () => {
  it('skips git-level options', () => {
    expect(subcommandOf(['status', '--porcelain=v2'])).toBe('status');
    expect(subcommandOf(['-c', 'core.quotepath=false', 'status'])).toBe('status');
    expect(subcommandOf(['--no-pager', '-C', '/repo', 'log'])).toBe('log');
    expect(subcommandOf(['--git-dir=/repo/.git', 'fetch'])).toBe('fetch');
  });

  it('is not fooled by a flag value that looks like a subcommand', () => {
    expect(subcommandOf(['-C', 'stash', 'commit'])).toBe('commit');
  });

  it('returns undefined when there is no subcommand', () => {
    expect(subcommandOf(['--version'])).toBeUndefined();
    expect(subcommandOf([])).toBeUndefined();
  });
});

describe('isReadOnly', () => {
  it.each([
    ['status', ['status', '--porcelain=v2', '-z', '--branch']],
    ['log', ['log', '-z', '--format=%H%x00%s']],
    ['diff', ['diff', '--patch', '--no-color', '-U3']],
    ['for-each-ref', ['for-each-ref', '--format=%(refname)']],
    ['rev-parse', ['rev-parse', 'HEAD']],
    ['blame', ['blame', '--porcelain', 'src/app.ts']],
    ['no subcommand', ['--version']],
  ])('treats %s as a read', (_label, args) => {
    expect(isReadOnly(args)).toBe(true);
  });

  it.each([
    ['add', ['add', '--', 'src/app.ts']],
    ['commit', ['commit', '-m', 'msg']],
    ['checkout', ['checkout', 'main']],
    ['reset', ['reset', 'HEAD', '--', 'file']],
    ['merge', ['merge', 'origin/main']],
    ['fetch', ['fetch', '--prune']],
    ['push', ['push', 'origin', 'main']],
  ])('treats %s as a write', (_label, args) => {
    expect(isReadOnly(args)).toBe(false);
  });

  it('splits subcommands by how they are invoked', () => {
    expect(isReadOnly(['stash', 'list'])).toBe(true);
    expect(isReadOnly(['stash', 'push', '-m', 'wip'])).toBe(false);
    expect(isReadOnly(['stash'])).toBe(false);

    expect(isReadOnly(['branch', '--list'])).toBe(true);
    expect(isReadOnly(['branch'])).toBe(true);
    expect(isReadOnly(['branch', '--contains', 'HEAD'])).toBe(true);
    expect(isReadOnly(['branch', '-d', 'feature'])).toBe(false);
    expect(isReadOnly(['branch', 'feature'])).toBe(false);

    expect(isReadOnly(['config', '--get', 'user.name'])).toBe(true);
    expect(isReadOnly(['config', 'user.name', 'Ivan'])).toBe(false);

    expect(isReadOnly(['remote'])).toBe(true);
    expect(isReadOnly(['remote', '-v'])).toBe(true);
    expect(isReadOnly(['remote', 'add', 'origin', 'url'])).toBe(false);

    expect(isReadOnly(['symbolic-ref', '--short', 'HEAD'])).toBe(true);
    expect(isReadOnly(['symbolic-ref', 'HEAD', 'refs/heads/main'])).toBe(false);

    expect(isReadOnly(['worktree', 'list'])).toBe(true);
    expect(isReadOnly(['worktree', 'add', '/tmp/wt'])).toBe(false);
  });

  // The safety property this whole module exists for: an unrecognised command
  // must serialize rather than run alongside a commit.
  it('treats anything unrecognised as a write', () => {
    expect(isReadOnly(['update-index', '--refresh'])).toBe(false);
    expect(isReadOnly(['some-future-subcommand'])).toBe(false);
  });
});
