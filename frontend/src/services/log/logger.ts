/**
 * The application log (PLAN.md §11).
 *
 * Before this there were eight `console.warn` calls scattered through the app,
 * every one of them at the same moment: something degraded and the app carried
 * on. Those are exactly the events worth having a record of — the watcher that
 * could not attach, the layout that would not restore, the settings row that
 * held unparseable JSON — and `console` is the worst place to keep them. In a
 * packaged Wails app there is no devtools window to read, so in the build that
 * users actually run, every one of those messages went nowhere at all.
 *
 * Two sinks, deliberately, because they answer different questions.
 *
 * **The ring buffer records everything, regardless of level.** It is what the
 * log viewer reads, and the moment somebody wants the log is *after* the
 * strange thing has already happened — a threshold applied at record time
 * throws away precisely the debug lines that would explain it. Bounded, so a
 * client left open for a week with a watcher firing on every keystroke cannot
 * grow without limit.
 *
 * **The console gets only what passes the threshold**, so a devtools session
 * stays readable. Changing the threshold does not change what the viewer can
 * show, which is the point of separating them.
 */

export const LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LEVELS)[number];

/** Ordering for threshold comparisons. Index into `LEVELS`, named for clarity. */
const RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export interface LogEntry {
  readonly seq: number;
  readonly at: number;
  readonly level: LogLevel;
  /** Which part of the app spoke — `watcher`, `layout`, `db`. */
  readonly scope: string;
  readonly message: string;
  /** Anything structured worth keeping beside the message. */
  readonly detail?: unknown;
}

/**
 * How many entries the ring holds.
 *
 * 500 is roughly a working session's worth of interesting events at the rate
 * this app produces them, and small enough that serialising the whole buffer
 * for the viewer stays instant.
 */
const CAPACITY = 500;

const entries: LogEntry[] = [];
let nextSeq = 1;
let threshold: LogLevel = 'info';

type Listener = () => void;
const listeners = new Set<Listener>();

function emit(level: LogLevel, scope: string, message: string, detail?: unknown): void {
  const entry: LogEntry = {
    seq: nextSeq++,
    at: Date.now(),
    level,
    scope,
    message,
    ...(detail !== undefined && { detail }),
  };

  entries.push(entry);
  // Bounded from the front: the oldest entry is the one worth losing.
  if (entries.length > CAPACITY) entries.splice(0, entries.length - CAPACITY);

  if (RANK[level] >= RANK[threshold]) {
    const line = `[${scope}] ${message}`;
    // Routed to the matching console method rather than all through `log`, so
    // devtools keeps its own filtering and an error still gets a stack trace.
    if (level === 'error') console.error(line, detail ?? '');
    else if (level === 'warn') console.warn(line, detail ?? '');
    else if (level === 'info') console.info(line, detail ?? '');
    else console.debug(line, detail ?? '');
  }

  for (const listener of listeners) listener();
}

export interface Logger {
  debug: (message: string, detail?: unknown) => void;
  info: (message: string, detail?: unknown) => void;
  warn: (message: string, detail?: unknown) => void;
  error: (message: string, detail?: unknown) => void;
}

/**
 * A logger bound to one part of the app.
 *
 * Scoped rather than global so every line says where it came from without the
 * caller repeating itself, and so the viewer can filter by subsystem — which is
 * the first thing anyone does when reading a log.
 */
export function logger(scope: string): Logger {
  return {
    debug: (message, detail) => emit('debug', scope, message, detail),
    info: (message, detail) => emit('info', scope, message, detail),
    warn: (message, detail) => emit('warn', scope, message, detail),
    error: (message, detail) => emit('error', scope, message, detail),
  };
}

/** Everything the ring currently holds, oldest first. */
export function logEntries(): readonly LogEntry[] {
  return entries;
}

export function logThreshold(): LogLevel {
  return threshold;
}

/** What reaches the console. Does not affect what the ring records. */
export function setLogThreshold(level: LogLevel): void {
  threshold = level;
}

/**
 * Subscribe to new entries, for `useSyncExternalStore`.
 *
 * Returns the unsubscribe, so a component's effect can return it directly.
 */
export function onLogChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test-only: forget everything, so one suite cannot see another's lines. */
export function resetLog(): void {
  entries.length = 0;
  nextSeq = 1;
  threshold = 'info';
  listeners.clear();
}
