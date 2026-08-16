import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { askConfirm, askText, useAskStore } from './askStore';

/**
 * The in-app prompt/confirm, and the ban on the native ones (PLAN.md §11, 8.11).
 *
 * `window.prompt` returns null and `window.confirm` returns false in a packaged
 * Wails app — measured, not guessed — because Wails implements none of
 * `WKUIDelegate`'s dialog methods. Both work perfectly in `wails dev`, which is
 * a browser, so this is the worst shape of bug available: four controls that
 * passed every test, worked in development, and did nothing at all in the build
 * anyone would run.
 */

beforeEach(() => {
  useAskStore.setState({ pending: null, resolve: null });
});

describe('askText', () => {
  it('resolves with the typed value', async () => {
    const answer = askText('New branch name');
    useAskStore.getState().settle('feature/x');
    await expect(answer).resolves.toBe('feature/x');
  });

  it('resolves null when cancelled, like the prompt it replaces', async () => {
    const answer = askText('New branch name');
    useAskStore.getState().settle(null);
    await expect(answer).resolves.toBeNull();
  });

  it('carries the initial value for the dialog to prefill', () => {
    void askText('Rename to', 'old-name');
    const pending = useAskStore.getState().pending;
    expect(pending?.kind === 'text' && pending.initial).toBe('old-name');
  });
});

describe('askConfirm', () => {
  it('resolves true only on an explicit yes', async () => {
    const yes = askConfirm('Delete?');
    useAskStore.getState().settle(true);
    await expect(yes).resolves.toBe(true);
  });

  it.each([[false], [null]])('resolves false when dismissed with %o', async (value) => {
    const no = askConfirm('Delete?');
    useAskStore.getState().settle(value);
    await expect(no).resolves.toBe(false);
  });
});

describe('a second request while one is open', () => {
  it('settles the first rather than dropping its resolver', async () => {
    // A dropped resolver is a promise that never settles, and the caller of
    // that one is an `await` that hangs forever with nothing to explain it.
    const first = askText('first');
    void askText('second');
    await expect(first).resolves.toBeNull();
  });
});

/**
 * The rule, enforced rather than remembered.
 *
 * This is the check that would have caught the original bug: nothing in
 * `src/` may call the native dialogs, because in this app they do nothing.
 */
describe('the native dialogs are banned in app code', () => {
  function sourceFiles(dir: string, found: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) sourceFiles(path, found);
      else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) found.push(path);
    }
    return found;
  }

  it('no source file calls window.prompt, window.confirm or alert', () => {
    const root = join(import.meta.dirname, '..');
    const offenders = sourceFiles(root).filter((path) => {
      const text = readFileSync(path, 'utf8')
        // Comments explain *why* these are banned, so they must not trip it.
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      return /\bwindow\.(prompt|confirm|alert)\s*\(/.test(text);
    });

    expect(offenders.map((p) => p.slice(root.length + 1))).toEqual([]);
  });
});
