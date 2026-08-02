import { describe, expect, it } from 'vitest';
import { mergeSpans, type SyntaxToken } from './highlight';
import { imageTypeForPath, languageForPath } from './languages';

function token(text: string, color: string): SyntaxToken {
  return { text, color };
}

function segment(text: string, changed: boolean) {
  return { text, changed };
}

/** Spans must reconstruct the line, or the renderer drops characters. */
function joined(spans: readonly { text: string }[]): string {
  return spans.map((span) => span.text).join('');
}

describe('mergeSpans', () => {
  it('returns the bare line when there is nothing to apply', () => {
    expect(mergeSpans('const a = 1;', undefined, undefined)).toEqual([
      { text: 'const a = 1;', color: '', changed: false },
    ]);
  });

  it('passes syntax colour through when there is no word diff', () => {
    const spans = mergeSpans('a b', [token('a', '#f00'), token(' b', '#0f0')], undefined);
    expect(spans).toEqual([
      { text: 'a', color: '#f00', changed: false },
      { text: ' b', color: '#0f0', changed: false },
    ]);
  });

  it('cuts at the union of both sets of boundaries', () => {
    // Grammar: "retries" | ": " | "3"   Word diff: "retries: " | "3"
    const spans = mergeSpans(
      'retries: 3',
      [token('retries', '#79c0ff'), token(': ', '#e6edf3'), token('3', '#a5d6ff')],
      [segment('retries: ', false), segment('3', true)],
    );

    expect(joined(spans)).toBe('retries: 3');
    expect(spans).toEqual([
      { text: 'retries', color: '#79c0ff', changed: false },
      { text: ': ', color: '#e6edf3', changed: false },
      { text: '3', color: '#a5d6ff', changed: true },
    ]);
  });

  it('splits a single token across a word-diff boundary', () => {
    const spans = mergeSpans(
      'abcd',
      [token('abcd', '#fff')],
      [segment('ab', false), segment('cd', true)],
    );
    expect(spans).toEqual([
      { text: 'ab', color: '#fff', changed: false },
      { text: 'cd', color: '#fff', changed: true },
    ]);
  });

  it('coalesces neighbours that agree on colour and state', () => {
    const spans = mergeSpans(
      'abc',
      [token('a', '#fff'), token('b', '#fff'), token('c', '#fff')],
      [segment('abc', false)],
    );
    expect(spans).toHaveLength(1);
  });

  /**
   * The blob and the patch can disagree when the file is written between the
   * two git calls. Colouring that shifts partway through a line looks like
   * corruption; no colouring just looks plain.
   */
  it('drops highlighting when the tokens do not cover the line', () => {
    const spans = mergeSpans('a much longer line', [token('a', '#fff')], undefined);
    expect(spans).toEqual([{ text: 'a much longer line', color: '', changed: false }]);
  });

  it('keeps the word diff even when the tokens are unusable', () => {
    const spans = mergeSpans(
      'abcd',
      [token('xy', '#fff')],
      [segment('ab', false), segment('cd', true)],
    );
    expect(joined(spans)).toBe('abcd');
    expect(spans.map((span) => span.changed)).toEqual([false, true]);
    expect(spans.every((span) => span.color === '')).toBe(true);
  });

  it('handles an empty line', () => {
    expect(mergeSpans('', [], undefined)).toEqual([]);
  });
});

describe('languageForPath', () => {
  it('maps by extension, ignoring the directory', () => {
    expect(languageForPath('src/components/Header.tsx')).toBe('tsx');
    expect(languageForPath('internal/store/service.go')).toBe('go');
  });

  it('uses the tsx grammar for jsx, which the typescript one cannot read', () => {
    expect(languageForPath('a/b/Widget.jsx')).toBe('tsx');
  });

  it('reads the last extension, so .eslintrc.json is JSON', () => {
    expect(languageForPath('.eslintrc.json')).toBe('json');
  });

  it('gives no language to a dotfile with no extension', () => {
    expect(languageForPath('.gitignore')).toBeNull();
    expect(languageForPath('src/.env')).toBeNull();
  });

  it('recognises names that carry no extension at all', () => {
    expect(languageForPath('Makefile')).toBe('shellscript');
  });

  it('returns null rather than guessing', () => {
    expect(languageForPath('data/blob.bin')).toBeNull();
    expect(languageForPath('LICENSE')).toBeNull();
  });
});

describe('imageTypeForPath', () => {
  it('names the type a data URI needs', () => {
    expect(imageTypeForPath('assets/logo.PNG')).toBe('image/png');
    expect(imageTypeForPath('a/photo.jpeg')).toBe('image/jpeg');
  });

  // An SVG is both — text git can diff, and a picture worth previewing.
  it('treats svg as an image as well as markup', () => {
    expect(imageTypeForPath('icon.svg')).toBe('image/svg+xml');
    expect(languageForPath('icon.svg')).toBe('xml');
  });

  it('refuses binaries a webview cannot render', () => {
    expect(imageTypeForPath('design/mock.psd')).toBeNull();
    expect(imageTypeForPath('build/app.wasm')).toBeNull();
  });
});
