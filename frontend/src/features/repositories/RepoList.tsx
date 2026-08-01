import { useNavigate } from 'react-router-dom';
import { EmptyState } from '@/components/EmptyState';
import { Icons } from '@/components/icons';
import { ListItem } from '@/components/ListItem';
import { PanelBody } from '@/components/Panel';
import { useRepositoriesByName, useTouchRepository } from '@/queries/repositories';
import { useWorkspaceStore } from '@/stores/workspaceStore';

/**
 * The repository switcher (ui-example L509–543).
 *
 * Backed by the SQLite inventory rather than git. Switching navigates rather
 * than mutating state directly, so the current repository is in the URL and
 * survives a reload — and so the browser's back button does what it looks
 * like it should.
 *
 * Ordered by name, **not** by recency. Opening a repository updates its
 * `last_opened_at`, so a recency-ordered list would jump the clicked row to
 * the top and shift every other row out from under the cursor. A list must not
 * rearrange itself because you used it.
 *
 * The mockup showed a clean/dirty tag per repository. That would cost a
 * `git status` per row on every render, so it is not shown here; the open
 * repository's state is already in the Files panel, and Phase 6's dashboard
 * work is where a cached badge belongs.
 */
export function RepoList() {
  const navigate = useNavigate();
  const repoId = useWorkspaceStore((state) => state.repoId);
  const { data: repositories, isPending } = useRepositoriesByName();
  const touch = useTouchRepository();

  if (isPending) {
    return (
      <PanelBody>
        <EmptyState icon={Icons.Sync} message="Loading repositories…" />
      </PanelBody>
    );
  }

  if (repositories === undefined || repositories.length === 0) {
    return (
      <PanelBody>
        <EmptyState icon={Icons.Repository} message="No repositories yet" />
      </PanelBody>
    );
  }

  return (
    <PanelBody>
      {repositories.map((repo) => (
        <ListItem
          key={repo.id}
          selected={repoId === repo.id}
          onClick={() => {
            touch.mutate(repo.id);
            void navigate(`/repo/${repo.id}/main`);
          }}
          icon={
            <Icons.Repository
              size={12}
              color={repoId === repo.id ? 'var(--accent)' : 'var(--text-muted)'}
            />
          }
          name={repo.name}
          {...(repo.isFavorite && {
            tag: <Icons.Favorite size={11} color="var(--accent)" />,
          })}
        />
      ))}
    </PanelBody>
  );
}
