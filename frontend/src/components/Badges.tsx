import styles from './Badges.module.css';

/**
 * The two coloured pills: a file's status letter and a branch's type tag
 * (ui-example L432–446, styles at L148–171).
 */

export type FileStatus = 'modified' | 'added' | 'deleted' | 'untracked';

const STATUS: Record<FileStatus, { readonly cls: string; readonly label: string }> = {
  modified: { cls: 'statusModified', label: 'M' },
  added: { cls: 'statusAdded', label: 'A' },
  deleted: { cls: 'statusDeleted', label: 'D' },
  untracked: { cls: 'statusUntracked', label: 'U' },
};

/** Falls back to `modified` for an unknown status, exactly as the mockup does (L439). */
export function StatusBadge({ status }: { readonly status: string }) {
  const entry = STATUS[status as FileStatus] ?? STATUS.modified;
  return (
    <div className={`${styles.status} ${styles[entry.cls] ?? ''}`} title={status}>
      {entry.label}
    </div>
  );
}

export type BranchType = 'main' | 'feature' | 'fix' | 'release' | 'hotfix' | 'develop';

const BRANCH_TONE: Record<string, string> = {
  main: 'tagGreen',
  feature: 'tagBlue',
  fix: 'tagRed',
  release: 'tagPurple',
  hotfix: 'tagRed',
  develop: 'tagAccent',
};

/** Unknown branch types render blue, as in the mockup (L445). */
export function BranchTag({ type }: { readonly type: string }) {
  const tone = BRANCH_TONE[type] ?? 'tagBlue';
  return <div className={`${styles.tag} ${styles[tone] ?? ''}`}>{type}</div>;
}
