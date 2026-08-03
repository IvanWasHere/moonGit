import { useMemo, useState } from 'react';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { Icons } from '@/components/icons';
import { useStatus } from '@/queries/git';
import { useStage } from '@/queries/mutations';
import { isConflicted, type StatusEntry } from '@/services/git';
import { openPath, readFile, writeFile } from '@/services/wails';
import { showToast } from '@/stores/notificationStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useRebaseState } from '@/features/rebase/useRebaseState';
import { useMergeFile } from './useMergeFile';
import {
  choiceFor,
  fromLines,
  linesFor,
  resolvedLines,
  undecided,
  type Choice,
  type Choices,
  type MergeRegion,
} from './threeWay';
import styles from './MergeModal.module.css';

/**
 * The three-way merge tool (PLAN.md §9.3).
 *
 * **The result column sits in the middle**, not on the right, so each side is
 * adjacent to what it would produce — comparing "theirs" against the result
 * across the width of "ours" is the thing every three-pane tool that puts the
 * result last gets wrong.
 *
 * Every region where the two sides differ is listed, not only the ones git
 * could not decide. The auto-resolved ones arrive with a side already chosen
 * and can be overridden; the conflicts arrive with nothing chosen, and saving
 * is blocked until each has an answer. Defaulting a conflict silently is how a
 * merge tool loses somebody's work.
 *
 * The escape hatch is the file itself: "Edit in editor" writes the resolution
 * so far to disk and opens it, and from then on **the file wins** — the
 * watcher reloads it and the region choices stop driving the result, because
 * two sources of truth for one file is worse than either.
 */
