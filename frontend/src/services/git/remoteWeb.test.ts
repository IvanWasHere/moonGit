import { describe, expect, it } from 'vitest';
import { pullRequestsUrl, releasesUrl, remoteWeb } from './remoteWeb';

/**
 * Turning a git remote into a browsable URL (PLAN.md §11, 8.9).
 *
 * The scp-like form is the one that breaks naive implementations: it has no
 * scheme, so `new URL()` throws on it, and its separator is a colon rather
 * than a slash — yet it is what `git clone git@github.com:…` leaves in every
 * repository cloned over SSH, which is most of them.
 */

describe('remoteWeb', () => {
  it('reads the scp-like SSH form git actually stores', () => {
    expect(remoteWeb('git@github.com:owner/repo.git')?.url).toBe('https://github.com/owner/repo');
  });

  it('reads a real ssh:// URL', () => {
    expect(remoteWeb('ssh://git@github.com/owner/repo.git')?.url).toBe(
      'https://github.com/owner/repo',
    );
  });

  it('passes https through, minus the .git', () => {
    expect(remoteWeb('https://github.com/owner/repo.git')?.url).toBe(
      'https://github.com/owner/repo',
    );
  });

  it('keeps nested groups, which GitLab uses', () => {
    expect(remoteWeb('git@gitlab.com:group/sub/repo.git')?.path).toBe('group/sub/repo');
  });

  it('tolerates a missing .git suffix and trailing slashes', () => {
    expect(remoteWeb('https://github.com/owner/repo/')?.url).toBe('https://github.com/owner/repo');
  });

  it.each([
    ['', 'empty'],
    ['/Users/ivan/repos/thing', 'a local path'],
    ['file:///Users/ivan/repos/thing', 'a file URL'],
    ['https://github.com', 'a host with no repository'],
  ])('returns null for %o (%s)', (value) => {
    // Null rather than a guess: a caller that cannot build a link should say
    // so, not open a browser on something invented.
    expect(remoteWeb(value)).toBeNull();
  });
});

describe('pullRequestsUrl', () => {
  it('uses each host own word for it', () => {
    // "pulls" on GitLab is a 404, which is worse than no link at all.
    expect(pullRequestsUrl('git@github.com:o/r.git')).toBe('https://github.com/o/r/pulls');
    expect(pullRequestsUrl('git@gitlab.com:o/r.git')).toBe(
      'https://gitlab.com/o/r/-/merge_requests',
    );
    expect(pullRequestsUrl('git@bitbucket.org:o/r.git')).toBe(
      'https://bitbucket.org/o/r/pull-requests',
    );
  });

  it('falls back to the repository page on an unknown host', () => {
    expect(pullRequestsUrl('git@git.example.com:o/r.git')).toBe('https://git.example.com/o/r');
  });

  it('is null when there is nothing to link to', () => {
    expect(pullRequestsUrl('/Users/ivan/repos/thing')).toBeNull();
  });
});

describe('releasesUrl', () => {
  it('points at releases where the host has them', () => {
    expect(releasesUrl('git@github.com:o/r.git')).toBe('https://github.com/o/r/releases');
    expect(releasesUrl('git@gitlab.com:o/r.git')).toBe('https://gitlab.com/o/r/-/releases');
  });
});
