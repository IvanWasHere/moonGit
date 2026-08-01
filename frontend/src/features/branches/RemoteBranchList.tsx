import { BranchTag } from '@/components/Badges';
import { EmptyState } from '@/components/EmptyState';
import { Icons } from '@/components/icons';
import { ListItem } from '@/components/ListItem';
import { PanelBody } from '@/components/Panel';
import { useRefs } from '@/queries/git';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { branchType } from './branchType';

/**
 * Remote-tracking branches, the Review view's Origin Branch pane
 * (ui-example L661–686).
 *
 * Rows are not selectable and the short object id stands in for the mockup's
 * `lastCommit` column. `origin/HEAD` is already filtered out by `groupRefs` —
 * it only duplicates whatever it points at.
 */
export function RemoteBranchList() {
  const repoPath = useWorkspaceStore((state) => state.repoPath);
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

  return (
    <PanelBody>
      {refs.remotes.map((branch) => (
        <ListItem
          key={branch.name}
          icon={<Icons.Branch size={12} color="var(--text-muted)" />}
          name={branch.shortName}
          tag={<BranchTag type={branchType(branch.shortName.split('/').slice(1).join('/'))} />}
          metaBefore={branch.oid.slice(0, 7)}
          meta={branch.subject}
        />
      ))}
    </PanelBody>
  );
}
