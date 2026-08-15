import type { ReactNode, Ref } from 'react';
import styles from './Panel.module.css';

/**
 * The panel shell every pane in both views is built from
 * (ui-example L90–113: `.panel`, `.panel-header`, `.panel-body`).
 *
 * `Panel` is a flex column that clips its own overflow; `PanelBody` is the
 * only scrolling element. That split is what keeps a header pinned while a
 * list of ten thousand files scrolls under it.
 */

export interface PanelProps {
  readonly children: ReactNode;
  /** Percentage height or width, applied inline exactly as the mockup does. */
  readonly style?: React.CSSProperties;
  readonly id?: string;
  readonly className?: string;
}

export function Panel({ children, style, id, className }: PanelProps) {
  return (
    <div
      className={className === undefined ? styles.panel : `${styles.panel} ${className}`}
      {...(style !== undefined && { style })}
      {...(id !== undefined && { id })}
    >
      {children}
    </div>
  );
}

export interface PanelHeaderProps {
  readonly title: string;
  /** The pill after the title — a count, or the selected file's path (L750). */
  readonly count?: string | number;
  /** Icon buttons on the right. */
  readonly actions?: ReactNode;
}

export function PanelHeader({ title, count, actions }: PanelHeaderProps) {
  return (
    <div className={styles.header}>
      <span>{title}</span>
      {count !== undefined && <div className={styles.count}>{count}</div>}
      {actions !== undefined && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}

export interface PanelActionProps {
  readonly title: string;
  readonly onClick?: () => void;
  readonly children: ReactNode;
}

/** A 22px icon button in a panel header (L105–110). */
export function PanelAction({ title, onClick, children }: PanelActionProps) {
  return (
    <button type="button" className={styles.action} title={title} onClick={onClick}>
      {children}
    </button>
  );
}

export interface PanelBodyProps {
  readonly children: ReactNode;
  /**
   * The scrolling element itself, for a virtualized list to attach to.
   *
   * Exposed rather than left to callers to build their own scroll container,
   * because `PanelBody` being the *only* scrolling element is what pins every
   * panel header in the app. A pane that rolled its own would have two nested
   * scrollers and a header that scrolled away with the content.
   */
  readonly ref?: Ref<HTMLDivElement>;
}

export function PanelBody({ children, ref }: PanelBodyProps) {
  return (
    <div className={styles.body} ref={ref}>
      {children}
    </div>
  );
}
