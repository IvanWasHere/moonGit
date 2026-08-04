import { Close, Open, Resize, Sessions, Write } from '../../../wailsjs/go/ptyapi/Service';
import { base64ToBytes, textToBase64 } from '@/utils/base64';
import { onEvent } from './events';
import type { PtyDataEvent, PtyExitEvent, PtyOpenRequest, PtySessionInfo } from './types';

/**
 * The terminal bridge — a shell on a pseudo-terminal (PLAN.md §9, item 9).
 *
 * The session id is chosen by the caller rather than returned by `Open`, the
 * same as `runGitStream`'s runId and for the same reason: output can arrive
 * before `Open` resolves, so the subscription has to exist first. A shell that
 * prints its prompt faster than a promise settles is not an edge case.
 */

export function openPty(sessionId: string, req: PtyOpenRequest): Promise<PtySessionInfo> {
  return Open(sessionId, req);
}

/** Send input. Text in — the UTF-8 encoding to base64 happens here. */
export function writePty(sessionId: string, data: string): Promise<void> {
  return Write(sessionId, textToBase64(data));
}

/**
 * Tell the shell how big its window is.
 *
 * Not cosmetic: without it everything that draws itself — a pager, an editor,
 * a progress bar — wraps at the pty's default 80×24 rather than at the panel's
 * real width.
 */
export function resizePty(sessionId: string, cols: number, rows: number): Promise<void> {
  return Resize(sessionId, cols, rows);
}

/** Ends the shell. Closing an unknown or already-finished session is not an error. */
export function closePty(sessionId: string): Promise<boolean> {
  return Close(sessionId);
}

export function ptySessions(): Promise<PtySessionInfo[]> {
  return Sessions();
}

/**
 * Subscribe to a session's output. Returns an unsubscribe function.
 *
 * The handler receives **bytes**, not a string. Decoding here would mean
 * guessing where a rune ends, and the Go side batches on a timer with no
 * regard for character boundaries — a `café` split across two flushes would
 * become two replacement characters. xterm.js reassembles UTF-8 across writes
 * itself, so the bytes are handed to it untouched.
 */
export function onPtyData(
  sessionId: string,
  handler: (bytes: Uint8Array) => void,
): () => void {
  return onEvent<PtyDataEvent>(`pty:data:${sessionId}`, (event) => {
    handler(base64ToBytes(event.data));
  });
}

/** Subscribe to a session ending, however it ended. */
export function onPtyExit(
  sessionId: string,
  handler: (event: PtyExitEvent) => void,
): () => void {
  return onEvent<PtyExitEvent>(`pty:exit:${sessionId}`, handler);
}
