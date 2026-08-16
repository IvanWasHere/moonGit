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
      /* Not in the mockup either (Phase 6.9). It sits with the repository
         because that is what its working directory is — a terminal opened
         from here starts in the repository, not in $HOME. */
      { id: 'repository.terminal', label: 'Terminal', separatorBefore: true },
      { id: 'repository.settings', label: 'Repository Settings', separatorBefore: true },
      /* Application preferences, as distinct from the repository's own config
         above. There is no app menu to put them in — the mockup's bar starts
         at Repository — so they sit here, which is also where macOS users
         reach for ⌘, out of habit.

         **Labelled `Settings…`, not `Preferences…`, so the two menu bars read
         the same.** 6.11 called the divergence a free win: macOS silently
         retitles a menu item named `Preferences…` to `Settings…` on Ventura
         and later, so each bar matched its own convention from one source.
         In practice it is the *only* label out of forty that differs between
         the in-window bar and the native one, and one word that changes
         depending on where you look reads as a bug rather than as etiquette.
         Naming it `Settings…` here means macOS has nothing to retitle and
         both bars agree.

         The id stays `repository.preferences`: it is internal, `useMenuActions`
         and every test key off it, and renaming it would churn those for no
         visible gain. */
      { id: 'repository.preferences', label: 'Settings…' },
      { id: 'repository.exit', label: 'Exit', separatorBefore: true },
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
      /* No "Check for Updates" (PLAN.md §11, 8.9). Auto-update is cut — an
         unsigned updater is an unverified download replacing the running app
         (§11) — so the item could only ever report that there is no updater.
         Removed rather than left saying so, on the same grounds as Git-flow
         and Investigate (§14): a control that cannot do anything costs a click
         to discover that. */
      { id: 'help.documentation', label: 'Documentation' },
      { id: 'help.whatsNew', label: "What's New" },
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

/**
 * Whether a string is one of those ids.
 *
 * Needed because the native menu bar's clicks arrive from Go as plain strings
 * (`useNativeMenu`). Inside the app the type is guaranteed; across the bridge
 * it is an assumption, and an unrecognised id should be dropped rather than
 * indexed into a map that has no entry for it.
 */
export function isMenuItemId(value: string): value is MenuItemId {
  return (MENU_ITEM_IDS as readonly string[]).includes(value);
}
