/**
 * Display formatting, ported from the mockup's helpers (ui-example L422–449).
 *
 * Pure and framework-free so the port can be validated without rendering.
 */

/**
 * "just now" / "5m ago" / "3h ago" / "2d ago" — the mockup's exact ladder
 * (L422–430), including its choice to stop at days rather than weeks.
 *
 * `now` is injectable because a function that reads the clock cannot be tested
 * without freezing time, and this one is called on every journal row.
 */
export function timeAgo(timestamp: number, now: number = Date.now()): string {
  const minutes = Math.floor((now - timestamp) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  return `${Math.floor(hours / 24)}d ago`;
}

/** Trailing segment of a path: `src/a/b.ts` → `b.ts` (L448). */
export function fileName(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] ?? path;
}

/**
 * Leading segments with a trailing slash: `src/a/b.ts` → `src/a/`, and an
 * empty string when the path has no directory part (L449).
 */
export function fileDir(path: string): string {
  const parts = path.split('/');
  return parts.length > 1 ? `${parts.slice(0, -1).join('/')}/` : '';
}
