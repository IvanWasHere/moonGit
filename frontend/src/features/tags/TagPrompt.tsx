import { useState } from 'react';
import { Button } from '@/components/Button';
import { Icons } from '@/components/icons';
import { useCreateTag } from '@/queries/mutations';
import { showToast } from '@/stores/notificationStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import styles from './TagPrompt.module.css';

/**
 * Naming a new tag (PLAN.md §9.5).
 *
 * An in-app prompt rather than a native one because there is no native prompt
 * for free text — `dialogs.ShowMessage` offers buttons, and `SaveFile` returns
 * a *path*, which a ref name is not. Rename could borrow the save dialog
 * honestly; a tag name cannot.
 *
 * **A message makes it annotated.** That is git's rule, not a UI convention: a
 * tag with a message is a real object with a tagger and a date, and one
 * without is a pointer. The field says so rather than offering a checkbox that
 * means the same thing twice.
 */
export function TagPrompt({
  oid,
  onClose,
}: {
  readonly oid: string;
  readonly onClose: () => void;
}) {
  const repoPath = useWorkspaceStore((state) => state.repoPath);
  const createTag = useCreateTag(repoPath);

  const [name, setName] = useState('');
  const [message, setMessage] = useState('');

  const trimmed = name.trim();
  // Git's own rules are longer than this; these are the ones a person hits by
  // accident, and git rejects the rest with a message worth showing verbatim.
  const invalid =
    trimmed !== '' && (/\s/.test(trimmed) || trimmed.startsWith('-') || trimmed.includes('..'));

  const submit = () => {
    if (trimmed === '' || invalid) return;
    createTag.mutate(
      { name: trimmed, target: oid, ...(message.trim() !== '' && { message: message.trim() }) },
      {
        onSuccess: () => {
          showToast(
            `Tagged ${oid.slice(0, 7)} as ${trimmed}${message.trim() === '' ? '' : ' (annotated)'}`,
            'success',
          );
          onClose();
        },
        onError: (error) => showToast(error.message, 'error'),
      },
    );
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-label="Create tag"
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.header}>
          <Icons.Tag size={14} color="var(--accent)" />
          <span className={styles.title}>Create tag</span>
          <span className={styles.target}>at {oid.slice(0, 7)}</span>
        </header>

        <div className={styles.body}>
          <input
            className={`${styles.input} ${invalid ? styles.invalid : ''}`}
            placeholder="Tag name, e.g. v1.2.0"
            value={name}
            autoFocus
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit();
              if (event.key === 'Escape') onClose();
            }}
          />
          {invalid && (
            <div className={styles.error}>
              A tag name cannot contain spaces or `..`, or start with `-`.
            </div>
          )}
          <input
            className={styles.input}
            placeholder="Message — leave empty for a lightweight tag"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit();
              if (event.key === 'Escape') onClose();
            }}
          />
          <div className={styles.hint}>
            {message.trim() === ''
              ? 'Lightweight — a name pointing straight at the commit.'
              : 'Annotated — a tag object with your name and the date on it.'}
          </div>
        </div>

        <footer className={styles.footer}>
          <Button size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={trimmed === '' || invalid || createTag.isPending}
            onClick={submit}
          >
            Create
          </Button>
        </footer>
      </div>
    </div>
  );
}
