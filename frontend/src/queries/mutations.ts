import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  branchService,
  cherryPickService,
  commitService,
  configService,
  isStaged,
  mergeService,
  rebaseService,
  remoteService,
  stashService,
  tagService,
  workingTreeService,
  type CommitOutcome,
  type DiscardTarget,
  type GitError,
  type IntegrationOutcome,
  type PushOutcome,
  type RepoStatus,
  type Result,
} from '@/services/git';
import { deletePath } from '@/services/wails';
import { writeIgnoreFile, type IgnoreFileId } from '@/services/ignoreFiles';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { GitQueryError } from './git';
import { gitKeys } from './keys';
import type { PushTarget } from './pushTarget';

/**
 * Everything that changes the repository.
 *
 * Two rules hold across all of them:
 *
 * 1. **The watcher is the source of truth.** Every mutation invalidates and
 *    lets the next `status` say what actually happened. Guessing the resulting
 *    state in the client is how a UI drifts out of sync with the repository it
 *    claims to show.
 * 2. **Optimism is bounded to staging.** Stage and unstage move a row between
 *    two lists — cheap to predict, cheap to undo, and the PRD's responsiveness
 *    bar is about exactly that interaction. Commit, checkout and push are not
 *    optimistic: they can fail in ways whose correct rollback is not obvious.
 */

function unwrap<T>(result: Result<T, GitError>): T {
  if (result.ok) return result.value;
  throw new GitQueryError(result.error);
}

/**
 * Move the selection to follow a file across the staged/unstaged divide.
 *
 * Without this, staging the selected file leaves the selection pointing at the
 * side it just left — and the diff pane, which queries per side, correctly
 * reports "no diff data" for a file that very much has changes. The row stays
 * highlighted, so it reads as a broken diff rather than a stale selection.
 */
function followSelection(paths: readonly string[], to: 'staged' | 'worktree'): void {
  const { selectedFile, selectFile } = useWorkspaceStore.getState();
  if (selectedFile === null) return;
  if (!paths.includes(selectedFile.path)) return;
  selectFile({ path: selectedFile.path, side: to });
}

/** After a write, let git tell us the truth rather than assuming it. */
async function refresh(queryClient: QueryClient, repoPath: string): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: gitKeys.repo(repoPath) });
}

// --- staging ----------------------------------------------------------------

export interface StageVariables {
  readonly paths: readonly string[];
}

/**
 * Stage paths, moving the rows immediately.
 *
 * The optimistic update rewrites the cached status so the file appears under
 * "Staged Changes" before git has run. `onError` restores the snapshot, and
 * `onSettled` invalidates either way — so even a *successful* stage ends up
 * showing git's own answer, not the predicted one.
 */
export function useStage(repoPath: string | null) {
  const queryClient = useQueryClient();

  return useMutation<void, GitQueryError, StageVariables, { previous?: RepoStatus }>({
    mutationFn: async ({ paths }) => {
      unwrap(await workingTreeService(repoPath ?? '').stage(paths));
    },
    onSuccess: (_data, { paths }) => followSelection(paths, 'staged'),
    onMutate: async ({ paths }) => {
      if (repoPath === null) return {};
      const key = gitKeys.status(repoPath);
      await queryClient.cancelQueries({ queryKey: key });

      const previous = queryClient.getQueryData<RepoStatus>(key);
      if (previous !== undefined) {
        const staged = new Set(paths);
        queryClient.setQueryData<RepoStatus>(key, {
          ...previous,
          entries: previous.entries.map((entry) =>
            staged.has(entry.path)
              ? // Untracked becomes a staged addition; anything else moves its
                // worktree code into the index half.
                {
                  ...entry,
                  kind: entry.kind === 'untracked' ? ('ordinary' as const) : entry.kind,
                  index: entry.kind === 'untracked' ? ('A' as const) : entry.worktree,
                  worktree: '.' as const,
                }
              : entry,
          ),
        });
      }
      return previous === undefined ? {} : { previous };
    },
    onError: (_error, _variables, context) => {
      if (repoPath !== null && context?.previous !== undefined) {
        queryClient.setQueryData(gitKeys.status(repoPath), context.previous);
      }
    },
    onSettled: () => (repoPath === null ? undefined : refresh(queryClient, repoPath)),
  });
}

