import { useCallback, useEffect, useRef, useState } from 'react';
import {
  dbInfo,
  environment,
  gitInfo,
  onRepoChanged,
  runGit,
  runGitStream,
  unwatchRepo,
  watchRepo,
  type DBInfo,
  type Environment,
  type GitInfo,
  type RepoChangeEvent,
  type WatchInfo,
} from '@/services/wails';
import { DevServicesPanel } from './DevServicesPanel';
import styles from './DevBridgePage.module.css';

/**
 * Phase 1 verification harness (PLAN.md §4, exit criteria).
 *
 * Exercises every native capability end to end: run git, stream a large
 * command, cancel it mid-flight, and receive debounced watcher events. This is
 * a development surface, not product UI — it is not linked from anywhere and
 * exists so the bridge can be proven before any feature is built on it.
 *
 * Reachable at #/dev/bridge.
 */

const DEFAULT_REPO = '/Volumes/Ddrive/projects/vibe-weekends/testGitHere/test-repo1';

export function DevBridgePage() {
  const [repoPath, setRepoPath] = useState(DEFAULT_REPO);
  const [env, setEnv] = useState<Environment | null>(null);
  const [git, setGit] = useState<GitInfo | null>(null);
  const [db, setDb] = useState<DBInfo | null>(null);

  const [statusOut, setStatusOut] = useState('');
  const [streamOut, setStreamOut] = useState('');
  const [streamStats, setStreamStats] = useState<string>('');
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const [watch, setWatch] = useState<WatchInfo | null>(null);
  const [events, setEvents] = useState<RepoChangeEvent[]>([]);

  // --- boot info ---------------------------------------------------------
  useEffect(() => {
    void (async () => {
      setEnv(await environment());
      setGit(await gitInfo());
      setDb(await dbInfo());
    })();
  }, []);

  // --- watcher subscription ---------------------------------------------
  useEffect(() => {
    const off = onRepoChanged((ev) => {
      setEvents((prev) => [ev, ...prev].slice(0, 20));
    });
    return off;
  }, []);

  const doStatus = useCallback(async () => {
    const res = await runGit({
      repoPath,
      args: ['status', '--porcelain=v2', '--branch', '--untracked-files=all'],
    });
    setStatusOut(
      `exit=${res.exitCode} in ${res.durationMs}ms\n\n${res.stdout || res.stderr || '(no output)'}`,
    );
  }, [repoPath]);

  // Deliberately a non-zero exit: proves failure arrives as data, not a throw.
  const doFailingCommand = useCallback(async () => {
    const res = await runGit({ repoPath, args: ['rev-parse', 'does-not-exist'] });
    setStatusOut(
      `RESOLVED (did not throw)\nexit=${res.exitCode}\nstderr=${res.stderr.trim()}\n\n` +
        `This is the contract: a non-zero exit is an answer, not an exception.`,
    );
  }, [repoPath]);

  const doStream = useCallback(async () => {
    setStreaming(true);
    setStreamOut('');
    setStreamStats('');
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    let received = 0;
    let chunks = 0;
    const preview: string[] = [];

    try {
      const res = await runGitStream(
        {
          repoPath,
          // -p makes the output big enough that chunking is actually exercised.
          args: ['log', '-p', '--all', '--format=%H%x00%an%x00%s'],
          delimiter: 'nul',
          chunkSize: 8 * 1024,
        },
        {
          signal: ctrl.signal,
          onChunk: (data, seq) => {
            received += data.length;
            chunks += 1;
            if (seq < 3) preview.push(data.slice(0, 200));
            if (chunks % 5 === 0 || chunks < 5) {
              setStreamStats(`${chunks} chunks · ${received.toLocaleString()} chars`);
            }
          },
        },
      );
      setStreamStats(
        `done · ${res.chunks} chunks · ${res.bytesOut.toLocaleString()} bytes · ` +
          `${res.durationMs}ms · exit=${res.exitCode}${res.canceled ? ' · CANCELED' : ''}`,
      );
      setStreamOut(preview.join('\n---\n') || '(no output)');
    } catch (err) {
      setStreamStats(`error: ${String(err)}`);
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [repoPath]);

  const doCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const doWatch = useCallback(async () => {
    setWatch(await watchRepo(repoPath));
  }, [repoPath]);

  const doUnwatch = useCallback(async () => {
    await unwatchRepo(repoPath);
    setWatch(null);
  }, [repoPath]);

  // Touching a file should produce exactly one debounced worktree event.
  const doTouch = useCallback(async () => {
    const { writeFile } = await import('@/services/wails');
    await writeFile(`${repoPath}/.moongit-watch-probe`, `touched at ${Date.now()}\n`);
  }, [repoPath]);

  return (
    <div className={styles.page}>
      <div className={styles.title}>Bridge harness</div>
      <div className={styles.subtitle}>
        Phase 1 verification — not product UI. Proves the Go native layer end to end.
      </div>

      <div className={styles.row}>
        <input
          className={styles.input}
          value={repoPath}
          onChange={(e) => setRepoPath(e.target.value)}
          spellCheck={false}
        />
      </div>

      <div className={styles.grid}>
        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <span>Environment</span>
          </div>
          <div className={styles.cardBody}>
            <Stat k="platform" v={env ? `${env.platform}/${env.arch}` : '…'} />
            <Stat k="app version" v={env?.version ?? '…'} />
            <Stat k="git" v={git?.version ?? '…'} />
            <Stat k="git path" v={git?.path ?? '…'} />
            <Stat k="sqlite" v={db?.version ?? '…'} />
            <Stat k="FTS5" v={db ? String(db.hasFts5) : '…'} />
            <Stat k="journal mode" v={db?.journalMode ?? '…'} />
            <Stat k="db open" v={db ? String(db.open) : '…'} />
          </div>
        </section>

        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <span>Run · buffered</span>
          </div>
          <div className={styles.cardBody}>
            <div className={styles.row}>
              <button className={styles.btn} onClick={() => void doStatus()}>
                git status
              </button>
              <button className={styles.btn} onClick={() => void doFailingCommand()}>
                failing command
              </button>
            </div>
            <div className={styles.out}>{statusOut || '(nothing run yet)'}</div>
          </div>
        </section>

        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <span>RunStream · chunked</span>
            <span className={styles.pending}>{streamStats}</span>
          </div>
          <div className={styles.cardBody}>
            <div className={styles.row}>
              <button
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={() => void doStream()}
                disabled={streaming}
              >
                stream git log -p
              </button>
              <button
                className={`${styles.btn} ${styles.btnDanger}`}
                onClick={doCancel}
                disabled={!streaming}
              >
                cancel
              </button>
            </div>
            <div className={styles.out}>{streamOut || '(not streamed yet)'}</div>
          </div>
        </section>

        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <span>Watcher</span>
            <span className={styles.pending}>{events.length} events</span>
          </div>
          <div className={styles.cardBody}>
            <div className={styles.row}>
              <button className={styles.btn} onClick={() => void doWatch()} disabled={!!watch}>
                watch
              </button>
              <button className={styles.btn} onClick={() => void doTouch()} disabled={!watch}>
                touch a file
              </button>
              <button className={styles.btn} onClick={() => void doUnwatch()} disabled={!watch}>
                unwatch
              </button>
            </div>
            {watch && (
              <>
                <Stat k="watched dirs" v={String(watch.dirs)} />
                <Stat k="degraded" v={String(watch.degraded)} />
              </>
            )}
            <div className={styles.out}>
              {events.length === 0
                ? '(no events yet — watch, then touch a file)'
                : events.map((e) => `${e.reasons.join(', ')}  ←  ${e.repoPath}`).join('\n')}
            </div>
          </div>
        </section>

        <DevServicesPanel repoPath={repoPath} />
      </div>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statKey}>{k}</span>
      <span className={styles.statVal}>{v}</span>
    </div>
  );
}
