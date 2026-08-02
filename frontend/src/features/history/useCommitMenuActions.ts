/**
 * What each commit context-menu item does.
 *
 * The same three rules the file menu follows: destructive actions confirm,
 * the watcher is the source of truth, and nothing reports a success it did not
 * have.
 */

import { useCherryPick } from '@/queries/mutations';
import type { Commit } from '@/services/git';
import { copyToClipboard } from '@/services/wails';
import { showToast } from '@/stores/notificationStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { CommitMenuAction } from './commitMenu';

export function useCommitMenuActions(repoPath: string | null) {
  const cherryPick = useCherryPick(repoPath);
  const setLogPath = useWorkspaceStore((state) => state.setLogPath);
  const selectCommit = useWorkspaceStore((state) => state.selectCommit);
  const openMerge = useWorkspaceStore((state) => state.openMerge);
  const openTagPrompt = useWorkspaceStore((state) => state.openTagPrompt);

  return (commit: Commit, action: CommitMenuAction): void => {
    switch (action) {
      case 'showDiff':
        selectCommit(commit.oid);
        return;

      case 'cherryPick':
      case 'cherryPickNoCommit':
        cherryPick.mutate(
          { oids: [commit.oid], ...(action === 'cherryPickNoCommit' && { noCommit: true }) },
          {
            onSuccess: (outcome) => {
              if (outcome.status === 'conflicted') {
                // Same stopping point as a merge — unmerged paths with stages
                // 1, 2 and 3 — so the resolver handles it unchanged.
                showToast(`${commit.shortOid} conflicts — resolve to finish the pick`, 'error');
                openMerge();
                return;
              }
              showToast(
                action === 'cherryPickNoCommit'
                  ? `Applied ${commit.shortOid} without committing`
                  : `Cherry-picked ${commit.shortOid}`,
                'success',
              );
            },
            onError: (error) => showToast(error.message, 'error'),
          },
        );
        return;

      case 'tagHere':
        // The name needs typing, and there is no native prompt for free text —
        // `showMessage` is buttons only. So the modal owns it.
        openTagPrompt(commit.oid);
        return;

      case 'fileLogFrom':
        // Deliberately not a path filter: "history from here" is a revision
        // range, and the Journal filters by path. Until it can take a revision,
        // selecting the commit is the honest half of the answer.
        selectCommit(commit.oid);
        setLogPath(null);
        showToast(`Showing ${commit.shortOid}; ranged history needs the Log view`, 'info');
        return;

      case 'copyOid':
        void copyToClipboard(commit.oid).then(() => showToast('Commit SHA copied', 'info'));
        return;

      case 'copySubject':
        void copyToClipboard(commit.subject).then(() => showToast('Subject copied', 'info'));
        return;
    }
  };
}
