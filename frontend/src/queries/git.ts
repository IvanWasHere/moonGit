import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import {
  blameService,
  branchService,
  commitService,
  configService,
  diffService,
  ignoreService,
  remoteService,
  repositoryService,
  stashService,
  treeService,
  type Blame,
  type Commit,
  type CommitSearchParams,
  type ConfigEntry,
  type ConfigScope,
  type DiffFile,
  type GitError,
  type IgnoreRule,
  type RefCollection,
  type Remote,
  type RepoStatus,
  type Result,
  type Stash,
  type StatusEntry,
} from '@/services/git';
import {
  loadTuning,
  noteLogDuration,
  noteStatusDuration,
  type Tuning,
} from '@/services/git/tuning';
import { readIgnoreFile, type IgnoreFileId } from '@/services/ignoreFiles';
import { listDir, type FileInfo } from '@/services/wails';
import { gitKeys } from './keys';
import { nextLogPageParam } from './logPaging';

/**
 * React Query bindings for the git services.
 *
 * The services return `Result`; these throw the error instead, because that is
 * how Query reports failure — it catches the throw and hands it back as
 * `error`, typed below. Nothing escapes: the discipline is still "no uncaught
 * exceptions", the Result is just being converted into the channel the data
 * layer already has for the purpose.
 */

/** Carries the typed `GitError` while still being a real `Error` for tooling. */
export class GitQueryError extends Error {
  constructor(readonly gitError: GitError) {
    super(gitError.message);
    this.name = 'GitQueryError';
  }
}

function unwrap<T>(result: Result<T, GitError>): T {
  if (result.ok) return result.value;
  throw new GitQueryError(result.error);
}

/** Every hook is disabled until a repository is chosen. */
function enabled(repoPath: string | null): repoPath is string {
  return repoPath !== null && repoPath !== '';
}

/**
 * How the repository has been tuned for its size, from SQLite.
 *
 * `staleTime: Infinity` because nothing outside this app changes it, and the
 * two things that do — a slow status, or the user overriding it — invalidate
 * this key by hand.
 */
export function useTuning(repoPath: string | null): UseQueryResult<Tuning, Error> {
  return useQuery({
    queryKey: gitKeys.tuning(repoPath ?? ''),
    queryFn: () => loadTuning(repoPath ?? ''),
    enabled: enabled(repoPath),
    staleTime: Infinity,
  });
}

/**
 * Working tree and index state.
 *
 * Two things here are Phase 7 rather than Phase 5:
 *
 * **It waits for the tuning to load.** `untrackedMode` reads a memory cache
 * that SQLite fills, and a status that ran before the fill would run
 * `--untracked-files=all` on a repository already known to be too big for it —
 * so the first refresh after every relaunch would be the slow one, forever. The
 * gate costs one database read on the open path and removes that entirely.
 *
 * **It times itself and may degrade the repository.** See
 * `services/git/tuning.ts` for why the trigger is a duration rather than a file
 * count. The elapsed time measured here is the whole round trip, bridge
 * included, rather than git's own `durationMs` — what matters is how long the
 * panel waited, not how long the subprocess ran.
 */
export function useStatus(repoPath: string | null): UseQueryResult<RepoStatus, GitQueryError> {
  const queryClient = useQueryClient();
  const tuning = useTuning(repoPath);

  return useQuery({
    queryKey: gitKeys.status(repoPath ?? ''),
    queryFn: async ({ signal }) => {
      const started = performance.now();
      const value = unwrap(await repositoryService(repoPath ?? '').status({ signal }));

      if (await noteStatusDuration(repoPath ?? '', performance.now() - started)) {
        // The repository just degraded. Refresh what it says about itself, and
        // let the next status run the cheaper command — this one's result is
        // still correct, being a superset of what `normal` would have returned.
        await queryClient.invalidateQueries({ queryKey: gitKeys.tuning(repoPath ?? '') });
      }
      return value;
    },
    enabled: enabled(repoPath) && tuning.isSuccess,
  });
}

