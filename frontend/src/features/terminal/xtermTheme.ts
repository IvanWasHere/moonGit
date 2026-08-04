import type { ITheme } from '@xterm/xterm';

/**
 * Reads the terminal's colours out of the design tokens.
 *
 * xterm.js paints to a canvas, so it cannot use CSS variables: it needs 20
 * resolved colour strings up front, and new ones every time the theme changes.
 * This is the seam. Tokens stay the single source of truth (§7 — component
 * code never holds a literal hex), and the canvas gets the values they
 * currently resolve to.
 *
 * Kept as a pure function over a reader so it is testable without a DOM and
 * without xterm: the mapping from token name to ANSI slot is the part worth
 * asserting, and mounting a terminal to check it would test the canvas instead.
 */

/**
 * Every token the terminal needs, in the order xterm wants them.
 *
 * `Partial`, because ITheme has slots this deliberately does not fill —
 * xterm's own defaults for things like the scrollbar slider are derived from
 * the foreground it is given, and a token per derived colour would be a
 * palette to keep in sync for no visible gain. The constraint is still doing
 * its job: a key that is not an ITheme slot at all fails to compile.
 */
const TOKENS = {
  background: '--term-bg',
  foreground: '--term-fg',
  cursor: '--term-cursor',
  cursorAccent: '--term-bg',
  selectionBackground: '--term-selection',

  black: '--term-black',
  red: '--term-red',
  green: '--term-green',
  yellow: '--term-yellow',
  blue: '--term-blue',
  magenta: '--term-magenta',
  cyan: '--term-cyan',
  white: '--term-white',
  brightBlack: '--term-bright-black',
  brightRed: '--term-bright-red',
  brightGreen: '--term-bright-green',
  brightYellow: '--term-bright-yellow',
  brightBlue: '--term-bright-blue',
  brightMagenta: '--term-bright-magenta',
  brightCyan: '--term-bright-cyan',
  brightWhite: '--term-bright-white',
} as const satisfies Partial<Record<keyof ITheme, string>>;

export type TokenReader = (name: string) => string;

/**
 * Build an xterm theme from a token reader.
 *
 * A token that reads back empty is dropped rather than passed through: xterm
 * takes `''` as a colour and throws parsing it, which would take the whole
 * drawer down over one missing variable. Its own defaults are a much better
 * outcome than a crash.
 */
export function terminalTheme(read: TokenReader): ITheme {
  const theme: Record<string, string> = {};
  for (const [key, token] of Object.entries(TOKENS)) {
    const value = read(token).trim();
    if (value !== '') theme[key] = value;
  }
  return theme;
}

/** The reader for a live document — resolves against whatever `data-theme` is. */
export function cssTokenReader(element: Element): TokenReader {
  const computed = getComputedStyle(element);
  return (name) => computed.getPropertyValue(name);
}

/**
 * The font stack, read from `--font-mono` so the terminal matches the diff
 * viewer. Falls back to a generic monospace: xterm measures a character cell
 * at startup, and an empty family would measure the UI font.
 */
export function terminalFont(read: TokenReader): string {
  const family = read('--font-mono').trim();
  return family === '' ? 'ui-monospace, monospace' : family;
}
