import { BranchTag } from '@/components/Badges';
import { EmptyState } from '@/components/EmptyState';
import { Icons } from '@/components/icons';
import { ListItem } from '@/components/ListItem';
import { PanelBody } from '@/components/Panel';
import { useRefs } from '@/queries/git';
import { FilterBox } from '@/features/search/FilterBox';
import { filterBy } from '@/features/search/matchText';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { branchType } from './branchType';
import styles from './BranchList.module.css';

/**
 * Local branches from `for-each-ref` (ui-example L545–575).
 *
 * The mockup's `type` tag came from a seeded column. Real branches have no
 * type, so it is derived from the name — `feature/x` is a feature branch by
 * the convention git-flow established, and that is exactly what the tag was
 * conveying in the mockup.
 */
export function BranchList() {
  const repoPath = useWorkspaceStore((state) => state.repoPath);
  const selectedBranch = useWorkspaceStore((state) => state.selectedBranch);
  const selectBranch = useWorkspaceStore((state) => state.selectBranch);
  const filter = useWorkspaceStore((state) => state.panelFilters.branches);
  const { data: refs, isPending, error } = useRefs(repoPath);

  if (repoPath === null) {
    return (
      <PanelBody>
        <EmptyState icon={Icons.Branch} message="Select a repository to view branches" />
      </PanelBody>
    );
  }
  if (error !== null) {
    return (
      <PanelBody>
        <EmptyState icon={Icons.Abort} message={error.message} />
      </PanelBody>
    );
  }
  if (isPending) {
    return (
      <PanelBody>
        <EmptyState icon={Icons.Sync} message="Reading branches…" />
      </PanelBody>
    );
  }
  if (refs.branches.length === 0) {
    return (
      <PanelBody>
        <EmptyState icon={Icons.Branch} message="No branches yet" />
      </PanelBody>
    );
  }

  // The checked-out branch is the selection until the user picks another, so
  // the panel below is never empty on open.
  const active = selectedBranch ?? refs.head?.shortName ?? null;
  // Matched on the name and the derived type, so `feature` finds both
  // `feature/x` and anything the convention marks as one.
  const branches = filterBy(refs.branches, filter, (branch) => [
    branch.shortName,
    branchType(branch.shortName),
  ]);

  return (
    <>
      <FilterBox
        panel="branches"
        placeholder="Filter branches"
        matched={branches.length}
        total={refs.branches.length}
      />
      <PanelBody>
        {branches.length === 0 && (
          <EmptyState icon={Icons.Branch} message="No branches match this filter" />
        )}
        {branches.map((branch) => (
          <ListItem
            key={branch.name}
            selected={active === branch.shortName}
            onClick={() => selectBranch(branch.shortName)}
            icon={
              <Icons.Branch
                size={12}
                color={branch.isHead ? 'var(--green)' : 'var(--text-muted)'}
              />
            }
            name={branch.shortName}
            tag={<BranchTag type={branchType(branch.shortName)} />}
            {...(branch.upstream !== null &&
            (branch.upstream.ahead > 0 || branch.upstream.behind > 0 || branch.upstream.gone)
              ? {
                  meta: (
                    <AheadBehind
                      ahead={branch.upstream.ahead}
                      behind={branch.upstream.behind}
                      gone={branch.upstream.gone}
                    />
                  ),
                }
              : {})}
          />
        ))}
      </PanelBody>
    </>
  );
}

export function AheadBehind({
  ahead,
  behind,
  gone,
}: {
  readonly ahead: number;
  readonly behind: number;
  readonly gone?: boolean;
}) {
  // A deleted upstream reports 0/0, which would otherwise render as "in sync"
  // — the opposite of what it means.
  if (gone === true) return <span className={styles.gone}>gone</span>;

  return (
    <>
      {ahead > 0 && <span className={styles.ahead}>+{ahead}</span>}
      {behind > 0 && <span className={styles.behind}>-{behind}</span>}
    </>
  );
}
