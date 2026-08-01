import { EventsOn } from '../../../wailsjs/runtime/runtime';
import type { RepoChangeEvent } from './types';

/**
 * Typed wrapper over the Wails event bus.
 *
 * The generated runtime types every payload as `any`, so the casts live here
 * and nowhere else — callers get a real type.
 */

/** Subscribe to a raw event. Returns an unsubscribe function. */
export function onEvent<T>(event: string, handler: (payload: T) => void): () => void {
  return EventsOn(event, (...data: unknown[]) => {
    handler(data[0] as T);
  });
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
