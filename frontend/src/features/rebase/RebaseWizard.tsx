import { useMemo, useState } from 'react';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { Icons } from '@/components/icons';
import { useLog, useRefs } from '@/queries/git';
import { useRebase } from '@/queries/mutations';
import type { Commit, GitRef } from '@/services/git';
import { writeFile } from '@/services/wails';
import { showToast } from '@/stores/notificationStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { timeAgo } from '@/utils/format';
import {
  ACTION_HINTS,
  ACTION_LABELS,
  moveEntry,
  serialiseTodo,
  setAction,
  todoFromCommits,
  todoProblem,
  type RebaseAction,
  type TodoEntry,
} from './rebaseTodo';
import styles from './RebaseWizard.module.css';

/** How many commits may be replayed before the list stops being a list. */
const MAX_REPLAY = 200;

const ACTIONS: readonly RebaseAction[] = ['pick', 'edit', 'squash', 'fixup', 'drop'];

/**
 * Rebasing onto another branch, with the todo list edited in place (§9.4).
 *
 * The preview is the same idea as the merge wizard's: the commits about to be
 * *replayed* are `upstream..HEAD`, and showing them first is the difference
 * between rewriting history deliberately and finding out afterwards.
 *
 * The list is in **apply order — oldest at the top**, which is git's own and is
 * the only order in which "fold into the commit above" means anything.
 */
