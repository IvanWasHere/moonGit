/**
 * The application menu, as data.
 *
 * Kept separate from the component so the structure can be asserted in tests
 * and so adding an item is a one-line change rather than JSX surgery. Every
 * `id` is namespaced by its menu, which is what lets the handler map be
 * exhaustive — an item with no handler is a visible bug, not a silent no-op.
 */

export interface MenuItem {
  readonly id: string;
  readonly label: string;
  /** Draws a divider above this item. */
  readonly separatorBefore?: boolean;
}

export interface Menu {
  readonly id: string;
  readonly label: string;
  readonly items: readonly MenuItem[];
}

export const MENUS = [
  {
    id: 'repository',
    label: 'Repository',
    items: [
      { id: 'repository.clone', label: 'Clone…' },
      { id: 'repository.open', label: 'Open…' },
      { id: 'repository.close', label: 'Close' },
      { id: 'repository.pull', label: 'Pull', separatorBefore: true },
      { id: 'repository.push', label: 'Push' },
      { id: 'repository.fetch', label: 'Fetch' },
      { id: 'repository.synchronize', label: 'Synchronize' },
      { id: 'repository.settings', label: 'Repository Settings', separatorBefore: true },
      { id: 'repository.exit', label: 'Exit' },
    ],
  },
  {
    id: 'local',
    label: 'Local',
    items: [
      { id: 'local.commit', label: 'Commit' },
      { id: 'local.stage', label: 'Stage' },
      { id: 'local.unstage', label: 'Unstage' },
      { id: 'local.stash', label: 'Stash', separatorBefore: true },
      { id: 'local.shelve', label: 'Shelve' },
      { id: 'local.ignore', label: 'Ignore' },
    ],
  },
  {
    id: 'branch',
    label: 'Branch',
    items: [
      { id: 'branch.checkout', label: 'Checkout' },
      { id: 'branch.create', label: 'Create' },
      { id: 'branch.rename', label: 'Rename' },
      { id: 'branch.merge', label: 'Merge', separatorBefore: true },
      { id: 'branch.rebase', label: 'Rebase' },
      { id: 'branch.cherryPick', label: 'Cherry Pick' },
      { id: 'branch.reset', label: 'Reset' },
      { id: 'branch.delete', label: 'Delete', separatorBefore: true },
    ],
  },
  {
    id: 'remote',
    label: 'Remote',
    items: [
      { id: 'remote.fetch', label: 'Fetch' },
      { id: 'remote.pull', label: 'Pull' },
      { id: 'remote.push', label: 'Push' },
      { id: 'remote.manage', label: 'Manage Remotes', separatorBefore: true },
      { id: 'remote.pullRequests', label: 'Pull Requests' },
    ],
  },
  {
    id: 'query',
    label: 'Query',
    items: [
      { id: 'query.log', label: 'Log' },
      { id: 'query.fileHistory', label: 'File History' },
      { id: 'query.blame', label: 'Blame' },
      { id: 'query.showChanges', label: 'Show Changes' },
      { id: 'query.search', label: 'Search', separatorBefore: true },
    ],
  },
  {
    id: 'help',
    label: 'Help',
    items: [
      { id: 'help.documentation', label: 'Documentation' },
      { id: 'help.whatsNew', label: "What's New" },
      { id: 'help.checkForUpdates', label: 'Check for Updates' },
      { id: 'help.license', label: 'License', separatorBefore: true },
      { id: 'help.about', label: 'About' },
    ],
  },
] as const satisfies readonly Menu[];

/**
 * The union of every item id.
 *
 * This is why `MENUS` is `as const`: it makes the handler map in
 * `useMenuActions` a `Record<MenuItemId, …>`, so adding an item here without
 * wiring it is a **type error**, not a menu entry that silently does nothing.
 */
export type MenuItemId = (typeof MENUS)[number]['items'][number]['id'];

export const MENU_ITEM_IDS: readonly MenuItemId[] = MENUS.flatMap((menu) =>
  menu.items.map((item) => item.id),
);
