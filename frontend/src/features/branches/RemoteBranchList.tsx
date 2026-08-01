import { BranchTag } from '@/components/Badges';
import { EmptyState } from '@/components/EmptyState';
import { Icons } from '@/components/icons';
import { ListItem } from '@/components/ListItem';
import { PanelBody } from '@/components/Panel';
import { branchesForRepo } from '@/fixtures/workspace';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { AheadBehind } from './BranchList';

/**
 * Origin Branch pane in the Review view (ui-example L661–686).
 *
 * Differs from `BranchList` in three ways the mockup establishes: rows are not
 * selectable, the active branch is marked by a green left border rather than
 * the selection highlight, and a branch level with its upstream reads
 * "synced" instead of showing nothing.
 */
export function RemoteBranchList() {
  const selectedRepoId = useWorkspaceStore((state) => state.selectedRepoId);

  if (selectedRepoId === null) {
    return (
      <PanelBody>
        <EmptyState icon={Icons.Branch} message="No repository selected" />
      </PanelBody>
    );
  }

  return (
    <PanelBody>
      {branchesForRepo(selectedRepoId).map((branch) => (
        <ListItem
          key={branch.id}
          accent={branch.isActive ? 'var(--green)' : 'transparent'}
          icon={
            <Icons.Branch
              size={12}
              color={branch.isActive ? 'var(--green)' : 'var(--text-muted)'}
            />
          }
          name={branch.name}
          tag={<BranchTag type={branch.type} />}
          metaBefore={branch.lastCommit}
          meta={
            branch.ahead > 0 || branch.behind > 0 ? (
              <AheadBehind ahead={branch.ahead} behind={branch.behind} />
            ) : (
              'synced'
            )
          }
        />
      ))}
    </PanelBody>
  );
}
