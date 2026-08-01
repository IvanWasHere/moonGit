import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { Icons } from '@/components/icons';
import { ToastContainer } from '@/components/ToastContainer';
import {
  useForgetRepository,
  useLastRepositoryId,
  useOpenRepository,
  useRepositories,
  useToggleFavorite,
  useTouchRepository,
} from '@/queries/repositories';
import { showToast } from '@/stores/notificationStore';
import { timeAgo } from '@/utils/format';
import styles from './DashboardPage.module.css';

/**
 * Module-level, not a ref: it must survive the component remounting.
 *
 * "Open into a repository" is a decision made **once per launch**, not once
 * per visit to this route. A per-component ref resets when the dashboard
 * remounts, which is exactly what happens on `Repository ▸ Close` — the
 * dashboard would then immediately reopen the repository the user just closed,
 * and Close would look broken. A page reload is a new launch, and resets this.
 */
let autoOpenAttempted = false;

/**
 * Repository Dashboard (PLAN.md §1.4) — the welcome screen when no repository
 * is open.
 *
 * Net-new: the mockup had no equivalent, so this is built from the same tokens
 * and primitives as the workspace rather than in a second visual language.
 * Favourites sort first, then most recently opened, which puts what the user
 * came for under their cursor.
 */
export function DashboardPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');

  const { data: repositories, isPending } = useRepositories();
  const { data: lastRepositoryId, isPending: lastPending } = useLastRepositoryId();
  const open = useOpenRepository();
  const favorite = useToggleFavorite();
  const forget = useForgetRepository();
  const touch = useTouchRepository();

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const matches = (repositories ?? []).filter(
      (repo) =>
        term === '' ||
        repo.name.toLowerCase().includes(term) ||
        repo.path.toLowerCase().includes(term),
    );
    // Favourites first; `listRepositories` already ordered by last-opened.
    return [...matches].sort((a, b) => Number(b.isFavorite) - Number(a.isFavorite));
  }, [repositories, search]);

  /**
   * On launch, go straight into a repository if there is one.
   *
   * The dashboard is a *first-run* screen: once the user has added a
   * repository, making them pick it again every launch is a step that only
   * ever has one sensible answer. It stays reachable through
   * `Repository ▸ Close`, which is why the guard is per launch rather than
   * per visit.
   *
   * Preference first, then the most recently opened — `listRepositories` is
   * already ordered by recency, so the fallback is the same answer the user
   * would have given.
   */
  useEffect(() => {
    if (autoOpenAttempted || isPending || lastPending) return;

    const all = repositories ?? [];
    if (all.length === 0) {
      // Nothing to open: this is a genuine first run, so show the dashboard
      // and do not burn the guard — adding a repository should open it.
      return;
    }

    autoOpenAttempted = true;
    const remembered = all.find((repo) => repo.id === lastRepositoryId);
    const target = remembered ?? all[0];
    if (target === undefined) return;

    void navigate(`/repo/${target.id}/main`, { replace: true });
  }, [lastRepositoryId, repositories, isPending, lastPending, navigate]);

  const openRepository = (id: number) => {
    touch.mutate(id);
    void navigate(`/repo/${id}/main`);
  };

  const handleOpen = () => {
    open.mutate(undefined, {
      onSuccess: (result) => {
        if (result.status === 'opened' && result.repository !== undefined) {
          openRepository(result.repository.id);
        }
      },
      onError: (error) => showToast(error.message, 'error'),
    });
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <Icons.Branch size={26} strokeWidth={2.25} />
          moonGit
        </div>
        <div className={styles.actions}>
          <Button variant="primary" onClick={handleOpen} disabled={open.isPending}>
            <Icons.RepositoryOpen size={13} />
            {open.isPending ? 'Opening…' : 'Open Repository'}
          </Button>
        </div>
      </header>

      <div className={styles.toolbar}>
        <div className={styles.searchWrap}>
          <Icons.Search size={13} className={styles.searchIcon} />
          <input
            className={styles.search}
            placeholder="Search repositories"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            spellCheck={false}
          />
        </div>
        <span className={styles.count}>
          {visible.length} of {repositories?.length ?? 0}
        </span>
      </div>

      <div className={styles.list}>
        {isPending ? (
          <EmptyState icon={Icons.Sync} message="Loading repositories…" />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={Icons.Repository}
            message={
              (repositories?.length ?? 0) === 0
                ? 'No repositories yet — open one to get started'
                : 'No repositories match that search'
            }
          />
        ) : (
          visible.map((repo) => (
            <div key={repo.id} className={styles.row} onDoubleClick={() => openRepository(repo.id)}>
              <button
                type="button"
                className={styles.star}
                title={repo.isFavorite ? 'Remove from favourites' : 'Add to favourites'}
                onClick={() => favorite.mutate({ id: repo.id, favorite: !repo.isFavorite })}
              >
                <Icons.Favorite
                  size={14}
                  color={repo.isFavorite ? 'var(--accent)' : 'var(--text-muted)'}
                  fill={repo.isFavorite ? 'var(--accent)' : 'none'}
                />
              </button>

              <div className={styles.info} onClick={() => openRepository(repo.id)}>
                <div className={styles.name}>{repo.name}</div>
                <div className={styles.path}>{repo.path}</div>
              </div>

              <div className={styles.opened}>
                {repo.lastOpenedAt === null ? 'never opened' : timeAgo(repo.lastOpenedAt)}
              </div>

              <div className={styles.rowActions}>
                <Button size="sm" onClick={() => openRepository(repo.id)}>
                  Open
                </Button>
                {/* Forgets the row only. The label says "Remove", so it must
                    not mean "delete" — nothing on disk is touched. */}
                <Button
                  size="sm"
                  variant="danger"
                  title="Remove from this list (nothing on disk is deleted)"
                  onClick={() => forget.mutate(repo.id)}
                >
                  Remove
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      <ToastContainer />
    </div>
  );
}
