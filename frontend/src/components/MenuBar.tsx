import { useNavigate, useParams } from 'react-router-dom';
import { useRemotes, useStatus } from '@/queries/git';
import { useDiscard, useFetch, usePull, usePush, useStage, useUnstage } from '@/queries/mutations';
import { pushTarget } from '@/queries/pushTarget';
import { isConflicted } from '@/services/git';
import { showMessage } from '@/services/wails';
import { showToast } from '@/stores/notificationStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { fileName } from '@/utils/format';
import { Icons, type LucideIcon } from './icons';
import styles from './MenuBar.module.css';

/**
 * The 60px icon menubar (ui-example L454–504), now driving real git.
 *
 * The mockup's handlers all called `showToast`; these call services and report
 * what actually happened. Two behaviours are deliberate:
 *
 * - **Destructive actions confirm first.** Discard has no reflog to recover
 *   from, so it goes through a native dialog naming the file. The confirm
 *   lives here rather than in the service, because a service that opens
 *   dialogs cannot be tested or scripted.
 * - **Push always reports.** It is the only action that changes something
 *   other people can see, so its result — including "Everything up-to-date" —
 *   is never silent.
 *
 * Buttons whose features land in Phase 6 say so rather than pretending to work.
 */

interface MenuAction {
  readonly kind: 'button';
  readonly label: string;
  readonly icon: LucideIcon;
  readonly tone?: 'danger' | 'primary';
  readonly run: () => void;
  readonly busy?: boolean;
}

type MenuEntry = { readonly kind: 'separator' } | MenuAction;