export function RebaseWizard({ onClose }: { readonly onClose: () => void }) {
  const repoPath = useWorkspaceStore((state) => state.repoPath);
  const openMerge = useWorkspaceStore((state) => state.openMerge);
  const { data: refs } = useRefs(repoPath);

  const head = refs?.head ?? null;
  /**
   * The upstream *and* the branch it was chosen from, captured together.
   *
   * The branch is held rather than read live because a rebase **detaches
   * HEAD** the moment it starts. Reading it live made the panel flip to "HEAD
   * is detached" mid-run, which unmounted the panel — and React Query does not
   * fire a `mutate` callback whose component has gone, so the rebase stopped
   * on a conflict and nothing closed the wizard or opened the resolver.
   */
  const [selection, setSelection] = useState<{
    readonly upstream: string;
    readonly branch: string;
  } | null>(null);
  const [filter, setFilter] = useState('');

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
        aria-label="Rebase"
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.header}>
          <Icons.Rebase size={14} color="var(--accent)" />
          <span className={styles.title}>Rebase</span>
          <span className={styles.branch}>
            {selection?.branch ?? head?.shortName ?? 'detached HEAD'}
          </span>
          <span className={styles.muted}>onto</span>
          <span className={styles.branch}>{selection?.upstream ?? '…'}</span>
          <button type="button" className={styles.close} title="Close" onClick={onClose}>
            <Icons.Remove size={14} />
          </button>
        </header>

        {head === null && selection === null ? (
          <div className={styles.empty}>
            <EmptyState
              icon={Icons.Abort}
              message="HEAD is detached — check out a branch before rebasing"
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
                      selected={ref.shortName === selection?.upstream}
                      onSelect={() =>
                        head !== null &&
                        setSelection({ upstream: ref.shortName, branch: head.shortName })
                      }
                    />
                  ))
                )}
              </div>
            </div>

            {selection === null ? (
              <div className={styles.empty}>
                <EmptyState icon={Icons.Branch} message="Choose a branch to rebase onto" />
              </div>
            ) : (
              <RebasePlan
                key={selection.upstream}
                repoPath={repoPath}
                upstream={selection.upstream}
                branch={selection.branch}
                onDone={onClose}
                onStopped={() => {
                  onClose();
                  openMerge();
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

function RebasePlan({
  repoPath,
  upstream,
  branch,
  onDone,
  onStopped,
}: {
  readonly repoPath: string | null;
  readonly upstream: string;
  readonly branch: string;
  readonly onDone: () => void;
  readonly onStopped: () => void;
}) {
  /**
   * The mutation lives *here*, above the remounting boundary below.
   *
   * React Query drops a `mutate` callback whose component has unmounted, and
   * starting a rebase changes the very range `TodoStage` is keyed on — so
   * holding the mutation down there meant the rebase stopped on a conflict and
   * nothing ever closed the wizard or opened the resolver.
   */
  const rebase = useRebase(repoPath);

  // What would be replayed: everything HEAD has that the upstream does not.
  const replay = useLog(repoPath, { revisions: [`${upstream}..HEAD`], maxCount: MAX_REPLAY });

  const [interactive, setInteractive] = useState(false);
  const [autostash, setAutostash] = useState(true);

  if (replay.isPending) {
    return (
      <div className={styles.empty}>
        <EmptyState icon={Icons.Sync} message="Working out what would be replayed…" />
      </div>
    );
  }
  if (replay.error !== null) {
    return (
      <div className={styles.empty}>
        <EmptyState icon={Icons.Abort} message={replay.error.message} />
      </div>
    );
  }

  const count = replay.data.length;

  return (
    <TodoStage
      rebase={rebase}
      commits={replay.data}
      // A real React key, not a prop: changing it remounts, which is how the
      // edited list resets without syncing state to props. An edit only means
      // anything against the commits it was made on.
      key={replay.data.map((commit) => commit.oid).join()}
      repoPath={repoPath}
      upstream={upstream}
      branch={branch}
      count={count}
      interactive={interactive}
      setInteractive={setInteractive}
      autostash={autostash}
      setAutostash={setAutostash}
      onDone={onDone}
      onStopped={onStopped}
    />
  );
}

function TodoStage({
  rebase,
  commits,
  repoPath,
  upstream,
  branch,
  count,
  interactive,
  setInteractive,
  autostash,
  setAutostash,
  onDone,
  onStopped,
}: {
  readonly rebase: ReturnType<typeof useRebase>;
  readonly commits: readonly Commit[];
  readonly repoPath: string | null;
  readonly upstream: string;
  readonly branch: string;
  readonly count: number;
  readonly interactive: boolean;
  readonly setInteractive: (value: boolean) => void;
  readonly autostash: boolean;
  readonly setAutostash: (value: boolean) => void;
  readonly onDone: () => void;
  readonly onStopped: () => void;
}) {
  const [todo, setTodo] = useState<readonly TodoEntry[]>(() => todoFromCommits(commits));
  const problem = interactive ? todoProblem(todo) : null;

  const run = () => {
    void (async () => {
      let todoPath: string | undefined;
      if (interactive) {
        // Inside `.git` so it travels with the repository and cannot collide
        // with anything the user owns; git ignores names it does not know.
        todoPath = `${repoPath ?? ''}/.git/moongit-rebase-todo`;
        try {
          await writeFile(todoPath, serialiseTodo(todo));
        } catch (cause) {
          showToast(cause instanceof Error ? cause.message : 'Could not write the todo', 'error');
          return;
        }
      }

      rebase.mutate(
        { upstream, autostash, ...(todoPath !== undefined && { todoPath }) },
        {
          onSuccess: (outcome) => {
            if (outcome.status === 'conflicted') {
              // A conflict and an `edit` stop look the same from here, and the
              // way out of both is the same.
              showToast(`Rebase stopped — ${outcome.summary}`, 'error');
              onStopped();
              return;
            }
            showToast(
              outcome.status === 'upToDate'
                ? 'Already up to date'
                : `Rebased ${branch} onto ${upstream}`,
              outcome.status === 'upToDate' ? 'info' : 'success',
            );
            onDone();
          },
          onError: (error) => showToast(error.message, 'error'),
        },
      );
    })();
  };

  return (
    <div className={styles.plan}>
      <div className={styles.summary}>
        <Icons.Rebase size={14} color="var(--accent)" />
        <span>
          {count === 0 ? (
            <>
              <strong>{branch}</strong> has nothing <strong>{upstream}</strong> does not — there is
              nothing to replay.
            </>
          ) : (
            <>
              <strong>
                {count}
                {count === MAX_REPLAY ? '+' : ''} commit{count === 1 ? '' : 's'}
              </strong>{' '}
              would be replayed onto <strong>{upstream}</strong>, each becoming a new commit.
            </>
          )}
        </span>
      </div>

      <div className={styles.commits}>
        {count === 0 ? (
          <div className={styles.none}>Nothing to rebase</div>
        ) : interactive ? (
          todo.map((entry, index) => (
            <TodoRow
              key={entry.oid}
              entry={entry}
              index={index}
              last={index === todo.length - 1}
              onAction={(action) => setTodo((current) => setAction(current, index, action))}
              onMove={(to) => setTodo((current) => moveEntry(current, index, to))}
            />
          ))
        ) : (
          // Same order as the todo, so turning interactive on does not
          // reshuffle the list under the user.
          [...commits].reverse().map((commit) => (
            <div key={commit.oid} className={styles.commit}>
              <span className={styles.oid}>{commit.shortOid}</span>
              <span className={styles.subject}>{commit.subject}</span>
            </div>
          ))
        )}
      </div>

      <div className={styles.options}>
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={interactive}
            disabled={count === 0}
            onChange={(event) => setInteractive(event.target.checked)}
          />
          <span className={styles.toggleLabel}>Interactive</span>
          <span className={styles.toggleHint}>
            Choose what happens to each commit — reorder, squash, drop
          </span>
        </label>
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={autostash}
            onChange={(event) => setAutostash(event.target.checked)}
          />
          <span className={styles.toggleLabel}>Autostash</span>
          <span className={styles.toggleHint}>
            --autostash — set aside uncommitted changes and put them back after
          </span>
        </label>
      </div>

      {problem !== null && <div className={styles.problem}>{problem}</div>}

      <footer className={styles.footer}>
        <span className={styles.status}>
          {rebase.isPending ? 'Rebasing…' : `${branch} → ${upstream}`}
        </span>
        <Button size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={count === 0 || problem !== null || rebase.isPending}
          onClick={run}
        >
          Rebase
        </Button>
      </footer>
    </div>
  );
}

function TodoRow({
  entry,
  index,
  last,
  onAction,
  onMove,
}: {
  readonly entry: TodoEntry;
  readonly index: number;
  readonly last: boolean;
  readonly onAction: (action: RebaseAction) => void;
  readonly onMove: (to: number) => void;
}) {
  return (
    <div className={`${styles.todo} ${entry.action === 'drop' ? styles.dropped : ''}`}>
      <div className={styles.reorder}>
        <button
          type="button"
          className={styles.arrow}
          title="Move earlier"
          disabled={index === 0}
          onClick={() => onMove(index - 1)}
        >
          ↑
        </button>
        <button
          type="button"
          className={styles.arrow}
          title="Move later"
          disabled={last}
          onClick={() => onMove(index + 1)}
        >
          ↓
        </button>
      </div>
      <div className={styles.actions}>
        {ACTIONS.map((action) => (
          <button
            type="button"
            key={action}
            className={`${styles.action} ${entry.action === action ? styles.actionOn : ''}`}
            title={ACTION_HINTS[action]}
            onClick={() => onAction(action)}
          >
            {ACTION_LABELS[action]}
          </button>
        ))}
      </div>
      <span className={styles.oid}>{entry.shortOid}</span>
      <span className={styles.subject}>{entry.subject}</span>
    </div>
  );
}
