import { create } from 'zustand';

/**
 * Selection and layout state for the workspace.
 *
 * Selection is by **identity, not index**. A file is its path, a branch is its
 * ref name, a commit is its object id — because every one of those survives a
 * refetch and a row number does not. When the watcher fires and the status
 * list comes back with one fewer entry, "the third row" is a different file;
 * "src/app.ts" is the same file or is gone, and both are answerable.
 *
 * The repository keeps its database id (the route carries it) alongside the
 * path every git command needs.
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

/** Which list a selected file came from — the two have separate diffs. */
export type FileSide = 'staged' | 'worktree';

/**
 * Inline or side-by-side, for every diff in the app.
 *
 * One setting rather than one per panel: the Main and Review views show the
 * same kind of thing, and a viewer that reverts to inline when the user
 * switches views reads as having forgotten the preference.
 */
export type DiffViewMode = 'inline' | 'split';

export interface FileSelection {
  readonly path: string;
  readonly side: FileSide;
}

interface WorkspaceState {
  readonly repoId: number | null;
  readonly repoPath: string | null;
  readonly selectedBranch: string | null;
  readonly selectedFile: FileSelection | null;
  readonly selectedCommit: string | null;
  readonly commitMessage: string;
  /** The commit composer is opened on demand, not always on screen. */
  readonly commitOpen: boolean;
  /** The three-way merge tool, which is modal over the whole workspace. */
  readonly mergeOpen: boolean;
  /** The branch picker that starts a merge. Separate: one begins the operation,
   *  the other cleans up after it, and both can be reached independently. */
  readonly mergeWizardOpen: boolean;
  /**
   * The commit a new tag would point at, or null when the prompt is closed.
   *
   * The oid *is* the open state: a tag prompt with no target is meaningless,
   * so one field carries both rather than a boolean that can disagree with it.
   */
  readonly tagPromptOid: string | null;
  /** Stash stack, modal over the workspace like the merge tools. */
  readonly stashOpen: boolean;
  /** The rebase wizard. The *stopped* state is read from git, not stored. */
  readonly rebaseWizardOpen: boolean;
  readonly diffView: DiffViewMode;
  /**
   * Restrict the Journal to one file's history ("File Log"), or null for all.
   *
   * A path rather than a boolean, because the filter *is* the path — and like
   * every other selection here it survives a refetch, which a row index would
   * not.
   */
  readonly logPath: string | null;
  /**
   * Show every branch in the Journal, not just HEAD's history.
   *
   * Off by default — the Journal is "what am I on" far more often than "what
   * exists". But cherry-pick needs a commit you do *not* have, so without this
   * its input is unreachable from the one place it is offered.
   */
  readonly logAll: boolean;
  readonly main: MainLayout;
  readonly review: ReviewLayout;

  openRepo: (repoId: number, repoPath: string) => void;
  selectBranch: (name: string) => void;
  selectFile: (selection: FileSelection | null) => void;
  selectCommit: (oid: string | null) => void;
  setCommitMessage: (message: string) => void;
  openCommit: () => void;
  closeCommit: () => void;
  toggleCommit: () => void;
  openMerge: () => void;
  closeMerge: () => void;
  openMergeWizard: () => void;
  closeMergeWizard: () => void;
  openTagPrompt: (oid: string) => void;
  closeTagPrompt: () => void;
  openStash: () => void;
  closeStash: () => void;
  openRebaseWizard: () => void;
  closeRebaseWizard: () => void;
  setDiffView: (mode: DiffViewMode) => void;
  setLogPath: (path: string | null) => void;
  toggleLogAll: () => void;
  setMain: (patch: Partial<MainLayout>) => void;
  setReview: (patch: Partial<ReviewLayout>) => void;
  resetLayout: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  repoId: null,
  repoPath: null,
  selectedBranch: null,
  selectedFile: null,
  selectedCommit: null,
  commitMessage: '',
  commitOpen: false,
  mergeOpen: false,
  mergeWizardOpen: false,
  tagPromptOid: null,
  stashOpen: false,
  rebaseWizardOpen: false,
  // Inline by default: it is the mockup's layout, and the Changes pane is
  // narrow enough at its default size that split would truncate both halves.
  diffView: 'inline',
  logPath: null,
  logAll: false,
  main: MAIN_DEFAULTS,
  review: REVIEW_DEFAULTS,

  /**
   * Point the workspace at a repository.
   *
   * Re-opening the same one is a no-op rather than a reset: the watcher fires
   * on every keystroke in an editor, and clearing the user's file selection
   * because a route re-rendered would make the diff pane flicker empty.
   */
  openRepo: (repoId, repoPath) => {
    if (get().repoId === repoId && get().repoPath === repoPath) return;
    set({
      repoId,
      repoPath,
      // Everything else is scoped to the previous repository.
      selectedBranch: null,
      selectedFile: null,
      selectedCommit: null,
      commitMessage: '',
      commitOpen: false,
      mergeOpen: false,
      mergeWizardOpen: false,
      tagPromptOid: null,
      stashOpen: false,
      rebaseWizardOpen: false,
      logPath: null,
      logAll: false,
    });
  },

  selectBranch: (name) => set({ selectedBranch: name, selectedFile: null }),
  selectFile: (selection) => set({ selectedFile: selection }),
  selectCommit: (oid) => set({ selectedCommit: oid }),
  setCommitMessage: (commitMessage) => set({ commitMessage }),
  openCommit: () => set({ commitOpen: true }),
  // The message survives closing: a half-written commit message is work, and
  // losing it because the panel was collapsed would be its own bug.
  closeCommit: () => set({ commitOpen: false }),
  toggleCommit: () => set((state) => ({ commitOpen: !state.commitOpen })),

  openMerge: () => set({ mergeOpen: true }),
  closeMerge: () => set({ mergeOpen: false }),
  openMergeWizard: () => set({ mergeWizardOpen: true }),
  closeMergeWizard: () => set({ mergeWizardOpen: false }),

  openTagPrompt: (tagPromptOid) => set({ tagPromptOid }),
  closeTagPrompt: () => set({ tagPromptOid: null }),
  openStash: () => set({ stashOpen: true }),
  closeStash: () => set({ stashOpen: false }),
  openRebaseWizard: () => set({ rebaseWizardOpen: true }),
  closeRebaseWizard: () => set({ rebaseWizardOpen: false }),

  setDiffView: (diffView) => set({ diffView }),

  setLogPath: (logPath) => set({ logPath }),
  toggleLogAll: () => set((state) => ({ logAll: !state.logAll })),

  setMain: (patch) => set((state) => ({ main: { ...state.main, ...patch } })),
  setReview: (patch) => set((state) => ({ review: { ...state.review, ...patch } })),
  resetLayout: () => set({ main: MAIN_DEFAULTS, review: REVIEW_DEFAULTS }),
}));
