import { StatusBadge } from '@/components/Badges';
import { EmptyState } from '@/components/EmptyState';
import { Icons } from '@/components/icons';
import { PanelBody } from '@/components/Panel';
import { changesFor, files } from '@/fixtures/workspace';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import styles from './DiffPane.module.css';

/**
 * The Changes pane (ui-example L611–631).
 *
 * Two distinct empty states, which the mockup is careful about and which say
 * different things: nothing selected, versus a file with no diff to show.
 * Collapsing them would leave the user unsure whether they had clicked.
 */
export function DiffPane() {
  const selectedFileId = useWorkspaceStore((state) => state.selectedFileId);

  if (selectedFileId === null) {
    return (
      <PanelBody>
        <EmptyState icon={Icons.Diff} message="Select a file to view changes" />
      </PanelBody>
    );
  }

  const file = files.find((entry) => entry.id === selectedFileId);
  const lines = changesFor(selectedFileId);

  if (file === undefined || lines.length === 0) {
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
          <span>{file.path}</span>
          <StatusBadge status={file.status} />
        </div>
        {lines.map((line, index) => (
          <div
            // Diff lines have no id and repeat freely — position is their identity.
            key={index}
            className={`${styles.line} ${styles[line.type] ?? ''}`}
          >
            <div className={styles.lineNumber}>{line.lineFrom}</div>
            <div className={styles.code}>{line.content}</div>
          </div>
        ))}
      </div>
    </PanelBody>
  );
}
