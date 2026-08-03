/**
 * What the file tree's context menu does.
 *
 * Four actions that work on **any** path, which is the whole reason this is
 * separate from `useFileMenuActions`: that one is built around a `StatusEntry`
 * and offers staging, unstaging and discarding, none of which mean anything
 * for a file with no changes — and most of a repository has none.
 *
 * Same discipline as the Changes menu: nothing reports success it did not
 * have, and every failure toasts rather than disappearing.
 */

import type { DirEntry } from '@/queries/git';
import { copyToClipboard, openInEditor, revealInFinder } from '@/services/wails';
import { showToast } from '@/stores/notificationStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

export type TreeMenuAction = 'open' | 'reveal' | 'copyPath' | 'history';

/** Takes no `repoPath`: every action here works off the entry's own paths. */
export function useTreeMenuActions() {
  const setLogPath = useWorkspaceStore((state) => state.setLogPath);
  const editor = useSettingsStore((state) => state.editor);
  const setFilesTab = useWorkspaceStore((state) => state.setFilesTab);

  return async (entry: DirEntry, action: TreeMenuAction): Promise<void> => {
    // `entry.path` is already absolute — it comes from the filesystem listing,
    // not from git — but everything the app keys on is repo-relative, so the
    // two are used deliberately: OS calls take the absolute, git takes `relPath`.
    const absolute = entry.path;
    const report = (cause: unknown) => showToast(String(cause), 'error');

    switch (action) {
      case 'open':
        await openInEditor(absolute, editor).catch(report);
        return;

      case 'reveal':
        await revealInFinder(absolute).catch(report);
        return;

      case 'copyPath':
        // The repo-relative path, not the absolute one: it is what gets pasted
        // into a commit message, an issue or a `git log --` invocation.
        await copyToClipboard(entry.relPath)
          .then(() => showToast(`Copied ${entry.relPath}`, 'success'))
          .catch(report);
        return;

      case 'history':
        /*
         * Filtering the Journal by a directory works because git's pathspec
         * takes one — `git log -- src/` is every commit touching anything
         * beneath it. Switching back to Changes is deliberate: the history is
         * on the other side of the window and leaving the tree open would hide
         * the thing that was just asked for.
         */
        setLogPath(entry.relPath);
        setFilesTab('changes');
        showToast(`History for ${entry.relPath}`, 'info');
        return;

      default:
        return;
    }
  };
}
