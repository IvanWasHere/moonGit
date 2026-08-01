import { describe, expect, it } from 'vitest';
import type { RepoStatus } from '@/services/git';
import { pushTarget } from './pushTarget';

function statusWith(branch: Partial<RepoStatus['branch']>): RepoStatus {
  return {
    branch: {
      oid: 'abc',
      head: 'main',
      detached: false,
      unborn: false,
      upstream: null,
      ahead: 0,
      behind: 0,
      ...branch,
    },
    entries: [],
  };
}

const origin = [{ name: 'origin' }];

describe('pushTarget', () => {
  it('pushes to the configured upstream remote', () => {
    const result = pushTarget(statusWith({ head: 'main', upstream: 'origin/main' }), origin);

    expect(result).toEqual({
      ok: true,
      target: { remote: 'origin', branch: 'main', setUpstream: false },
    });
  });

  it('sets an upstream when the branch has none', () => {
    const result = pushTarget(statusWith({ head: 'feature/x', upstream: null }), origin);

    expect(result).toEqual({
      ok: true,
      target: { remote: 'origin', branch: 'feature/x', setUpstream: true },
    });
  });

  /**
   * The case that broke the first push during Phase 5 verification: a branch
   * created with `switch -c work origin/main` inherits `origin/main`, and git
   * then refuses a bare push because the names disagree.
   */
  it('re-points an inherited upstream whose name does not match the branch', () => {
    const result = pushTarget(
      statusWith({ head: 'moongit-verify', upstream: 'origin/main' }),
      origin,
    );

    expect(result).toEqual({
      ok: true,
      target: { remote: 'origin', branch: 'moongit-verify', setUpstream: true },
    });
  });

  it('keeps a nested upstream branch name intact', () => {
    const result = pushTarget(
      statusWith({ head: 'feature/deep/name', upstream: 'origin/feature/deep/name' }),
      origin,
    );

    expect(result).toEqual({
      ok: true,
      target: { remote: 'origin', branch: 'feature/deep/name', setUpstream: false },
    });
  });

  it('reads the remote name from the upstream, not by assuming origin', () => {
    const result = pushTarget(statusWith({ head: 'main', upstream: 'upstream/main' }), [
      { name: 'origin' },
      { name: 'upstream' },
    ]);

    expect(result.ok && result.target.remote).toBe('upstream');
  });

  it('prefers origin when there is no upstream and several remotes', () => {
    const result = pushTarget(statusWith({ upstream: null }), [
      { name: 'backup' },
      { name: 'origin' },
    ]);

    expect(result.ok && result.target.remote).toBe('origin');
  });

  it('falls back to the only remote when it is not called origin', () => {
    const result = pushTarget(statusWith({ upstream: null }), [{ name: 'backup' }]);
    expect(result.ok && result.target.remote).toBe('backup');
  });

  it('refuses to guess with a detached HEAD', () => {
    const result = pushTarget(statusWith({ head: null, detached: true }), origin);
    expect(result).toEqual({ ok: false, problem: 'detached' });
  });

  it('refuses when there is no remote at all', () => {
    const result = pushTarget(statusWith({ upstream: null }), []);
    expect(result).toEqual({ ok: false, problem: 'no-remote' });
  });

  it('refuses when the status has not loaded', () => {
    expect(pushTarget(undefined, origin)).toEqual({ ok: false, problem: 'detached' });
  });
});
