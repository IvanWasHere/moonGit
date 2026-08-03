/**
 * Syntax highlighting for the diff viewer, via Shiki's tokenizer.
 *
 * Three decisions shape this file:
 *
 * 1. **Whole files are tokenized, never hunks.** A hunk is a fragment, and a
 *    tokenizer handed a fragment cannot know it began inside a block comment or
 *    a template literal — it would colour the tail of a comment as code. The
 *    caller reads the old and new blobs in full (`BlobService`) and this
 *    returns one token run per line, which the renderer indexes by line number.
 * 2. **Shiki's core, not its bundle**, with the JavaScript regex engine rather
 *    than Oniguruma. That drops the ~1 MB WASM payload entirely, and grammars
 *    arrive one dynamic import at a time (`languages.ts`).
 * 3. **`github-dark-default`** because its background is `#0d1117` — the same
 *    value as the mockup's `--bg-darkest` (styles/tokens.css). The palette the
 *    UI was designed around and the palette the code is coloured with are the
 *    same one, rather than two dark themes that nearly agree.
 *
 * The light theme (Phase 6.8) extends that third point rather than changing
 * it: `github-light-default` is the counterpart of the theme already chosen,
 * and its background is white — which is exactly what `--bg-darkest` becomes.
 * Both are registered at load and selected per call, because the alternative
 * is tearing down the highlighter every time the user flips the theme.
 */

import type { HighlighterCore } from 'shiki/core';
import { grammarLoader } from './languages';

/** Shiki's name for each of our two themes. */
export const THEMES = {
  dark: 'github-dark-default',
  light: 'github-light-default',
} as const;

export type HighlightTheme = keyof typeof THEMES;

/** One coloured run within a line. */
export interface SyntaxToken {
  readonly text: string;
  readonly color: string;
}

/** Token runs per line, indexed from 0 — line `n` of the file is `[n - 1]`. */
export type SyntaxLines = readonly (readonly SyntaxToken[])[];

/**
 * Shiki is loaded on first use and never again.
 *
 * The promise, not the highlighter, is the cached value: two files selected in
 * the same tick would otherwise both see "not loaded yet" and each construct
 * one.
 */
let corePromise: Promise<HighlighterCore> | null = null;
const loadedLanguages = new Set<string>();

async function core(): Promise<HighlighterCore> {
  corePromise ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
      import('shiki/core'),
      import('shiki/engine/javascript'),
    ]);
    return createHighlighterCore({
      themes: [
        import('@shikijs/themes/github-dark-default'),
        import('@shikijs/themes/github-light-default'),
      ],
      langs: [],
      engine: createJavaScriptRegexEngine(),
    });
  })();
  return corePromise;
}

/**
 * Tokenize a whole file.
 *
 * Returns null for a language with no grammar, which is not an error — the
 * viewer renders the diff unhighlighted and nothing is lost but colour.
 */
export async function highlightFile(
  text: string,
  language: string,
  theme: HighlightTheme = 'dark',
): Promise<SyntaxLines | null> {
  const loader = grammarLoader(language);
  if (loader === undefined) return null;

  const highlighter = await core();
  if (!loadedLanguages.has(language)) {
    await highlighter.loadLanguage(loader as never);
    loadedLanguages.add(language);
  }

  const { tokens } = highlighter.codeToTokens(text, { lang: language, theme: THEMES[theme] });
  return tokens.map((line) =>
    line.map((token) => ({ text: token.content, color: token.color ?? '' })),
  );
}

/** Test-only: forget the highlighter so a test can start from nothing. */
export function resetHighlighter(): void {
  corePromise = null;
  loadedLanguages.clear();
}

// --- composing syntax colour with the word diff ------------------------------

export interface RenderSpan {
  readonly text: string;
  /** Empty when the line is not highlighted; the CSS colour otherwise. */
  readonly color: string;
  /** Part of the intra-line change — gets the stronger background. */
  readonly changed: boolean;
}

/**
 * Merge two independent partitions of the same line into one run of spans.
 *
 * Syntax tokens and word-diff segments both slice the line, and they slice it
 * at different points: `retries: 3` is three tokens to a grammar and two
 * segments to the word diff. Rendering one inside the other would mean nesting
 * spans that cross each other, which is not expressible — so both are cut at
 * the union of their boundaries and each piece carries a colour and a flag.
 *
 * The guard matters as much as the merge: if the two partitions do not describe
 * strings of the same length, the highlighting is silently dropped for that
 * line. That happens when the blob and the patch have drifted — a file edited
 * between the two git calls — and a wrong colouring that shifts partway through
 * a line looks like corruption, where no colouring just looks plain.
 */
export function mergeSpans(
  content: string,
  tokens: readonly SyntaxToken[] | undefined,
  segments: readonly { readonly text: string; readonly changed: boolean }[] | undefined,
): RenderSpan[] {
  const usable =
    tokens !== undefined &&
    tokens.reduce((total, token) => total + token.text.length, 0) === content.length;

  if (!usable) {
    if (segments === undefined) return [{ text: content, color: '', changed: false }];
    return segments.map((segment) => ({ text: segment.text, color: '', changed: segment.changed }));
  }
  if (segments === undefined) {
    return tokens.map((token) => ({ text: token.text, color: token.color, changed: false }));
  }

  const spans: RenderSpan[] = [];
  let tokenIndex = 0;
  let segmentIndex = 0;
  let tokenUsed = 0;
  let segmentUsed = 0;

  while (tokenIndex < tokens.length && segmentIndex < segments.length) {
    const token = tokens[tokenIndex];
    const segment = segments[segmentIndex];
    if (token === undefined || segment === undefined) break;

    const take = Math.min(token.text.length - tokenUsed, segment.text.length - segmentUsed);
    if (take > 0) {
      const text = token.text.slice(tokenUsed, tokenUsed + take);
      const last = spans[spans.length - 1];
      // Adjacent pieces that agree on both attributes are one span; a grammar
      // emits many same-coloured runs in a row and each would be a DOM node.
      if (last !== undefined && last.color === token.color && last.changed === segment.changed) {
        spans[spans.length - 1] = { ...last, text: last.text + text };
      } else {
        spans.push({ text, color: token.color, changed: segment.changed });
      }
    }

    tokenUsed += take;
    segmentUsed += take;
    if (tokenUsed >= token.text.length) {
      tokenIndex += 1;
      tokenUsed = 0;
    }
    if (segmentUsed >= segment.text.length) {
      segmentIndex += 1;
      segmentUsed = 0;
    }
  }

  return spans;
}
