import { createContext, useContext, useMemo, useState } from 'react';
import { StatusBadge } from '@/components/Badges';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { Icons } from '@/components/icons';
import { PanelBody } from '@/components/Panel';
import { useStagedDiff, useWorkingTreeDiff } from '@/queries/git';
import { hasRenderableDiff, type DiffFile, type DiffLine } from '@/services/git';
import { useWorkspaceStore, type DiffViewMode } from '@/stores/workspaceStore';
import styles from './DiffPane.module.css';
import {
  alignFile,
  isLargeDiff,
  renderedLineCount,
  type AlignedHunk,
  type SplitRow,
  type ViewLine,
} from './diffView';
import { mergeSpans, type SyntaxToken } from './highlight';
import { ImageDiff } from './ImageDiff';
import { useDiffHighlight, type DiffHighlight } from './useDiffHighlight';

/**
 * Real patches in the mockup's `.diff-line` renderer (ui-example L611–631),
 * with the two things the mockup's single view could not do: side-by-side, and
 * intra-line marks (PLAN.md §9.1).
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
      <DiffFileView file={file} />
    </PanelBody>
  );
}

/**
 * Tokens for the file on screen, read by every line without threading them
 * through four levels of props. Empty until (and unless) they arrive.
 */
const HighlightContext = createContext<DiffHighlight>({ old: null, next: null });

function DiffFileView({ file }: { readonly file: DiffFile }) {
  const repoPath = useWorkspaceStore((state) => state.repoPath);
  const mode = useWorkspaceStore((state) => state.diffView);
  const setMode = useWorkspaceStore((state) => state.setDiffView);

  // The override is keyed by path rather than a boolean, so selecting a
  // different large file re-arms the guard instead of inheriting the last
  // file's "show anyway".
  const [shown, setShown] = useState<string | null>(null);

  // No blobs are read for a diff that is not on screen: a binary file, a
  // conflict, or a large one still behind its guard.
  const rendering = hasRenderableDiff(file) && (!isLargeDiff(file) || shown === file.path);
  const highlight = useDiffHighlight(repoPath, rendering ? file : null);

  return (
    <div className={styles.file}>
      <div className={styles.fileHeader}>
        <Icons.File size={12} color="var(--accent)" />
        <span className={styles.path}>
          {file.oldPath !== undefined ? `${file.oldPath} → ${file.path}` : file.path}
        </span>
        <StatusBadge status={file.kind} />
        <div className={styles.headerRight}>
          {(file.additions > 0 || file.deletions > 0) && (
            <span className={styles.stats}>
              <span className={styles.statAdd}>+{file.additions}</span>
              <span className={styles.statRemove}>−{file.deletions}</span>
            </span>
          )}
          <ViewModeToggle mode={mode} onChange={setMode} />
        </div>
      </div>
      <HighlightContext.Provider value={highlight}>
        <DiffBody
          file={file}
          mode={mode}
          shown={shown === file.path}
          onShow={() => setShown(file.path)}
          repoPath={repoPath}
        />
      </HighlightContext.Provider>
    </div>
  );
}

function ViewModeToggle({
  mode,
  onChange,
}: {
  readonly mode: DiffViewMode;
  readonly onChange: (mode: DiffViewMode) => void;
}) {
  return (
    <div className={styles.toggle} role="group" aria-label="Diff view">
      <button
        type="button"
        className={`${styles.toggleButton} ${mode === 'inline' ? styles.toggleActive : ''}`}
        title="Unified view"
        aria-pressed={mode === 'inline'}
        onClick={() => onChange('inline')}
      >
        <Icons.DiffInline size={11} />
      </button>
      <button
        type="button"
        className={`${styles.toggleButton} ${mode === 'split' ? styles.toggleActive : ''}`}
        title="Side-by-side view"
        aria-pressed={mode === 'split'}
        onClick={() => onChange('split')}
      >
        <Icons.DiffSplit size={11} />
      </button>
    </div>
  );
}

/**
 * Files git will not diff need saying so rather than rendering as empty.
 * "No changes" and "a change I cannot show you" are different answers.
 */
