import styles from './Badges.module.css';

/**
 * The two coloured pills: a file's status letter and a branch's type tag
 * (ui-example L432–446, styles at L148–171).
 */

export type FileStatus =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'untracked'
  | 'renamed'
  | 'copied'
  | 'typechange'
  | 'conflicted'
  | 'ignored';

/**
 * The mockup defined four (L432–438). The rest are additions: real porcelain
 * output distinguishes them, and showing a conflict as "modified" would invite
 * the user to stage a file with conflict markers still in it. Colours reuse the
 * mockup's palette rather than introducing new ones.
 *
 * **`I` for ignored, not git's own `!!`.** Porcelain v1 writes ignored as `!!`,
 * but this map already spends `!` on conflicted — and a grey `!` beside a red
 * one is the one confusion in this vocabulary that actually costs something,
 * since it pairs "nothing to do here" with "stop and fix this". A letter is
 * unambiguous at 16px in a way a colour difference is not.
 */
const STATUS: Record<FileStatus, { readonly cls: string; readonly label: string }> = {
  modified: { cls: 'statusModified', label: 'M' },
  added: { cls: 'statusAdded', label: 'A' },
  deleted: { cls: 'statusDeleted', label: 'D' },
  untracked: { cls: 'statusUntracked', label: '?' },
  renamed: { cls: 'statusRenamed', label: 'R' },
  copied: { cls: 'statusRenamed', label: 'C' },
  typechange: { cls: 'statusRenamed', label: 'T' },
  conflicted: { cls: 'statusConflicted', label: '!' },
  ignored: { cls: 'statusIgnored', label: 'I' },
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