export function MenuBar({
  view,
  selectedFileName: _selectedFileName,
}: {
  readonly view: 'main' | 'review';
  readonly selectedFileName: string | null;
}) {
  const navigate = useNavigate();
  const { repoId } = useParams();

  const repoPath = useWorkspaceStore((state) => state.repoPath);
  const selectedFile = useWorkspaceStore((state) => state.selectedFile);
  const toggleCommit = useWorkspaceStore((state) => state.toggleCommit);
  const openMerge = useWorkspaceStore((state) => state.openMerge);
  const { data: status } = useStatus(repoPath);
  const { data: remotes } = useRemotes(repoPath);

  const stage = useStage(repoPath);
  const unstage = useUnstage(repoPath);
  const discard = useDiscard(repoPath);
  const fetch = useFetch(repoPath);
  const pull = usePull(repoPath);
  const push = usePush(repoPath);

  const entry = status?.entries.find((candidate) => candidate.path === selectedFile?.path);
  const needsSelection = () => showToast('Select a file first', 'error');
  const reportError = (error: Error) => showToast(error.message, 'error');

  /**
   * The Merge button resolves conflicts; it does not start a merge.
   *
   * Starting one needs a branch picker, which is the other half of §9.3 and is
   * not built. Saying so beats opening an empty resolver and letting the user
   * conclude the tool is broken.
   */
  const openMergeTool = () => {
    const conflicts = (status?.entries ?? []).filter(isConflicted);
    if (conflicts.length === 0) {
      showToast('No conflicts to resolve — starting a merge arrives with the wizard', 'info');
      return;
    }
    openMerge();
  };

  const doDiscard = () => {
    if (selectedFile === null || entry === undefined) {
      needsSelection();
      return;
    }

    void (async () => {
      const choice = await showMessage({
        kind: 'warning',
        title: 'Discard changes?',
        message: `Discard all changes to ${fileName(selectedFile.path)}? This cannot be undone.`,
        buttons: ['Cancel', 'Discard'],
        defaultButton: 'Cancel',
        cancelButton: 'Cancel',
      });
      if (choice !== 'Discard') return;

      discard.mutate(
        { targets: [{ path: entry.path, untracked: entry.kind === 'untracked' }] },
        {
          onSuccess: () => showToast(`Discarded changes: ${fileName(entry.path)}`, 'info'),
          onError: reportError,
        },
      );
    })();
  };

  const left: readonly MenuEntry[] = [
    {
      kind: 'button',
      label: 'Pull',
      icon: Icons.Pull,
      busy: pull.isPending,
      run: () =>
        pull.mutate(undefined, {
          onSuccess: () => showToast('Pulled from remote', 'success'),
          // `--ff-only` refuses a diverged branch, and saying so is exactly
          // the information the user needs to choose merge or rebase.
          onError: reportError,
        }),
    },
    {
      kind: 'button',
      label: 'Sync',
      icon: Icons.Sync,
      busy: fetch.isPending,
      run: () =>
        fetch.mutate(
          { prune: true },
          { onSuccess: () => showToast('Fetched and pruned', 'success'), onError: reportError },
        ),
    },
    {
      kind: 'button',
      label: 'Push',
      icon: Icons.Push,
      busy: push.isPending,
      run: () => {
        const resolved = pushTarget(status, remotes ?? []);
        if (!resolved.ok) {
          showToast(
            resolved.problem === 'detached'
              ? 'HEAD is detached — check out a branch to push'
              : 'No remote configured for this repository',
            'error',
          );
          return;
        }
        push.mutate(resolved.target, {
          onSuccess: (outcome) =>
            showToast(
              outcome.upToDate
                ? 'Everything up-to-date'
                : `Pushed ${resolved.target.branch} → ${resolved.target.remote}`,
              outcome.upToDate ? 'info' : 'success',
            ),
          onError: reportError,
        });
      },
    },
    { kind: 'separator' },
    {
      kind: 'button',
      label: 'Commit',
      icon: Icons.Commit,
      // The mockup's one filled button (L464). It now opens the composer
      // rather than committing directly — the message has to be written first.
      tone: 'primary',
      run: toggleCommit,
    },
    {
      kind: 'button',
      label: 'Git-flow',
      icon: Icons.GitFlow,
      run: () => showToast('Git-flow arrives in Phase 6', 'info'),
    },
    {
      kind: 'button',
      label: 'Merge',
      icon: Icons.Merge,
      run: openMergeTool,
    },
  ];

  const center: readonly MenuEntry[] = [
    {
      kind: 'button',
      label: 'Stage',
      icon: Icons.Stage,
      run: () =>
        selectedFile === null
          ? needsSelection()
          : stage.mutate({ paths: [selectedFile.path] }, { onError: reportError }),
    },
    {
      kind: 'button',
      label: 'Index Editor',
      icon: Icons.IndexEditor,
      run: () => showToast('Index editor arrives in Phase 6', 'info'),
    },
    {
      kind: 'button',
      label: 'Unstage',
      icon: Icons.Unstage,
      run: () =>
        selectedFile === null
          ? needsSelection()
          : unstage.mutate({ paths: [selectedFile.path] }, { onError: reportError }),
    },
    { kind: 'separator' },
    {
      kind: 'button',
      label: 'Remove',
      icon: Icons.Remove,
      run: () => showToast('Remove arrives in Phase 6', 'info'),
    },
    {
      kind: 'button',
      label: 'Abort',
      icon: Icons.Abort,
      run: () => showToast('Abort arrives with the conflict UI in Phase 6', 'info'),
    },
    {
      kind: 'button',
      label: 'Discard',
      icon: Icons.Discard,
      tone: 'danger',
      busy: discard.isPending,
      run: doDiscard,
    },
    {
      kind: 'button',
      label: 'Delete',
      icon: Icons.Delete,
      tone: 'danger',
      run: () => showToast('Delete arrives in Phase 6', 'info'),
    },
  ];

  const rightTools: readonly MenuEntry[] = [
    {
      kind: 'button',
      label: 'Log',
      icon: Icons.Log,
      run: () => showToast('Log view arrives in Phase 6', 'info'),
    },
    {
      kind: 'button',
      label: 'Blame',
      icon: Icons.Blame,
      run: () => showToast('Blame view arrives in Phase 6', 'info'),
    },
    {
      kind: 'button',
      label: 'Investigate',
      icon: Icons.Investigate,
      run: () => showToast('Investigate arrives in Phase 6', 'info'),
    },
  ];

  const render = (entries: readonly MenuEntry[]) =>
    entries.map((item, index) =>
      item.kind === 'separator' ? (
        <div key={`sep-${index}`} className={styles.separator} />
      ) : (
        <MenuButton
          key={item.label}
          label={item.label}
          icon={item.icon}
          {...(item.tone !== undefined && { tone: item.tone })}
          {...(item.busy !== undefined && { busy: item.busy })}
          onClick={item.run}
        />
      ),
    );

  return (
    <div className={styles.menubar}>
      <div className={`${styles.section} ${styles.left}`}>{render(left)}</div>
      <div className={`${styles.section} ${styles.center}`}>{render(center)}</div>
      <div className={`${styles.section} ${styles.right}`}>
        {render(rightTools)}
        <div className={styles.separator} />
        <MenuButton
          label="Main View"
          icon={Icons.MainView}
          active={view === 'main'}
          onClick={() => void navigate(`/repo/${repoId ?? ''}/main`)}
        />
        <MenuButton
          label="Review View"
          icon={Icons.ReviewView}
          active={view === 'review'}
          onClick={() => void navigate(`/repo/${repoId ?? ''}/review`)}
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
  busy,
}: {
  readonly label: string;
  readonly icon: LucideIcon;
  readonly onClick: () => void;
  readonly active?: boolean;
  readonly tone?: 'danger' | 'primary';
  readonly busy?: boolean;
}) {
  return (
    <button
      type="button"
      className={`${styles.button} ${active === true ? styles.active : ''} ${
        tone === 'danger' ? styles.danger : ''
      } ${tone === 'primary' ? styles.primary : ''}`}
      onClick={onClick}
      disabled={busy === true}
      title={label}
    >
      <Icon size={15} {...(busy === true && { className: styles.spin })} />
      <span>{label}</span>
    </button>
  );
}
