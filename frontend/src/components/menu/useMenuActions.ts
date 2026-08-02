import { useNavigate } from 'react-router-dom';
import { useRemotes, useStatus } from '@/queries/git';
import { useFetch, usePull, usePush, useStage, useUnstage } from '@/queries/mutations';
import { pushTarget } from '@/queries/pushTarget';
import { useOpenRepository } from '@/queries/repositories';
import { isConflicted } from '@/services/git';
import { openExternal } from '@/services/wails';
import { showToast } from '@/stores/notificationStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { MenuItemId } from './menuConfig';

/**
 * Maps every application-menu item to what it does.
 *
 * Items whose feature has not been built yet say so by name rather than doing
 * nothing — a menu item that silently no-ops is indistinguishable from a bug,
 * and there are enough of them here that the difference matters.
 *
 * The map is typed `Record<MenuItemId, …>`, so adding an item to the config
 * without wiring it here does not compile.
 */
export function useMenuActions(): (id: MenuItemId) => void {
  const navigate = useNavigate();

  const repoPath = useWorkspaceStore((state) => state.repoPath);
  const selectedFile = useWorkspaceStore((state) => state.selectedFile);
  const openCommit = useWorkspaceStore((state) => state.openCommit);
  const openMerge = useWorkspaceStore((state) => state.openMerge);
  const openMergeWizard = useWorkspaceStore((state) => state.openMergeWizard);
  const openStash = useWorkspaceStore((state) => state.openStash);

  const { data: status } = useStatus(repoPath);
  const { data: remotes } = useRemotes(repoPath);

  const openRepository = useOpenRepository();
  const stage = useStage(repoPath);
  const unstage = useUnstage(repoPath);
  const fetch = useFetch(repoPath);
  const pull = usePull(repoPath);
  const push = usePush(repoPath);

  const soon = (feature: string) => () => showToast(`${feature} arrives in Phase 6`, 'info');
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
    'repository.clone': soon('Clone'),
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
    'repository.settings': soon('Repository settings'),
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
    'local.ignore': soon('Ignore'),

    // --- Branch -----------------------------------------------------------
    'branch.checkout': soon('Branch checkout'),
    'branch.create': soon('Branch create'),
    'branch.rename': soon('Branch rename'),
    'branch.merge': openMergeTool,
    'branch.rebase': soon('Rebase'),
    // Cherry-picking needs a commit, and the Journal's context menu is where
    // one is in front of you. This points there rather than being a blinder
    // second route to the same operation.
    'branch.cherryPick': () =>
      showToast('Right-click a commit in the Journal to cherry-pick it', 'info'),
    'branch.reset': soon('Reset'),
    'branch.delete': soon('Branch delete'),

    // --- Remote -----------------------------------------------------------
    'remote.fetch': doFetch,
    'remote.pull': doPull,
    'remote.push': doPush,
    'remote.manage': soon('Remote management'),
    'remote.pullRequests': soon('Pull requests'),

    // --- Query ------------------------------------------------------------
    'query.log': soon('Log view'),
    'query.fileHistory': soon('File history'),
    'query.blame': soon('Blame view'),
    'query.showChanges': soon('Show changes'),
    'query.search': soon('Search'),

    // --- Help -------------------------------------------------------------
    // `openExternal` rejects anything that is not http/https/mailto.
    'help.documentation': () => {
      void openExternal('https://github.com/IvanWasHere/moonGit').catch(() =>
        showToast('Could not open the browser', 'error'),
      );
    },
    'help.whatsNew': soon("What's new"),
    'help.checkForUpdates': soon('Update checks'),
    'help.license': soon('License'),
    'help.about': () => showToast('moonGit 0.1.0 — a native macOS Git client', 'info'),
  };

  return (id: MenuItemId) => handlers[id]();
}
