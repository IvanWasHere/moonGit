import type { WatchState } from '@/stores/watchStore';

/**
 * Whether to warn that the working tree is not fully watched, and in what words.
 *
 * A function rather than a condition inside the banner's JSX because the rule
 * has three inputs that look like two, and the one that is easy to get wrong is
 * invisible on screen when it is right: `undefined` means the watch has not
 * been established yet, and must render nothing. Treated as "unhealthy" it puts
 * a warning on screen for a moment on **every** repository open; treated as
 * "healthy" it is correct by accident and stops being correct the first time
 * someone gives it a default. Neither mistake is visible in a screenshot, so
 * the rule is pinned here instead (`watchBanner.test.ts`).
 */
export interface WatchWarning {
  readonly message: string;
  /** Distinguishes the two failures for tests and for anything that styles them. */
  readonly kind: 'unwatched' | 'degraded';
}

export function watchWarningFor(watch: WatchState): WatchWarning | null {
  // Not known yet. Say nothing — see above.
  if (watch === undefined) return null;

  if (watch === null) {
    return {
      kind: 'unwatched',
      message: 'Not watching this repository — nothing refreshes on its own',
    };
  }

  if (!watch.degraded) return null;

  /*
   * Deliberately narrow about what is broken.
   *
   * `.git` is always covered even when the budget runs out (see
   * `internal/watcher/service.go`), so commits, checkouts, staging and branch
   * switches still report normally. Only edits to files in the uncovered part
   * go unnoticed. "This repository is not being watched" would be false, and
   * would send someone hunting for a bug in the half that works — the failure
   * being fixed here is silence, and overshooting into alarm is its own bug.
   */
  return {
    kind: 'degraded',
    message: 'Repository too large to watch fully — file edits may not appear on their own',
  };
}
