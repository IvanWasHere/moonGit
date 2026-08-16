import { useNavigate } from 'react-router-dom';
import { useRemotes, useStatus } from '@/queries/git';
import {
  useFetch,
  usePull,
  usePush,
  useStage,
  useUnstage,
} from '@/queries/mutations';
import { pushTarget } from '@/queries/pushTarget';
import { useOpenRepository } from '@/queries/repositories';
import { isConflicted, pullRequestsUrl, releasesUrl } from '@/services/git';
import { openExternal } from '@/services/wails';
import { showToast } from '@/stores/notificationStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useBranchActions } from '@/features/branches/useBranchActions';
import type { MenuItemId } from './menuConfig';

/**
 * Maps every application-menu item to what it does.
 *
 * **Every entry now does something real** (PLAN.md §11, 8.8–8.9). Until then
 * fourteen of them raised "arrives in Phase 6" — a message that was true when
 * written and became a lie the moment Phase 6 shipped, while several of the
 * features it apologised for already existed elsewhere in the app with no wire
 * to them. There is no `notBuilt` helper here any more, and that absence is
 * the point: adding one back is how the last set rotted.
 *
 * The map is typed `Record<MenuItemId, …>`, so adding an item to the config
 * without wiring it here does not compile.
 */
export function useMenuActions(): (id: MenuItemId) => void {
  const navigate = useNavigate();

  const repoPath = useWorkspaceStore((state) => state.repoPath);
  const selectedFile = useWorkspaceStore((state) => state.selectedFile);
  const openCommit = useWorkspaceStore((state) => state.openCommit);
  const openSettings = useWorkspaceStore((state) => state.openSettings);
  const openMerge = useWorkspaceStore((state) => state.openMerge);
  const openMergeWizard = useWorkspaceStore((state) => state.openMergeWizard);
  const openStash = useWorkspaceStore((state) => state.openStash);
  const openRebaseWizard = useWorkspaceStore((state) => state.openRebaseWizard);
  const toggleTerminal = useWorkspaceStore((state) => state.toggleTerminal);
  const openRepoSettings = useWorkspaceStore((state) => state.openRepoSettings);
  const setLogPath = useWorkspaceStore((state) => state.setLogPath);
  const toggleLogSearch = useWorkspaceStore((state) => state.toggleLogSearch);
  const selectFile = useWorkspaceStore((state) => state.selectFile);
  const openBlame = useWorkspaceStore((state) => state.openBlame);
  const openReset = useWorkspaceStore((state) => state.openReset);
  const openLicense = useWorkspaceStore((state) => state.openLicense);
  const openClone = useWorkspaceStore((state) => state.openClone);
  const selectedCommit = useWorkspaceStore((state) => state.selectedCommit);

  const { data: status } = useStatus(repoPath);
  const { data: remotes } = useRemotes(repoPath);

  const openRepository = useOpenRepository();
  const stage = useStage(repoPath);
  const unstage = useUnstage(repoPath);
  const fetch = useFetch(repoPath);
  const pull = usePull(repoPath);
  const push = usePush(repoPath);
  const branch = useBranchActions();

  const reportError = (error: Error) => showToast(error.message, 'error');
  const needsFile = () => showToast('Select a file first', 'error');

  /** Conflicts on the floor mean the resolver; otherwise the branch picker. */
  const openMergeTool = () => {
    if ((status?.entries ?? []).some(isConflicted)) openMerge();
    else openMergeWizard();
  };

  const doPush = () => {
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
  };

  /*
   * Open something about this repository on the web.
   *
   * moonGit has no host integration and is not getting one; what these items
   * can honestly do is take you there. `remoteWeb` returns null when the
   * remote is a local path or an unknown scheme, and this says so rather than
   * opening a browser on a URL it invented.
   */
  const openForRemote = (build: (url: string) => string | null, what: string) => () => {
    const origin = remotes?.find((r) => r.name === 'origin') ?? remotes?.[0];
    if (origin === undefined) return showToast('No remote configured', 'error');
    const url = build(origin.url);
    if (url === null) return showToast(`This remote has no web page to open`, 'error');
    void openExternal(url).catch(() => showToast(`Could not open ${what}`, 'error'));
  };

  const doFetch = () =>
    fetch.mutate(
      { prune: true },
      { onSuccess: () => showToast('Fetched and pruned', 'success'), onError: reportError },
    );

  const doPull = () =>
    pull.mutate(undefined, {
      onSuccess: () => showToast('Pulled from remote', 'success'),
      onError: reportError,
    });

  // `Record<MenuItemId, …>`: a missing entry is a type error, not dead UI.
  const handlers: Record<MenuItemId, () => void> = {
    // --- Repository -------------------------------------------------------
    'repository.clone': openClone,
    'repository.open': () => openRepository.mutate(),
    // Returns to the dashboard for the rest of this session. The remembered
    // repository is deliberately *not* cleared: closing a view is not the same
    // as forgetting which repository you work in, and the next launch should
    // still open it.
    'repository.close': () => void navigate('/'),
    'repository.pull': doPull,
    'repository.push': doPush,
    'repository.fetch': doFetch,
    // Synchronize is fetch-then-pull; the pull is what reconciles.
    'repository.synchronize': () =>
      fetch.mutate({ prune: true }, { onSuccess: doPull, onError: reportError }),
    'repository.terminal': toggleTerminal,
    'repository.settings': () => openRepoSettings('general'),
    'repository.preferences': openSettings,
    'repository.exit': () => showToast('Close the window to exit', 'info'),

    // --- Local ------------------------------------------------------------
    'local.commit': openCommit,
    'local.stage': () =>
      selectedFile === null
        ? needsFile()
        : stage.mutate({ paths: [selectedFile.path] }, { onError: reportError }),
    'local.unstage': () =>
      selectedFile === null
        ? needsFile()
        : unstage.mutate({ paths: [selectedFile.path] }, { onError: reportError }),
    // Both open the stack, which is where stashing and restoring both live.
    // The previous `local.stash` called the service directly and never
    // invalidated, so a successful stash left the panels showing the changes
    // it had just taken away.
    'local.stash': openStash,
    'local.shelve': openStash,
    // The panel's Ignore tab, not a per-file action: the menubar has no file
    // in hand the way the Files panel's context menu does, and "Ignore" with
    // nothing selected can only sensibly mean "show me the rules".
    'local.ignore': () => openRepoSettings('ignore'),

    // --- Branch -----------------------------------------------------------
    'branch.checkout': branch.checkout,
    'branch.create': () => void branch.create(),
    'branch.rename': () => void branch.rename(),
    'branch.merge': openMergeTool,
    'branch.rebase': openRebaseWizard,
    // Cherry-picking needs a commit, and the Journal's context menu is where
    // one is in front of you. This points there rather than being a blinder
    // second route to the same operation.
    'branch.cherryPick': () =>
      showToast('Right-click a commit in the Journal to cherry-pick it', 'info'),
    // Resets onto the commit selected in the Journal, which is the only place
    // in the app where a commit is in front of you — the same reasoning as
    // cherry-pick above.
    'branch.reset': () =>
      selectedCommit === null
        ? showToast('Select a commit in the Journal to reset onto', 'error')
        : openReset(selectedCommit),
    'branch.delete': () => void branch.remove(),

    // --- Remote -----------------------------------------------------------
    'remote.fetch': doFetch,
    'remote.pull': doPull,
    'remote.push': doPush,
    'remote.manage': () => openRepoSettings('remotes'),
    'remote.pullRequests': openForRemote(pullRequestsUrl, 'pull requests'),

    // --- Query ------------------------------------------------------------
    // The Journal *is* the log. This clears any file filter and search so the
    // panel shows the whole history, which is what "Log" can usefully mean in
    // an app where the log is always on screen.
    'query.log': () => {
      setLogPath(null);
      showToast('Showing the full history', 'info');
    },
    // History filtered to the selected file — the Journal's own file filter,
    // reached from the menu instead of the file's context menu.
    'query.fileHistory': () =>
      selectedFile === null ? needsFile() : setLogPath(selectedFile.path),
    'query.blame': () =>
      selectedFile === null ? needsFile() : openBlame(selectedFile.path),
    // "Show changes" means the diff for the selected file, which is what
    // selecting it in the Changes pane already does.
    'query.showChanges': () =>
      selectedFile === null
        ? needsFile()
        : selectFile({ path: selectedFile.path, side: selectedFile.side }),
    'query.search': toggleLogSearch,

    // --- Help -------------------------------------------------------------
    // `openExternal` rejects anything that is not http/https/mailto.
    'help.documentation': () => {
      void openExternal('https://github.com/IvanWasHere/moonGit').catch(() =>
        showToast('Could not open the browser', 'error'),
      );
    },
    'help.whatsNew': openForRemote(releasesUrl, 'the releases page'),
    'help.license': openLicense,
    'help.about': () => showToast('moonGit 0.1.0 — a native macOS Git client', 'info'),
  };

  return (id: MenuItemId) => handlers[id]();
}