export function useUnstage(repoPath: string | null) {
  const queryClient = useQueryClient();

  return useMutation<void, GitQueryError, StageVariables, { previous?: RepoStatus }>({
    mutationFn: async ({ paths }) => {
      // Whether HEAD exists decides between `restore --staged` and `rm
      // --cached`; the status we already have knows.
      const status = queryClient.getQueryData<RepoStatus>(gitKeys.status(repoPath ?? ''));
      const hasHead = status !== undefined && !status.branch.unborn;
      unwrap(await workingTreeService(repoPath ?? '').unstage(paths, hasHead));
    },
    onSuccess: (_data, { paths }) => followSelection(paths, 'worktree'),
    onMutate: async ({ paths }) => {
      if (repoPath === null) return {};
      const key = gitKeys.status(repoPath);
      await queryClient.cancelQueries({ queryKey: key });

      const previous = queryClient.getQueryData<RepoStatus>(key);
      if (previous !== undefined) {
        const unstaged = new Set(paths);
        queryClient.setQueryData<RepoStatus>(key, {
          ...previous,
          entries: previous.entries.map((entry) =>
            unstaged.has(entry.path)
              ? {
                  ...entry,
                  worktree: entry.index === '.' ? entry.worktree : entry.index,
                  index: '.' as const,
                }
              : entry,
          ),
        });
      }
      return previous === undefined ? {} : { previous };
    },
    onError: (_error, _variables, context) => {
      if (repoPath !== null && context?.previous !== undefined) {
        queryClient.setQueryData(gitKeys.status(repoPath), context.previous);
      }
    },
    onSettled: () => (repoPath === null ? undefined : refresh(queryClient, repoPath)),
  });
}

export function useStageAll(repoPath: string | null) {
  const queryClient = useQueryClient();
  return useMutation<void, GitQueryError, void>({
    mutationFn: async () => {
      unwrap(await workingTreeService(repoPath ?? '').stageAll());
    },
    onSettled: () => (repoPath === null ? undefined : refresh(queryClient, repoPath)),
  });
}

export function useUnstageAll(repoPath: string | null) {
  const queryClient = useQueryClient();
  return useMutation<void, GitQueryError, void>({
    mutationFn: async () => {
      const status = queryClient.getQueryData<RepoStatus>(gitKeys.status(repoPath ?? ''));
      const hasHead = status !== undefined && !status.branch.unborn;
      unwrap(await workingTreeService(repoPath ?? '').unstageAll(hasHead));
    },
    onSettled: () => (repoPath === null ? undefined : refresh(queryClient, repoPath)),
  });
}

/**
 * Discard changes. **Not optimistic**: this destroys work that has no reflog
 * entry, so the UI should show what git actually did, not a guess.
 */
export function useDiscard(repoPath: string | null) {
  const queryClient = useQueryClient();
  return useMutation<void, GitQueryError, { targets: readonly DiscardTarget[] }>({
    mutationFn: async ({ targets }) => {
      unwrap(await workingTreeService(repoPath ?? '').discard(targets));
    },
    onSettled: () => (repoPath === null ? undefined : refresh(queryClient, repoPath)),
  });
}

// --- commit -----------------------------------------------------------------

export interface CommitVariables {
  readonly message: string;
  readonly amend?: boolean;
  readonly signoff?: boolean;
}

