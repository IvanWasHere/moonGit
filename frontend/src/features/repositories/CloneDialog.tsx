import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/Button';
import { Icons } from '@/components/icons';
import { useDialog } from '@/components/useDialog';
import { dbKeys } from '@/queries/repositories';
import { addRepository, touchRepository } from '@/services/db/repositories';
import { cloneRepository, cloneTargetName } from '@/services/git/clone';
import { selectDirectory } from '@/services/wails';
import { showToast } from '@/stores/notificationStore';
import styles from './CloneDialog.module.css';

/**
 * Clone a repository from a URL (PLAN.md §11, 8.9).
 *
 * A dialog with two fields rather than a chain of prompts, because the second
 * answer depends on seeing the first: the folder the clone will create is
 * derived from the URL, and showing it is what stops someone discovering they
 * have cloned `repo.git` into the wrong parent directory.
 *
 * **It does not stream progress**, and that is worth knowing rather than
 * discovering. `git clone` reports progress on stderr, which the buffered
 * `exec` path does not surface until the command finishes — so a large clone
 * shows a pending button for minutes with no percentage. Wiring it to
 * `execStream` would mean parsing git's progress format, which is a real piece
 * of work and not this one. The button says what it is doing and the timeout is
 * an hour (`services/git/clone.ts`).
 */
export function CloneDialog({ onClose }: { readonly onClose: () => void }) {
  const [url, setUrl] = useState('');
  const [parent, setParent] = useState('');
  const [busy, setBusy] = useState(false);
  const dialog = useDialog('Clone a repository', onClose);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const folder = cloneTargetName(url);
  const canClone = url.trim() !== '' && parent !== '' && folder !== null && !busy;

  const pickParent = async () => {
    const chosen = await selectDirectory('Clone into');
    if (chosen !== '') setParent(chosen);
  };

  const run = async () => {
    setBusy(true);
    const result = await cloneRepository(url.trim(), parent);
    setBusy(false);

    if (!result.ok) {
      showToast(result.error.message, 'error');
      return;
    }

    // Registered and opened, not merely cloned: a clone that leaves you on the
    // same repository you started from has done half the job.
    const repository = await addRepository(result.value.path, result.value.name);
    await touchRepository(repository.id);
    await queryClient.invalidateQueries({ queryKey: dbKeys.repositories() });
    showToast(`Cloned ${result.value.name}`, 'success');
    onClose();
    void navigate(`/repo/${repository.id}/main`);
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} {...dialog} onClick={(event) => event.stopPropagation()}>
        <header className={styles.header}>
          <Icons.RepositoryOpen size={14} color="var(--accent)" />
          <span className={styles.title}>Clone a repository</span>
          <button type="button" className={styles.close} title="Close" onClick={onClose}>
            <Icons.Close size={14} />
          </button>
        </header>

        <div className={styles.body}>
          <label className={styles.field}>
            <span className={styles.label}>Repository URL</span>
            <input
              className={styles.input}
              placeholder="https://github.com/owner/repo.git"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              autoFocus
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Clone into</span>
            <div className={styles.picker}>
              <input
                className={styles.input}
                placeholder="Choose a folder…"
                value={parent}
                readOnly
              />
              <Button size="sm" onClick={() => void pickParent()}>
                Browse…
              </Button>
            </div>
          </label>

          {/* The whole reason this is a dialog: the destination is derived, so
              it is shown before anything is written to disk. */}
          {folder !== null && parent !== '' && (
            <p className={styles.preview}>
              Creates <code>{parent.replace(/\/+$/, '')}/{folder}</code>
            </p>
          )}
          {url.trim() !== '' && folder === null && (
            <p className={styles.problem}>Could not work out a folder name from that URL.</p>
          )}
        </div>

        <footer className={styles.footer}>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void run()} disabled={!canClone}>
            {busy ? 'Cloning…' : 'Clone'}
          </Button>
        </footer>
      </div>
    </div>
  );
}
