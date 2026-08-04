import { useEffect, useRef } from 'react';
import { onMenuAction, setApplicationMenu } from '@/services/wails';
import type { NativeMenu } from '@/services/wails';
import { isMenuItemId, MENUS, type MenuItemId } from './menuConfig';

/**
 * Mirrors the application menu into the native macOS menu bar.
 *
 * Both menus exist on purpose. The in-window bar is the design's (the mockup
 * draws it, and the window is `TitleBarHiddenInset` so that strip is also where
 * the window is dragged from); the native one is where macOS users look, and
 * where the OS puts an app's menu whether the app agrees or not. What matters
 * is that they cannot disagree: one `MENUS` builds both, and one handler map
 * answers both.
 *
 * The native menu is *global to the app*, not to this component. Unmounting
 * does not remove it — nothing in Wails takes a menu back down — so the
 * subscription is what stops mattering, and the menu simply becomes inert until
 * something mounts that handles it again.
 */
export function useNativeMenu(onAction: (id: MenuItemId) => void): void {
  // `useMenuActions` builds a fresh closure every render. Held in a ref so the
  // subscription is made once rather than torn down and rebuilt on each one —
  // a click that arrived mid-swap would land on nothing.
  const handler = useRef(onAction);
  // Written in an effect rather than during render: a ref assignment in the
  // render body runs during a render React may discard.
  useEffect(() => {
    handler.current = onAction;
  });

  useEffect(() => {
    void setApplicationMenu(NATIVE_MENUS).catch((cause: unknown) => {
      // Not fatal, and deliberately not a toast: the in-window menubar still
      // has every one of these items, so the app is fully usable with the
      // native bar left at whatever Wails defaulted to.
      console.warn('failed to set the native application menu', cause);
    });
  }, []);

  useEffect(
    () =>
      onMenuAction((id) => {
        // Guarded rather than cast: the id crosses a process boundary, and an
        // unknown one should be ignored, not passed to a map that has no entry
        // for it.
        if (isMenuItemId(id)) handler.current(id);
      }),
    [],
  );
}

/**
 * `MENUS` in the shape the bridge sends.
 *
 * Computed once at module load: the menu is static, and the conversion exists
 * only because `separatorBefore` is optional in the config and required in the
 * Go struct.
 */
const NATIVE_MENUS: readonly NativeMenu[] = MENUS.map((menu) => ({
  id: menu.id,
  label: menu.label,
  items: menu.items.map((item) => ({
    id: item.id,
    label: item.label,
    separatorBefore: 'separatorBefore' in item && item.separatorBefore === true,
  })),
}));
