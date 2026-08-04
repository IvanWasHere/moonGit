import { useQuery, type UseQueryResult } from '@tanstack/react-query';
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
} from '@/services/git';
import { readIgnoreFile, type IgnoreFileId } from '@/services/ignoreFiles';
import { listDir, type FileInfo } from '@/services/wails';
import { gitKeys } from './keys';

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

export function useStatus(repoPath: string | null): UseQueryResult<RepoStatus, GitQueryError> {
  return useQuery({
    queryKey: gitKeys.status(repoPath ?? ''),
    queryFn: async ({ signal }) =>
      unwrap(await repositoryService(repoPath ?? '').status({ signal })),
    enabled: enabled(repoPath),
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

export function useLog(
  repoPath: string | null,
  params: LogParams = {},
): UseQueryResult<Commit[], GitQueryError> {
  return useQuery({
    queryKey: gitKeys.log(repoPath ?? '', params),
    // The service streams internally; the promise resolves with everything.
    // Progressive rendering uses `onBatch` directly rather than this hook.
    queryFn: async ({ signal }) =>
      unwrap(await commitService(repoPath ?? '').list({ ...params, signal })),
    enabled: enabled(repoPath),
  });
}

export function useCommit(
  repoPath: string | null,
  oid: string | null,
): UseQueryResult<Commit | null, GitQueryError> {
  return useQuery({
    queryKey: gitKeys.commit(repoPath ?? '', oid ?? ''),
    queryFn: async ({ signal }) =>
      unwrap(await commitService(repoPath ?? '').get(oid ?? '', { signal })),
    enabled: enabled(repoPath) && oid !== null && oid !== '',
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

export function useCommitDiff(
  repoPath: string | null,
  oid: string | null,
): UseQueryResult<DiffFile[], GitQueryError> {
  return useQuery({
    queryKey: gitKeys.diff(repoPath ?? '', 'commit', oid),
    queryFn: async ({ signal }) =>
      unwrap(await diffService(repoPath ?? '').commit(oid ?? '', { signal })),
    enabled: enabled(repoPath) && oid !== null && oid !== '',
  });
}

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