export function MergeModal({ onClose }: { readonly onClose: () => void }) {
  const repoPath = useWorkspaceStore((state) => state.repoPath);
  const { data: status } = useStatus(repoPath);

  const conflicts = useMemo(() => (status?.entries ?? []).filter(isConflicted), [status]);
  // Deriving the entry rather than syncing it means a file resolved out from
  // under the user falls back to the next conflict on its own.
  const [path, setPath] = useState<string | null>(null);
  const entry = conflicts.find((candidate) => candidate.path === path) ?? conflicts[0] ?? null;

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-label="Resolve merge conflicts"
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.header}>
          <Icons.Merge size={14} color="var(--accent)" />
          <span className={styles.title}>Resolve conflicts</span>
          <span className={styles.count}>
            {conflicts.length} {conflicts.length === 1 ? 'file' : 'files'}
          </span>
          <button type="button" className={styles.close} title="Close" onClick={onClose}>
            <Icons.Remove size={14} />
          </button>
        </header>

        {conflicts.length === 0 ? (
          <div className={styles.body}>
            <EmptyState icon={Icons.Clean} message="No conflicted files" />
          </div>
        ) : (
          <div className={styles.split}>
            <nav className={styles.files}>
              {conflicts.map((candidate) => (
                <button
                  type="button"
                  key={candidate.path}
                  className={`${styles.fileRow} ${candidate.path === entry?.path ? styles.fileActive : ''}`}
                  onClick={() => setPath(candidate.path)}
                  title={candidate.path}
                >
                  {candidate.path}
                </button>
              ))}
            </nav>
            {entry !== null && repoPath !== null && (
              <MergeFileView key={entry.path} repoPath={repoPath} entry={entry} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function MergeFileView({
  repoPath,
  entry,
}: {
  readonly repoPath: string;
  readonly entry: StatusEntry;
}) {
  const { data, isPending, error } = useMergeFile(repoPath, entry);
  const stage = useStage(repoPath);
  const rebasing = useRebaseState(repoPath).active;

  const [choices, setChoices] = useState<Choices>({});
  /** Set once the file has been edited outside the region model; the file then wins. */
  const [detached, setDetached] = useState<string | null>(null);

  const absolutePath = `${repoPath}/${entry.path}`;
  const regions = data?.regions ?? [];
  const pending = undecided(regions, choices);
  const resultLines = resolvedLines(regions, choices);
  const resultText = detached ?? fromLines(resultLines);

  const save = async (alsoStage: boolean) => {
    try {
      await writeFile(absolutePath, resultText);
      if (alsoStage) {
        // Staging a conflicted path is what tells git it is resolved.
        stage.mutate({ paths: [entry.path] });
      }
      showToast(alsoStage ? `${entry.path} resolved` : `${entry.path} saved`, 'success');
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : 'Could not write the file', 'error');
    }
  };

  /**
   * Hand the file to the user's editor.
   *
   * The resolution so far is written first — opening a file still full of
   * git's conflict markers, having just spent time on the regions, would throw
   * that work away. After this the file is the source of truth.
   *
   * `openPath`, not `openExternal`: the latter refuses every scheme but
   * http/https/mailto, so it rejected the file path outright. Caught when the
   * file context menu needed the same call.
   */
  const editExternally = async () => {
    try {
      await writeFile(absolutePath, resultText);
      await openPath(absolutePath);
      const content = await readFile(absolutePath);
      setDetached(content.text ?? resultText);
      showToast('Opened in your editor — this file now drives the result', 'info');
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : 'Could not open the file', 'error');
    }
  };

  const reload = async () => {
    const content = await readFile(absolutePath);
    setDetached(content.text ?? '');
  };

  if (error !== null) {
    return (
      <div className={styles.body}>
        <EmptyState icon={Icons.Abort} message={error.message} />
      </div>
    );
  }
  if (isPending) {
    return (
      <div className={styles.body}>
        <EmptyState icon={Icons.Sync} message="Reading the three sides…" />
      </div>
    );
  }
  if (data.problem !== null) {
    return (
      <div className={styles.body}>
        <EmptyState icon={Icons.Abort} message={data.problem} />
      </div>
    );
  }

  return (
    <div className={styles.pane}>
      <div className={styles.columnHeads}>
        {/*
         * Git swaps what "ours" means during a rebase, and calling the wrong
         * side "current branch" while replaying commits onto another one would
         * have the user pick the opposite of what they meant. Mid-rebase,
         * "ours" is the branch being replayed *onto* and "theirs" is the commit
         * being applied — the reverse of a merge.
         */}
        <div className={styles.colOurs}>
          {rebasing ? 'Ours (the new base)' : 'Ours (current branch)'}
        </div>
        <div className={styles.colResult}>Result</div>
        <div className={styles.colTheirs}>
          {rebasing ? 'Theirs (commit being replayed)' : 'Theirs (incoming)'}
        </div>
      </div>

      {detached !== null && (
        <div className={styles.detached}>
          <span>
            Edited on disk — the file drives the result now, and the buttons below no longer apply.
          </span>
          <Button size="sm" onClick={() => void reload()}>
            Reload from disk
          </Button>
          <Button size="sm" onClick={() => setDetached(null)}>
            Go back to region choices
          </Button>
        </div>
      )}

      <div className={styles.regions}>
        {detached !== null ? (
          <pre className={styles.detachedText}>{detached}</pre>
        ) : (
          regions.map((region) => (
            <RegionRow
              key={region.id}
              region={region}
              choice={choiceFor(region, choices)}
              onChoose={(choice) => setChoices((current) => ({ ...current, [region.id]: choice }))}
            />
          ))
        )}
      </div>

      <footer className={styles.footer}>
        <span className={styles.status}>
          {detached !== null
            ? 'Editing the file directly'
            : pending.length === 0
              ? 'All regions decided'
              : `${pending.length} conflict${pending.length === 1 ? '' : 's'} left to decide`}
        </span>
        <Button size="sm" onClick={() => void editExternally()}>
          Edit in editor
        </Button>
        <Button size="sm" onClick={() => void save(false)}>
          Save
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={detached === null && pending.length > 0}
          onClick={() => void save(true)}
        >
          Save &amp; mark resolved
        </Button>
      </footer>
    </div>
  );
}

const CHOICES: readonly { readonly value: Choice; readonly label: string }[] = [
  { value: 'ours', label: 'Ours' },
  { value: 'theirs', label: 'Theirs' },
  { value: 'base', label: 'Base' },
  { value: 'oursThenTheirs', label: 'Both' },
  { value: 'theirsThenOurs', label: 'Both ↕' },
];

const KIND_LABEL: Record<MergeRegion['kind'], string> = {
  identical: '',
  ours: 'auto: ours',
  theirs: 'auto: theirs',
  agreed: 'both made this change',
  conflict: 'conflict',
};

function RegionRow({
  region,
  choice,
  onChoose,
}: {
  readonly region: MergeRegion;
  readonly choice: Choice | null;
  readonly onChoose: (choice: Choice) => void;
}) {
  // Shared text is context, not a decision — one column wide, no buttons.
  if (region.kind === 'identical') {
    return (
      <div className={styles.identical}>
        <Lines lines={region.base} />
      </div>
    );
  }

  const result = choice === null ? null : linesFor(region, choice);
  // The label says what *git* did; the highlighted button says what is chosen
  // now. When they disagree the label alone reads as a bug, so it says so.
  const overridden = region.suggested !== null && choice !== region.suggested;

  return (
    <div className={`${styles.region} ${region.kind === 'conflict' ? styles.conflictRegion : ''}`}>
      <div className={styles.regionBar}>
        <span className={styles.kind}>
          {KIND_LABEL[region.kind]}
          {overridden && <span className={styles.overridden}> · overridden</span>}
        </span>
        <div className={styles.buttons}>
          {CHOICES.map((option) => (
            <button
              type="button"
              key={option.value}
              className={`${styles.choice} ${choice === option.value ? styles.chosen : ''}`}
              onClick={() => onChoose(option.value)}
              title={
                option.value === 'oursThenTheirs'
                  ? 'Keep both — ours first'
                  : option.value === 'theirsThenOurs'
                    ? 'Keep both — theirs first'
                    : `Take ${option.label.toLowerCase()}`
              }
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.columns}>
        <div className={`${styles.cell} ${styles.ours}`}>
          <Lines lines={region.ours} />
        </div>
        <div className={`${styles.cell} ${styles.result}`}>
          {result === null ? (
            <span className={styles.undecided}>— undecided —</span>
          ) : (
            <Lines lines={result} />
          )}
        </div>
        <div className={`${styles.cell} ${styles.theirs}`}>
          <Lines lines={region.theirs} />
        </div>
      </div>
    </div>
  );
}

/** An empty side is a real answer — "this side removed these lines" — and says so. */
function Lines({ lines }: { readonly lines: readonly string[] }) {
  if (lines.length === 0) return <span className={styles.nothing}>(nothing)</span>;
  return (
    <>
      {lines.map((line, index) => (
        <div key={index} className={styles.line}>
          {line === '' ? ' ' : line}
        </div>
      ))}
    </>
  );
}
