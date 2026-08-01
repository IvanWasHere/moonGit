import { StatusBadge } from '@/components/Badges';
import { EmptyState } from '@/components/EmptyState';
import { Icons } from '@/components/icons';
import { ListSectionHeader } from '@/components/ListItem';
import { PanelBody } from '@/components/Panel';
import { filesFor, type MockFile } from '@/fixtures/workspace';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { fileDir, fileName } from '@/utils/format';
import styles from './FileList.module.css';

/**
 * Working-tree file list, split into staged and unstaged sections
 * (ui-example L577–609).
 *
 * The two sections only appear when they have contents, and an entirely clean
 * tree falls through to the empty state rather than showing two empty headers.
 */
export function FileList() {
  const selectedRepoId = useWorkspaceStore((state) => state.selectedRepoId);
  const selectedBranchId = useWorkspaceStore((state) => state.selectedBranchId);

  if (selectedRepoId === null || selectedBranchId === null) {
    return (
      <PanelBody>
        <EmptyState icon={Icons.File} message="Select a repository and branch" />
      </PanelBody>
    );
  }

  const all = filesFor(selectedRepoId, selectedBranchId);
  const staged = all.filter((file) => file.staged);
  const unstaged = all.filter((file) => !file.staged);

  if (all.length === 0) {
    return (
      <PanelBody>
        <EmptyState icon={Icons.Clean} message="No changes in working directory" />
      </PanelBody>
    );
  }

  return (
    <PanelBody>
      {staged.length > 0 && (
        <>
          <ListSectionHeader tone="staged" label={`Staged Changes (${staged.length})`} />
          {staged.map((file) => (
            <FileRow key={file.id} file={file} />
          ))}
        </>
      )}
      {unstaged.length > 0 && (
        <>
          <ListSectionHeader tone="unstaged" label={`Changes (${unstaged.length})`} />
          {unstaged.map((file) => (
            <FileRow key={file.id} file={file} />
          ))}
        </>
      )}
    </PanelBody>
  );
}

function FileRow({ file }: { readonly file: MockFile }) {
  const selectedFileId = useWorkspaceStore((state) => state.selectedFileId);
  const selectFile = useWorkspaceStore((state) => state.selectFile);
  const dir = fileDir(file.path);

  return (
    <div
      className={`${styles.file} ${selectedFileId === file.id ? styles.selected : ''}`}
      onClick={() => selectFile(file.id)}
      title={file.path}
    >
      <StatusBadge status={file.status} />
      <div className={styles.path}>
        {/* Filename first, then its directory in muted text — the mockup's
            ordering (L597), which reads better in a narrow pane than a full
            path truncated from the left. */}
        <span className={styles.filename}>{fileName(file.path)}</span>
        {dir !== '' && <span className={styles.dir}>{dir}</span>}
      </div>
    </div>
  );
}
