import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { repositoryService } from '@/services/git';
import {
  addRepository,
  findRepositoryByPath,
  listRepositories,
  listRepositoriesByName,
  removeRepository,
  setFavorite,
  touchRepository,
  type RepositoryRecord,
} from '@/services/db/repositories';
import { getPreference, setPreference } from '@/services/db/keyValue';
import { selectDirectory, showMessage } from '@/services/wails';

/**
 * The repository inventory: SQLite rows, not git.
 *
 * Kept separate from `queries/git.ts` because it is invalidated by the user
 * adding or removing a repository, never by the file watcher — mixing it into
 * the git keys would mean a file save re-reading the dashboard.
 */

export const dbKeys = {
  repositories: () => ['db', 'repositories'] as const,
  repository: (id: number | null) => ['db', 'repository', id] as const,
  lastRepository: () => ['db', 'lastRepository'] as const,
};

/**
 * The repository to reopen on launch.
 *
 * Stored as a preference rather than inferred from `last_opened_at`, because
 * those are different questions: "which did I have open" survives the user
 * browsing the dashboard, which would otherwise change the answer.
 */
const LAST_REPO_KEY = 'workspace.lastRepositoryId';

export function useLastRepositoryId(): UseQueryResult<number | null, Error> {
  return useQuery({
    queryKey: dbKeys.lastRepository(),
    queryFn: () => getPreference<number | null>(LAST_REPO_KEY, null),
  });
}

export async function rememberLastRepository(id: number | null): Promise<void> {
  await setPreference(LAST_REPO_KEY, id);
}

export function useRepositories(): UseQueryResult<RepositoryRecord[], Error> {
  return useQuery({
    queryKey: dbKeys.repositories(),
    queryFn: listRepositories,
  });
}

/**
 * The workspace switcher's list — alphabetical, so selecting a repository
 * never moves the rows around it. See `listRepositoriesByName`.
 */
export function useRepositoriesByName(): UseQueryResult<RepositoryRecord[], Error> {
  return useQuery({
    queryKey: [...dbKeys.repositories(), 'byName'],
    queryFn: listRepositoriesByName,
  });
}

export function useRepository(id: number | null): UseQueryResult<RepositoryRecord | null, Error> {
  return useQuery({
    queryKey: dbKeys.repository(id),
    queryFn: async () => {
      const all = await listRepositories();
      return all.find((repo) => repo.id === id) ?? null;
    },
    enabled: id !== null,
  });
}

export interface OpenRepositoryResult {
  readonly status: 'opened' | 'cancelled' | 'not-a-repository';
  readonly repository?: RepositoryRecord;
  readonly path?: string;
}

/**
 * Ask for a directory, check it is a repository, and record it.
 *
 * The check matters: a user who picks their Documents folder should be told
 * so, not have a broken entry added to their list that fails every command
 * from then on. `isRepository` answers with a boolean rather than an error
 * precisely for this call site.
 */
export function useOpenRepository() {
  const queryClient = useQueryClient();

  return useMutation<OpenRepositoryResult, Error, void>({
    mutationFn: async () => {
      const path = await selectDirectory('Open Repository');
      // An empty string is the cancel signal, not a failure.
      if (path === '') return { status: 'cancelled' };

      const isRepo = await repositoryService(path).isRepository();
      if (!isRepo) return { status: 'not-a-repository', path };

      // Store the work-tree root: the user may have picked a subdirectory, and
      // every panel should agree on what "this repository" means.
      const root = await repositoryService(path).root();
      const resolved = root.ok && root.value !== '' ? root.value : path;

      const name = resolved.split('/').filter(Boolean).pop() ?? resolved;
      const repository = await addRepository(resolved, name);
      await touchRepository(repository.id);

      return { status: 'opened', repository, path: resolved };
    },
    onSuccess: async (result) => {
      if (result.status === 'opened') {
        await queryClient.invalidateQueries({ queryKey: dbKeys.repositories() });
      } else if (result.status === 'not-a-repository') {
        await showMessage({
          kind: 'warning',
          title: 'Not a repository',
          message: `${result.path ?? ''} is not a git repository.`,
        });
      }
    },
  });
}

export function useToggleFavorite() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, { id: number; favorite: boolean }>({
    mutationFn: ({ id, favorite }) => setFavorite(id, favorite),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: dbKeys.repositories() }),
  });
}

/** Forgets the repository. The directory on disk is never touched. */
export function useForgetRepository() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, number>({
    mutationFn: removeRepository,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: dbKeys.repositories() }),
  });
}

export function useTouchRepository() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, number>({
    mutationFn: async (id) => {
      await touchRepository(id);
      await rememberLastRepository(id);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: dbKeys.repositories() }),
  });
}

export { findRepositoryByPath };
