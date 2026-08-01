import type { ReactNode } from 'react';
import styles from './Button.module.css';

/** Ported from ui-example L223–235 (`.btn`, `.btn-primary`, `.btn-danger`, `.btn-sm`). */
export function Button({
  children,
  onClick,
  variant = 'default',
  size = 'md',
  title,
  disabled,
}: {
  readonly children: ReactNode;
  readonly onClick?: () => void;
  readonly variant?: 'default' | 'primary' | 'danger';
  readonly size?: 'sm' | 'md';
  readonly title?: string;
  readonly disabled?: boolean;
}) {
  const variantClass =
    variant === 'primary' ? styles.primary : variant === 'danger' ? styles.danger : '';

  return (
    <button
      type="button"
      className={`${styles.btn} ${variantClass} ${size === 'sm' ? styles.sm : ''}`}
      onClick={onClick}
      {...(title !== undefined && { title })}
      {...(disabled !== undefined && { disabled })}
    >
      {children}
    </button>
  );
}
