import { describe, expect, it } from 'vitest';
import { fileDir, fileName, timeAgo } from './format';

/** The mockup's ladder (ui-example L422–430), pinned so a rewrite cannot drift. */
describe('timeAgo', () => {
  const NOW = 1_700_000_000_000;
  const ago = (ms: number) => timeAgo(NOW - ms, NOW);

  it('reads under a minute as "just now"', () => {
    expect(ago(0)).toBe('just now');
    expect(ago(59_000)).toBe('just now');
  });

  it('reads minutes', () => {
    expect(ago(60_000)).toBe('1m ago');
    expect(ago(59 * 60_000)).toBe('59m ago');
  });

  it('reads hours', () => {
    expect(ago(60 * 60_000)).toBe('1h ago');
    expect(ago(23 * 60 * 60_000)).toBe('23h ago');
  });

  it('reads days, and does not go further', () => {
    expect(ago(24 * 60 * 60_000)).toBe('1d ago');
    // The mockup stops at days; a year reads as 365d rather than "1y".
    expect(ago(365 * 24 * 60 * 60_000)).toBe('365d ago');
  });

  it('does not produce a negative age for a future timestamp', () => {
    // Clock skew between a commit's recorded time and the local clock is
    // ordinary; "-3m ago" would be visibly wrong.
    expect(ago(-60_000)).toBe('just now');
  });
});

describe('fileName / fileDir', () => {
  it('splits a nested path', () => {
    expect(fileName('src/components/Header.tsx')).toBe('Header.tsx');
    expect(fileDir('src/components/Header.tsx')).toBe('src/components/');
  });

  it('gives an empty directory for a root-level file', () => {
    expect(fileName('package.json')).toBe('package.json');
    expect(fileDir('package.json')).toBe('');
  });

  it('keeps spaces and unicode in a filename', () => {
    expect(fileName('src/a b/ünïcode name.txt')).toBe('ünïcode name.txt');
    expect(fileDir('src/a b/ünïcode name.txt')).toBe('src/a b/');
  });

  it('handles a trailing slash without inventing a name', () => {
    expect(fileName('src/dir/')).toBe('');
    expect(fileDir('src/dir/')).toBe('src/dir/');
  });
});
