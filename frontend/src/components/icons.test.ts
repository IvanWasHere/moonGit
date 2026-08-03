import { describe, expect, it } from 'vitest';
import { Icons } from './icons';

/**
 * lucide renames icons between major versions — v1 dropped `History` and
 * renamed `Filter` to `Funnel`, both of which the mockup uses. A bad name
 * imports as `undefined` rather than failing at build time, so it would only
 * surface as a blank icon at runtime. This catches it in CI instead.
 */
describe('icon registry', () => {
  it('resolves every icon to a component', () => {
    const unresolved = Object.entries(Icons)
      .filter(([, icon]) => typeof icon !== 'function' && typeof icon !== 'object')
      .map(([name]) => name);

    expect(unresolved).toEqual([]);
  });

  it('covers every icon the menubar renders', () => {
    /*
     * Originally the mockup's menubar in full (ui-example L458–500). Two of its
     * buttons are gone: **Git-flow** and **Investigate** were never defined by
     * the PRD and only ever fired a toast, so they were removed rather than
     * left as controls that do nothing (PLAN.md §14). Their icons went with
     * them — an icon with no caller is a mapping to nothing.
     */
    const required = [
      'Pull',
      'Sync',
      'Push',
      'Merge',
      'Commit',
      'Stage',
      'IndexEditor',
      'Unstage',
      'Remove',
      'Abort',
      'Discard',
      'Delete',
      'Log',
      'Blame',
      'MainView',
      'ReviewView',
    ] as const;

    for (const name of required) {
      expect(Icons, `menubar icon "${name}" is missing`).toHaveProperty(name);
    }
  });
});
