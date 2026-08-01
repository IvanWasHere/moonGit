import { useCallback, useEffect, useRef, useState } from 'react';
import { MENUS, type MenuItemId } from './menuConfig';
import styles from './TopMenu.module.css';

/**
 * The application menu bar.
 *
 * Sits above the icon menubar, inset from the top of the window so it clears
 * the macOS traffic lights — the window is `TitleBarHiddenInset`, so nothing
 * else reserves that space. The inset strip is marked draggable, since hiding
 * the title bar also removes the only place the user could grab the window.
 *
 * Behaviour follows a desktop menu rather than a web dropdown: clicking a
 * title opens it, and while one is open, *hovering* another switches to it
 * without a second click. Escape and any outside click close.
 */
export function TopMenu({ onAction }: { readonly onAction: (id: MenuItemId) => void }) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpenMenu(null), []);

  useEffect(() => {
    if (openMenu === null) return;

    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node) === true) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openMenu, close]);

  return (
    <div className={styles.root} ref={rootRef}>
      <div className={styles.bar}>
        {MENUS.map((menu) => (
          <div key={menu.id} className={styles.menu}>
            <button
              type="button"
              className={`${styles.title} ${openMenu === menu.id ? styles.titleOpen : ''}`}
              onClick={() => setOpenMenu((current) => (current === menu.id ? null : menu.id))}
              // Only switches when a menu is already open, so passing the
              // cursor over the bar does not pop menus open unbidden.
              onMouseEnter={() => setOpenMenu((current) => (current === null ? null : menu.id))}
            >
              {menu.label}
            </button>

            {openMenu === menu.id && (
              <div className={styles.dropdown} role="menu">
                {menu.items.map((item) => (
                  <div key={item.id}>
                    {/* `as const` narrows each item to its own literal type, so
                        the optional field needs an `in` check rather than a
                        property read. */}
                    {'separatorBefore' in item && item.separatorBefore === true && (
                      <div className={styles.separator} />
                    )}
                    <button
                      type="button"
                      role="menuitem"
                      className={styles.item}
                      onClick={() => {
                        close();
                        onAction(item.id);
                      }}
                    >
                      {item.label}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
