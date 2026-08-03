import { Button } from '@/components/Button';
import { Icons } from '@/components/icons';
import { useStatus } from '@/queries/git';
import { useRebaseStep } from '@/queries/mutations';
import { isConflicted } from '@/services/git';
import { showMessage } from '@/services/wails';
import { showToast } from '@/stores/notificationStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useRebaseState } from './useRebaseState';
import styles from './RebaseBanner.module.css';

/**
 * The way out of a stopped rebase.
 *
 * A rebase that has stopped is the one state where the app's ordinary
 * affordances are all slightly wrong: committing would not do what it looks
 * like, and the branch shown is a detached HEAD partway through a replay. So it
 * gets a bar across the top of the workspace that says where it stopped and
 * offers the three things git offers.
 *
 * **Continue and skip lead in different directions and only one is safe by
 * default.** Skip throws the current commit away entirely, so it confirms;
 * continue does not, because it is the intended path.
 */
export function RebaseBanner() {
  const repoPath = useWorkspaceStore((state) => state.repoPath);
  const openMerge = useWorkspaceStore((state) => state.openMerge);
  const rebase = useRebaseState(repoPath);
  const step = useRebaseStep(repoPath);
  const { data: status } = useStatus(repoPath);

  if (!rebase.active) return null;

  const conflicts = (status?.entries ?? []).filter(isConflicted);
  const progress =
    rebase.step !== null && rebase.total !== null ? `${rebase.step} of ${rebase.total}` : null;

  const run = (which: 'continue' | 'skip' | 'abort', confirmText?: string) => {
    void (async () => {
      if (confirmText !== undefined) {
        const label = which === 'skip' ? 'Skip' : 'Abort';
        const choice = await showMessage({
          kind: 'warning',
          title: `${label} this commit?`,
          message: confirmText,
          buttons: ['Cancel', label],
          defaultButton: 'Cancel',
          cancelButton: 'Cancel',
        });
        if (choice !== label) return;
      }

      step.mutate(
        { step: which },
        {
          onSuccess: (outcome) => {
            if (outcome?.status === 'conflicted') {
              showToast(`Stopped again — ${outcome.summary}`, 'error');
              openMerge();
              return;
            }
            showToast(
              which === 'abort' ? 'Rebase aborted' : 'Rebase finished',
              which === 'abort' ? 'info' : 'success',
            );
          },
          onError: (error) => showToast(error.message, 'error'),
        },
      );
    })();
  };

  return (
    <div className={styles.banner}>
      <Icons.Rebase size={14} color="var(--accent)" />
      <span className={styles.label}>Rebase in progress</span>
      {progress !== null && <span className={styles.progress}>{progress}</span>}

      <span className={styles.detail}>
        {conflicts.length > 0
          ? `${conflicts.length} conflicted file${conflicts.length === 1 ? '' : 's'} to resolve`
          : /*
             * Deliberately not "stopped to edit". Nothing on disk distinguishes
             * a stop for an `edit` line from a conflict that has since been
             * resolved — both leave a clean tree partway through — and naming
             * the wrong one is worse than naming neither.
             */
            'Nothing left to resolve — continue when ready'}
      </span>

      {conflicts.length > 0 && (
        <Button size="sm" onClick={openMerge}>
          Resolve
        </Button>
      )}
      <Button size="sm" variant="primary" disabled={step.isPending} onClick={() => run('continue')}>
        Continue
      </Button>
      <Button
        size="sm"
        disabled={step.isPending}
        onClick={() =>
          run('skip', 'Skip this commit? Its changes will not appear in the rebased history.')
        }
      >
        Skip
      </Button>
      <Button
        size="sm"
        variant="danger"
        disabled={step.isPending}
        onClick={() => run('abort', 'Abort the rebase and put the branch back where it started?')}
      >
        Abort
      </Button>
    </div>
  );
}