/**
 * The ignored files, fetched only while the Ignored filter chip is on.
 *
 * The expensive query in the Files panel, and the only one in the app that is
 * gated on a UI toggle rather than on having a repository. Two consequences the
 * design accepts rather than engineers away: switching the chip on has a
 * visible pause on a large repository, and because the chips persist, that
 * pause happens at launch if it was left on.
 *
 * `staleTime` is long and the watcher does not invalidate this key (see
 * `gitKeys.ignored`), so toggling the chip off and back on inside the window is
 * free. Editing an ignore file invalidates it explicitly.
 */
export function useIgnoredFiles(
  repoPath: string | null,
  enabledWhen: boolean,
): UseQueryResult<StatusEntry[], GitQueryError> {
  return useQuery({
    queryKey: gitKeys.ignored(repoPath ?? ''),
    queryFn: async ({ signal }) =>
      unwrap(await repositoryService(repoPath ?? '').ignored({ signal })),
    enabled: enabled(repoPath) && enabledWhen,
    staleTime: 5 * 60_000,
  });
}

export function useRefs(repoPath: string | null): UseQueryResult<RefCollection, GitQueryError> {
  return useQuery({
    queryKey: gitKeys.refs(repoPath ?? ''),
    queryFn: async ({ signal }) => unwrap(await branchService(repoPath ?? '').list({ signal })),
    enabled: enabled(repoPath),
  });
}

export function useCurrentBranch(
  repoPath: string | null,
): UseQueryResult<string | null, GitQueryError> {
  return useQuery({
    queryKey: gitKeys.currentBranch(repoPath ?? ''),
    queryFn: async ({ signal }) => unwrap(await branchService(repoPath ?? '').current({ signal })),
    enabled: enabled(repoPath),
  });
}

/**
 * Everything `useLog` varies by — and therefore everything in its cache key.
 *
 * It extends `CommitSearchParams` rather than restating it, so a new search
 * flag cannot be added to the service and forgotten here, which would cache
 * two different searches under the same key.
 */
export interface LogParams extends CommitSearchParams {
  readonly maxCount?: number;
  readonly revisions?: readonly string[];
  readonly firstParent?: boolean;
  readonly topoOrder?: boolean;
}

/**
 * Commit history, and the history axis's half of the Phase 7 tuning.
 *
 * **It times itself and may write a commit-graph**, the mirror of what
 * `useStatus` does for the file axis, and the reason both hooks wait on
 * `useTuning` — a log that ran before the flag loaded would rewrite a graph the
 * repository already has, on every relaunch, forever. The two hooks share the
 * query key, so the gate costs one database read between them rather than two.
 *
 * **Nothing awaits the write.** `noteLogDuration` returns void by design: the
 * commits below are already correct and a graph would not change them, only
 * make the *next* log cheaper. See its docblock.
 */
export function useLog(
  repoPath: string | null,
  params: LogParams = {},
): UseQueryResult<Commit[], GitQueryError> {
  const tuning = useTuning(repoPath);

  return useQuery({
    queryKey: gitKeys.log(repoPath ?? '', params),
    // The service streams internally; the promise resolves with everything.
    // Progressive rendering uses `onBatch` directly rather than this hook.
    queryFn: async ({ signal }) => {
      const started = performance.now();
      const value = unwrap(await commitService(repoPath ?? '').list({ ...params, signal }));

      noteLogDuration(repoPath ?? '', performance.now() - started);
      return value;
    },
    enabled: enabled(repoPath) && tuning.isSuccess,
  });
}

/**
 * The Journal's paged history.
 *
 * Separate from `useLog` rather than replacing it: the other four callers
 * (`MergeWizard` twice, `RebaseWizard`, `CommitMessagesView`) all want a
 * bounded preview of a range and would be actively worse for being able to
 * scroll further into it. Only the Journal is a window onto the whole history.
 *
 * **The cursor is an offset, not a commit.** `--skip=n` re-walks from the tip
 * each time, which sounds wasteful and is what the measurements endorse: with
 * a commit-graph in place, page 2,500 costs 270ms — the walk is not the
 * expensive part once generation numbers exist. The alternative, resuming from
 * the last commit of the previous page, cannot express `--topo-order`'s
 * ordering as a revision range without re-deriving the frontier, which is more
 * machinery for something already fast enough.
 *
 * **A page can disagree with the one before it.** Commits arriving between two
 * fetches shift every subsequent offset, so a row can repeat or be missed at a
 * page boundary. That is inherent to offset paging, and the invalidation that
 * follows any mutation resets the whole list — so the window in which it can
 * happen is a background fetch landing mid-scroll, and the cost is one
 * duplicated row rather than anything incorrect.
 */
