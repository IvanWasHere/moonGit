import { useState } from 'react';
import { Button } from '@/components/Button';
import { Icons } from '@/components/icons';
import { useDialog } from '@/components/useDialog';
import { useResetBranch } from '@/queries/mutations';
import { showToast } from '@/stores/notificationStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import styles from './ResetDialog.module.css';

/**
 * Move the current branch to another commit (PLAN.md §11, 8.9).
 *
 * A dialog rather than a prompt, and this is the one place in 8.9 where that
 * is not over-engineering: the three modes differ only in how much they take
 * with them, one of them **destroys uncommitted work with no way back through
 * git**, and their names give no hint which. `window.confirm('soft/mixed/hard?')`
 * would be asking someone to type the name of a thing they cannot undo.
 *
 * So each mode states its consequence in the sentence next to it, and the
 * destructive one is styled as destructive and needs a second confirmation.
 */
export function ResetDialog({
  target,
  onClose,
}: {
  readonly target: string;
  readonly onClose: () => void;
}) {
  const repoPath = useWorkspaceStore((state) => state.repoPath);
  const reset = useResetBranch(repoPath);
  const [mode, setMode] = useState<'soft' | 'mixed' | 'hard'>('mixed');
  const dialog = useDialog('Reset branch', onClose);

  const run = () => {
    if (mode === 'hard' && !window.confirm('Discard all uncommitted changes? This cannot be undone.')) {
      return;
    }
    reset.mutate(
      { target, mode },
      {
        onSuccess: () => {
          showToast(`Reset to ${target.slice(0, 7)} (${mode})`, 'success');
          onClose();
        },
        onError: (error: Error) => showToast(error.message, 'error'),
      },
    );
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} {...dialog} onClick={(event) => event.stopPropagation()}>
        <header className={styles.header}>
          <Icons.Discard size={14} color="var(--accent)" />
          <span className={styles.title}>Reset branch</span>
          <span className={styles.target}>to {target.slice(0, 7)}</span>
          <button type="button" className={styles.close} title="Close" onClick={onClose}>
            <Icons.Close size={14} />
          </button>
        </header>

        <div className={styles.body}>
          {MODES.map((option) => (
            <label
              key={option.mode}
              className={`${styles.option} ${mode === option.mode ? styles.optionOn : ''} ${
                option.destructive ? styles.destructive : ''
              }`}
            >
              <input
                type="radio"
                name="reset-mode"
                checked={mode === option.mode}
                onChange={() => setMode(option.mode)}
              />
              <span className={styles.optionName}>{option.mode}</span>
              <span className={styles.optionHint}>{option.hint}</span>
            </label>
          ))}
        </div>

        <footer className={styles.footer}>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant={mode === 'hard' ? 'danger' : 'primary'}
            onClick={run}
            disabled={reset.isPending}
          >
            {reset.isPending ? 'Resetting…' : 'Reset'}
          </Button>
        </footer>
      </div>
    </div>
  );
}

/**
 * What each mode actually does, in the sentence next to it.
 *
 * Written as consequences rather than as git's own vocabulary: "resets the
 * index" is only meaningful to somebody who already knows which of the three
 * they want, which is exactly the person who does not need the dialog.
 */
const MODES = [
  {
    mode: 'soft',
    hint: 'Keep every change, staged and ready to commit again.',
    destructive: false,
  },
  {
    mode: 'mixed',
    hint: 'Keep every change as unstaged edits. This is git’s default.',
    destructive: false,
  },
  {
    mode: 'hard',
    hint: 'Throw away all uncommitted changes. This cannot be undone.',
    destructive: true,
  },
] as const;
