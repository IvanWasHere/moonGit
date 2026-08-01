import { BranchTag } from '@/components/Badges';
import { EmptyState } from '@/components/EmptyState';
import { Icons } from '@/components/icons';
import { ListItem } from '@/components/ListItem';
import { PanelBody } from '@/components/Panel';
import { branchesForRepo } from '@/fixtures/workspace';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import styles from './BranchList.module.css';

/** Branch list for the Main view (ui-example L545–575). */
export function BranchList() {
  const selectedRepoId = useWorkspaceStore((state) => state.selectedRepoId);
  const selectedBranchId = useWorkspaceStore((state) => state.selectedBranchId);
  const selectBranch = useWorkspaceStore((state) => state.selectBranch);

  if (selectedRepoId === null) {
    return (
      <PanelBody>
        <EmptyState icon={Icons.Branch} message="Select a repository to view branches" />
      </PanelBody>
    );
  }

  return (
    <PanelBody>
      {branchesForRepo(selectedRepoId).map((branch) => (
        <ListItem
          key={branch.id}
          selected={selectedBranchId === branch.id}
          onClick={() => selectBranch(branch.id)}
          icon={
            <Icons.Branch
              size={12}
              color={branch.isActive ? 'var(--green)' : 'var(--text-muted)'}
            />
          }
          name={branch.name}
          tag={<BranchTag type={branch.type} />}
          {...(branch.ahead > 0 || branch.behind > 0
            ? { meta: <AheadBehind ahead={branch.ahead} behind={branch.behind} /> }
            : {})}
        />
      ))}
    </PanelBody>
  );
}

export function AheadBehind({
  ahead,
  behind,
}: {
  readonly ahead: number;
  readonly behind: number;
}) {
  return (
    <>
      {ahead > 0 && <span className={styles.ahead}>+{ahead}</span>}
      {behind > 0 && <span className={styles.behind}>-{behind}</span>}
    </>
  );
}
