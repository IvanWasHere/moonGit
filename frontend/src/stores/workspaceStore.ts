import { create } from 'zustand';

/**
 * Selection and layout state for the workspace — the mockup's `state` object
 * (ui-example L346–365) minus the parts git now owns.
 *
 * Only the stores the port actually forces the shape of live here. The rest of
 * the PRD's store list waits until there is a component whose needs decide it
 * (PLAN.md §6); inventing them now would be guessing.
 *
 * Layout percentages keep the mockup's defaults exactly, because the panes
 * were sized against real content and any drift is visible immediately.
 */

export interface MainLayout {
  readonly leftW: number;
  readonly reposH: number;
  readonly rightFilesH: number;
  readonly rightChangesH: number;
}

export interface ReviewLayout {
  readonly topH: number;
  readonly bottomH: number;
  readonly topReposW: number;
  readonly topFilesW: number;
  readonly topMsgW: number;
  readonly bottomLeftW: number;
  readonly bottomRightW: number;
}

/** ui-example L353–358. */
const MAIN_DEFAULTS: MainLayout = {
  leftW: 30,
  reposH: 35,
  rightFilesH: 35,
  rightChangesH: 35,
};

/** ui-example L359–363. */
const REVIEW_DEFAULTS: ReviewLayout = {
  topH: 55,
  bottomH: 45,
  topReposW: 20,
  topFilesW: 50,
  topMsgW: 30,
  bottomLeftW: 50,
  bottomRightW: 50,
};

interface WorkspaceState {
  readonly selectedRepoId: number | null;
  readonly selectedBranchId: number | null;
  readonly selectedFileId: number | null;
  readonly selectedCommitId: number | null;
  readonly commitMessage: string;
  readonly main: MainLayout;
  readonly review: ReviewLayout;

  selectRepo: (id: number, activeBranchId: number | null) => void;
  selectBranch: (id: number) => void;
  selectFile: (id: number | null) => void;
  selectCommit: (id: number) => void;
  setCommitMessage: (message: string) => void;
  setMain: (patch: Partial<MainLayout>) => void;
  setReview: (patch: Partial<ReviewLayout>) => void;
  resetLayout: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  selectedRepoId: null,
  selectedBranchId: null,
  selectedFileId: null,
  selectedCommitId: null,
  commitMessage: '',
  main: MAIN_DEFAULTS,
  review: REVIEW_DEFAULTS,

  // Selecting a repository clears everything scoped to the previous one, or
  // the Changes pane keeps rendering a diff from a repo the user has left
  // (the mockup does the same at L530).
  selectRepo: (id, activeBranchId) =>
    set({
      selectedRepoId: id,
      selectedBranchId: activeBranchId,
      selectedFileId: null,
      selectedCommitId: null,
    }),

  selectBranch: (id) => set({ selectedBranchId: id, selectedFileId: null }),
  selectFile: (id) => set({ selectedFileId: id }),
  selectCommit: (id) => set({ selectedCommitId: id }),
  setCommitMessage: (commitMessage) => set({ commitMessage }),

  setMain: (patch) => set((state) => ({ main: { ...state.main, ...patch } })),
  setReview: (patch) => set((state) => ({ review: { ...state.review, ...patch } })),
  resetLayout: () => set({ main: MAIN_DEFAULTS, review: REVIEW_DEFAULTS }),
}));
