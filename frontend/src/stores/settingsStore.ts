import { create } from 'zustand';
import { getPreference, setPreference } from '@/services/db/keyValue';
import { accentTokens } from '@/services/theme/accent';

/**
 * Application settings — the PRD's `Settings` and `Theme` stores, which Phase 3
 * deliberately left out until something consumed them (PLAN.md §6).
 *
 * These are **application** settings, not repository ones: they belong to the
 * install, persist to the `preferences` table, and survive switching between
 * repositories. Anything scoped to one repository is `git config`, which is the
 * repository's own file and not ours to mirror.
 *
 * Every setter writes through to SQLite immediately rather than on a Save
 * button. A settings panel with an unsaved state has to solve what happens when
 * it is closed with the escape key, and the answer people expect from a native
 * preferences window is "it was already applied".
 */

export type ThemeChoice = 'dark' | 'light' | 'system';
/** What `system` resolved to — never `system` itself. */
export type ResolvedTheme = 'dark' | 'light';

export interface Settings {
  readonly theme: ThemeChoice;
  /**
   * Path to the git binary, or '' for "whatever is on PATH".
   *
   * Held here as well as in the Go service because the Go side forgets it on
   * restart — `gitexec` starts at "git" every launch, and this is what points
   * it back at the user's choice.
   */
  readonly gitPath: string;
  /**
   * Command used to open a file for editing, or '' for the OS default.
   *
   * A command rather than an application path: `code -w`, `subl`, and
   * `/usr/bin/vi` are all things people mean by "my editor", and only the
   * middle one is something a file picker could have produced.
   */
  readonly editor: string;
  /**
   * A custom accent as `#rrggbb`, or '' for the theme's own.
   *
   * Empty rather than the shipped colour so that "default" keeps following the
   * theme: dark and light have *different* accents, chosen for contrast against
   * their own backgrounds, and storing one of them would pin the other theme to
   * a colour picked for the opposite background.
   */
  readonly accent: string;
}

const DEFAULTS: Settings = {
  // System, not dark. The mockup is dark and that is the app's identity, but a
  // launcher that ignores the OS setting is the first thing anyone notices on
  // a light desktop.
  theme: 'system',
  gitPath: '',
  editor: '',
  accent: '',
};

const PREFERENCE_KEY = 'settings';

interface SettingsState extends Settings {
  /** False until SQLite has answered; the UI shows defaults meanwhile. */
  readonly loaded: boolean;
  /** `theme`, with `system` already resolved against the OS. */
  readonly resolved: ResolvedTheme;
  load: () => Promise<void>;
  set: (patch: Partial<Settings>) => void;
  /** Called by the OS media query listener; not part of the public surface. */
  syncSystemTheme: () => void;
}

function systemTheme(): ResolvedTheme {
  // `matchMedia` is missing in the test environment, and a store that throws
  // on import would take the whole app with it.
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  return choice === 'system' ? systemTheme() : choice;
}

/**
 * Write the theme onto <html>, which is what `tokens.css` keys off.
 *
 * The attribute is always one of the two concrete themes. Leaving `system` in
 * the DOM would mean every stylesheet had to know about `prefers-color-scheme`
 * as well, and the two rules would drift.
 */
export function applyTheme(resolved: ResolvedTheme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset['theme'] = resolved;
}

/**
 * Write a custom accent onto <html>, or clear it back to the theme's own.
 *
 * Inline custom properties on the root element, which beat `tokens.css`'s
 * `:root` rules by specificity — so "no custom accent" is *removing* them
 * rather than writing the shipped values back. That distinction is what lets
 * the default keep following the theme: dark and light ship different accents,
 * each picked against its own background, and writing one of them down would
 * pin the other theme to a colour chosen for the opposite surface.
 *
 * Lives beside `applyTheme` and is called from the same three places, because
 * the hover variant is derived per theme — following the OS into light has to
 * recompute it, not merely leave it.
 */
export function applyAccent(accent: string, resolved: ResolvedTheme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const tokens = accent === '' ? null : accentTokens(accent, resolved);

  if (tokens === null) {
    for (const name of ['--accent', '--accent-dim', '--accent-glow', '--accent-hover']) {
      root.style.removeProperty(name);
    }
    return;
  }

  root.style.setProperty('--accent', tokens.accent);
  root.style.setProperty('--accent-dim', tokens.accentDim);
  root.style.setProperty('--accent-glow', tokens.accentGlow);
  root.style.setProperty('--accent-hover', tokens.accentHover);
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...DEFAULTS,
  loaded: false,
  resolved: resolveTheme(DEFAULTS.theme),

  load: async () => {
    const stored = await getPreference<Partial<Settings>>(PREFERENCE_KEY, {});
    // Spread over the defaults rather than trusting the row: the column holds
    // unvalidated JSON, and a settings file written by an older build should
    // lose the keys it does not have, not the ones it does.
    const settings: Settings = { ...DEFAULTS, ...stored };
    const resolved = resolveTheme(settings.theme);
    applyTheme(resolved);
    applyAccent(settings.accent, resolved);
    set({ ...settings, resolved, loaded: true });
  },

  set: (patch) => {
    const next: Settings = {
      theme: patch.theme ?? get().theme,
      gitPath: patch.gitPath ?? get().gitPath,
      editor: patch.editor ?? get().editor,
      accent: patch.accent ?? get().accent,
    };
    const resolved = resolveTheme(next.theme);
    applyTheme(resolved);
    applyAccent(next.accent, resolved);
    set({ ...next, resolved });
    void setPreference(PREFERENCE_KEY, next);
  },

  syncSystemTheme: () => {
    // Only meaningful while following the OS; an explicit choice is not
    // something the desktop switching to night mode should override.
    if (get().theme !== 'system') return;
    const resolved = systemTheme();
    applyTheme(resolved);
    // Re-derived, not merely re-applied: the hover variant depends on which
    // theme is showing, so following the OS into light has to recompute it.
    applyAccent(get().accent, resolved);
    set({ resolved });
  },
}));

/**
 * Start following the OS theme. Returns an unsubscribe.
 *
 * Lives here rather than in a component so that the listener is attached once
 * for the process, not once per mount of whatever happens to render.
 */
export function watchSystemTheme(): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const media = window.matchMedia('(prefers-color-scheme: light)');
  const onChange = () => useSettingsStore.getState().syncSystemTheme();
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}