export function useCommit(repoPath: string | null) {
  const queryClient = useQueryClient();

  return useMutation<CommitOutcome, GitQueryError, CommitVariables>({
    mutationFn: async ({ message, amend, signoff }) =>
      unwrap(
        await commitService(repoPath ?? '').create(message, {
          ...(amend !== undefined && { amend }),
          ...(signoff !== undefined && { signoff }),
        }),
      ),
    onSettled: () => (repoPath === null ? undefined : refresh(queryClient, repoPath)),
  });
}

// --- branches ---------------------------------------------------------------

export function useCheckoutBranch(repoPath: string | null) {
  const queryClient = useQueryClient();
  return useMutation<void, GitQueryError, string>({
    mutationFn: async (name) => {
      unwrap(await branchService(repoPath ?? '').checkout(name));
    },
    onSettled: () => (repoPath === null ? undefined : refresh(queryClient, repoPath)),
  });
}

export function useCreateBranch(repoPath: string | null) {
  const queryClient = useQueryClient();
  return useMutation<void, GitQueryError, { name: string; startPoint?: string }>({
    mutationFn: async ({ name, startPoint }) => {
      unwrap(await branchService(repoPath ?? '').create(name, startPoint));
    },
    onSettled: () => (repoPath === null ? undefined : refresh(queryClient, repoPath)),
  });
}

export function useDeleteBranch(repoPath: string | null) {
  const queryClient = useQueryClient();
  return useMutation<void, GitQueryError, { name: string; force?: boolean }>({
    mutationFn: async ({ name, force }) => {
      unwrap(await branchService(repoPath ?? '').delete(name, force ?? false));
    },
    onSettled: () => (repoPath === null ? undefined : refresh(queryClient, repoPath)),
  });
}

// --- remotes ----------------------------------------------------------------

export function useFetch(repoPath: string | null) {
  const queryClient = useQueryClient();
  return useMutation<void, GitQueryError, { prune?: boolean } | void>({
    mutationFn: async (variables) => {
      unwrap(
        await remoteService(repoPath ?? '').fetch(undefined, {
          prune: variables?.prune ?? true,
        }),
      );
    },
    onSettled: () => (repoPath === null ? undefined : refresh(queryClient, repoPath)),
  });
}

export function usePull(repoPath: string | null) {
  const queryClient = useQueryClient();
  return useMutation<void, GitQueryError, { rebase?: boolean } | void>({
    mutationFn: async (variables) => {
      unwrap(
        await remoteService(repoPath ?? '').pull({
          ...(variables?.rebase !== undefined && { rebase: variables.rebase }),
        }),
      );
    },
    onSettled: () => (repoPath === null ? undefined : refresh(queryClient, repoPath)),
  });
}

export interface ApplyPatchVariables {
  readonly patch: string;
  readonly reverse?: boolean;
}

/**
 * Stage or unstage part of a file, by applying a patch to the index.
 *
 * **Not optimistic.** Stage and unstage of a whole path can be predicted by
 * moving a row between two lists; the result of a partial stage is a file that
 * appears in *both* halves with different contents in each, and guessing that
 * shape wrongly would show the user an index that does not exist.
 */
export function useApplyPatch(repoPath: string | null) {
  const queryClient = useQueryClient();

  return useMutation<void, GitQueryError, ApplyPatchVariables>({
    mutationFn: async ({ patch, reverse }) => {
      unwrap(
        await workingTreeService(repoPath ?? '').applyToIndex(patch, {
          ...(reverse !== undefined && { reverse }),
        }),
      );
    },
    onSettled: () => (repoPath === null ? undefined : refresh(queryClient, repoPath)),
  });
}

// --- stash ------------------------------------------------------------------

export interface StashPushVariables {
  readonly message?: string;
  readonly includeUntracked?: boolean;
  readonly keepIndex?: boolean;
}

/**
 * Stash the working tree.
 *
 * Resolves to `false` when there was nothing to stash. Git says "No local
 * changes to save" and **exits 0**, so without that the UI would report a
 * successful stash that never appears in the list.
 */
