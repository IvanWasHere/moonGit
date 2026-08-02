import { useMemo, useState } from 'react';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { Icons } from '@/components/icons';
import { useLog, useRefs } from '@/queries/git';
import { useMerge } from '@/queries/mutations';
import type { GitRef } from '@/services/git';
import { showToast } from '@/stores/notificationStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { timeAgo } from '@/utils/format';
import { canFastForwardOnly, defaultMergeMessage, previewOf, PREVIEW_LIMIT } from './mergePreview';
import styles from './MergeWizard.module.css';

/**
 * Picking what to merge, and seeing what that would do first (PLAN.md §9.3).
 *
 * The preview is the point. `git merge` tells you whether it fast-forwarded or
 * made a commit *after* it has done it, and by then a merge bubble is in the
 * history. Two commit counts — `HEAD..<ref>` and `<ref>..HEAD` — answer it in
 * advance, and the fast-forward option is disabled rather than offered when it
 * would fail, so the UI never lets the user pick something git will refuse.
 *
 * A conflicted result is not a failure: the wizard closes and the resolver
 * opens on it, which is the only useful next step.
 */
export function MergeWizard({ onClose }: { readonly onClose: () => void }) {
  const repoPath = useWorkspaceStore((state) => state.repoPath);
  const openMergeResolver = useWorkspaceStore((state) => state.openMerge);
  const { data: refs } = useRefs(repoPath);

  const head = refs?.head ?? null;
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  // Local branches first, then remote-tracking. The checked-out branch is not
  // in the list: merging a branch into itself is always "already up to date".
  const candidates = useMemo(() => {
    const all = [...(refs?.branches ?? []), ...(refs?.remotes ?? [])].filter(
      (ref) => !ref.isHead && ref.symrefTarget === null,
    );
    const needle = filter.trim().toLowerCase();
    return needle === '' ? all : all.filter((ref) => ref.shortName.toLowerCase().includes(needle));
  }, [refs, filter]);

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-label="Merge a branch"
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.header}>
          <Icons.Merge size={14} color="var(--accent)" />
          <span className={styles.title}>Merge into</span>
          <span className={styles.branch}>{head?.shortName ?? 'detached HEAD'}</span>
          <button type="button" className={styles.close} title="Close" onClick={onClose}>
            <Icons.Remove size={14} />
          </button>
        </header>

        {head === null ? (
          <div className={styles.empty}>
            <EmptyState
              icon={Icons.Abort}
              message="HEAD is detached — check out a branch before merging"
            />
          </div>
        ) : (
          <div className={styles.split}>
            <div className={styles.picker}>
              <input
                className={styles.search}
                placeholder="Filter branches"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
              <div className={styles.branchList}>
                {candidates.length === 0 ? (
                  <div className={styles.none}>No other branches</div>
                ) : (
                  candidates.map((ref) => (
                    <BranchRow
                      key={ref.name}
                      branch={ref}
                      selected={ref.shortName === selected}
                      onSelect={() => setSelected(ref.shortName)}
                    />
                  ))
                )}
              </div>
            </div>

            {selected === null ? (
              <div className={styles.empty}>
                <EmptyState icon={Icons.Branch} message="Choose a branch to merge" />
              </div>
            ) : (
              <MergePlan
                key={selected}
                repoPath={repoPath}
                ref_={selected}
                into={head.shortName}
                onDone={onClose}
                onConflict={() => {
                  onClose();
                  openMergeResolver();
                }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function BranchRow({
  branch,
  selected,
  onSelect,
}: {
  readonly branch: GitRef;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`${styles.branchRow} ${selected ? styles.branchActive : ''}`}
      onClick={onSelect}
      title={branch.name}
    >
      <Icons.Branch
        size={11}
        color={branch.kind === 'remote' ? 'var(--text-muted)' : 'var(--green)'}
      />
      <span className={styles.branchName}>{branch.shortName}</span>
      {branch.date !== null && <span className={styles.age}>{timeAgo(branch.date * 1000)}</span>}
    </button>
  );
}

function MergePlan({
  repoPath,
  ref_,
  into,
  onDone,
  onConflict,
}: {
  readonly repoPath: string | null;
  readonly ref_: string;
  readonly into: string;
  readonly onDone: () => void;
  readonly onConflict: () => void;
}) {
  const merge = useMerge(repoPath);

  // Two ranges, two queries. Only the incoming ones are listed, so the
  // outgoing side asks for a single commit — all it has to answer is "any?".
  const incoming = useLog(repoPath, { revisions: [`HEAD..${ref_}`], maxCount: PREVIEW_LIMIT });
  const outgoing = useLog(repoPath, { revisions: [`${ref_}..HEAD`], maxCount: 1 });

  const [noFastForward, setNoFastForward] = useState(false);
  const [fastForwardOnly, setFastForwardOnly] = useState(false);
  const [squash, setSquash] = useState(false);
  const [message, setMessage] = useState('');

  if (incoming.isPending || outgoing.isPending) {
    return (
      <div className={styles.empty}>
        <EmptyState icon={Icons.Sync} message="Working out what this would do…" />
      </div>
    );
  }
  if (incoming.error !== null) {
    return (
      <div className={styles.empty}>
        <EmptyState icon={Icons.Abort} message={incoming.error.message} />
      </div>
    );
  }

  const preview = previewOf(incoming.data.length, outgoing.data?.length ?? 0);
  const ffOnlyPossible = canFastForwardOnly(preview);

  const run = () => {
    merge.mutate(
      {
        ref: ref_,
        ...(noFastForward && { noFastForward: true }),
        ...(fastForwardOnly && ffOnlyPossible && { fastForwardOnly: true }),
        ...(squash && { squash: true }),
        ...(message.trim() !== '' && { message: message.trim() }),
      },
      {
        onSuccess: (outcome) => {
          if (outcome.status === 'conflicted') {
            showToast(`${ref_} conflicts with ${into} — resolve them to finish`, 'error');
            onConflict();
            return;
          }
          showToast(
            outcome.status === 'upToDate'
              ? 'Already up to date'
              : outcome.status === 'fastForward'
                ? `Fast-forwarded ${into} to ${ref_}`
                : `Merged ${ref_} into ${into}`,
            outcome.status === 'upToDate' ? 'info' : 'success',
          );
          onDone();
        },
        onError: (error) => showToast(error.message, 'error'),
      },
    );
  };

  return (
    <div className={styles.plan}>
      <div className={styles.summary}>
        {preview.shape === 'upToDate' && (
          <>
            <Icons.Clean size={14} color="var(--green)" />
            <span>
              <strong>{into}</strong> already contains everything in <strong>{ref_}</strong>.
            </span>
          </>
        )}
        {preview.shape === 'fastForward' && (
          <>
            <Icons.Pull size={14} color="var(--blue)" />
            <span>
              <strong>Fast-forward.</strong> {countLabel(preview.incoming, preview.incomingCapped)}{' '}
              would move onto <strong>{into}</strong> with no merge commit.
            </span>
          </>
        )}
        {preview.shape === 'mergeCommit' && (
          <>
            <Icons.Merge size={14} color="var(--accent)" />
            {/* No count for the outgoing side: that query asks for one commit,
                because all it has to answer is "any?". Naming a number here
                would be naming the query's limit, not the repository's truth. */}
            <span>
              <strong>Merge commit.</strong> The branches diverged —{' '}
              {countLabel(preview.incoming, preview.incomingCapped)} to bring into{' '}
              <strong>{into}</strong>, which also has commits <strong>{ref_}</strong> does not.
            </span>
          </>
        )}
      </div>

      <div className={styles.commits}>
        {incoming.data.length === 0 ? (
          <div className={styles.none}>Nothing to merge</div>
        ) : (
          incoming.data.map((commit) => (
            <div key={commit.oid} className={styles.commit}>
              <span className={styles.oid}>{commit.shortOid}</span>
              <span className={styles.subject}>{commit.subject}</span>
              <span className={styles.author}>{commit.author.name}</span>
            </div>
          ))
        )}
        {preview.incomingCapped && (
          <div className={styles.none}>…and more, beyond the first {PREVIEW_LIMIT}</div>
        )}
      </div>

      <div className={styles.options}>
        <Toggle
          label="Always create a merge commit"
          hint="--no-ff — keeps the fact that a branch existed"
          checked={noFastForward}
          disabled={fastForwardOnly}
          onChange={setNoFastForward}
        />
        <Toggle
          label="Only if it fast-forwards"
          hint={
            ffOnlyPossible
              ? '--ff-only — refuse rather than create a merge commit'
              : 'Not possible: the branches have diverged'
          }
          checked={fastForwardOnly && ffOnlyPossible}
          disabled={!ffOnlyPossible || noFastForward}
          onChange={setFastForwardOnly}
        />
        <Toggle
          label="Squash"
          hint="--squash — stage the changes without recording the merge"
          checked={squash}
          onChange={setSquash}
        />
        <input
          className={styles.message}
          placeholder={defaultMergeMessage(ref_, into)}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          disabled={preview.shape === 'fastForward' && !noFastForward}
        />
      </div>

      <footer className={styles.footer}>
        <span className={styles.status}>{merge.isPending ? 'Merging…' : `${ref_} → ${into}`}</span>
        <Button size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={merge.isPending || preview.shape === 'upToDate'}
          onClick={run}
        >
          Merge
        </Button>
      </footer>
    </div>
  );
}

function countLabel(count: number, capped: boolean): string {
  const suffix = count === 1 ? 'commit' : 'commits';
  return capped ? `${count}+ ${suffix}` : `${count} ${suffix}`;
}

function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  readonly label: string;
  readonly hint: string;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly onChange: (value: boolean) => void;
}) {
  return (
    <label className={`${styles.toggle} ${disabled === true ? styles.toggleDisabled : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className={styles.toggleLabel}>{label}</span>
      <span className={styles.toggleHint}>{hint}</span>
    </label>
  );
}
