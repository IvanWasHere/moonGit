// Package ptyapi runs an interactive shell on a pseudo-terminal and pipes it
// to the frontend.
//
// Like gitexec, it knows nothing about what is running on the other end. It
// starts a shell, moves bytes in both directions, and reports how it exited.
// Terminal *emulation* — cursor movement, colours, scrollback — is xterm.js's
// job in TypeScript (PLAN.md §9, item 9); this side is a pipe with a window
// size attached.
//
// Where this deliberately differs from gitexec: that package sets
// GIT_TERMINAL_PROMPT=0 so a credential prompt fails fast instead of hanging a
// process with no terminal attached. Here there *is* a terminal, so a prompt
// is a prompt — the user can answer it, and that is much of the reason to have
// an embedded shell at all.
package ptyapi

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/creack/pty"
	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

const (
	// How long output accumulates before it is emitted. A shell can produce
	// output far faster than the Wails bridge can carry discrete events —
	// `yes`, a large `git log`, a build — and emitting per read would drown
	// the frontend in events carrying a few bytes each. Batching bounds the
	// event rate to ~125/s no matter how loud the process is, and 8ms is below
	// the frame budget, so nothing looks delayed.
	flushInterval = 8 * time.Millisecond

	// Flush early once this much has piled up, so a burst arrives as several
	// paced writes rather than one that stalls the renderer.
	maxPending = 128 << 10

	// Read buffer per pty. Larger than the typical line so a busy process is
	// drained in few syscalls.
	readBuffer = 32 << 10

	// After the master side closes, the shell gets SIGHUP. This is how long it
	// may take to act on it before being killed outright — long enough for a
	// shell to run its exit trap, short enough that quitting the app is not
	// held up by one that ignores the hangup.
	killGrace = 2 * time.Second

	// Every session is a real shell process holding a pty pair. The UI opens
	// one per repository, so this is far above normal use and exists only so a
	// loop in the frontend cannot fork-bomb the machine.
	maxSessions = 8
)

// OpenRequest describes a shell to start.
type OpenRequest struct {
	// Cwd is the directory the shell starts in — the open repository, which is
	// what "repo-aware cwd" means for this feature.
	Cwd string `json:"cwd"`
	// Shell is a path to a shell binary, or empty for the user's own.
	//
	// A path, never a command line: nothing here is split on whitespace, so
	// there is no place for an argument to be smuggled in. The shell that gets
	// started is a file that exists on disk or the call fails.
	Shell string `json:"shell,omitempty"`
	Cols  int    `json:"cols,omitempty"`
	Rows  int    `json:"rows,omitempty"`
	// Env entries in "KEY=VALUE" form, layered over the managed defaults.
	Env []string `json:"env,omitempty"`
}

// SessionInfo describes a running shell.
type SessionInfo struct {
	SessionID string `json:"sessionId"`
	Shell     string `json:"shell"`
	Cwd       string `json:"cwd"`
	PID       int    `json:"pid"`
}

// DataEvent is emitted on "pty:data:<sessionID>".
//
// Data is base64. A pty carries bytes, and two things guarantee they are not
// valid UTF-8: a read can split a multi-byte rune down the middle, and plenty
// of what runs in a shell emits binary outright. `encoding/json` replaces every
// invalid sequence with U+FFFD silently and without an error anywhere, so a
// plain string here would corrupt output on the way through the bridge — the
// same trap RunBase64 exists to avoid in gitexec.
type DataEvent struct {
	SessionID string `json:"sessionId"`
	Seq       int    `json:"seq"`
	Data      string `json:"data"`
}

// ExitEvent is emitted on "pty:exit:<sessionID>" when the shell is gone.
type ExitEvent struct {
	SessionID string `json:"sessionId"`
	ExitCode  int    `json:"exitCode"`
	// Message carries a spawn or wait failure that is not an exit status.
	Message string `json:"message,omitempty"`
}

type session struct {
	info SessionInfo
	cmd  *exec.Cmd
	ptmx *os.File
	// closed guards the master fd: Close and the app shutting down can race,
	// and closing the same file twice is an error on one of them.
	closed sync.Once
}

