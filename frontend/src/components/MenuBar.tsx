import { useNavigate, useParams } from 'react-router-dom';
import { useRemotes, useStatus } from '@/queries/git';
import {
  useAbortMerge,
  useDiscard,
  useFetch,
  usePull,
  usePush,
  useStage,
  useUnstage,
} from '@/queries/mutations';
import { pushTarget } from '@/queries/pushTarget';
import { isConflicted } from '@/services/git';
import { showMessage } from '@/services/wails';
import { showToast } from '@/stores/notificationStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useFileMenuActions } from '@/features/working-tree/useFileMenuActions';
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
  readonly tone?: 'danger';
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
  const selectedPaths = useWorkspaceStore((state) => state.selectedPaths);

  /*
   * Every selected file, or the active one (PLAN.md §11, 8.17).
   *
   * Stage and Unstage have always taken an array — they were simply never
   * given more than one path. With multi-select in the Changes list they now
   * act on the whole selection, which is what a list you can ⌘A into has to
   * mean, or selecting five files and pressing Stage would stage one of them.
   */
  const selectionPaths = (): string[] =>
    selectedPaths.size > 0 ? [...selectedPaths] : selectedFile === null ? [] : [selectedFile.path];
  const toggleCommit = useWorkspaceStore((state) => state.toggleCommit);
  const openMerge = useWorkspaceStore((state) => state.openMerge);
  const openMergeWizard = useWorkspaceStore((state) => state.openMergeWizard);
  const toggleTerminal = useWorkspaceStore((state) => state.toggleTerminal);
  const setLogPath = useWorkspaceStore((state) => state.setLogPath);
  const openBlame = useWorkspaceStore((state) => state.openBlame);
  const { data: status } = useStatus(repoPath);
  const { data: remotes } = useRemotes(repoPath);

  const stage = useStage(repoPath);
  const unstage = useUnstage(repoPath);
  const discard = useDiscard(repoPath);
  const fetch = useFetch(repoPath);
  const pull = usePull(repoPath);
  const push = usePush(repoPath);
  const abortMerge = useAbortMerge(repoPath);
  const runFileAction = useFileMenuActions(repoPath);

  const entry = status?.entries.find((candidate) => candidate.path === selectedFile?.path);
  const needsSelection = () => showToast('Select a file first', 'error');
  const reportError = (error: Error) => showToast(error.message, 'error');

  /**
   * One button, two jobs, chosen by the state the repository is actually in.
   *
   * With conflicts on the floor the only useful thing to offer is the
   * resolver; offering a branch picker there would invite starting a second
   * merge on top of an unfinished one, which git refuses anyway.
   */
  const openMergeTool = () => {
    if ((status?.entries ?? []).some(isConflicted)) openMerge();
    else openMergeWizard();
  };

  /**
   * Abort whatever merge is in progress.
   *
   * No check for whether there is one: git answers that itself, and its
   * message is better than a guess of ours would be.
   */
  const doAbort = () => {
    void (async () => {
      const choice = await showMessage({
        kind: 'warning',
        title: 'Abort the merge?',
        message: 'Throw away the merge and every conflict resolution made so far?',
        buttons: ['Cancel', 'Abort'],
        defaultButton: 'Cancel',
        cancelButton: 'Cancel',
      });
      if (choice !== 'Abort') return;

      abortMerge.mutate(undefined, {
        onSuccess: () => showToast('Merge aborted', 'info'),
        onError: reportError,
      });
    })();
  };

  /**
   * Remove and Delete run the context menu's implementations rather than their
   * own.
   *
   * Both need a confirmation, both have a tracked/untracked split, and both
   * already exist a few files away — a second copy here would be a second
   * place for those rules to drift. The label doubles as the dialog's wording,
   * which is why it is passed rather than hard-coded.
   */
  const runOnSelected = (action: 'remove' | 'delete', label: string) => {
    if (entry === undefined) {
      needsSelection();
      return;
    }
    runFileAction(entry, { kind: 'item', action, label, destructive: true });
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
      // Deliberately *not* the mockup's filled gold button (L464) — see the
      // deviation note in PLAN.md §14. It opens the composer rather than
      // committing, so it is a step on the way somewhere like every other
      // button here, and the emphasis was overstating what it does.
      run: toggleCommit,
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
          : stage.mutate({ paths: selectionPaths() }, { onError: reportError }),
    },
    {
      kind: 'button',
      label: 'Index Editor',
      icon: Icons.IndexEditor,
      // Partial staging happens in the diff pane, beside the hunks. This
      // points there rather than being a second, blinder way to do it.
      run: () =>
        selectedFile === null
          ? needsSelection()
          : showToast('Pick lines, or use "Stage hunk", in the Changes pane', 'info'),
    },
    {
      kind: 'button',
      label: 'Unstage',
      icon: Icons.Unstage,
      run: () =>
        selectedFile === null
          ? needsSelection()
          : unstage.mutate({ paths: selectionPaths() }, { onError: reportError }),
    },
    { kind: 'separator' },
    {
      kind: 'button',
      label: 'Remove',
      icon: Icons.Remove,
      // Untracks the file and leaves it on disk — `git rm --cached`.
      run: () => runOnSelected('remove', 'Remove from Repository'),
    },
    {
      kind: 'button',
      label: 'Abort',
      icon: Icons.Abort,
      busy: abortMerge.isPending,
      run: doAbort,
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
      run: () => runOnSelected('delete', 'Delete from Disk'),
    },
  ];

  const rightTools: readonly MenuEntry[] = [
    {
      kind: 'button',
      label: 'Log',
      icon: Icons.Log,
      // The Journal is the log and is always on screen, so this clears the
      // file filter rather than opening a second view of the same thing.
      run: () => {
        setLogPath(null);
        showToast('Showing the full history', 'info');
      },
    },
    {
      kind: 'button',
      label: 'Blame',
      icon: Icons.Blame,
      run: () =>
        selectedFile === null
          ? needsSelection()
          : openBlame(selectedFile.path),
    },
    {
      kind: 'button',
      label: 'Terminal',
      icon: Icons.Terminal,
      // Deliberately not given the `active` treatment, even though it is a
      // toggle. PLAN.md §14 records that a highlighted button in this bar
      // means "active view" and nothing else, and the drawer sliding into the
      // bottom of the workspace is unambiguous feedback on its own.
      run: toggleTerminal,
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
  readonly tone?: 'danger';
  readonly busy?: boolean;
}) {
  return (
    <button
      type="button"
      className={`${styles.button} ${active === true ? styles.active : ''} ${
        tone === 'danger' ? styles.danger : ''
      }`}
      onClick={onClick}
      disabled={busy === true}
      title={label}
    >
      <Icon size={15} {...(busy === true && { className: styles.spin })} />
      <span>{label}</span>
    </button>
  );
}