function DiffBody({
  file,
  mode,
  shown,
  onShow,
  repoPath,
}: {
  readonly file: DiffFile;
  readonly mode: DiffViewMode;
  readonly shown: boolean;
  readonly onShow: () => void;
  readonly repoPath: string | null;
}) {
  const aligned = useMemo(() => alignFile(file), [file]);

  if (file.isBinary) {
    // Git refuses to diff an image, which is the case where seeing the change
    // matters most. `ImageDiff` falls back to git's own answer for a binary
    // that is not a picture.
    return repoPath === null ? (
      <div className={styles.notice}>Binary file — no textual diff</div>
    ) : (
      <ImageDiff file={file} repoPath={repoPath} />
    );
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
  if (isLargeDiff(file) && !shown) {
    return (
      <div className={styles.guard}>
        <div className={styles.guardText}>
          {renderedLineCount(file).toLocaleString()} changed lines — large enough to make the window
          unresponsive while it renders.
        </div>
        <Button size="sm" onClick={onShow}>
          Show anyway
        </Button>
      </div>
    );
  }

  return mode === 'split' ? <SplitView hunks={aligned} /> : <InlineView hunks={aligned} />;
}

function InlineView({ hunks }: { readonly hunks: readonly AlignedHunk[] }) {
  return (
    <>
      {hunks.map(({ hunk, lines }) => (
        <div key={`${hunk.oldStart}:${hunk.newStart}`}>
          <HunkHeader hunk={hunk} />
          {lines.map((view, index) => (
            <div
              key={`${hunk.oldStart}:${index}`}
              className={`${styles.line} ${styles[lineClass(view.line.kind)] ?? ''}`}
            >
              <div className={styles.lineNumber}>
                {view.line.newLineNo ?? view.line.oldLineNo ?? ''}
              </div>
              <div className={styles.code}>
                <Code view={view} />
              </div>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

/**
 * Side-by-side as one CSS grid rather than two scrolling columns.
 *
 * A grid row keeps a deletion and the addition that replaced it on the same
 * visual line no matter how tall either gets, which two independently
 * scrolling columns cannot promise — the moment one side wraps or grows a
 * scrollbar, the halves drift apart and the reader is comparing the wrong
 * lines. That is also why the code cells wrap here and not in the unified
 * view: wrapping grows the whole row, and both halves stay level.
 */
function SplitView({ hunks }: { readonly hunks: readonly AlignedHunk[] }) {
  return (
    <div className={styles.split}>
      {hunks.map(({ hunk, rows }) => (
        <div key={`${hunk.oldStart}:${hunk.newStart}`} className={styles.splitHunk}>
          <div className={styles.splitFull}>
            <HunkHeader hunk={hunk} />
          </div>
          {rows.map((row, index) => (
            <SplitRowCells key={`${hunk.oldStart}:${index}`} row={row} />
          ))}
        </div>
      ))}
    </div>
  );
}

function SplitRowCells({ row }: { readonly row: SplitRow }) {
  return (
    <>
      <SplitCell view={row.left} side="left" />
      <SplitCell view={row.right} side="right" />
    </>
  );
}

function SplitCell({
  view,
  side,
}: {
  readonly view: ViewLine | null;
  readonly side: 'left' | 'right';
}) {
  if (view === null) {
    return (
      <>
        <div className={`${styles.lineNumber} ${styles.empty}`} />
        <div className={`${styles.code} ${styles.empty}`} />
      </>
    );
  }

  const number = side === 'left' ? view.line.oldLineNo : view.line.newLineNo;
  const cellClass = styles[lineClass(view.line.kind)] ?? '';

  return (
    <>
      <div className={`${styles.lineNumber} ${cellClass}`}>{number ?? ''}</div>
      <div className={`${styles.code} ${styles.wrap} ${cellClass}`}>
        <Code view={view} />
      </div>
    </>
  );
}

function HunkHeader({ hunk }: { readonly hunk: AlignedHunk['hunk'] }) {
  return (
    <div className={styles.hunkHeader}>
      @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
      {hunk.header !== '' && <span className={styles.hunkContext}>{hunk.header}</span>}
    </div>
  );
}

/**
 * Which side's tokens a line is coloured from.
 *
 * A context line exists identically on both sides, so either would do; the new
 * side is preferred because it is the one the user is about to have.
 */
function tokensFor(line: DiffLine, highlight: DiffHighlight): readonly SyntaxToken[] | undefined {
  if (line.newLineNo !== null && highlight.next !== null) {
    return highlight.next[line.newLineNo - 1];
  }
  if (line.oldLineNo !== null && highlight.old !== null) {
    return highlight.old[line.oldLineNo - 1];
  }
  return undefined;
}

/**
 * A line's text: syntax colour from the grammar, background from the word diff.
 *
 * Both are optional and often absent — an unsupported language, a line still
 * loading its blob, a pair the word diff declined — and every combination
 * renders. The fast path (neither) is a bare string with no elements at all.
 */
function Code({ view }: { readonly view: ViewLine }) {
  const highlight = useContext(HighlightContext);
  const tokens = tokensFor(view.line, highlight);

  if (tokens === undefined && view.segments === undefined) return <>{view.line.content}</>;

  const spans = mergeSpans(view.line.content, tokens, view.segments);
  return (
    <>
      {spans.map((span, index) => (
        <span
          key={index}
          {...(span.changed && { className: styles.word })}
          {...(span.color !== '' && { style: { color: span.color } })}
        >
          {span.text}
        </span>
      ))}
    </>
  );
}

function lineClass(kind: DiffLine['kind']): string {
  if (kind === 'addition') return 'add';
  if (kind === 'deletion') return 'remove';
  if (kind === 'noNewline') return 'noNewline';
  return 'context';
}