export function useStashPush(repoPath: string | null) {
  const queryClient = useQueryClient();
  return useMutation<boolean, GitQueryError, StashPushVariables | void>({
    mutationFn: async (variables) =>
      unwrap(
        await stashService(repoPath ?? '').push({
          ...(variables?.message !== undefined && { message: variables.message }),
          ...(variables?.includeUntracked !== undefined && {
            includeUntracked: variables.includeUntracked,
          }),
          ...(variables?.keepIndex !== undefined && { keepIndex: variables.keepIndex }),
        }),
      ),
    onSettled: () => (repoPath === null ? undefined : refresh(queryClient, repoPath)),
  });
}

export type StashAction = 'apply' | 'pop' | 'drop';

/**
 * Apply, pop or drop one stash.
 *
 * One mutation rather than three: they take the same argument, invalidate the
 * same things, and differ only in the verb — which is data.
 */
export function useStashAction(repoPath: string | null) {
  const queryClient = useQueryClient();
  return useMutation<void, GitQueryError, { action: StashAction; selector: string }>({
    mutationFn: async ({ action, selector }) => {
      const service = stashService(repoPath ?? '');
      unwrap(
        await (action === 'apply'
          ? service.apply(selector)
          : action === 'pop'
            ? service.pop(selector)
            : service.drop(selector)),
      );
    },
    onSettled: () => (repoPath === null ? undefined : refresh(queryClient, repoPath)),
  });
}

// --- tags -------------------------------------------------------------------

export interface CreateTagVariables {
  readonly name: string;
  /** A message makes it annotated — a real object with a tagger and a date. */
  readonly message?: string;
  readonly target?: string;
  readonly force?: boolean;
}

export function useCreateTag(repoPath: string | null) {
  const queryClient = useQueryClient();
  return useMutation<void, GitQueryError, CreateTagVariables>({
    mutationFn: async ({ name, message, target, force }) => {
      unwrap(
        await tagService(repoPath ?? '').create(name, {
          ...(message !== undefined && message !== '' && { message }),
          ...(target !== undefined && { target }),
          ...(force !== undefined && { force }),
        }),
      );
    },
    onSettled: () => (repoPath === null ? undefined : refresh(queryClient, repoPath)),
  });
}

export function useDeleteTag(repoPath: string | null) {
  const queryClient = useQueryClient();
  return useMutation<void, GitQueryError, { name: string }>({
    mutationFn: async ({ name }) => {
      unwrap(await tagService(repoPath ?? '').delete(name));
    },
    onSettled: () => (repoPath === null ? undefined : refresh(queryClient, repoPath)),
  });
}

// --- cherry-pick ------------------------------------------------------------

export interface CherryPickVariables {
  readonly oids: readonly string[];
  readonly noCommit?: boolean;
  readonly recordOrigin?: boolean;
}

/**
 * Cherry-pick commits onto the current branch.
 *
 * A conflict is an outcome, not an error — the pick stops with unmerged paths
 * the three-way resolver already knows how to read.
 */
export function useCherryPick(repoPath: string | null) {
  const queryClient = useQueryClient();
  return useMutation<IntegrationOutcome, GitQueryError, CherryPickVariables>({
    mutationFn: async ({ oids, noCommit, recordOrigin }) =>
      unwrap(
        await cherryPickService(repoPath ?? '').pick(oids, {
          ...(noCommit !== undefined && { noCommit }),
          ...(recordOrigin !== undefined && { recordOrigin }),
        }),
      ),
    onSettled: () => (repoPath === null ? undefined : refresh(queryClient, repoPath)),
  });
}

// --- rebase -----------------------------------------------------------------

export interface RebaseVariables {
  readonly upstream: string;
  readonly autostash?: boolean;
  readonly onto?: string;
  /** Present for an interactive rebase: the todo file git's editor will copy. */
  readonly todoPath?: string;
}

