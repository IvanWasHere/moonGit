import { useState } from 'react';
import { Button } from '@/components/Button';
import { useStatus } from '@/queries/git';
import { useCommit } from '@/queries/mutations';
import { stagedPaths } from '@/queries/mutations';
import { recordCommitMessage } from '@/services/db/repositories';
import { showToast } from '@/stores/notificationStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import styles from './CommitBox.module.css';

/**
 * Where a commit message is written.
 *
 * Net-new: the mockup's menubar validated `state.commitMessage` (L465) but
 * nothing in it ever set that value — there was no input anywhere. So this is
 * designed rather than ported, and it sits under the Files panel because that
 * is where the staged changes it describes are.
 *
 * The staged count is shown on the button rather than left implicit: "Commit"
 * with nothing staged is the single most common way to be confused by a git
 * client.
 */
export function CommitBox() {
  const repoPath = useWorkspaceStore((state) => state.repoPath);
  const repoId = useWorkspaceStore((state) => state.repoId);
  const message = useWorkspaceStore((state) => state.commitMessage);
  const setMessage = useWorkspaceStore((state) => state.setCommitMessage);
  const closeCommit = useWorkspaceStore((state) => state.closeCommit);
  const [amend, setAmend] = useState(false);

  const { data: status } = useStatus(repoPath);
  const commit = useCommit(repoPath);

  const staged = stagedPaths(status);
  // Amending re-writes the previous commit, so it is legitimate with nothing
  // staged — for fixing a message.
  const canCommit = message.trim() !== '' && (staged.length > 0 || amend);

  const submit = () => {
    if (!canCommit || commit.isPending) return;

    commit.mutate(
      { message, amend },
      {
        onSuccess: (outcome) => {
          if (!outcome.created) {
            showToast(outcome.summary, 'error');
            return;
          }
          showToast(outcome.summary, 'success');
          if (repoId !== null) {
            void recordCommitMessage(repoId, message);
          }
          setMessage('');
          setAmend(false);
          // The composer is opened on demand, so it closes once its job is
          // done rather than sitting empty over the file list.
          closeCommit();
        },
        onError: (error) => showToast(error.message, 'error'),
      },
    );
  };

  return (
    <div className={styles.box}>
      <textarea
        className={styles.input}
        placeholder={
          staged.length === 0 && !amend
            ? 'Stage changes to commit…'
            : 'Commit message (first line is the subject)'
        }
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        onKeyDown={(event) => {
          // Cmd/Ctrl+Enter commits — Enter alone has to stay newline, since a
          // message body is the whole point of a multi-line field.
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            submit();
          }
        }}
        rows={3}
        spellCheck
      />
      <div className={styles.row}>
        <label className={styles.amend}>
          <input type="checkbox" checked={amend} onChange={(e) => setAmend(e.target.checked)} />
          Amend
        </label>
        <span className={styles.count}>{staged.length} staged</span>
        <Button size="sm" onClick={closeCommit}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={submit}
          disabled={!canCommit || commit.isPending}
        >
          {commit.isPending ? 'Committing…' : amend ? 'Amend commit' : 'Commit'}
        </Button>
      </div>
    </div>
  );
}
