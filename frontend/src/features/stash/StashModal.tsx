import { useState } from 'react';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { Icons } from '@/components/icons';
import { useStashes, useStatus } from '@/queries/git';
import { useStashAction, useStashPush } from '@/queries/mutations';
import type { Stash } from '@/services/git';
import { showMessage } from '@/services/wails';
import { showToast } from '@/stores/notificationStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { timeAgo } from '@/utils/format';
import styles from './StashModal.module.css';

/**
 * The stash stack (PLAN.md §9.5).
 *
 * `StashService` has existed since Phase 2, fully parsed and tested, and has
 * never been rendered — this is the panel for it.
 *
 * Two things the UI has to say out loud, because git does not:
 *
 * 1. **Apply and pop are different**, and the difference is not recoverable in
 *    one direction. Pop drops the stash once it lands; if the apply conflicts
 *    and the user then abandons it, the entry is gone. Both are offered, with
 *    apply first.
 * 2. **Dropping is permanent enough to confirm.** A dropped stash is
 *    unreachable from any ref; recovering it means going through
 *    `fsck --unreachable`, which is not a thing to ask of somebody who clicked
 *    the wrong row.
 */
export function StashModal({ onClose }: { readonly onClose: () => void }) {
  const repoPath = useWorkspaceStore((state) => state.repoPath);
  const { data: stashes, isPending, error } = useStashes(repoPath);
  const { data: status } = useStatus(repoPath);

  const push = useStashPush(repoPath);
  const act = useStashAction(repoPath);

  const [message, setMessage] = useState('');
  const [includeUntracked, setIncludeUntracked] = useState(true);

  const hasChanges = (status?.entries ?? []).some((entry) => entry.kind !== 'ignored');

  const doPush = () => {
    push.mutate(
      { ...(message.trim() !== '' && { message: message.trim() }), includeUntracked },
      {
        onSuccess: (stashed) => {
          // Git exits 0 with "No local changes to save", so a false here is a
          // real answer rather than a failure — and saying "stashed" would be
          // a lie the list immediately contradicts.
          showToast(stashed ? 'Changes stashed' : 'Nothing to stash', stashed ? 'success' : 'info');
          if (stashed) setMessage('');
        },
        onError: (cause) => showToast(cause.message, 'error'),
      },
    );
  };

  const run = (action: 'apply' | 'pop' | 'drop', stash: Stash) => {
    void (async () => {
      if (action === 'drop') {
        const choice = await showMessage({
          kind: 'warning',
          title: 'Drop this stash?',
          message: `Drop ${stash.selector}? A dropped stash is not reachable from any ref and cannot be recovered from the UI.`,
          buttons: ['Cancel', 'Drop'],
          defaultButton: 'Cancel',
          cancelButton: 'Cancel',
        });
        if (choice !== 'Drop') return;
      }

      act.mutate(
        { action, selector: stash.selector },
        {
          onSuccess: () =>
            showToast(
              action === 'apply'
                ? `Applied ${stash.selector}, kept on the stack`
                : action === 'pop'
                  ? `Popped ${stash.selector}`
                  : `Dropped ${stash.selector}`,
              action === 'drop' ? 'info' : 'success',
            ),
          // A conflicting apply leaves unmerged paths behind, and git says so.
          onError: (cause) => showToast(cause.message, 'error'),
        },
      );
    })();
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-label="Stashes"
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.header}>
          <Icons.Stash size={14} color="var(--accent)" />
          <span className={styles.title}>Stashes</span>
          <span className={styles.count}>{stashes?.length ?? 0}</span>
          <button type="button" className={styles.close} title="Close" onClick={onClose}>
            <Icons.Remove size={14} />
          </button>
        </header>

        <div className={styles.compose}>
          <input
            className={styles.input}
            placeholder="Message (optional)"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && hasChanges) doPush();
            }}
          />
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={includeUntracked}
              onChange={(event) => setIncludeUntracked(event.target.checked)}
            />
            {/* On by default: `git stash` without it silently leaves new files
                behind, which is how people lose work they thought was saved. */}
            <span>Include untracked</span>
          </label>
          <Button
            size="sm"
            variant="primary"
            disabled={!hasChanges || push.isPending}
            onClick={doPush}
          >
            Stash changes
          </Button>
        </div>

        <div className={styles.body}>
          {error !== null ? (
            <EmptyState icon={Icons.Abort} message={error.message} />
          ) : isPending ? (
            <EmptyState icon={Icons.Sync} message="Reading the stash stack…" />
          ) : stashes.length === 0 ? (
            <EmptyState icon={Icons.Stash} message="No stashes" />
          ) : (
            stashes.map((stash) => (
              <div key={stash.selector} className={styles.row}>
                <div className={styles.rowMain}>
                  <span className={styles.selector}>{stash.selector}</span>
                  <span className={`${styles.message} ${stash.autoNamed ? styles.auto : ''}`}>
                    {stash.message}
                  </span>
                </div>
                <div className={styles.meta}>
                  {stash.branch !== null && <span className={styles.branch}>{stash.branch}</span>}
                  {stash.includesUntracked && <span className={styles.flag}>+untracked</span>}
                  <span className={styles.age}>{timeAgo(stash.date * 1000)}</span>
                </div>
                <div className={styles.actions}>
                  <Button size="sm" disabled={act.isPending} onClick={() => run('apply', stash)}>
                    Apply
                  </Button>
                  <Button size="sm" disabled={act.isPending} onClick={() => run('pop', stash)}>
                    Pop
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={act.isPending}
                    onClick={() => run('drop', stash)}
                  >
                    Drop
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
