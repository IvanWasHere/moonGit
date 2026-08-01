import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import {
  blameService,
  branchService,
  commitService,
  diffService,
  remoteService,
  repositoryService,
  stashService,
  type Blame,
  type Commit,
  type DiffFile,
  type GitError,
  type RefCollection,
  type Remote,
  type RepoStatus,
  type Result,
  type Stash,
} from '@/services/git';
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

export interface LogParams {
  readonly maxCount?: number;
  readonly revisions?: readonly string[];
  readonly paths?: readonly string[];
  readonly firstParent?: boolean;
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
