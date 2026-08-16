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

/**
 * Remote-tracking branches, the Review view's Origin Branch pane
 * (ui-example L661–686).
 *
 * The short object id stands in for the mockup's `lastCommit` column, and
 * `origin/HEAD` is already filtered out by `groupRefs` — it only duplicates
 * whatever it points at.
 *
 * **Rows became selectable in 8.9**, because the panel's own Compare button had
 * nothing to compare against: it had no handler at all, and there was no way to
 * say *which* remote branch you meant.
 */
export function RemoteBranchList() {
  const repoPath = useWorkspaceStore((state) => state.repoPath);
  const filter = useWorkspaceStore((state) => state.panelFilters.remotes);
  const selectedRemoteBranch = useWorkspaceStore((state) => state.selectedRemoteBranch);
  const selectRemoteBranch = useWorkspaceStore((state) => state.selectRemoteBranch);
  const { data: refs, isPending, error } = useRefs(repoPath);

  if (repoPath === null) {
    return (
      <PanelBody>
        <EmptyState icon={Icons.Branch} message="No repository selected" />
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
        <EmptyState icon={Icons.Sync} message="Reading remote branches…" />
      </PanelBody>
    );
  }
  if (refs.remotes.length === 0) {
    return (
      <PanelBody>
        <EmptyState icon={Icons.Branch} message="No remote-tracking branches" />
      </PanelBody>
    );
  }

  // The subject is matched too: "which remote branch was that fix on" is a
  // question about the commit message, and the message is already on the row.
  const remotes = filterBy(refs.remotes, filter, (branch) => [branch.shortName, branch.subject]);

  return (
    <>
      <FilterBox
        panel="remotes"
        placeholder="Filter remote branches"
        matched={remotes.length}
        total={refs.remotes.length}
      />
      <PanelBody>
        {remotes.length === 0 && (
          <EmptyState icon={Icons.Branch} message="No remote branches match this filter" />
        )}
        {remotes.map((branch) => (
          <ListItem
            key={branch.name}
            selected={branch.shortName === selectedRemoteBranch}
            onClick={() => selectRemoteBranch(branch.shortName)}
            icon={<Icons.Branch size={12} color="var(--text-muted)" />}
            name={branch.shortName}
            tag={<BranchTag type={branchType(branch.shortName.split('/').slice(1).join('/'))} />}
            metaBefore={branch.oid.slice(0, 7)}
            meta={branch.subject}
          />
        ))}
      </PanelBody>
    </>
  );
}