// Service owns every running shell. One instance is bound to Wails.
type Service struct {
	ctx context.Context

	mu       sync.Mutex
	sessions map[string]*session

	// emit is swappable so tests can observe the event stream without a live
	// Wails runtime, as in gitexec and watcher.
	emit func(event string, data any)
}

func New() *Service {
	return &Service{sessions: make(map[string]*session)}
}

func (s *Service) Startup(ctx context.Context) { s.ctx = ctx }

func (s *Service) emitEvent(event string, data any) {
	if s.emit != nil {
		s.emit(event, data)
		return
	}
	if s.ctx == nil {
		return // not running under Wails (tests)
	}
	wruntime.EventsEmit(s.ctx, event, data)
}

// --- lifecycle -----------------------------------------------------------

// Open starts a shell and begins streaming its output on "pty:data:<sessionID>".
//
// The caller names the session, matching RunStream's runID: the frontend
// already has to subscribe to the event channel before any output arrives, and
// an id handed back from here would arrive too late to do that with.
func (s *Service) Open(sessionID string, req OpenRequest) (SessionInfo, error) {
	if strings.TrimSpace(sessionID) == "" {
		return SessionInfo{}, errors.New("sessionID is required")
	}

	cwd, err := resolveCwd(req.Cwd)
	if err != nil {
		return SessionInfo{}, err
	}
	shell, err := resolveShell(req.Shell)
	if err != nil {
		return SessionInfo{}, err
	}

	s.mu.Lock()
	if _, exists := s.sessions[sessionID]; exists {
		s.mu.Unlock()
		return SessionInfo{}, fmt.Errorf("session %q is already open", sessionID)
	}
	if len(s.sessions) >= maxSessions {
		s.mu.Unlock()
		return SessionInfo{}, fmt.Errorf("too many terminals open (limit %d)", maxSessions)
	}
	// Reserved before the process exists so two concurrent Opens with the same
	// id cannot both get past the check above.
	s.sessions[sessionID] = nil
	s.mu.Unlock()

	release := func() {
		s.mu.Lock()
		if s.sessions[sessionID] == nil {
			delete(s.sessions, sessionID)
		}
		s.mu.Unlock()
	}

	cmd := exec.Command(shell, loginArgs(shell)...)
	cmd.Dir = cwd
	cmd.Env = append(os.Environ(), append(managedEnv(), req.Env...)...)

	ptmx, err := pty.StartWithSize(cmd, winsize(req.Cols, req.Rows))
	if err != nil {
		release()
		return SessionInfo{}, fmt.Errorf("could not start %s: %w", shell, err)
	}

	sess := &session{
		info: SessionInfo{SessionID: sessionID, Shell: shell, Cwd: cwd, PID: cmd.Process.Pid},
		cmd:  cmd,
		ptmx: ptmx,
	}

	s.mu.Lock()
	s.sessions[sessionID] = sess
	s.mu.Unlock()

	go s.pump(sess)
	return sess.info, nil
}

// Write sends base64-encoded input to the shell.
//
// Base64 in this direction too, for one reason: it is the encoding the output
// direction *requires*, and a second encoding for input would be a second
// thing to get wrong. Keystrokes are also not always text — every arrow key
// and control chord is an escape sequence, and paste can carry anything.
func (s *Service) Write(sessionID, dataB64 string) error {
	sess, err := s.lookup(sessionID)
	if err != nil {
		return err
	}
	data, err := base64.StdEncoding.DecodeString(dataB64)
	if err != nil {
		return fmt.Errorf("input was not valid base64: %w", err)
	}
	if _, err := sess.ptmx.Write(data); err != nil {
		return fmt.Errorf("terminal is gone: %w", err)
	}
	return nil
}

// Resize tells the shell how big its window is.
//
// Without this, everything that draws itself — a pager, an editor, `git log`'s
// own pager, a progress bar — wraps at the pty's default 80×24 rather than at
// the panel's real width. The frontend calls this on every layout change.
func (s *Service) Resize(sessionID string, cols, rows int) error {
	sess, err := s.lookup(sessionID)
	if err != nil {
		return err
	}
	return pty.Setsize(sess.ptmx, winsize(cols, rows))
}

