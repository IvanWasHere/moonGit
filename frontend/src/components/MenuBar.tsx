import { useNavigate, useParams } from 'react-router-dom';
import { showToast } from '@/stores/notificationStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { Icons, type LucideIcon } from './icons';
import styles from './MenuBar.module.css';

/**
 * The 60px icon menubar (ui-example L454–504).
 *
 * Driven by a config array rather than sixty lines of inline handlers, so the
 * three sections and their separators are data. The mockup's handlers all
 * called `showToast` directly; here each `run` is a place a service call will
 * go in Phase 5 (PLAN.md §7) — the toasts are placeholders, and deliberately
 * keep the mockup's wording so the two can be compared.
 */

type MenuEntry =
  | { readonly kind: 'separator' }
  | {
      readonly kind: 'button';
      readonly label: string;
      readonly icon: LucideIcon;
      readonly tone?: 'danger' | 'primary';
      readonly run: (context: MenuContext) => void;
    };

interface MenuContext {
  readonly selectedFileName: string | null;
  readonly commitMessage: string;
  readonly clearCommitMessage: () => void;
}

const LEFT: readonly MenuEntry[] = [
  {
    kind: 'button',
    label: 'Pull',
    icon: Icons.Pull,
    run: () => showToast('Pulling latest changes...', 'info'),
  },
  {
    kind: 'button',
    label: 'Sync',
    icon: Icons.Sync,
    run: () => showToast('Syncing with remote...', 'info'),
  },
  {
    kind: 'button',
    label: 'Push',
    icon: Icons.Push,
    run: () => showToast('Pushed 3 commits to origin', 'success'),
  },
  { kind: 'separator' },
  {
    kind: 'button',
    label: 'Git-flow',
    icon: Icons.GitFlow,
    run: () => showToast('Git-flow: select an action', 'info'),
  },
  {
    kind: 'button',
    label: 'Merge',
    icon: Icons.Merge,
    run: () => showToast('Merge branch into current', 'info'),
  },
  {
    kind: 'button',
    label: 'Commit',
    icon: Icons.Commit,
    // The mockup gives this one button `btn-primary` as well as `menu-btn`
    // (L464), making Commit the only filled control in the bar.
    tone: 'primary',
    run: ({ commitMessage, clearCommitMessage }) => {
      if (commitMessage.trim() === '') {
        showToast('Please enter a commit message', 'error');
        return;
      }
      showToast(`Commit created: ${commitMessage.slice(0, 40)}...`, 'success');
      clearCommitMessage();
    },
  },
];

const CENTER: readonly MenuEntry[] = [
  {
    kind: 'button',
    label: 'Stage',
    icon: Icons.Stage,
    run: ({ selectedFileName }) =>
      selectedFileName === null
        ? showToast('Select a file to stage', 'error')
        : showToast(`Staged: ${selectedFileName}`, 'success'),
  },
  {
    kind: 'button',
    label: 'Index Editor',
    icon: Icons.IndexEditor,
    run: () => showToast('Index editor opened', 'info'),
  },
  {
    kind: 'button',
    label: 'Unstage',
    icon: Icons.Unstage,
    run: ({ selectedFileName }) =>
      selectedFileName === null
        ? showToast('Select a file to unstage', 'error')
        : showToast(`Unstaged: ${selectedFileName}`, 'info'),
  },
  { kind: 'separator' },
  {
    kind: 'button',
    label: 'Remove',
    icon: Icons.Remove,
    run: () => showToast('File removed from index', 'info'),
  },
  {
    kind: 'button',
    label: 'Abort',
    icon: Icons.Abort,
    run: () => showToast('Operation aborted', 'error'),
  },
  {
    kind: 'button',
    label: 'Discard',
    icon: Icons.Discard,
    tone: 'danger',
    run: ({ selectedFileName }) =>
      selectedFileName === null
        ? showToast('Select changes to discard', 'error')
        : showToast(`Discarded changes: ${selectedFileName}`, 'error'),
  },
  {
    kind: 'button',
    label: 'Delete',
    icon: Icons.Delete,
    tone: 'danger',
    run: ({ selectedFileName }) =>
      selectedFileName === null
        ? showToast('Select a file to delete', 'error')
        : showToast('File deleted', 'error'),
  },
];

const RIGHT_TOOLS: readonly MenuEntry[] = [
  {
    kind: 'button',
    label: 'Log',
    icon: Icons.Log,
    run: () => showToast('Log view loaded', 'info'),
  },
  {
    kind: 'button',
    label: 'Blame',
    icon: Icons.Blame,
    run: () => showToast('Blame annotations loaded', 'info'),
  },
  {
    kind: 'button',
    label: 'Investigate',
    icon: Icons.Investigate,
    run: () => showToast('Investigate mode active', 'info'),
  },
];

export function MenuBar({
  view,
  selectedFileName,
}: {
  readonly view: 'main' | 'review';
  readonly selectedFileName: string | null;
}) {
  const navigate = useNavigate();
  const { repoId } = useParams();
  const commitMessage = useWorkspaceStore((state) => state.commitMessage);
  const setCommitMessage = useWorkspaceStore((state) => state.setCommitMessage);

  const context: MenuContext = {
    selectedFileName,
    commitMessage,
    clearCommitMessage: () => setCommitMessage(''),
  };

  const render = (entries: readonly MenuEntry[]) =>
    entries.map((entry, index) =>
      entry.kind === 'separator' ? (
        <div key={`sep-${index}`} className={styles.separator} />
      ) : (
        <MenuButton
          key={entry.label}
          label={entry.label}
          icon={entry.icon}
          {...(entry.tone !== undefined && { tone: entry.tone })}
          onClick={() => entry.run(context)}
        />
      ),
    );

  return (
    <div className={styles.menubar}>
      <div className={`${styles.section} ${styles.left}`}>{render(LEFT)}</div>
      <div className={`${styles.section} ${styles.center}`}>{render(CENTER)}</div>
      <div className={`${styles.section} ${styles.right}`}>
        {render(RIGHT_TOOLS)}
        <div className={styles.separator} />
        {/* The mockup toggled `state.view`; the port routes, so the two views
            are addressable and reloadable (PLAN.md §1.4). */}
        <MenuButton
          label="Main View"
          icon={Icons.MainView}
          active={view === 'main'}
          onClick={() => void navigate(`/repo/${repoId ?? '1'}/main`)}
        />
        <MenuButton
          label="Review View"
          icon={Icons.ReviewView}
          active={view === 'review'}
          onClick={() => void navigate(`/repo/${repoId ?? '1'}/review`)}
        />
      </div>
    </div>
  );
}

function MenuButton({
  label,
  icon: Icon,
  onClick,
  active,
  tone,
}: {
  readonly label: string;
  readonly icon: LucideIcon;
  readonly onClick: () => void;
  readonly active?: boolean;
  readonly tone?: 'danger' | 'primary';
}) {
  return (
    <button
      type="button"
      className={`${styles.button} ${active === true ? styles.active : ''} ${tone === 'danger' ? styles.danger : ''} ${tone === 'primary' ? styles.primary : ''}`}
      onClick={onClick}
      title={label}
    >
      <Icon size={15} />
      <span>{label}</span>
    </button>
  );
}
