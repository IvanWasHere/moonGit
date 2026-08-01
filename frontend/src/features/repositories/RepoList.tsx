import { BranchTag } from '@/components/Badges';
import { Icons } from '@/components/icons';
import { ListItem } from '@/components/ListItem';
import { PanelBody } from '@/components/Panel';
import { activeBranchFor, repos } from '@/fixtures/workspace';
import { useWorkspaceStore } from '@/stores/workspaceStore';

/**
 * Repository list (ui-example L509–543).
 *
 * Selecting a repository also resolves its active branch, because every other
 * panel is scoped to a branch and leaving that null would empty the workspace
 * until the user clicked twice (the mockup does the same at L531–534).
 */
export function RepoList() {
  const selectedRepoId = useWorkspaceStore((state) => state.selectedRepoId);
  const selectRepo = useWorkspaceStore((state) => state.selectRepo);

  return (
    <PanelBody>
      {repos.map((repo) => (
        <ListItem
          key={repo.id}
          selected={selectedRepoId === repo.id}
          onClick={() => selectRepo(repo.id, activeBranchFor(repo.id)?.id ?? null)}
          icon={<Icons.Repository size={12} color="var(--accent)" />}
          name={repo.name}
          tag={<BranchTag type={repo.status === 'dirty' ? 'dirty' : 'clean'} />}
        />
      ))}
    </PanelBody>
  );
}