// Close ends a session. Closing an unknown or already-finished one is not an
// error — the frontend routinely races an unmount against a shell that just
// exited on its own.
func (s *Service) Close(sessionID string) bool {
	s.mu.Lock()
	sess, ok := s.sessions[sessionID]
	s.mu.Unlock()
	if !ok || sess == nil {
		return false
	}
	sess.hangup()
	return true
}

// Sessions lists the shells currently running.
func (s *Service) Sessions() []SessionInfo {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]SessionInfo, 0, len(s.sessions))
	for _, sess := range s.sessions {
		if sess != nil {
			out = append(out, sess.info)
		}
	}
	return out
}

// Shutdown ends every session. Called from the app's OnShutdown, because a
// shell whose window has gone keeps running otherwise — it is a child process,
// not a goroutine, and nothing else will reap it.
func (s *Service) Shutdown() {
	s.mu.Lock()
	all := make([]*session, 0, len(s.sessions))
	for _, sess := range s.sessions {
		if sess != nil {
			all = append(all, sess)
		}
	}
	s.mu.Unlock()

	for _, sess := range all {
		sess.hangup()
	}
}

// hangup closes the master side, which is what makes the shell exit.
//
// Closing the master causes the kernel to send SIGHUP to the pty's foreground
// process group — the shell *and* whatever it is running. Signalling the shell
// directly would leave a long-running child (a build, a `less`) orphaned but
// alive with a half-dead terminal, which is the failure mode this avoids. The
// hard kill in reap covers a shell that ignores the hangup.
func (sess *session) hangup() {
	sess.closed.Do(func() { _ = sess.ptmx.Close() })
}

// --- streaming -----------------------------------------------------------

// pump reads the pty and emits batched output until the shell exits.
func (s *Service) pump(sess *session) {
	chunks := make(chan []byte, 64)

	// The read is its own goroutine so the batching loop below is never
	// blocked in a syscall while its flush timer fires. The channel is
	// bounded, so a process louder than the bridge can carry blocks here —
	// which is the correct backpressure: the pty buffer fills, and the process
	// is throttled by the terminal rather than by dropped output.
	go func() {
		defer close(chunks)
		buf := make([]byte, readBuffer)
		for {
			n, err := sess.ptmx.Read(buf)
			if n > 0 {
				chunk := make([]byte, n)
				copy(chunk, buf[:n])
				chunks <- chunk
			}
			if err != nil {
				// On macOS and Linux a read from the master returns EIO once
				// the last slave fd is gone. That *is* the exit notification —
				// there is no separate EOF for a pty.
				return
			}
		}
	}()

	var (
		pending []byte
		seq     int
	)
	flush := func() {
		if len(pending) == 0 {
			return
		}
		s.emitEvent("pty:data:"+sess.info.SessionID, DataEvent{
			SessionID: sess.info.SessionID,
			Seq:       seq,
			Data:      base64.StdEncoding.EncodeToString(pending),
		})
		seq++
		pending = pending[:0]
	}

	ticker := time.NewTicker(flushInterval)
	defer ticker.Stop()

	for {
		select {
		case chunk, ok := <-chunks:
			if !ok {
				flush()
				s.reap(sess)
				return
			}
			pending = append(pending, chunk...)
			if len(pending) >= maxPending {
				flush()
			}
		case <-ticker.C:
			flush()
		}
	}
}

// reap waits for the shell, reports how it ended, and forgets the session.
func (s *Service) reap(sess *session) {
	// A shell that ignores SIGHUP would otherwise hold Wait — and app
	// shutdown — open forever.
	kill := time.AfterFunc(killGrace, func() {
		if sess.cmd.Process != nil {
			_ = sess.cmd.Process.Kill()
		}
	})
	waitErr := sess.cmd.Wait()
	kill.Stop()

	// The master is closed after Wait rather than before, so a shell that
	// exits on its own does not leak the fd. Idempotent by construction.
	sess.hangup()

	s.mu.Lock()
	delete(s.sessions, sess.info.SessionID)
	s.mu.Unlock()

	event := ExitEvent{SessionID: sess.info.SessionID}
	var exitErr *exec.ExitError
	switch {
	case waitErr == nil:
		// zero
	case errors.As(waitErr, &exitErr):
		// A shell killed by SIGHUP reports -1 here. That is a normal close,
		// not a failure, and the frontend says "session ended" either way.
		event.ExitCode = exitErr.ExitCode()
	default:
		event.ExitCode = -1
		event.Message = waitErr.Error()
	}
	s.emitEvent("pty:exit:"+sess.info.SessionID, event)
}

