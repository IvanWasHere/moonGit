import { describe, expect, it } from 'vitest';
import { isMenuItemId, MENUS, MENU_ITEM_IDS } from './menuConfig';

describe('menuConfig', () => {
  it('has the six top-level menus in order', () => {
    expect(MENUS.map((menu) => menu.label)).toEqual([
      'Repository',
      'Local',
      'Branch',
      'Remote',
      'Query',
      'Help',
    ]);
  });

  /*
   * These lists are the mockup's menus, item for item, and the point of the
   * assertion is that they do not quietly drift from it.
   *
   * **`Preferences…` is the one deliberate addition** (Phase 6.8). Application
   * settings need a home and the mockup's bar has no app menu — it starts at
   * Repository — so they sit at the end of the first menu, next to the
   * repository's own settings and where ⌘, already points. Distinct from
   * "Repository Settings" above it, which is git config and still unbuilt.
   *
   * **`Terminal` is the second** (Phase 6.9). The mockup has no shell at all,
   * so there is no item it could drift from; it is in the Repository menu
   * because the repository is the shell's working directory.
   */
  it.each([
    [
      'Repository',
      [
        'Clone…',
        'Open…',
        'Close',
        'Pull',
        'Push',
        'Fetch',
        'Synchronize',
        'Terminal',
        'Repository Settings',
        'Preferences…',
        'Exit',
      ],
    ],
    ['Local', ['Commit', 'Stage', 'Unstage', 'Stash', 'Shelve', 'Ignore']],
    [
      'Branch',
      ['Checkout', 'Create', 'Rename', 'Merge', 'Rebase', 'Cherry Pick', 'Reset', 'Delete'],
    ],
    ['Remote', ['Fetch', 'Pull', 'Push', 'Manage Remotes', 'Pull Requests']],
    ['Query', ['Log', 'File History', 'Blame', 'Show Changes', 'Search']],
    ['Help', ['Documentation', "What's New", 'Check for Updates', 'License', 'About']],
  ])('%s holds exactly its specified items', (label, expected) => {
    const menu = MENUS.find((candidate) => candidate.label === label);
    expect(menu?.items.map((item) => item.label)).toEqual(expected);
  });

  // Ids are the handler-map keys, so a duplicate would silently shadow one
  // item's action with another's.
  it('gives every item a unique id', () => {
    expect(new Set(MENU_ITEM_IDS).size).toBe(MENU_ITEM_IDS.length);
  });

  it('namespaces every id by its menu', () => {
    for (const menu of MENUS) {
      for (const item of menu.items) {
        expect(item.id.startsWith(`${menu.id}.`)).toBe(true);
      }
    }
  });

  /*
   * The guard exists for the native menu bar, whose clicks arrive from Go as
   * plain strings. Anything it lets through is indexed straight into the
   * handler map, so "recognises every real id" and "refuses everything else"
   * are both load-bearing.
   */
  describe('isMenuItemId', () => {
    it('accepts every id in the config', () => {
      for (const id of MENU_ITEM_IDS) {
        expect(isMenuItemId(id)).toBe(true);
      }
    });

    it.each(['', 'repository', 'repository.', 'repository.nope', 'toString', '__proto__'])(
      'rejects %o',
      (value) => {
        expect(isMenuItemId(value)).toBe(false);
      },
    );
  });
});
