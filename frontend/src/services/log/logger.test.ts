import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  logEntries,
  logger,
  onLogChange,
  resetLog,
  setLogThreshold,
} from './logger';

/**
 * The log's two sinks, and the separation between them (PLAN.md §11, 8.4).
 *
 * The property worth protecting is that the *ring* records everything while
 * the *console* is filtered. It is easy to "simplify" this into one threshold
 * checked once at entry, and the cost of that is invisible until the day
 * somebody opens the viewer to find out why something failed and discovers the
 * debug lines that would have explained it were never kept.
 */

beforeEach(() => {
  resetLog();
  vi.spyOn(console, 'debug').mockImplementation(() => undefined);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the ring buffer', () => {
  it('records entries below the console threshold', () => {
    setLogThreshold('error');
    logger('watcher').debug('attaching');

    // Not printed, but kept — this is the whole design.
    expect(console.debug).not.toHaveBeenCalled();
    expect(logEntries().map((e) => e.message)).toEqual(['attaching']);
  });

  it('tags each entry with its scope and level', () => {
    logger('layout').warn('could not restore', { cause: 'bad json' });

    const [entry] = logEntries();
    expect(entry?.scope).toBe('layout');
    expect(entry?.level).toBe('warn');
    expect(entry?.detail).toEqual({ cause: 'bad json' });
  });

  it('numbers entries so the viewer has a stable key', () => {
    const log = logger('db');
    log.info('one');
    log.info('two');

    expect(logEntries().map((e) => e.seq)).toEqual([1, 2]);
  });

  it('drops the oldest entries rather than growing without limit', () => {
    // The watcher fires on every keystroke in an editor; a client left open
    // for a week must not accumulate a week of lines.
    const log = logger('watcher');
    for (let i = 0; i < 600; i++) log.debug(`event ${i}`);

    const kept = logEntries();
    expect(kept.length).toBe(500);
    // The newest survive, the oldest are gone.
    expect(kept[kept.length - 1]?.message).toBe('event 599');
    expect(kept[0]?.message).toBe('event 100');
  });
});

describe('the console sink', () => {
  it('prints at or above the threshold', () => {
    setLogThreshold('warn');
    const log = logger('git');

    log.warn('slow status');
    log.error('spawn failed');

    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it('stays quiet below it', () => {
    setLogThreshold('warn');
    const log = logger('git');

    log.debug('args');
    log.info('ran');

    expect(console.debug).not.toHaveBeenCalled();
    expect(console.info).not.toHaveBeenCalled();
  });

  it('routes each level to its own console method', () => {
    // So devtools keeps its own filtering, and an error still gets a stack.
    setLogThreshold('debug');
    const log = logger('x');
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');

    expect(console.debug).toHaveBeenCalledTimes(1);
    expect(console.info).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledTimes(1);
  });
});

describe('subscription', () => {
  it('notifies listeners so a viewer can follow along', () => {
    const seen = vi.fn();
    const off = onLogChange(seen);

    logger('a').info('first');
    expect(seen).toHaveBeenCalledTimes(1);

    off();
    logger('a').info('second');
    expect(seen).toHaveBeenCalledTimes(1);
  });
});
