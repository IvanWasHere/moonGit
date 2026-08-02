import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './ContextMenu.module.css';

/**
 * A right-click menu, positioned at the pointer and clamped to the window.
 *
 * Rendered through a portal to `document.body` rather than in place. A menu
 * nested inside a panel inherits that panel's `overflow: hidden` and gets
 * clipped the moment it is longer than the row it belongs to — which, for a
 * file menu with twenty entries in a list item four rows tall, is always.
 *
 * Position is corrected after layout, not guessed before it: the menu's height
 * depends on how many items its file's status earned, so the only reliable
 * time to ask whether it fits below the pointer is once it has been measured.
 */

export interface ContextMenuProps {
  readonly x: number;
  readonly y: number;
  readonly onClose: () => void;
  readonly children: ReactNode;
}

const MARGIN = 6;

/**
 * Marks a menu surface so the dismiss listener can recognise its own.
 *
 * An attribute rather than a ref because submenus render into separate
 * portals: there is no single DOM subtree to test containment against.
 */
const MENU_ATTRIBUTE = 'data-context-menu';

export function ContextMenu({ x, y, onClose, children }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const { width, height } = element.getBoundingClientRect();

    // Flip rather than merely clamp: a menu shoved up from the bottom edge
    // ends up under the cursor, and the first item lands wherever the pointer
    // already is — which is how a right-click turns into an accidental click.
    const left = x + width + MARGIN > window.innerWidth ? Math.max(MARGIN, x - width) : x;
    const top = y + height + MARGIN > window.innerHeight ? Math.max(MARGIN, y - height) : y;
    setPosition({ left, top });
  }, [x, y]);

  useEffect(() => {
    /**
     * Dismiss on any interaction that was not with a menu.
     *
     * The test is `closest(MENU_ATTRIBUTE)` rather than `stopPropagation` in
     * the menu's own handler, and that is not a style preference: this
     * listener is on `window` in the **capture** phase, so it runs before the
     * event reaches any React handler. A `stopPropagation` inside the menu is
     * therefore too late — the menu unmounted on mousedown and no click ever
     * landed on the item. The attribute also covers submenus, which live in
     * their own portals and are not descendants of this element.
     */
    const dismiss = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && target.closest(`[${MENU_ATTRIBUTE}]`) !== null) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('mousedown', dismiss, true);
    window.addEventListener('resize', onClose);
    // A menu anchored to a row that has scrolled away is pointing at a
    // different file than the one it was opened on.
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', dismiss, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      className={styles.menu}
      role="menu"
      style={position}
      {...{ [MENU_ATTRIBUTE]: '' }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {children}
    </div>,
    document.body,
  );
}

export function ContextMenuItem({
  label,
  disabled,
  hint,
  destructive,
  onSelect,
}: {
  readonly label: string;
  readonly disabled?: boolean;
  readonly hint?: string;
  readonly destructive?: boolean;
  readonly onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`${styles.item} ${destructive === true ? styles.destructive : ''}`}
      disabled={disabled}
      onClick={onSelect}
    >
      <span className={styles.label}>{label}</span>
      {hint !== undefined && <span className={styles.hint}>{hint}</span>}
    </button>
  );
}

export function ContextMenuSeparator() {
  return <div className={styles.separator} role="separator" />;
}

/**
 * A nested menu, opened on hover and on click.
 *
 * Opening on hover alone makes it unreachable by keyboard and fiddly with a
 * trackpad; on click alone it behaves unlike every other menu on the platform.
 *
 * **Portalled, like the parent menu, and for a sharper version of the same
 * reason.** The parent needs `overflow-y: auto` so a long menu can scroll —
 * and CSS computes `overflow-x: visible` to `auto` the moment the other axis
 * is not visible. An absolutely-positioned submenu inside it is therefore
 * clipped at the parent's right edge: it opened, and rendered as an empty
 * sliver. Going through the portal takes it out of that clipping context
 * entirely.
 */
export function ContextSubmenu({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState({ left: 0, top: 0 });
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = () => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };

  // A grace period on leaving: with the submenu in a portal there is no shared
  // element for the pointer to travel through, so an instant close makes the
  // gap between the two panels impossible to cross.
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  };

  const show = () => {
    cancelClose();
    const rect = hostRef.current?.getBoundingClientRect();
    if (rect !== undefined) {
      const width = 190;
      const left =
        rect.right + width + MARGIN > window.innerWidth ? rect.left - width : rect.right - 4;
      setBox({ left: Math.max(MARGIN, left), top: rect.top - 4 });
    }
    setOpen(true);
  };

  useEffect(() => cancelClose, []);

  return (
    <div ref={hostRef} onMouseEnter={show} onMouseLeave={scheduleClose}>
      <button
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        className={styles.item}
        onClick={() => (open ? setOpen(false) : show())}
      >
        <span className={styles.label}>{label}</span>
        <span className={styles.chevron}>›</span>
      </button>
      {open &&
        createPortal(
          <div
            className={styles.submenu}
            role="menu"
            style={box}
            {...{ [MENU_ATTRIBUTE]: '' }}
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
          >
            {children}
          </div>,
          document.body,
        )}
    </div>
  );
}
