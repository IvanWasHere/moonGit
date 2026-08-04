import { useEffect, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { Button } from '@/components/Button';
import { closePty, onPtyData, onPtyExit, openPty, resizePty, writePty } from '@/services/wails';
import { useSettingsStore } from '@/stores/settingsStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { createInputQueue } from './inputQueue';
import { cssTokenReader, terminalFont, terminalTheme } from './xtermTheme';
import styles from './Terminal.module.css';

/**
 * A shell running on a pty, drawn by xterm.js (PLAN.md §9, item 9).
 *
 * Loaded lazily by TerminalDrawer — xterm and its addon are ~250 KB that
 * nobody who never opens the drawer should pay for (PLAN.md §10, "lazy-load
 * Monaco and xterm.js on first use").
 *
 * The component owns exactly one session for its lifetime. It is keyed by
 * repository upstream, so switching repositories tears this down and builds a
 * new one rather than trying to move a running shell to a new directory —
 * which is not a thing a shell can be asked to do.
 */
export function TerminalPanel({
  repoPath,
  onRestart,
}: {
  readonly repoPath: string;
  readonly onRestart: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const refitRef = useRef<(() => void) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState<string | null>(null);

  const resolvedTheme = useSettingsStore((state) => state.resolved);
  const drawerHeight = useWorkspaceStore((state) => state.terminalH);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;

    let cancelled = false;
    // A session id per mount, chosen here rather than returned by the Go side:
    // the shell can print its prompt before `openPty` resolves, so the
    // subscription has to exist first or the first line is lost.
    const sessionId = crypto.randomUUID();
    const cleanups: Array<() => void> = [];

    void (async () => {
      /*
       * Wait for the vendored webfonts before measuring anything. xterm sizes
       * one character cell at startup and lays the whole grid out from it; do
       * that while JetBrains Mono is still loading and every column is
       * measured against the fallback, leaving the grid permanently out of
       * step with the glyphs drawn into it.
       */
      if (typeof document.fonts?.ready?.then === 'function') {
        await document.fonts.ready.catch(() => undefined);
      }
      if (cancelled) return;

      const read = cssTokenReader(document.documentElement);
      const term = new Terminal({
        theme: terminalTheme(read),
        fontFamily: terminalFont(read),
        fontSize: 12,
        lineHeight: 1.3,
        cursorBlink: true,
        // Deep enough that a `git log` or a build's output is still there to
        // scroll back to, bounded so a runaway process cannot grow forever.
        scrollback: 5000,
        // The webview has no macOS-style Option-as-Meta by default, and
        // without this ⌥← / ⌥→ move the *browser* rather than the cursor.
        macOptionIsMeta: true,
        allowProposedApi: true,
      });
      /*
       * ⌃` closes the drawer from inside it.
       *
       * xterm claims almost every keystroke, which is right — a terminal that
       * lets the app eat Ctrl-C is not a terminal. But the chord that opened
       * this panel has to also close it, or the only way out is the mouse.
       * Returning false hands the event back to the window listener in
       * Workspace and sends nothing to the shell.
       */
      term.attachCustomKeyEventHandler(
        (event) => !(event.ctrlKey && !event.metaKey && event.key === '`'),
      );

      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(host);
      termRef.current = term;
      cleanups.push(() => {
        termRef.current = null;
        term.dispose();
      });

      fit.fit();

      cleanups.push(onPtyData(sessionId, (bytes) => term.write(bytes)));
      cleanups.push(
        onPtyExit(sessionId, (event) => {
          // Written into the terminal rather than replacing it: the output of
          // whatever just ran is usually the reason the session ended, and
          // swapping it for a React panel would take away the explanation.
          term.write('\r\n\x1b[2m[session ended]\x1b[0m\r\n');
          setEnded(
            event.message !== undefined && event.message !== ''
              ? event.message
              : `The shell exited (code ${event.exitCode}).`,
          );
        }),
      );

      // Keystrokes are not always text — every arrow key and control chord is
      // an escape sequence, and the bridge carries them base64-encoded.
      /*
       * Input goes through a queue rather than straight to the bridge.
       *
       * One promise per keystroke means N in flight with no ordering between
       * them, and they do arrive out of order — typing `git status -sb` fast
       * put `git sattus  - sb` in the shell. See inputQueue.ts. The failure
       * callback is empty on purpose: a write only fails once the shell is
       * gone, the exit handler above has already said so, and a toast per
       * keystroke afterwards would be worse than silence.
       */
      const queue = createInputQueue((data) => writePty(sessionId, data));
      cleanups.push(() => queue.dispose());

      const input = term.onData((data) => queue.push(data));
      cleanups.push(() => input.dispose());

      /*
       * xterm reports the grid it settled on after a fit, which is the number
       * the pty needs — computing it here would be a second, drifting answer.
       *
       * Chained for the same reason input is queued: a resize drag fires on
       * every mouse move, and if those land out of order the pty keeps a size
       * from the middle of the drag while the panel shows the end of it. The
       * last call has to be the last one applied.
       */
      let resizes: Promise<unknown> = Promise.resolve();
      const resize = term.onResize(({ cols, rows }) => {
        resizes = resizes.then(() => resizePty(sessionId, cols, rows)).catch(() => undefined);
      });
      cleanups.push(() => resize.dispose());

      const refit = () => {
        // A hidden or mid-transition element measures as 0, and a fit against
        // that would compute a nonsense grid; there is nothing useful to do
        // until it has a size.
        if (host.clientWidth === 0 || host.clientHeight === 0) return;
        try {
          fit.fit();
        } catch {
          // A fit that fails is a frame drawn at the old size, not a broken
          // terminal — the next resize corrects it.
        }
      };
      refitRef.current = refit;
      cleanups.push(() => {
        refitRef.current = null;
      });

      const observer = new ResizeObserver(refit);
      observer.observe(host);
      cleanups.push(() => observer.disconnect());

      try {
        await openPty(sessionId, {
          cwd: repoPath,
          cols: term.cols,
          rows: term.rows,
        });
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
        return;
      }
      if (cancelled) return;

      cleanups.push(() => void closePty(sessionId));

      /*
       * A shell is a child process, not a React subscription: nothing reaps it
       * if the page goes away without unmounting. `OnShutdown` in main.go
       * covers quitting the app, but a reload — routine in `wails dev`, and
       * observed leaving three orphaned zsh processes behind — never runs an
       * effect cleanup. `pagehide` is the last event that does fire.
       */
      const onPageHide = () => void closePty(sessionId);
      window.addEventListener('pagehide', onPageHide);
      cleanups.push(() => window.removeEventListener('pagehide', onPageHide));

      term.focus();
    })();

    return () => {
      cancelled = true;
      // Reversed: the pty is closed before the terminal that renders it is
      // disposed, so nothing writes into a torn-down canvas.
      for (const cleanup of cleanups.reverse()) cleanup();
    };
  }, [repoPath]);

  /*
   * xterm paints to a canvas, so it cannot follow CSS variables — a theme
   * switch has to be pushed into it. Without this the drawer keeps its dark
   * background on a light desktop until the session is restarted, which is
   * exactly the trap `useDiffHighlight` hit with Shiki's baked-in colours.
   */
  useEffect(() => {
    const term = termRef.current;
    if (term === null) return;
    term.options.theme = terminalTheme(cssTokenReader(document.documentElement));
  }, [resolvedTheme]);

  /*
   * Refit when the drawer is dragged, as well as when the element resizes.
   *
   * Belt and braces, deliberately. The ResizeObserver above is the general
   * answer — it covers the window resizing and the panes above rearranging —
   * but it only delivers during the rendering lifecycle, so anything that
   * starves the page of frames also starves the terminal of its correct size.
   * The drag has a cause we can observe directly, and reacting to the cause
   * costs one effect.
   */
  useEffect(() => {
    refitRef.current?.();
  }, [drawerHeight]);

  return (
    <div className={styles.panel}>
      <div className={styles.host} ref={hostRef} />
      {error !== null && (
        <div className={`${styles.banner} ${styles.error}`} role="alert">
          <span>{error}</span>
          <Button size="sm" onClick={onRestart}>
            Try again
          </Button>
        </div>
      )}
      {error === null && ended !== null && (
        <div className={styles.banner}>
          <span>{ended}</span>
          <Button size="sm" onClick={onRestart}>
            New session
          </Button>
        </div>
      )}
    </div>
  );
}
