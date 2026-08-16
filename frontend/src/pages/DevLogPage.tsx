import { useMemo, useState, useSyncExternalStore } from 'react';
import {
  LEVELS,
  logEntries,
  logThreshold,
  onLogChange,
  setLogThreshold,
  type LogEntry,
  type LogLevel,
} from '@/services/log';
import styles from './DevLogPage.module.css';

/**
 * The developer-mode log viewer (PLAN.md §11, 8.4).
 *
 * Reachable at `#/dev/log` and not linked from product UI, like the bridge
 * harness next to it. It exists because a packaged Wails app has no devtools
 * window: in the build that actually ships, `console.warn` goes nowhere a
 * person can read. This is where the ring buffer becomes visible.
 *
 * **Two filters that look alike and are not.** The level chips filter what is
 * *displayed*, over everything the ring has kept. The console threshold
 * changes what is *printed* to devtools from here on. Filtering the view can
 * never lose anything; raising the threshold cannot bring back what was never
 * printed — which is exactly why the ring records regardless of it.
 */
export function DevLogPage() {
  const entries = useSyncExternalStore(onLogChange, logEntries);
  const [levels, setLevels] = useState<ReadonlySet<LogLevel>>(new Set(LEVELS));
  const [scope, setScope] = useState<string | null>(null);
  const [threshold, setThreshold] = useState<LogLevel>(logThreshold);

  const scopes = useMemo(
    () => [...new Set(entries.map((entry) => entry.scope))].sort(),
    [entries],
  );

  const shown = useMemo(
    () =>
      entries.filter(
        (entry) => levels.has(entry.level) && (scope === null || entry.scope === scope),
      ),
    [entries, levels, scope],
  );

  const toggleLevel = (level: LogLevel) =>
    setLevels((current) => {
      const next = new Set(current);
      // Never empty: clearing the last chip would show nothing and read as a
      // broken viewer rather than as a filter.
      if (next.has(level) && next.size > 1) next.delete(level);
      else next.add(level);
      return next;
    });

  return (
    <div className={styles.page}>
      <div className={styles.title}>Application log</div>
      <div className={styles.subtitle}>
        the last {entries.length} entries · not linked from product UI
      </div>

      <div className={styles.controls}>
        <span className={styles.label}>Show</span>
        {LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            aria-pressed={levels.has(level)}
            className={`${styles.chip} ${levels.has(level) ? styles.chipOn : ''}`}
            onClick={() => toggleLevel(level)}
          >
            {level}
          </button>
        ))}

        {scopes.length > 0 && (
          <>
            <span className={styles.label}>Scope</span>
            <button
              type="button"
              aria-pressed={scope === null}
              className={`${styles.chip} ${scope === null ? styles.chipOn : ''}`}
              onClick={() => setScope(null)}
            >
              all
            </button>
            {scopes.map((name) => (
              <button
                key={name}
                type="button"
                aria-pressed={scope === name}
                className={`${styles.chip} ${scope === name ? styles.chipOn : ''}`}
                onClick={() => setScope((current) => (current === name ? null : name))}
              >
                {name}
              </button>
            ))}
          </>
        )}

        <span className={styles.spacer} />

        <span className={styles.label}>Console from</span>
        {LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            aria-pressed={threshold === level}
            className={`${styles.chip} ${threshold === level ? styles.chipOn : ''}`}
            onClick={() => {
              setLogThreshold(level);
              setThreshold(level);
            }}
          >
            {level}
          </button>
        ))}
      </div>

      <div className={styles.list}>
        {shown.length === 0 ? (
          <div className={styles.empty}>
            {entries.length === 0 ? 'Nothing logged yet' : 'No entries match these filters'}
          </div>
        ) : (
          shown.map((entry) => <Row key={entry.seq} entry={entry} />)
        )}
      </div>
    </div>
  );
}

function Row({ entry }: { readonly entry: LogEntry }) {
  return (
    <div className={styles.entry}>
      <span className={styles.at}>{formatTime(entry.at)}</span>
      <span className={`${styles.level} ${styles[entry.level] ?? ''}`}>{entry.level}</span>
      <span className={styles.scope} title={entry.scope}>
        {entry.scope}
      </span>
      <span className={styles.message}>
        {entry.message}
        {entry.detail !== undefined && (
          <span className={styles.detail}> — {formatDetail(entry.detail)}</span>
        )}
      </span>
    </div>
  );
}

/** Wall-clock with seconds, which is the resolution these events happen at. */
function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour12: false });
}

/**
 * A detail rendered as one line.
 *
 * An `Error` is the common case and its message is the useful part, so it is
 * unwrapped rather than stringified to `{}` — which is what `JSON.stringify`
 * does to an Error and is worse than useless in a log.
 */
function formatDetail(detail: unknown): string {
  if (detail instanceof Error) return detail.message;
  if (typeof detail === 'string') return detail;
  try {
    return JSON.stringify(detail) ?? String(detail);
  } catch {
    // Circular, or something else that will not serialise. Say so rather than
    // letting the viewer throw while showing a log.
    return String(detail);
  }
}
