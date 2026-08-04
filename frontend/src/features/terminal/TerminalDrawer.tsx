import { lazy, Suspense, useState, type RefObject } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { Icons } from '@/components/icons';
import { PanelAction, PanelHeader } from '@/components/Panel';
import { Resizer } from '@/components/Resizer';
import {
  TERMINAL_MAX_H,
  TERMINAL_MIN_H,
  useWorkspaceStore,
} from '@/stores/workspaceStore';
import { fileName } from '@/utils/format';
import styles from './Terminal.module.css';

/**
 * The terminal drawer across the bottom of the workspace.
 *
 * A drawer rather than a modal — the only departure from how Stash, Merge and
 * Rebase are presented, and the reason to embed a shell at all: `git rebase
 * --continue` is run *while* reading the file list, and a sheet over the
 * workspace would cover the thing the command is about.
 *
 * `TerminalPanel` is loaded on first open. xterm.js and its fit addon are a
 * quarter of a megabyte, and PLAN.md §10 names them specifically as something
 * the main bundle should not carry for a drawer most sessions never open.
 */
const TerminalPanel = lazy(async () => ({
  default: (await import('./TerminalPanel')).TerminalPanel,
}));

export function TerminalDrawer({
  containerRef,
}: {
  /** The workspace shell, which the resize percentage is measured against. */
  readonly containerRef: RefObject<HTMLElement | null>;
}) {
  const repoPath = useWorkspaceStore((state) => state.repoPath);
  const height = useWorkspaceStore((state) => state.terminalH);
  const setTerminalH = useWorkspaceStore((state) => state.setTerminalH);
  const closeTerminal = useWorkspaceStore((state) => state.closeTerminal);

  /*
   * Restarting is a remount, not a message to the panel.
   *
   * A session that has ended cannot be revived — the process is gone — so
   * "New session" means building a new one, and the key makes that the same
   * code path as opening the drawer for the first time. One way to start a
   * shell rather than two.
   */
  const [generation, setGeneration] = useState(0);

  if (repoPath === null) return null;

  return (
    <>
      <Resizer
        axis="h"
        containerRef={containerRef}
        // The resizer reports the divider's position from the top; the drawer
        // is what is left below it, so the store's limits invert here.
        min={100 - TERMINAL_MAX_H}
        max={100 - TERMINAL_MIN_H}
        onResize={(percent) => setTerminalH(100 - percent)}
        title="Drag to resize the terminal"
      />
      <div className={styles.drawer} style={{ height: `${height}%` }}>
        <PanelHeader
          title="Terminal"
          count={fileName(repoPath)}
          actions={
            <>
              <PanelAction title="New session" onClick={() => setGeneration((n) => n + 1)}>
                <Icons.Sync size={12} />
              </PanelAction>
              {/* Named for what it does: hiding the drawer ends the shell, so
                  the tooltip says so rather than letting a long-running
                  command disappear without warning. */}
              <PanelAction title="Close terminal (ends the session)" onClick={closeTerminal}>
                <Icons.Close size={12} />
              </PanelAction>
            </>
          }
        />
        <Suspense
          fallback={
            <div className={styles.loading}>
              <EmptyState icon={Icons.Terminal} message="Starting a shell…" />
            </div>
          }
        >
          <TerminalPanel
            key={`${repoPath}:${generation}`}
            repoPath={repoPath}
            onRestart={() => setGeneration((n) => n + 1)}
          />
        </Suspense>
      </div>
    </>
  );
}
