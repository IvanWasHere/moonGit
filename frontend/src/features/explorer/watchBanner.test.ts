import { describe, expect, it } from 'vitest';
import type { WatchInfo } from '@/services/wails';
import { watchWarningFor } from './watchBanner';

/**
 * The three-state rule behind the watcher banner (PLAN.md §10, 7.6).
 *
 * The flag it renders spent two phases reaching no UI at all — Go set it,
 * `watch.ts` documented it as something the UI should say, and
 * `useRepoWatcher` threw the value away. These tests are what keep it wired.
 */

function info(overrides: Partial<WatchInfo> = {}): WatchInfo {
  return { repoPath: '/repos/example', dirs: 12, descriptors: 12, degraded: false, ...overrides };
}

describe('watchWarningFor', () => {
  it('says nothing while the watch is still being established', () => {
    // The subtle one. `undefined` is not "healthy" and not "broken" — it is
    // the few hundred milliseconds of every repository open, and a warning
    // here would flash on screen every single time one is opened.
    expect(watchWarningFor(undefined)).toBeNull();
  });

  it('says nothing when the whole tree is watched', () => {
    expect(watchWarningFor(info())).toBeNull();
  });

  it('warns that nothing auto-refreshes when there is no watch at all', () => {
    const warning = watchWarningFor(null);
    expect(warning?.kind).toBe('unwatched');
    expect(warning?.message).toMatch(/nothing refreshes/i);
  });

  it('warns about missed edits — not about the repository being unwatched — when degraded', () => {
    /*
     * The wording matters more than it looks. `.git` stays watched when the
     * descriptor budget runs out, so commits, staging and checkouts still
     * report; only edits in the uncovered part are missed. Claiming the
     * repository is unwatched would be false and would send someone looking
     * for a bug in the parts that work.
     */
    const warning = watchWarningFor(info({ degraded: true }));
    expect(warning?.kind).toBe('degraded');
    expect(warning?.message).toMatch(/file edits/i);
    expect(warning?.message).not.toMatch(/not watching/i);
  });

  it('distinguishes the two failures rather than collapsing them', () => {
    // They need different sentences: one is partial, one is total.
    expect(watchWarningFor(null)?.message).not.toBe(
      watchWarningFor(info({ degraded: true }))?.message,
    );
  });
});
