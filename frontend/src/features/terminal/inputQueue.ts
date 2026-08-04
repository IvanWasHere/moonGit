/**
 * Keeps keystrokes in the order they were typed.
 *
 * Every keypress arrives from xterm as its own `onData` call, and sending each
 * one straight to the bridge means N promises in flight at once with no
 * ordering guarantee between them. That is not theoretical: typing
 * `git status -sb` fast enough produced `git sattus  - sb` in the shell, with
 * the characters genuinely reordered on the way in. A terminal that garbles
 * fast typing is not a terminal.
 *
 * So one write is in flight at a time, and anything typed meanwhile
 * accumulates. The buffer is a feature rather than a cost: a burst of twenty
 * keystrokes becomes one call carrying twenty characters instead of twenty
 * calls racing each other.
 */
export interface InputQueue {
  /** Queue input. Returns immediately; delivery is ordered and asynchronous. */
  push: (data: string) => void;
  /** Stop sending. Anything still buffered is dropped. */
  dispose: () => void;
}

export function createInputQueue(
  send: (data: string) => Promise<unknown>,
  onError?: (cause: unknown) => void,
): InputQueue {
  let pending = '';
  let inFlight = false;
  let disposed = false;

  const drain = async (): Promise<void> => {
    if (inFlight || disposed || pending === '') return;
    inFlight = true;

    // Taken before awaiting: anything typed during the write lands in a fresh
    // `pending` and goes out in the next pass, in order, exactly once.
    const data = pending;
    pending = '';

    try {
      await send(data);
    } catch (cause) {
      onError?.(cause);
    } finally {
      inFlight = false;
    }
    void drain();
  };

  return {
    push: (data) => {
      if (disposed) return;
      pending += data;
      void drain();
    },
    dispose: () => {
      disposed = true;
      pending = '';
    },
  };
}