export function useLogPages(
  repoPath: string | null,
  params: LogParams = {},
): UseInfiniteQueryResult<InfiniteData<Commit[]>, GitQueryError> {
  const tuning = useTuning(repoPath);

  return useInfiniteQuery({
    queryKey: gitKeys.log(repoPath ?? '', params),
    initialPageParam: 0,
    queryFn: async ({ signal, pageParam }) => {
      const started = performance.now();
      const value = unwrap(
        await commitService(repoPath ?? '').list({ ...params, skip: pageParam, signal }),
      );

      // Only the first page is a fair measurement of the history axis. A later
      // one has already paid for whatever tuning the first page triggered, and
      // timing it would just re-confirm the answer at the cost of noise.
      if (pageParam === 0) noteLogDuration(repoPath ?? '', performance.now() - started);
      return value;
    },
    getNextPageParam: (_lastPage, allPages) => nextLogPageParam(allPages, params.maxCount),
    enabled: enabled(repoPath) && tuning.isSuccess,
  });
}

export function useWorkingTreeDiff(
  repoPath: string | null,
  paths?: readonly string[],
): UseQueryResult<DiffFile[], GitQueryError> {
  return useQuery({
    queryKey: gitKeys.diff(repoPath ?? '', 'worktree', paths ?? null),
    queryFn: async ({ signal }) =>
      unwrap(
        await diffService(repoPath ?? '').workingTree({
          signal,
          ...(paths !== undefined && { paths }),
        }),
      ),
    enabled: enabled(repoPath),
  });
}

export function useStagedDiff(
  repoPath: string | null,
  paths?: readonly string[],
): UseQueryResult<DiffFile[], GitQueryError> {
  return useQuery({
    queryKey: gitKeys.diff(repoPath ?? '', 'staged', paths ?? null),
    queryFn: async ({ signal }) =>
      unwrap(
        await diffService(repoPath ?? '').staged({
          signal,
          ...(paths !== undefined && { paths }),
        }),
      ),
    enabled: enabled(repoPath),
  });
}

/*
 * There is no `useCommitDiff`, deliberately (PLAN.md §10, Phase 7.7).
 *
 * One existed, unused, calling `DiffService.commit(oid)` with no `paths` where
 * the two queries above both take a scope. Measured against the bench
 * repository that unscoped call returns **187.6MB in a single buffered
 * string** — the same payload class as the unbounded `git log` this codebase
 * streams specifically to avoid — while the same command scoped to one path is
 * 70ms and 319B.
 *
 * It is gone rather than fixed because nothing rendered it: a commit-diff view
 * does not exist in the app, so the hook was a shape waiting for someone to
 * wire it up and inherit the payload. If that view is built, write the query
 * with a required path scope and these numbers in front of you.
 */

/** One directory's entries, with git's verdict on each attached. */
export interface DirEntry extends FileInfo {
  /** Repo-relative path, which is what every other part of the app keys on. */
  readonly relPath: string;
  readonly ignored: boolean;
}

/**
 * A single level of the explorer tree.
 *
 * Lazy by directory rather than a recursive walk: the PRD's target is 500k
 * files, and the only listing that stays constant-time at that size is the one
 * the user actually opened.
 *
 * Two calls, not one — `listDir` reads the filesystem (so untracked files
 * appear) and `check-ignore` supplies the one fact the filesystem does not
 * have. They are in a single query because a half-loaded row would render as
 * un-ignored and then dim a moment later.
 */
