import { Set } from '../../../wailsjs/go/appmenu/Service';
import { appmenu } from '../../../wailsjs/go/models';
import { onEvent } from './events';
import type { NativeMenu } from './types';

/**
 * The native macOS menu bar (PLAN.md §9's Phase 6.11 entry).
 *
 * The menu is *pushed* from here rather than declared in Go, because the app
 * already has one menu structure — `components/menu/menuConfig.ts` — and the
 * in-window menubar is drawn from it. A second copy in Go would be a second
 * place to add an item to, with nothing to catch the omission.
 */

/** Replace the native menu bar with the app menu plus these. */
export function setApplicationMenu(menus: readonly NativeMenu[]): Promise<void> {
  // The generated binding is typed in terms of the Go structs' classes, so the
  // plain objects are constructed through them rather than cast past the type.
  return Set(menus.map((menu) => appmenu.Menu.createFrom(menu)));
}

/**
 * Subscribe to native menu clicks. Returns an unsubscribe function.
 *
 * The payload is the item's own id — the same one the in-window menubar hands
 * its handler map, so the two surfaces cannot do different things.
 */
export function onMenuAction(handler: (id: string) => void): () => void {
  return onEvent<string>('menu:action', handler);
}
