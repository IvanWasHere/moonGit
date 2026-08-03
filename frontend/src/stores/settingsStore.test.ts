/**
 * Theme resolution and how settings survive a round trip.
 *
 * The interesting cases are all about `system`: it is a *choice*, not a value,
 * and every place that forgets the difference produces a bug — a DOM attribute
 * that no stylesheet matches, or an OS switch overriding a deliberate pick.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, resolveTheme, useSettingsStore } from './settingsStore';

const stored = new Map<string, unknown>();

vi.mock('@/services/db/keyValue', () => ({
  getPreference: (key: string, fallback: unknown) =>
    Promise.resolve(stored.has(key) ? stored.get(key) : fallback),
  setPreference: (key: string, value: unknown) => {
    stored.set(key, value);
    return Promise.resolve();
  },
}));

/** Pretend the desktop is in light mode (or not). */
function mockSystem(light: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: light && query.includes('light'),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

beforeEach(() => {
  stored.clear();
  mockSystem(false);
  useSettingsStore.setState({ theme: 'system', gitPath: '', editor: '', loaded: false });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete document.documentElement.dataset['theme'];
});

describe('resolveTheme', () => {
  it('passes an explicit choice through', () => {
    mockSystem(true);
    expect(resolveTheme('dark')).toBe('dark');
    expect(resolveTheme('light')).toBe('light');
  });

  it('reads the OS for "system"', () => {
    mockSystem(true);
    expect(resolveTheme('system')).toBe('light');
    mockSystem(false);
    expect(resolveTheme('system')).toBe('dark');
  });

  it('falls back to dark where matchMedia does not exist', () => {
    // Headless environments and old webviews. A store that threw on import
    // would take the whole app down.
    vi.stubGlobal('matchMedia', undefined);
    expect(resolveTheme('system')).toBe('dark');
  });
});

describe('applyTheme', () => {
  it('never writes "system" to the DOM', () => {
    // tokens.css only knows `light` and `dark`; a `system` attribute would
    // match no rule and silently render the dark defaults.
    mockSystem(true);
    applyTheme(resolveTheme('system'));
    expect(document.documentElement.dataset['theme']).toBe('light');
  });
});

describe('load and set', () => {
  it('uses defaults when nothing is stored', async () => {
    await useSettingsStore.getState().load();
    expect(useSettingsStore.getState().theme).toBe('system');
    expect(useSettingsStore.getState().loaded).toBe(true);
  });

  it('persists and restores a choice', async () => {
    useSettingsStore.getState().set({ theme: 'light', editor: 'code -w' });
    await useSettingsStore.getState().load();
    expect(useSettingsStore.getState().theme).toBe('light');
    expect(useSettingsStore.getState().editor).toBe('code -w');
  });

  it('fills in keys a older build never wrote', async () => {
    // The row is unvalidated JSON; a settings object from a previous version
    // should lose the keys it lacks, not the ones it has.
    stored.set('settings', { theme: 'dark' });
    await useSettingsStore.getState().load();
    expect(useSettingsStore.getState().theme).toBe('dark');
    expect(useSettingsStore.getState().editor).toBe('');
  });

  it('applies the theme to the DOM as it is set', () => {
    useSettingsStore.getState().set({ theme: 'light' });
    expect(document.documentElement.dataset['theme']).toBe('light');
    useSettingsStore.getState().set({ theme: 'dark' });
    expect(document.documentElement.dataset['theme']).toBe('dark');
  });

  it('leaves the other settings alone on a partial patch', () => {
    useSettingsStore.getState().set({ editor: 'vi' });
    useSettingsStore.getState().set({ theme: 'dark' });
    expect(useSettingsStore.getState().editor).toBe('vi');
  });
});

describe('syncSystemTheme', () => {
  it('follows the OS while the choice is "system"', () => {
    useSettingsStore.getState().set({ theme: 'system' });
    mockSystem(true);
    useSettingsStore.getState().syncSystemTheme();
    expect(useSettingsStore.getState().resolved).toBe('light');
  });

  it('ignores the OS once a theme was chosen explicitly', () => {
    // The desktop going into night mode should not undo a deliberate pick.
    useSettingsStore.getState().set({ theme: 'dark' });
    mockSystem(true);
    useSettingsStore.getState().syncSystemTheme();
    expect(useSettingsStore.getState().resolved).toBe('dark');
  });
});
