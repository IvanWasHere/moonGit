/**
 * "Copy Diff" — the patch for the file the Changes pane is showing.
 *
 * The button lives in the panel header, one component away from the pane that
 * fetched the diff. Rather than lifting the query or threading it through, this
 * asks React Query for the *same key* the pane uses: the answer is already in
 * the cache, so it costs a lookup rather than a git call.
 *
 * The patch is rebuilt by `buildPatch` rather than kept as raw text. `DiffFile`
 * holds hunks, not the bytes git printed, and reconstructing beats retaining a
 * second copy of every diff on the chance somebody presses a button. What comes
 * out is a real unified diff — `git apply` takes it, which
 * `patchApply.test.ts` asserts — with only git's `index <old>..<new>` line
 * missing, since the abbreviated hashes it wants are not what the raw section
 * carries.
 */

import { useStagedDiff, useWorkingTreeDiff } from '@/queries/git';
import { copyToClipboard } from '@/services/wails';
import { showToast } from '@/stores/notificationStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { buildPatch, hunkLineKeys } from './patch';

export function useCopyDiff(): { readonly copy: () => void; readonly enabled: boolean } {
  const repoPath = useWorkspaceStore((state) => state.repoPath);
  const selected = useWorkspaceStore((state) => state.selectedFile);
  const paths = selected === null ? undefined : [selected.path];

  const worktree = useWorkingTreeDiff(selected?.side === 'worktree' ? repoPath : null, paths);
  const staged = useStagedDiff(selected?.side === 'staged' ? repoPath : null, paths);
  const file = (selected?.side === 'staged' ? staged : worktree).data?.find(
    (entry) => entry.path === selected?.path,
  );

  return {
    enabled: file !== undefined,
    copy: () => {
      if (file === undefined) {
        showToast('Select a file to copy its diff', 'error');
        return;
      }
      // Every changed line, which is what "the diff" means here — a line
      // selection is for staging, not for what lands on the clipboard.
      const everything = new Set(file.hunks.flatMap((hunk, index) => hunkLineKeys(hunk, index)));
      const patch = buildPatch(file, everything, 'stage');
      if (patch === null) {
        showToast('That file has no textual diff to copy', 'info');
        return;
      }
      void copyToClipboard(patch).then(() => showToast(`Copied diff for ${file.path}`, 'success'));
    },
  };
}
