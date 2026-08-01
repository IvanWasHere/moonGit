import type { ReactNode } from 'react';
import styles from './ListItem.module.css';

/**
 * The row shared by the repository, branch and remote-branch lists
 * (ui-example L139–156).
 *
 * The mockup rendered these inline in three places with slightly different
 * children; here the slots are named, so a change to row padding or the
 * selected-state border cannot drift between the lists that use it.
 */

export interface ListItemProps {
  readonly icon?: ReactNode;
  readonly name: ReactNode;
  /**
   * Right-aligned muted text — ahead/behind counts, last commit.
   *
   * Rendered as its own element with no internal gap, so `+3` and `-1` sit
   * adjacent. A row needing two separately spaced groups passes `metaBefore`
   * as well; the mockup does exactly this for remote branches (L678–682).
   */
  readonly meta?: ReactNode;
  readonly metaBefore?: ReactNode;
  /** Coloured pill after the name. */
  readonly tag?: ReactNode;
  readonly selected?: boolean;
  readonly onClick?: () => void;
  /** Left border colour when not selected — the Review view marks the active branch (L676). */
  readonly accent?: string;
}

export function ListItem({
  icon,
  name,
  meta,
  metaBefore,
  tag,
  selected,
  onClick,
  accent,
}: ListItemProps) {
  return (
    <div
      className={selected === true ? `${styles.item} ${styles.selected}` : styles.item}
      onClick={onClick}
      {...(accent !== undefined && selected !== true && { style: { borderLeftColor: accent } })}
    >
      {icon !== undefined && <span className={styles.icon}>{icon}</span>}
      <div className={styles.name}>{name}</div>
      {tag}
      {metaBefore !== undefined && <div className={styles.meta}>{metaBefore}</div>}
      {meta !== undefined && <div className={styles.meta}>{meta}</div>}
    </div>
  );
}

/**
 * The non-interactive "Staged Changes (3)" / "Changes (5)" divider inside the
 * file list (L595, L601). Inline styles in the mockup; a variant here.
 */
export function ListSectionHeader({
  label,
  tone,
}: {
  readonly label: string;
  readonly tone: 'staged' | 'unstaged';
}) {
  return (
    <div
      className={`${styles.item} ${styles.sectionHeader} ${tone === 'staged' ? styles.staged : ''}`}
    >
      {/* Empty icon slot: the mockup renders `m('i.icon', '')` here (L595, L601)
          so the label lines up with the filenames below it rather than sitting
          24px to their left. */}
      <span className={styles.icon} />
      <div className={styles.name}>{label}</div>
    </div>
  );
}
