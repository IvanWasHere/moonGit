import type { LucideIcon } from './icons';
import styles from './EmptyState.module.css';

/**
 * The centred icon-and-message block every panel falls back to
 * (ui-example L216–221, used at L561, L590, L606, L624–625, L647–648, L674, L702).
 *
 * The mockup's icon sizing came from Font Awesome's `font-size: 28px`; lucide
 * renders SVG, so the equivalent is an explicit size with the same opacity.
 */
export function EmptyState({
  icon: Icon,
  message,
}: {
  readonly icon: LucideIcon;
  readonly message: string;
}) {
  return (
    <div className={styles.empty}>
      <Icon size={28} className={styles.icon} />
      <p>{message}</p>
    </div>
  );
}
