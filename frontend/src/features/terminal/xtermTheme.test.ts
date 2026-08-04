import { describe, expect, it } from 'vitest';
import { terminalFont, terminalTheme } from './xtermTheme';

const reader =
  (values: Record<string, string>) =>
  (name: string): string =>
    values[name] ?? '';

describe('terminalTheme', () => {
  it('maps tokens onto the ANSI slots xterm expects', () => {
    const theme = terminalTheme(
      reader({
        '--term-bg': '#0d1117',
        '--term-fg': '#e2e8f0',
        '--term-cursor': '#e8a838',
        '--term-red': '#ff7b72',
        '--term-bright-red': '#ffa198',
      }),
    );

    expect(theme.background).toBe('#0d1117');
    expect(theme.foreground).toBe('#e2e8f0');
    expect(theme.cursor).toBe('#e8a838');
    // The cursor's own text takes the background, so the character under it
    // stays legible when the block inverts.
    expect(theme.cursorAccent).toBe('#0d1117');
    expect(theme.red).toBe('#ff7b72');
    expect(theme.brightRed).toBe('#ffa198');
  });

  it('trims what getComputedStyle returns', () => {
    // Custom properties come back with the author's whitespace intact, and
    // xterm throws on a colour it cannot parse.
    expect(terminalTheme(reader({ '--term-bg': '  #ffffff ' })).background).toBe('#ffffff');
  });

  /*
   * A missing token has to fall through to xterm's own default. Passing '' as
   * a colour throws inside the renderer, which would take the drawer down over
   * one variable — a far worse outcome than one slot being off-palette.
   */
  it('omits tokens that resolve to nothing rather than passing empty strings', () => {
    const theme = terminalTheme(reader({ '--term-bg': '#000000' }));

    expect(theme.background).toBe('#000000');
    expect('foreground' in theme).toBe(false);
    expect(Object.values(theme)).not.toContain('');
  });

  it('reads a theme with no tokens at all as empty', () => {
    expect(terminalTheme(reader({}))).toEqual({});
  });
});

describe('terminalFont', () => {
  it('uses the mono token so the terminal matches the diff viewer', () => {
    expect(terminalFont(reader({ '--font-mono': "'JetBrains Mono', monospace" }))).toBe(
      "'JetBrains Mono', monospace",
    );
  });

  it('falls back to a generic monospace rather than an empty family', () => {
    // xterm measures a character cell at startup; an empty family would
    // measure the UI font and every column would be misaligned.
    expect(terminalFont(reader({}))).toBe('ui-monospace, monospace');
  });
});
