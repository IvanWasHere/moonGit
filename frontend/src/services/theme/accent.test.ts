import { describe, expect, it } from 'vitest';
import { accentContrast, accentTokens, contrast, parseHex } from './accent';

/**
 * The accent arithmetic (PLAN.md §11, 8.5).
 *
 * All of it is pure, and all of it is the part most likely to be quietly wrong
 * — a hover variant that moves the wrong way is invisible until someone hovers
 * a control in the theme nobody tested.
 */

describe('parseHex', () => {
  it.each(['#e8a838', 'e8a838', '#E8A838'])('accepts %s', (value) => {
    expect(parseHex(value)).toEqual({ r: 232, g: 168, b: 56 });
  });

  it('expands the three-digit form', () => {
    expect(parseHex('#f0a')).toEqual({ r: 255, g: 0, b: 170 });
  });

  it.each(['', '#12', '#12345', 'rebeccapurple', '#ggg'])('rejects %o', (value) => {
    expect(parseHex(value)).toBeNull();
  });
});

describe('accentTokens', () => {
  it('derives the whole family, not just the accent', () => {
    // Picking only `--accent` would leave an orange wash behind a blue badge.
    const tokens = accentTokens('#58a6ff', 'dark');
    expect(tokens?.accent).toBe('#58a6ff');
    expect(tokens?.accentDim).toBe('rgba(88, 166, 255, 0.12)');
    expect(tokens?.accentGlow).toBe('rgba(88, 166, 255, 0.25)');
  });

  it('moves hover away from the background in each theme', () => {
    /*
     * The shipped tokens go lighter on hover in dark and darker in light. A
     * single direction would make one theme's hover approach its own
     * background and vanish — and only in the theme nobody happened to test.
     */
    const dark = accentTokens('#808080', 'dark');
    const light = accentTokens('#808080', 'light');

    const lum = (hex: string) => parseInt(hex.slice(1, 3), 16);
    expect(lum(dark?.accentHover ?? '#000')).toBeGreaterThan(0x80);
    expect(lum(light?.accentHover ?? '#fff')).toBeLessThan(0x80);
  });

  it('returns null rather than a broken family for an unparseable colour', () => {
    expect(accentTokens('not a colour', 'dark')).toBeNull();
  });
});

describe('contrast', () => {
  it('is 21 for black on white', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 1);
  });

  it('is 1 for a colour against itself', () => {
    expect(contrast('#e8a838', '#e8a838')).toBeCloseTo(1, 5);
  });

  it('does not care which way round the pair is given', () => {
    expect(contrast('#151b23', '#e8a838')).toBeCloseTo(contrast('#e8a838', '#151b23') ?? 0, 5);
  });
});

describe('accentContrast', () => {
  it('measures against the panel the accent is usually read on', () => {
    // The shipped dark accent, against `--bg-panel`. Comfortably readable.
    expect(accentContrast('#e8a838', 'dark') ?? 0).toBeGreaterThan(4.5);
  });

  it('reports a dim accent as failing rather than hiding it', () => {
    // A dark blue on the dark panel is the trap the readout exists to catch.
    expect(accentContrast('#2b3a55', 'dark') ?? 99).toBeLessThan(4.5);
  });
});
