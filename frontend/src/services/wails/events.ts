import { EventsOn } from '../../../wailsjs/runtime/runtime';
import type { RepoChangeEvent } from './types';

/**
 * Typed wrapper over the Wails event bus.
 *
 * The generated runtime types every payload as `any`, so the casts live here
 * and nowhere else — callers get a real type.
 */

/**
 * Subscribe to a raw event. Returns an unsubscribe function.
 *
 * The unsubscribe is guarded because it is called from React cleanup, and
 * Wails routes it back through the IPC bridge: in browser dev mode after a hot
 * reload that bridge can already be gone, and the resulting throw propagates
 * out of an unmount effect and takes down the whole route. Observed doing
 * exactly that when navigating away from the dev harness. Failing to detach a
 * listener during teardown is not worth a crash.
 */
export function onEvent<T>(event: string, handler: (payload: T) => void): () => void {
  const off = EventsOn(event, (...data: unknown[]) => {
    handler(data[0] as T);
  });

  return () => {
    try {
      off();
    } catch (cause) {
      console.warn(`failed to unsubscribe from "${event}"`, cause);
    }
  };
}

/**
 * Subscribe to repository change notifications from the Go file watcher.
 *
 * This is what keeps the UI live without polling: the watcher debounces
 * filesystem noise into a single event carrying which *areas* changed, and the
 * caller maps those to query invalidations (PLAN.md §6).
 */
export function onRepoChanged(handler: (event: RepoChangeEvent) => void): () => void {
  return onEvent<RepoChangeEvent>('repo:changed', handler);
}
