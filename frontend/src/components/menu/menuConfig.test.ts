import { describe, expect, it } from 'vitest';
import { MENUS, MENU_ITEM_IDS } from './menuConfig';

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
        'Repository Settings',
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
});
