import { StatusBadge } from '@/components/Badges';
import { EmptyState } from '@/components/EmptyState';
import { Icons } from '@/components/icons';
import { PanelBody } from '@/components/Panel';
import { useStagedDiff, useWorkingTreeDiff } from '@/queries/git';
import { hasRenderableDiff, type DiffFile } from '@/services/git';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import styles from './DiffPane.module.css';

/**
 * Real patches in the mockup's `.diff-line` renderer (ui-example L611–631).
 *
 * The diff is scoped to the selected path rather than fetched whole and
 * filtered: on a branch switch with hundreds of changed files, asking git for
 * the one patch being looked at is the difference between instant and not.
 *
 * Which half is shown follows the row that was clicked — the staged and
 * unstaged halves of the same file are different patches, and a user who
 * clicked the row under "Staged Changes" means that one.
 */
export function DiffPane() {
  const repoPath = useWorkspaceStore((state) => state.repoPath);
  const selected = useWorkspaceStore((state) => state.selectedFile);
  const paths = selected === null ? undefined : [selected.path];

  const worktree = useWorkingTreeDiff(selected?.side === 'worktree' ? repoPath : null, paths);
  const staged = useStagedDiff(selected?.side === 'staged' ? repoPath : null, paths);
  const query = selected?.side === 'staged' ? staged : worktree;

  if (selected === null) {
    return (
      <PanelBody>
        <EmptyState icon={Icons.Diff} message="Select a file to view changes" />
      </PanelBody>
    );
  }
  if (query.error !== null) {
    return (
      <PanelBody>
        <EmptyState icon={Icons.Abort} message={query.error.message} />
      </PanelBody>
    );
  }
  if (query.isPending) {
    return (
      <PanelBody>
        <EmptyState icon={Icons.Sync} message="Reading diff…" />
      </PanelBody>
    );
  }

  const file = query.data.find((entry) => entry.path === selected.path) ?? query.data[0];
  if (file === undefined) {
    return (
      <PanelBody>
        <EmptyState icon={Icons.NoDiff} message="No diff data available for this file" />
      </PanelBody>
    );
  }

  return (
    <PanelBody>
      <div className={styles.file}>
        <div className={styles.fileHeader}>
          <Icons.File size={12} color="var(--accent)" />
          <span>{file.oldPath !== undefined ? `${file.oldPath} → ${file.path}` : file.path}</span>
          <StatusBadge status={file.kind} />
        </div>
        <DiffBody file={file} />
      </div>
    </PanelBody>
  );
}

/**
 * Files git will not diff need saying so rather than rendering as empty.
 * "No changes" and "a change I cannot show you" are different answers.
 */
function DiffBody({ file }: { readonly file: DiffFile }) {
  if (file.isBinary) {
    return <div className={styles.notice}>Binary file — no textual diff</div>;
  }
  if (file.isCombined) {
    return (
      <div className={styles.notice}>
        Conflicted — resolve the conflict to see a diff for this file
      </div>
    );
  }
  if (file.isModeChangeOnly) {
    return (
      <div className={styles.notice}>
        Mode changed: {file.oldMode} → {file.newMode}
      </div>
    );
  }
  if (!hasRenderableDiff(file)) {
    return <div className={styles.notice}>No content change</div>;
  }

  return (
    <>
      {file.hunks.map((hunk) => (
        <div key={`${hunk.oldStart}:${hunk.newStart}`}>
          <div className={styles.hunkHeader}>
            @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
            {hunk.header !== '' && <span className={styles.hunkContext}>{hunk.header}</span>}
          </div>
          {hunk.lines.map((line, index) => (
            <div
              key={`${hunk.oldStart}:${index}`}
              className={`${styles.line} ${styles[lineClass(line.kind)] ?? ''}`}
            >
              <div className={styles.lineNumber}>{line.newLineNo ?? line.oldLineNo ?? ''}</div>
              <div className={styles.code}>{line.content}</div>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

function lineClass(kind: string): string {
  if (kind === 'addition') return 'add';
  if (kind === 'deletion') return 'remove';
  if (kind === 'noNewline') return 'noNewline';
  return 'context';
}
