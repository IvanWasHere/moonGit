import { useEffect, useRef, type ReactNode } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { EmptyState } from '@/components/EmptyState';
import { Icons } from '@/components/icons';
import { MenuBar } from '@/components/MenuBar';
import { TopMenu } from '@/components/menu/TopMenu';
import { useMenuActions } from '@/components/menu/useMenuActions';
import { useNativeMenu } from '@/components/menu/useNativeMenu';
import { ToastContainer } from '@/components/ToastContainer';
import { QuickOpen } from '@/features/explorer/QuickOpen';
import { SettingsModal } from '@/features/settings/SettingsModal';
import { MergeModal } from '@/features/merge/MergeModal';
import { MergeWizard } from '@/features/merge/MergeWizard';
import { RebaseBanner } from '@/features/rebase/RebaseBanner';
import { RebaseWizard } from '@/features/rebase/RebaseWizard';
import { RepoSettingsModal } from '@/features/repo-settings/RepoSettingsModal';
import { StashModal } from '@/features/stash/StashModal';
import { TagPrompt } from '@/features/tags/TagPrompt';
import { TerminalDrawer } from '@/features/terminal/TerminalDrawer';
import { useRepository } from '@/queries/repositories';
import { useRepoWatcher } from '@/queries/useRepoWatcher';
import { useLayoutPersistence } from '@/stores/layoutPersistence';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { fileName } from '@/utils/format';
import styles from './Workspace.module.css';

/**
 * The application shell: menubar, the active view, and the toast stack
 * (ui-example L790–803).
 *
 * The repository comes from the route, so a reload lands back where the user
 * was and the two views share one open repository. Resolving the id to a path
 * is what connects the SQLite inventory to every git command underneath.
 */
export function Workspace({
  view,
  children,
}: {
  readonly view: 'main' | 'review';
  readonly children: ReactNode;
}) {
  // The terminal drawer's resizer measures against the whole shell, since the
  // drawer's height is a share of the window rather than of a pane.
  const appRef = useRef<HTMLDivElement>(null);

  const { repoId: repoIdParam } = useParams();
  const repoId = repoIdParam === undefined ? null : Number.parseInt(repoIdParam, 10);
  const valid = repoId !== null && !Number.isNaN(repoId);

  const { data: repository, isPending } = useRepository(valid ? repoId : null);
  const repoPath = useWorkspaceStore((state) => state.repoPath);
  const selectedFile = useWorkspaceStore((state) => state.selectedFile);
  const mergeOpen = useWorkspaceStore((state) => state.mergeOpen);
  const closeMerge = useWorkspaceStore((state) => state.closeMerge);
  const mergeWizardOpen = useWorkspaceStore((state) => state.mergeWizardOpen);
  const closeMergeWizard = useWorkspaceStore((state) => state.closeMergeWizard);
  const stashOpen = useWorkspaceStore((state) => state.stashOpen);
  const closeStash = useWorkspaceStore((state) => state.closeStash);
  const rebaseWizardOpen = useWorkspaceStore((state) => state.rebaseWizardOpen);
  const closeRebaseWizard = useWorkspaceStore((state) => state.closeRebaseWizard);
  const tagPromptOid = useWorkspaceStore((state) => state.tagPromptOid);
  const closeTagPrompt = useWorkspaceStore((state) => state.closeTagPrompt);
  const openRepo = useWorkspaceStore((state) => state.openRepo);
  const openQuickOpen = useWorkspaceStore((state) => state.openQuickOpen);
  const quickOpen = useWorkspaceStore((state) => state.quickOpen);
  const settingsOpen = useWorkspaceStore((state) => state.settingsOpen);
  const openSettings = useWorkspaceStore((state) => state.openSettings);
  const closeSettings = useWorkspaceStore((state) => state.closeSettings);
  const repoSettingsTab = useWorkspaceStore((state) => state.repoSettingsTab);
  const closeRepoSettings = useWorkspaceStore((state) => state.closeRepoSettings);
  const terminalOpen = useWorkspaceStore((state) => state.terminalOpen);
  const toggleTerminal = useWorkspaceStore((state) => state.toggleTerminal);

  useEffect(() => {
    if (repository === null || repository === undefined) return;
    openRepo(repository.id, repository.path);
  }, [repository, openRepo]);

  /*
   * ⌘P opens quick open, ⌘, opens settings, ⌃` toggles the terminal — all
   * three the platform conventions.
   *
   * On `window` rather than a focused element, because the whole point is to
   * reach them from wherever the user is, including a filter box or the commit
   * message. `preventDefault` because the browser binds Print to the same
   * chord as ⌘P, and firing both puts a print dialog over the app.
   *
   * The terminal is ⌃`, not ⌘`: macOS gives ⌘` to "cycle through windows" at
   * the system level, so binding it would fight the OS and lose.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey && !event.ctrlKey) return;
      if (event.key.toLowerCase() === 'p') {
        event.preventDefault();
        openQuickOpen();
      }
      if (event.key === ',') {
        event.preventDefault();
        openSettings();
      }
      if (event.key === '`' && event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        toggleTerminal();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openQuickOpen, openSettings, toggleTerminal]);

  useLayoutPersistence();
  useRepoWatcher(repoPath);
  const onMenuAction = useMenuActions();
  // The same actions, reachable from the macOS menu bar as well as the bar in
  // the window. Called before the early return below so the hook order holds.
  useNativeMenu(onMenuAction);

  // A route pointing at a repository that has been forgotten — or a hand-typed
  // id — goes back to the dashboard rather than rendering empty panels.
  if (!valid || (!isPending && (repository === null || repository === undefined))) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className={styles.app} ref={appRef}>
      <TopMenu onAction={onMenuAction} />
      <MenuBar
        view={view}
        selectedFileName={selectedFile === null ? null : fileName(selectedFile.path)}
      />
      <RebaseBanner />
      {isPending ? (
        <div className={styles.loading}>
          <EmptyState icon={Icons.Sync} message="Opening repository…" />
        </div>
      ) : (
        children
      )}
      {/* Inside the flex column and after the view, so it takes height from
          the panels above rather than floating over them. */}
      {terminalOpen && <TerminalDrawer containerRef={appRef} />}
      {mergeOpen && <MergeModal onClose={closeMerge} />}
      {mergeWizardOpen && <MergeWizard onClose={closeMergeWizard} />}
      {stashOpen && <StashModal onClose={closeStash} />}
      {rebaseWizardOpen && <RebaseWizard onClose={closeRebaseWizard} />}
      {tagPromptOid !== null && <TagPrompt oid={tagPromptOid} onClose={closeTagPrompt} />}
      {quickOpen && <QuickOpen />}
      {settingsOpen && <SettingsModal onClose={closeSettings} />}
      {repoSettingsTab !== null && (
        <RepoSettingsModal tab={repoSettingsTab} onClose={closeRepoSettings} />
      )}
      <ToastContainer />
    </div>
  );
}
