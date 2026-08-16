import { Icons } from '@/components/icons';
import { useDialog } from '@/components/useDialog';
import licenseText from '../../../../LICENSE.md?raw';
import styles from './LicenseDialog.module.css';

/**
 * The licence, shown in the app (PLAN.md §11, 8.9).
 *
 * **Imported from `LICENSE.md` at build time rather than retyped here.** The
 * obvious alternative — a string constant in this file — is a second copy of a
 * legal document, and the copy that drifts is the one nobody reads. Vite's
 * `?raw` inlines the real file into the bundle, so there is exactly one licence
 * in the repository and this renders it.
 *
 * It has to be inlined rather than read at runtime: a packaged Wails app serves
 * its frontend from an embedded filesystem and the repository is not there, so
 * `readFile('LICENSE.md')` works in development and fails in the build people
 * actually run — the worst possible split.
 */
export function LicenseDialog({ onClose }: { readonly onClose: () => void }) {
  const dialog = useDialog('License', onClose);

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} {...dialog} onClick={(event) => event.stopPropagation()}>
        <header className={styles.header}>
          <Icons.File size={14} color="var(--accent)" />
          <span className={styles.title}>License</span>
          <button type="button" className={styles.close} title="Close" onClick={onClose}>
            <Icons.Close size={14} />
          </button>
        </header>
        {/* `pre`, because a licence is a legal text whose line breaks are part
            of it — reflowing it is editing it. */}
        <pre className={styles.text}>{licenseText}</pre>
      </div>
    </div>
  );
}
