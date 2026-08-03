import { describe, expect, it } from 'vitest';
import { filterBy, matchesFilter } from './matchText';

describe('matchesFilter', () => {
  it('matches case-insensitively', () => {
    expect(matchesFilter('src/GitRunner.ts', 'gitrunner')).toBe(true);
  });

  it('requires every term, in any order and anywhere', () => {
    expect(matchesFilter('services/git/parsers/log.ts', 'git log')).toBe(true);
    expect(matchesFilter('services/git/parsers/log.ts', 'log git')).toBe(true);
    expect(matchesFilter('services/git/GitRunner.ts', 'git log')).toBe(false);
  });

  it('treats a blank filter as matching everything', () => {
    expect(matchesFilter('anything', '')).toBe(true);
    expect(matchesFilter('anything', '   ')).toBe(true);
  });
});

describe('filterBy', () => {
  const rows = [
    { name: 'feature/search', remote: 'origin' },
    { name: 'main', remote: 'origin' },
    { name: 'feature/terminal', remote: 'upstream' },
  ];

  it('returns everything when closed or blank', () => {
    expect(filterBy(rows, null, (row) => [row.name])).toHaveLength(3);
    expect(filterBy(rows, '', (row) => [row.name])).toHaveLength(3);
  });

  it('matches across fields, so a query can span them', () => {
    const found = filterBy(rows, 'feature upstream', (row) => [row.name, row.remote]);
    expect(found.map((row) => row.name)).toEqual(['feature/terminal']);
  });

  it('skips fields that are absent rather than matching "undefined"', () => {
    const sparse = [{ name: 'a', subject: undefined }];
    expect(filterBy(sparse, 'undefined', (row) => [row.name, row.subject])).toEqual([]);
  });
});
