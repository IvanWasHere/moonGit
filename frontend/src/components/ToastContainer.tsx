import { AnimatePresence, motion } from 'framer-motion';
import { useNotificationStore } from '@/stores/notificationStore';
import { Icons } from './icons';
import styles from './ToastContainer.module.css';

/**
 * Bottom-right toast stack (ui-example L205–214, L795–800).
 *
 * The mockup's `@keyframes toastIn` is reproduced with Framer Motion so exits
 * can animate too — the CSS version simply vanished on removal, which reads as
 * a glitch when several dismiss at once.
 */

const ICON = {
  success: Icons.ToastSuccess,
  error: Icons.ToastError,
  info: Icons.ToastInfo,
} as const;

export function ToastContainer() {
  const toasts = useNotificationStore((state) => state.toasts);
  const dismiss = useNotificationStore((state) => state.dismiss);

  return (
    <div className={styles.container}>
      <AnimatePresence initial={false}>
        {toasts.map((toast) => {
          const Icon = ICON[toast.type];
          return (
            <motion.div
              key={toast.id}
              className={`${styles.toast} ${styles[toast.type] ?? ''}`}
              // Matches the mockup's keyframe: 10px up, 0.95 → 1 scale, 0.3s.
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              onClick={() => dismiss(toast.id)}
            >
              <Icon size={14} />
              <span>{toast.message}</span>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
