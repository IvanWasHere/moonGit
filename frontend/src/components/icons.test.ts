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

  it('covers every icon used by the mockup menubar', () => {
    // ui-example/index.html L458–500
    const required = [
      'Pull',
      'Sync',
      'Push',
      'GitFlow',
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
      'Investigate',
      'MainView',
      'ReviewView',
    ] as const;

    for (const name of required) {
      expect(Icons, `menubar icon "${name}" is missing`).toHaveProperty(name);
    }
  });
});
