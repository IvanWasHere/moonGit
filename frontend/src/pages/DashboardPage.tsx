import { Icons } from '@/components/icons';
import styles from './DashboardPage.module.css';

/**
 * Phase 0 placeholder. The real Repository Dashboard — recent repositories,
 * clone, open, search, favorites, groups (PLAN.md §1.4) — arrives in Phase 5.
 *
 * For now this doubles as the Phase 0 exit check: if the fonts, design tokens,
 * and icon registry are wired correctly, this screen renders in Space Grotesk
 * and JetBrains Mono with the mockup's palette.
 */
const SWATCHES = [
  '--accent',
  '--green',
  '--red',
  '--blue',
  '--purple',
  '--cyan',
  '--orange',
] as const;

export function DashboardPage() {
  return (
    <div className={styles.page}>
      <div className={styles.brand}>
        <Icons.Branch size={30} strokeWidth={2.25} />
        moonGit
      </div>
      <div className={styles.tagline}>a native macOS Git client</div>

      <div className={styles.swatches}>
        {SWATCHES.map((token) => (
          <div
            key={token}
            className={styles.swatch}
            style={{ background: `var(${token})` }}
            title={token}
          />
        ))}
      </div>

      <div className={styles.status}>
        <span>
          <span className={styles.ok}>✓</span> Phase 0 — foundations
        </span>
      </div>
    </div>
  );
}