export function useDirectory(
  repoPath: string | null,
  dir: string,
): UseQueryResult<DirEntry[], GitQueryError> {
  return useQuery({
    queryKey: gitKeys.dir(repoPath ?? '', dir),
    queryFn: async ({ signal }): Promise<DirEntry[]> => {
      const base = repoPath ?? '';
      const entries = await listDir(dir === '' ? base : `${base}/${dir}`);

      // `.git` is not part of the working tree in any sense the user cares
      // about, and walking into it is a way to find a thousand loose objects.
      const visible = entries.filter((entry) => !(dir === '' && entry.name === '.git'));
      const relative = visible.map((entry) => (dir === '' ? entry.name : `${dir}/${entry.name}`));

      const ignored = unwrap(await treeService(base).ignored(relative, { signal }));
      return visible.map((entry, index) => {
        const relPath = relative[index] ?? entry.name;
        return { ...entry, relPath, ignored: ignored.has(relPath) };
      });
    },
    enabled: enabled(repoPath),
  });
}

/** Every path in the repository, flat — the corpus quick open matches against. */
export function usePaths(repoPath: string | null): UseQueryResult<string[], GitQueryError> {
  return useQuery({
    queryKey: gitKeys.paths(repoPath ?? ''),
    queryFn: async ({ signal }) => unwrap(await treeService(repoPath ?? '').listPaths({ signal })),
    enabled: enabled(repoPath),
  });
}

export function useStashes(repoPath: string | null): UseQueryResult<Stash[], GitQueryError> {
  return useQuery({
    queryKey: gitKeys.stashes(repoPath ?? ''),
    queryFn: async ({ signal }) => unwrap(await stashService(repoPath ?? '').list({ signal })),
    enabled: enabled(repoPath),
  });
}

export function useRemotes(repoPath: string | null): UseQueryResult<Remote[], GitQueryError> {
  return useQuery({
    queryKey: gitKeys.remotes(repoPath ?? ''),
    queryFn: async ({ signal }) => unwrap(await remoteService(repoPath ?? '').list({ signal })),
    enabled: enabled(repoPath),
  });
}

/**
 * The repository's config for one scope.
 *
 * `effective` is the merge of system, global and local — what the repository
 * will actually behave like — and the settings panel reads both it and `local`
 * so it can tell "set here" from "inherited from your global config".
 */
export function useRepoConfig(
  repoPath: string | null,
  scope: ConfigScope,
): UseQueryResult<ConfigEntry[], GitQueryError> {
  return useQuery({
    queryKey: gitKeys.config(repoPath ?? '', scope),
    queryFn: async ({ signal }) =>
      unwrap(await configService(repoPath ?? '').list(scope, { signal })),
    enabled: enabled(repoPath),
  });
}

/**
 * An ignore file's text.
 *
 * Missing is empty, not an error — a repository with no `.gitignore` is the
 * normal starting state, and the editor should open on a blank file that
 * saving will create. That is `readIgnoreFile`'s own behaviour, so this never
 * fails for the common case.
 */
export function useIgnoreFileText(
  repoPath: string | null,
  file: IgnoreFileId,
): UseQueryResult<string, Error> {
  return useQuery({
    queryKey: gitKeys.ignoreText(repoPath ?? '', file),
    queryFn: () => readIgnoreFile(repoPath ?? '', file),
    enabled: enabled(repoPath),
  });
}

/** Which rule ignores each path, for the ignore editor's explainer. */
export function useIgnoreRules(
  repoPath: string | null,
  paths: readonly string[],
): UseQueryResult<IgnoreRule[], GitQueryError> {
  return useQuery({
    queryKey: [repoPath ?? '', 'checkIgnore', paths],
    queryFn: async ({ signal }) =>
      unwrap(await ignoreService(repoPath ?? '').explain(paths, { signal })),
    enabled: enabled(repoPath) && paths.length > 0,
  });
}

export function useBlame(
  repoPath: string | null,
  path: string | null,
  revision?: string,
): UseQueryResult<Blame, GitQueryError> {
  return useQuery({
    queryKey: gitKeys.blame(repoPath ?? '', path ?? '', revision),
    queryFn: async ({ signal }) =>
      unwrap(
        await blameService(repoPath ?? '').blame(path ?? '', {
          signal,
          ...(revision !== undefined && { revision }),
        }),
      ),
    enabled: enabled(repoPath) && path !== null && path !== '',
  });
}
