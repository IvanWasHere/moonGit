import { describe, expect, it } from 'vitest';
import { tokenize, wordDiff, type WordSegment } from './wordDiff';

/** The changed runs only — what the reader's eye is meant to land on. */
function changed(segments: readonly WordSegment[]): string[] {
  return segments.filter((segment) => segment.changed).map((segment) => segment.text);
}

/** Segments must reconstruct the line exactly, or the renderer loses text. */
function joined(segments: readonly WordSegment[]): string {
  return segments.map((segment) => segment.text).join('');
}

describe('tokenize', () => {
  it('keeps identifiers whole, including underscores and $', () => {
    expect(tokenize('foo_bar $el')).toEqual(['foo_bar', ' ', '$el']);
  });

  it('splits punctuation one character at a time', () => {
    expect(tokenize('f(a,b)')).toEqual(['f', '(', 'a', ',', 'b', ')']);
  });

  it('keeps a whitespace run as one token', () => {
    expect(tokenize('a    b')).toEqual(['a', '    ', 'b']);
  });
});

describe('wordDiff', () => {
  it('marks only the identifier that changed', () => {
    const diff = wordDiff('const total = price * 2;', 'const total = price * 3;');
    expect(diff).not.toBeNull();
    expect(changed(diff?.oldSegments ?? [])).toEqual(['2']);
    expect(changed(diff?.newSegments ?? [])).toEqual(['3']);
  });

  it('reconstructs both lines exactly', () => {
    const oldText = '  return foo(a, b);';
    const newText = '  return bar(a, b, c);';
    const diff = wordDiff(oldText, newText);
    expect(joined(diff?.oldSegments ?? [])).toBe(oldText);
    expect(joined(diff?.newSegments ?? [])).toBe(newText);
  });

  it('marks a pure insertion on the new side only', () => {
    const diff = wordDiff('call(a)', 'call(a, b)');
    expect(changed(diff?.oldSegments ?? [])).toEqual([]);
    expect(changed(diff?.newSegments ?? [])).toEqual([', b']);
  });

  it('declines a pair with nothing in common', () => {
    expect(wordDiff('import { readFile } from "fs";', 'export default class Widget {')).toBeNull();
  });

  it('declines when either side is empty', () => {
    expect(wordDiff('', 'something')).toBeNull();
    expect(wordDiff('something', '')).toBeNull();
  });

  it('declines lines too long to diff quadratically', () => {
    const long = 'x'.repeat(1200);
    expect(wordDiff(long, `${long}y`)).toBeNull();
  });

  /**
   * Two tokens differ out of many, and everything else is a shared affix — so
   * the quadratic middle stays tiny however long the line gets. Regression
   * guard for the prefix/suffix trim, not a benchmark.
   */
  it('handles a long line whose change is in the middle', () => {
    const head = 'a, '.repeat(150);
    const diff = wordDiff(`f(${head}old)`, `f(${head}new)`);
    expect(changed(diff?.oldSegments ?? [])).toEqual(['old']);
    expect(changed(diff?.newSegments ?? [])).toEqual(['new']);
  });

  it('marks whitespace changes, since they are what indentation edits are', () => {
    const diff = wordDiff('  value = 1;', '    value = 1;');
    expect(diff).not.toBeNull();
    expect(changed(diff?.newSegments ?? [])).toEqual(['    ']);
  });
});
