import type { ResolvedTheme } from '@/stores/settingsStore';

/**
 * A custom accent, and the four tokens it has to become (PLAN.md §11, 8.5).
 *
 * `tokens.css` does not hold one accent, it holds a small family: the colour
 * itself, a 12% wash behind badges (`--accent-dim`), a 25% glow, and a hover
 * variant. Letting the user pick `--accent` and leaving the other three at the
 * theme's defaults would put an orange wash behind a blue badge, so all four
 * are derived from the choice.
 *
 * **The hover variant moves in opposite directions per theme, and that is not
 * arbitrary.** The shipped tokens go lighter on hover in dark (#e8a838 →
 * #f0b44a) and darker in light (#9a6700 → #7a5200), because hover should move
 * *away* from the background in both. Deriving it one way would make one of the
 * two themes' hover state approach its own background and disappear.
 *
 * Kept as pure functions with no DOM access so the arithmetic is testable
 * without a document, which is the half most likely to be wrong.
 */

export interface AccentTokens {
  readonly accent: string;
  readonly accentDim: string;
  readonly accentGlow: string;
  readonly accentHover: string;
}

interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** `#rgb` and `#rrggbb`, case-insensitive. Null for anything else. */
export function parseHex(value: string): Rgb | null {
  const hex = value.trim().replace(/^#/, '');
  if (!/^[0-9a-f]{3}$|^[0-9a-f]{6}$/i.test(hex)) return null;
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function toHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

/** Toward white (`amount > 0`) or black (`amount < 0`), as a fraction. */
function shift({ r, g, b }: Rgb, amount: number): Rgb {
  const target = amount > 0 ? 255 : 0;
  const t = Math.abs(amount);
  return {
    r: r + (target - r) * t,
    g: g + (target - g) * t,
    b: b + (target - b) * t,
  };
}

/** How much hover moves. Matches the shipped tokens' own step closely enough. */
const HOVER_SHIFT = 0.14;

export function accentTokens(hex: string, theme: ResolvedTheme): AccentTokens | null {
  const rgb = parseHex(hex);
  if (rgb === null) return null;
  const { r, g, b } = rgb;
  return {
    accent: toHex(rgb),
    accentDim: `rgba(${r}, ${g}, ${b}, 0.12)`,
    accentGlow: `rgba(${r}, ${g}, ${b}, 0.25)`,
    accentHover: toHex(shift(rgb, theme === 'dark' ? HOVER_SHIFT : -HOVER_SHIFT)),
  };
}

// --- readability -------------------------------------------------------------

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function luminance({ r, g, b }: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two colours, 1–21. */
export function contrast(a: string, b: string): number | null {
  const first = parseHex(a);
  const second = parseHex(b);
  if (first === null || second === null) return null;
  const [hi, lo] = [luminance(first), luminance(second)].sort((x, y) => y - x);
  if (hi === undefined || lo === undefined) return null;
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The surface an accent is most often read against, per theme.
 *
 * `--bg-panel`, because accent-coloured text is overwhelmingly panel furniture
 * — headers, the active tab, branch labels. Hard-coded from `tokens.css`
 * rather than read from the DOM so the check is a pure function; if those
 * values change this must change with them, which is why they are named.
 */
const PANEL: Record<ResolvedTheme, string> = { dark: '#151b23', light: '#f6f8fa' };

/** Small-text AA. The accent is never large display type in this app. */
export const AA_NORMAL = 4.5;

/**
 * Whether an accent will be readable as text on the panel background.
 *
 * Surfaced in the picker rather than enforced. 8.1 established that the app's
 * own shipped accent fails this on some surfaces, so refusing a colour the
 * product itself would not pass would be incoherent — but letting someone pick
 * an unreadable accent with no indication at all is the trap this avoids.
 */
export function accentContrast(hex: string, theme: ResolvedTheme): number | null {
  return contrast(hex, PANEL[theme]);
}
