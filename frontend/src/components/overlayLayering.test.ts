import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every overlay must paint above the chrome it covers (PLAN.md §11, 8.10).
 *
 * This rule existed only as a comment repeated in five stylesheets — "the
 * z-index has to clear the top menu at 200" — and a comment is not a check.
 * Five new overlays were written at `z-index: 60`, which is below the icon
 * toolbar at 100 and the menu bar at 200, so both drew straight over the
 * modal's own header.
 *
 * **It was the geometry being right that made it hard to see.**
 * `getBoundingClientRect` put the header exactly where it belonged, because
 * layout *was* correct — only the paint order was wrong. Measuring the DOM
 * confirmed the bug was not there; the bug was on top of it. Ivan spotted it
 * in a second by looking at the screen.
 *
 * A source-text assertion rather than a rendered one: jsdom has no compositor,
 * so it cannot answer "what covers what" at all, and the value in the
 * stylesheet is the whole of the rule.
 */

const OVERLAYS = [
  'features/blame/BlameView.module.css',
  'features/branches/ResetDialog.module.css',
  'features/branches/CompareDialog.module.css',
  'features/about/LicenseDialog.module.css',
  'features/repositories/CloneDialog.module.css',
  'features/settings/SettingsModal.module.css',
  'features/stash/StashModal.module.css',
  'features/tags/TagPrompt.module.css',
  'features/merge/MergeWizard.module.css',
  'features/merge/MergeModal.module.css',
  'features/rebase/RebaseWizard.module.css',
  'features/repo-settings/RepoSettingsModal.module.css',
  'features/explorer/QuickOpen.module.css',
];

/** What an overlay has to cover. Both are in `components/`. */
const TOP_MENU = 200;

function firstZIndex(relativePath: string): number | null {
  const css = readFileSync(join(import.meta.dirname, '..', relativePath), 'utf8');
  // The backdrop is the first rule in each of these files, so the first
  // z-index is the one that decides whether the overlay covers the chrome.
  const match = /z-index:\s*(\d+)\s*;/.exec(css);
  return match?.[1] === undefined ? null : Number(match[1]);
}

describe('overlay layering', () => {
  it.each(OVERLAYS)('%s paints above the menu bar', (path) => {
    const z = firstZIndex(path);
    expect(z).not.toBeNull();
    expect(z ?? 0).toBeGreaterThan(TOP_MENU);
  });

  it('keeps the toasts above every overlay', () => {
    // Toasts report the outcome of what a modal just did, so a modal that
    // covered them would hide its own result.
    const toasts = firstZIndex('components/ToastContainer.module.css') ?? 0;
    for (const path of OVERLAYS) {
      expect(toasts).toBeGreaterThan(firstZIndex(path) ?? 0);
    }
  });
});