/**
 * Start a rebase, interactive or not.
 *
 * A stop — for a conflict, or for an `edit` line — comes back as `conflicted`.
 * The rebase is paused either way and the same continue/skip/abort gets out of
 * it, so the caller has one case to handle rather than two.
 */
export function useRebase(repoPath: string | null) {
  const queryClient = useQueryClient();

  return useMutation<IntegrationOutcome, GitQueryError, RebaseVariables>({
    mutationFn: async ({ upstream, autostash, onto, todoPath }) => {
      const service = rebaseService(repoPath ?? '');
      const options = {
        ...(autostash !== undefined && { autostash }),
        ...(onto !== undefined && { onto }),
      };
      try {
        return unwrap(
          todoPath === undefined
            ? await service.rebase(upstream, options)
            : await service.interactive(upstream, { ...options, todoPath }),
        );
      } finally {
        // Git copies the todo at the start and never looks at it again, so it
        // is litter inside `.git` from the moment the rebase begins — cleaned
        // up whichever way the rebase went.
        if (todoPath !== undefined) await deletePath(todoPath).catch(() => undefined);
      }
    },
    onSettled: () => (repoPath === null ? undefined : refresh(queryClient, repoPath)),
  });
}

export type RebaseStep = 'continue' | 'skip' | 'abort';

/** Continue, skip or abort a rebase that has stopped. */
export function useRebaseStep(repoPath: string | null) {
  const queryClient = useQueryClient();

  return useMutation<IntegrationOutcome | null, GitQueryError, { step: RebaseStep }>({
    mutationFn: async ({ step }) => {
      const service = rebaseService(repoPath ?? '');
      if (step === 'abort') {
        unwrap(await service.abort());
        return null;
      }
      return unwrap(step === 'continue' ? await service.continueRebase() : await service.skip());
    },
    onSettled: () => (repoPath === null ? undefined : refresh(queryClient, repoPath)),
  });
}

// --- merge ------------------------------------------------------------------

export interface MergeVariables {
  /** The ref being merged *into* the current branch. */
  readonly ref: string;
  readonly noFastForward?: boolean;
  readonly fastForwardOnly?: boolean;
  readonly squash?: boolean;
  readonly message?: string;
}

/**
 * Merge a ref into the current branch.
 *
 * A conflict is **not** an error here, and that is the whole reason this is a
 * mutation returning an outcome rather than one that throws: a conflicted
 * merge leaves the repository in a state the user has to be shown and helped
 * out of. `IntegrationService` already draws that line — only a bad ref, a
 * dirty tree or a refused fast-forward come back as errors.
 */
export function useMerge(repoPath: string | null) {
  const queryClient = useQueryClient();

  return useMutation<IntegrationOutcome, GitQueryError, MergeVariables>({
    mutationFn: async ({ ref, ...options }) =>
      unwrap(await mergeService(repoPath ?? '').merge(ref, options)),
    onSettled: () => (repoPath === null ? undefined : refresh(queryClient, repoPath)),
  });
}

/**
 * Throw away a conflicted merge.
 *
 * No check for whether a merge is in progress: git answers that itself
 * ("fatal: There is no merge to abort"), and a check of our own would be a
 * second, staler opinion about the same question.
 */
export function useAbortMerge(repoPath: string | null) {
  const queryClient = useQueryClient();

  return useMutation<void, GitQueryError, void>({
    mutationFn: async () => {
      unwrap(await mergeService(repoPath ?? '').abort());
    },
    onSettled: () => (repoPath === null ? undefined : refresh(queryClient, repoPath)),
  });
}

/**
 * Push an explicitly named remote and branch — never a bare `git push`.
 * See `pushTarget.ts` for why the defaults cannot be trusted.
 */
export function usePush(repoPath: string | null) {
  const queryClient = useQueryClient();

  return useMutation<PushOutcome, GitQueryError, PushTarget>({
    mutationFn: async ({ remote, branch, setUpstream }) =>
      unwrap(await remoteService(repoPath ?? '').push({ remote, branch, setUpstream })),
    onSettled: () => (repoPath === null ? undefined : refresh(queryClient, repoPath)),
  });
}

