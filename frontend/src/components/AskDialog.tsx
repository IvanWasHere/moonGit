import { useEffect, useState } from 'react';
import { Button } from '@/components/Button';
import { useDialog } from '@/components/useDialog';
import { useAskStore } from '@/stores/askStore';
import styles from './AskDialog.module.css';

/**
 * Renders whatever `askText` / `askConfirm` currently want (PLAN.md §11, 8.11).
 *
 * Mounted once, in `Workspace`, beside the other overlays. One host rather than
 * a dialog per caller: the callers are ordinary async functions in hooks, and
 * hooks cannot render.
 *
 * Escape and the backdrop both cancel, which resolves the waiting promise as
 * `null`/`false` rather than leaving it hanging — a dismissed dialog whose
 * promise never settles is an `await` that blocks forever with nothing on
 * screen to explain why.
 */
export function AskDialog() {
  const pending = useAskStore((state) => state.pending);
  const settle = useAskStore((state) => state.settle);

  if (pending === null) return null;
  // Keyed on the message so a second request re-mounts rather than reusing the
  // first one's draft text.
  return <AskBody key={pending.message} request={pending} settle={settle} />;
}

function AskBody({
  request,
  settle,
}: {
  readonly request: NonNullable<ReturnType<typeof useAskStore.getState>['pending']>;
  readonly settle: (value: string | boolean | null) => void;
}) {
  const [draft, setDraft] = useState(request.kind === 'text' ? request.initial : '');
  const cancel = () => settle(request.kind === 'text' ? null : false);
  const dialog = useDialog(request.message, cancel);

  // Select the whole default, so typing replaces it and editing still works —
  // this is what a rename dialog prefilled with the current name needs.
  const [input, setInput] = useState<HTMLInputElement | null>(null);
  useEffect(() => {
    input?.select();
  }, [input]);

  const accept = () => {
    if (request.kind === 'text') {
      const value = draft.trim();
      if (value === '') return;
      settle(value);
    } else {
      settle(true);
    }
  };

  return (
    <div className={styles.backdrop} onClick={cancel}>
      <div className={styles.modal} {...dialog} onClick={(event) => event.stopPropagation()}>
        <p className={styles.message}>{request.message}</p>

        {request.kind === 'text' && (
          <input
            ref={setInput}
            className={styles.input}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') accept();
            }}
            autoFocus
          />
        )}

        <div className={styles.actions}>
          <Button onClick={cancel}>Cancel</Button>
          <Button
            variant={request.kind === 'confirm' && request.destructive ? 'danger' : 'primary'}
            onClick={accept}
            disabled={request.kind === 'text' && draft.trim() === ''}
          >
            {request.confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
