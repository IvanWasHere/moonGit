import { useCallback, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';

/**
 * The three things every overlay in this app owes a keyboard (PLAN.md §11, 8.3).
 *
 * Eight overlays had grown the same shape by copying — a backdrop that closes
 * on click, a panel inside it — and had drifted on everything the shape does
 * not make obvious. Five announced themselves as dialogs and three did not.
 * None of the eight trapped focus, and none gave focus back when it closed.
 *
 * A hook rather than a `<Dialog>` component, deliberately. Each overlay owns
 * its own backdrop and panel classes, its own header and its own layout; a
 * component would have had to absorb all of that or accept every one of them as
 * a prop. What they genuinely share is behaviour, not markup, so that is what
 * is shared.
 *
 * What it does, and why each one matters:
 *
 * **Announces the panel as a modal dialog.** `aria-modal` is what tells a
 * screen reader that the rest of the page is inert while this is up; without
 * it the reader will happily wander into the workspace behind the backdrop and
 * read out a file list the user cannot reach.
 *
 * **Traps Tab.** Without this, tabbing off the last control moves focus into
 * the application behind the overlay — still covered by the backdrop, still
 * unreachable by mouse, and now holding the focus ring. The user is typing
 * into something they cannot see.
 *
 * **Gives focus back.** When the overlay closes, focus returns to whatever
 * opened it. Without this it falls to `<body>`, and the next Tab starts from
 * the top of the window rather than from the button just pressed — which for a
 * keyboard user means finding their place again after every dialog.
 */

/**
 * Focusable, in DOM order.
 *
 * `:not([disabled])` and the `tabindex="-1"` exclusion are both load-bearing:
 * a disabled button and a programmatically-focusable container are skipped by
 * Tab, so a trap that included them would stop on elements the browser itself
 * would pass over, and the cycle would not match what actually happens.
 */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Whether an element is actually reachable, by walking its ancestors.
 *
 * The obvious test is `offsetParent !== null`, and it is wrong here: jsdom
 * performs no layout, so `offsetParent` is null for *everything* and the filter
 * would remove every candidate — the trap would silently degrade to "keep focus
 * on the panel" and its tests would pass against a hook that does nothing. Only
 * caught because the tests asserted which control had focus rather than that
 * focus was somewhere inside.
 *
 * `getComputedStyle` is answered honestly by both jsdom and a browser, so the
 * walk works in tests and in the app. It exists because these overlays hide
 * inactive wizard steps with `display: none` — those controls are in the DOM
 * and must not be tab stops.
 */
function isReachable(el: HTMLElement, root: HTMLElement): boolean {
  for (let n: HTMLElement | null = el; n !== null && n !== root; n = n.parentElement) {
    if (n.hidden) return false;
    const cs = getComputedStyle(n);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
  }
  return true;
}

function focusableWithin(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => isReachable(el, root));
}

/**
 * Spread onto the panel element: `<div className={…} {...useDialog(…)}>`.
 *
 * One flat object including `ref`, rather than `{ref, props}`, for two reasons.
 * React 19 treats `ref` as an ordinary prop, so there is nothing to keep apart;
 * and `eslint-plugin-react-hooks` reads any member access on an object holding
 * a `ref` as touching a ref during render, so the two-part shape tripped
 * `react-hooks/refs` at all eight call sites for no benefit.
 */
export interface Dialog {
  readonly ref: (node: HTMLElement | null) => void;
  readonly role: 'dialog';
  readonly 'aria-modal': true;
  readonly 'aria-label': string;
  /** So the panel itself can hold focus when it contains no focusable control. */
  readonly tabIndex: -1;
  readonly onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
}

export function useDialog(label: string, onClose: () => void): Dialog {
  const panel = useRef<HTMLElement | null>(null);
  /** Whatever had focus when this opened, to give it back on the way out. */
  const restoreTo = useRef<Element | null>(null);

  // Captured in a ref rather than read at close time: by then the overlay has
  // focus, so `document.activeElement` would name the overlay's own control.
  if (restoreTo.current === null) restoreTo.current = document.activeElement;

  const ref = useCallback((node: HTMLElement | null) => {
    panel.current = node;
    if (node === null) return;
    // Only when nothing inside has claimed focus already — several of these
    // overlays `autoFocus` a text input, and stealing it back to the container
    // would be worse than doing nothing.
    if (!node.contains(document.activeElement)) {
      (focusableWithin(node)[0] ?? node).focus();
    }
  }, []);

  useEffect(
    () => () => {
      const target = restoreTo.current;
      // The opener can be gone by now — a menu item in a menu that has since
      // closed, a row in a list the dialog's own action refreshed. Focusing a
      // detached node silently does nothing, so check rather than hope.
      if (target instanceof HTMLElement && target.isConnected) target.focus();
    },
    [],
  );

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const node = panel.current;
      if (node === null) return;
      const focusable = focusableWithin(node);
      if (focusable.length === 0) {
        // Nothing to move between: keep focus on the panel rather than letting
        // it escape to the application behind the backdrop.
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (first === undefined || last === undefined) return;
      const active = document.activeElement;

      // Only the two ends are handled. Everything in between is the browser's
      // own tab order, which is already correct and should not be re-implemented.
      if (event.shiftKey && (active === first || active === node)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  return { ref, role: 'dialog', 'aria-modal': true, 'aria-label': label, tabIndex: -1, onKeyDown };
}
