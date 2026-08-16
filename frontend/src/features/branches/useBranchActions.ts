import {
  useCheckoutBranch,
  useCreateBranch,
  useDeleteBranch,
  useRenameBranch,
} from '@/queries/mutations';
import { showToast } from '@/stores/notificationStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

/**
 * Checkout, create and delete a branch (PLAN.md §11, 8.8).
 *
 * **These three mutations were written and tested in Phase 5 and then called by
 * nothing at all.** Clicking a branch in the panel only ever selected it, the
 * menu items said "Branch checkout arrives in Phase 6", and the panel's New
 * Branch button raised a toast — so the app shipped with no way to change
 * branch, which for a git client is not a missing nicety.
 *
 * A hook rather than the logic sitting in one of the two call sites, because
 * there are two: the application menu and the Branches panel header. Written
 * into whichever one came first, the other would have grown a second copy with
 * its own idea of whether deleting asks for confirmation.
 *
 * They act on the branch **selected in the panel** rather than opening a
 * picker. The panel is already a list of branches with one highlighted, and a
 * chooser on top of it asks the same question twice.
 */
export interface BranchActions {
  checkout: () => void;
  create: () => void;
  rename: () => void;
  remove: () => void;
}

export function useBranchActions(): BranchActions {
  const repoPath = useWorkspaceStore((state) => state.repoPath);
  const selectedBranch = useWorkspaceStore((state) => state.selectedBranch);

  const checkoutBranch = useCheckoutBranch(repoPath);
  const createBranch = useCreateBranch(repoPath);
  const deleteBranch = useDeleteBranch(repoPath);
  const renameBranch = useRenameBranch(repoPath);

  // git's own message is better than anything rewritten here — "not fully
  // merged" on a delete says exactly what is wrong and what to do about it.
  const reportError = (error: Error) => showToast(error.message, 'error');
  const needsBranch = () => showToast('Select a branch first', 'error');

  return {
    checkout: () => {
      if (selectedBranch === null) return needsBranch();
      checkoutBranch.mutate(selectedBranch, {
        onSuccess: () => showToast(`Switched to ${selectedBranch}`, 'success'),
        onError: reportError,
      });
    },

    create: () => {
      /*
       * `window.prompt`, and not one of the app's own modals.
       *
       * A branch name is a single line of text with no options; every modal in
       * this app is a multi-field form with a header and a footer, and one
       * built for this would be a form with one field. If branch creation ever
       * grows a start point or a checkout-after toggle, it earns a real dialog
       * then.
       */
      const name = window.prompt('New branch name');
      if (name === null || name.trim() === '') return;
      createBranch.mutate(
        { name: name.trim() },
        {
          onSuccess: () => showToast(`Created ${name.trim()}`, 'success'),
          onError: reportError,
        },
      );
    },

    rename: () => {
      if (selectedBranch === null) return needsBranch();
      // Prefilled with the current name, because a rename is almost always an
      // edit of it rather than a fresh one.
      const to = window.prompt(`Rename ${selectedBranch} to`, selectedBranch);
      if (to === null || to.trim() === '' || to.trim() === selectedBranch) return;
      renameBranch.mutate(
        { from: selectedBranch, to: to.trim() },
        {
          onSuccess: () => showToast(`Renamed to ${to.trim()}`, 'success'),
          onError: reportError,
        },
      );
    },

    remove: () => {
      if (selectedBranch === null) return needsBranch();
      // Asks, because nothing in the app can undo it. git's own refusal to
      // delete an unmerged branch is the second line of defence, not the first.
      if (!window.confirm(`Delete branch ${selectedBranch}?`)) return;
      deleteBranch.mutate(
        { name: selectedBranch },
        {
          onSuccess: () => showToast(`Deleted ${selectedBranch}`, 'success'),
          onError: reportError,
        },
      );
    },
  };
}