// --- repository settings ----------------------------------------------------

/**
 * Invalidate the config queries only.
 *
 * Not the whole repository, which every other mutation here does: a config
 * write changes no ref, no file and no index entry, so re-running `status`,
 * `log` and the ref list would be work with a guaranteed-identical result. The
 * two config scopes are the only things that can have changed.
 */
async function refreshConfig(queryClient: QueryClient, repoPath: string): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: [repoPath, 'config'] });
}

export interface SetConfigVariables {
  readonly key: string;
  /** Null removes the local value, falling back to the inherited one. */
  readonly value: string | null;
}

export function useSetRepoConfig(repoPath: string | null) {
  const queryClient = useQueryClient();

  return useMutation<void, GitQueryError, SetConfigVariables>({
    mutationFn: async ({ key, value }) => {
      const service = configService(repoPath ?? '');
      unwrap(value === null ? await service.unset(key) : await service.set(key, value));
    },
    onSettled: () => (repoPath === null ? undefined : refreshConfig(queryClient, repoPath)),
  });
}

export type RemoteVariables =
  | { readonly action: 'add'; readonly name: string; readonly url: string }
  | { readonly action: 'setUrl'; readonly name: string; readonly url: string }
  | { readonly action: 'rename'; readonly name: string; readonly to: string }
  | { readonly action: 'remove'; readonly name: string };

/**
 * Add, retarget, rename or remove a remote.
 *
 * One hook rather than four: they share a variables shape, an invalidation and
 * an error channel, and the panel calling them switches on the action anyway.
 *
 * This one *does* refresh the whole repository. A rename rewrites
 * `refs/remotes/<name>/*` and every branch's upstream, and a removal deletes
 * those refs outright — so the branch list, the ahead/behind counts in status,
 * and the graph's remote labels are all downstream of it.
 */
export function useRemoteAction(repoPath: string | null) {
  const queryClient = useQueryClient();

  return useMutation<void, GitQueryError, RemoteVariables>({
    mutationFn: async (variables) => {
      const service = remoteService(repoPath ?? '');
      switch (variables.action) {
        case 'add':
          unwrap(await service.add(variables.name, variables.url));
          return;
        case 'setUrl':
          unwrap(await service.setUrl(variables.name, variables.url));
          return;
        case 'rename':
          unwrap(await service.rename(variables.name, variables.to));
          return;
        case 'remove':
          unwrap(await service.remove(variables.name));
          return;
      }
    },
    onSettled: () => (repoPath === null ? undefined : refresh(queryClient, repoPath)),
  });
}

export interface WriteIgnoreVariables {
  readonly file: IgnoreFileId;
  readonly text: string;
}

/**
 * Save an ignore file.
 *
 * Invalidates the repository whole, unlike the config write above: ignore
 * rules decide which files appear as untracked, so saving one changes what
 * `status` reports and what the explorer shows. The watcher would notice
 * `.gitignore` on its own, but not `.git/info/exclude` — which lives inside
 * `.git`, where the watcher deliberately ignores everything but refs, HEAD and
 * the index (`internal/watcher/service.go`).
 */
export function useWriteIgnoreFile(repoPath: string | null) {
  const queryClient = useQueryClient();

  return useMutation<void, Error, WriteIgnoreVariables>({
    mutationFn: async ({ file, text }) => {
      await writeIgnoreFile(repoPath ?? '', file, text);
    },
    onSettled: async () => {
      if (repoPath === null) return;
      await queryClient.invalidateQueries({ queryKey: [repoPath, 'ignoreText'] });
      await refresh(queryClient, repoPath);
    },
  });
}

/** Paths currently in the index — what a commit would include. */
export function stagedPaths(status: RepoStatus | undefined): string[] {
  return (status?.entries ?? []).filter(isStaged).map((entry) => entry.path);
}