// --- internals -----------------------------------------------------------

func (s *Service) lookup(sessionID string) (*session, error) {
	s.mu.Lock()
	sess, ok := s.sessions[sessionID]
	s.mu.Unlock()
	if !ok || sess == nil {
		return nil, fmt.Errorf("no terminal session %q", sessionID)
	}
	return sess, nil
}

func resolveCwd(dir string) (string, error) {
	if strings.TrimSpace(dir) == "" {
		return "", errors.New("a working directory is required")
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", fmt.Errorf("not a directory: %s", abs)
	}
	return abs, nil
}

// resolveShell picks the shell to run, preferring the user's own.
//
// $SHELL before any hard-coded default: it is what the user chose in their
// account, and a terminal that silently runs a different shell than every
// other terminal on the machine has none of their aliases, prompt, or PATH.
func resolveShell(explicit string) (string, error) {
	candidate := strings.TrimSpace(explicit)
	if candidate == "" {
		candidate = os.Getenv("SHELL")
	}
	if candidate == "" {
		candidate = defaultShell()
	}

	// Resolved before spawning so "not installed" is reported as itself rather
	// than as a generic exec failure, the same courtesy OpenInEditor extends.
	path, err := exec.LookPath(candidate)
	if err != nil {
		return "", fmt.Errorf("shell %q not found: %w", candidate, err)
	}
	return path, nil
}

func defaultShell() string {
	switch runtime.GOOS {
	case "windows":
		return "powershell.exe"
	case "darwin":
		return "/bin/zsh"
	default:
		return "/bin/sh"
	}
}

// loginArgs starts known shells as login shells.
//
// This is what Terminal.app does on macOS, and it is not cosmetic: without it
// the shell skips .zprofile/.bash_profile, so PATH is missing everything
// /usr/libexec/path_helper and the user's own profile add — including, very
// often, the git and node the rest of their tooling expects. A shell we do not
// recognise gets no arguments at all rather than a guess.
func loginArgs(shell string) []string {
	switch filepath.Base(shell) {
	case "zsh", "bash", "fish", "sh", "ksh", "dash":
		return []string{"-l"}
	default:
		return nil
	}
}

// managedEnv are the environment guarantees every session gets.
//
// Appended after os.Environ() on purpose: os/exec de-duplicates the
// environment keeping the *last* occurrence, so these win over anything
// inherited — which matters for TERM, since a moonGit launched from a terminal
// inherits that terminal's value and xterm.js is not that terminal.
func managedEnv() []string {
	return []string{
		// What xterm.js actually implements, so programs pick the right
		// capabilities from terminfo instead of degrading to dumb output.
		"TERM=xterm-256color",
		"COLORTERM=truecolor",
		// Some prompts and tools key off this; naming ourselves is more useful
		// than letting them see whatever launched the app.
		"TERM_PROGRAM=moonGit",
		"TERM_PROGRAM_VERSION=" + version,
	}
}

// version is reported to child processes via TERM_PROGRAM_VERSION.
const version = "0.1.0"

func winsize(cols, rows int) *pty.Winsize {
	// A zero size is not "unknown" to a pty, it is 0×0, and everything that
	// draws itself would compute a negative width from it. The frontend sends
	// real numbers once xterm has measured itself; these cover the gap before
	// that first measurement.
	if cols <= 0 {
		cols = 80
	}
	if rows <= 0 {
		rows = 24
	}
	return &pty.Winsize{Cols: uint16(cols), Rows: uint16(rows)}
}
