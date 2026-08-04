package ptyapi

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
)

// recorder collects the event stream a session produces, standing in for the
// Wails runtime the same way gitexec's tests do.
type recorder struct {
	mu     sync.Mutex
	output strings.Builder
	exit   *ExitEvent
	exited chan struct{}
	once   sync.Once
}

func newRecorder() *recorder {
	return &recorder{exited: make(chan struct{})}
}

func (r *recorder) emit(event string, data any) {
	r.mu.Lock()
	defer r.mu.Unlock()

	switch payload := data.(type) {
	case DataEvent:
		decoded, err := base64.StdEncoding.DecodeString(payload.Data)
		if err != nil {
			// Undecodable output is a real defect, not a flaky test — the
			// frontend has no way to recover from it either.
			panic("emitted data was not valid base64: " + err.Error())
		}
		r.output.Write(decoded)
	case ExitEvent:
		r.exit = &payload
		r.once.Do(func() { close(r.exited) })
	}
	_ = event
}

func (r *recorder) text() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.output.String()
}

// waitForOutput polls until the session has printed want, or gives up.
//
// Polling rather than a fixed sleep: a shell's startup time varies by an order
// of magnitude depending on what the user's profile does, and a sleep long
// enough to be reliable would be long enough to be annoying.
func (r *recorder) waitForOutput(t *testing.T, want string) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if strings.Contains(r.text(), want) {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("never saw %q in output; got %q", want, r.text())
}

func newTestService(t *testing.T) (*Service, *recorder) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("no pty support on windows")
	}
	rec := newRecorder()
	s := New()
	s.emit = rec.emit
	t.Cleanup(s.Shutdown)
	return s, rec
}

// openSession starts /bin/sh rather than the user's $SHELL: the test asserts on
// what the shell prints, and a developer's own zsh with a themed prompt and a
// welcome banner is not a stable thing to assert against.
func openSession(t *testing.T, s *Service, id string) SessionInfo {
	t.Helper()
	info, err := s.Open(id, OpenRequest{Cwd: t.TempDir(), Shell: "/bin/sh", Cols: 100, Rows: 30})
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	return info
}

func writeLine(t *testing.T, s *Service, id, line string) {
	t.Helper()
	if err := s.Write(id, base64.StdEncoding.EncodeToString([]byte(line+"\n"))); err != nil {
		t.Fatalf("write %q: %v", line, err)
	}
}

func TestOpenRunsCommandsAndStreamsOutput(t *testing.T) {
	s, rec := newTestService(t)
	openSession(t, s, "a")

	writeLine(t, s, "a", "echo moongit-was-here")
	rec.waitForOutput(t, "moongit-was-here")
}

func TestSessionStartsInTheRequestedDirectory(t *testing.T) {
	s, rec := newTestService(t)

	// Symlinks make the raw temp dir a poor comparison on macOS, where
	// /var is /private/var: the shell reports the resolved path, so the
	// expectation has to be resolved too.
	dir := t.TempDir()
	resolved, err := filepath.EvalSymlinks(dir)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := s.Open("cwd", OpenRequest{Cwd: dir, Shell: "/bin/sh"}); err != nil {
		t.Fatalf("open: %v", err)
	}
	writeLine(t, s, "cwd", "pwd -P")
	rec.waitForOutput(t, resolved)
}

func TestOutputSurvivesBytesThatAreNotUTF8(t *testing.T) {
	s, rec := newTestService(t)
	openSession(t, s, "bin")

	// 0xff is not valid UTF-8 in any position. Sent through a plain JSON
	// string it would come back as U+FFFD, silently — this is the whole
	// reason DataEvent.Data is base64.
	writeLine(t, s, "bin", `printf 'start\377end'`)

	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if strings.Contains(rec.text(), "start\xffend") {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("raw byte did not survive the round trip; got %q", rec.text())
}

func TestExitIsReportedAndTheSessionIsForgotten(t *testing.T) {
	s, rec := newTestService(t)
	openSession(t, s, "bye")

	writeLine(t, s, "bye", "exit 3")

	select {
	case <-rec.exited:
	case <-time.After(10 * time.Second):
		t.Fatal("no exit event")
	}

	rec.mu.Lock()
	exit := *rec.exit
	rec.mu.Unlock()

	if exit.SessionID != "bye" {
		t.Errorf("exit event for %q, want %q", exit.SessionID, "bye")
	}
	if exit.ExitCode != 3 {
		t.Errorf("exit code = %d, want 3", exit.ExitCode)
	}
	if len(s.Sessions()) != 0 {
		t.Errorf("session still listed after exit: %+v", s.Sessions())
	}
	// Writing to a shell that has gone is an error the UI can report, not a
	// panic and not a silent success.
	if err := s.Write("bye", base64.StdEncoding.EncodeToString([]byte("x"))); err == nil {
		t.Error("write to a finished session should fail")
	}
}

func TestCloseEndsTheShell(t *testing.T) {
	s, rec := newTestService(t)
	openSession(t, s, "c")

	if !s.Close("c") {
		t.Fatal("close reported no such session")
	}
	select {
	case <-rec.exited:
	case <-time.After(10 * time.Second):
		t.Fatal("closing the session did not end the shell")
	}
	// The frontend races unmount against a shell that just exited, so a
	// second close is expected to be a quiet false rather than an error.
	if s.Close("c") {
		t.Error("closing an already-closed session should report false")
	}
}

func TestShutdownEndsEverySession(t *testing.T) {
	s, _ := newTestService(t)
	openSession(t, s, "one")
	openSession(t, s, "two")

	if len(s.Sessions()) != 2 {
		t.Fatalf("Sessions() = %d, want 2", len(s.Sessions()))
	}

	s.Shutdown()

	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if len(s.Sessions()) == 0 {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("sessions outlived shutdown: %+v", s.Sessions())
}

func TestResizeIsAppliedToTheShell(t *testing.T) {
	s, rec := newTestService(t)
	openSession(t, s, "size")

	if err := s.Resize("size", 132, 44); err != nil {
		t.Fatalf("resize: %v", err)
	}
	// `stty size` reads the window size from the terminal itself, which is the
	// only way to prove the ioctl reached the pty rather than a Go field.
	writeLine(t, s, "size", "stty size")
	rec.waitForOutput(t, "44 132")
}

func TestOpenRejectsBadInput(t *testing.T) {
	s, _ := newTestService(t)

	missing := filepath.Join(t.TempDir(), "does-not-exist")
	file := filepath.Join(t.TempDir(), "a-file")
	if err := os.WriteFile(file, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		name string
		id   string
		req  OpenRequest
	}{
		{"no session id", "", OpenRequest{Cwd: t.TempDir()}},
		{"no cwd", "x", OpenRequest{}},
		{"cwd does not exist", "x", OpenRequest{Cwd: missing}},
		{"cwd is a file", "x", OpenRequest{Cwd: file}},
		{"shell does not exist", "x", OpenRequest{Cwd: t.TempDir(), Shell: "/nope/not-a-shell"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := s.Open(tc.id, tc.req); err == nil {
				t.Error("expected an error")
			}
			if len(s.Sessions()) != 0 {
				t.Errorf("a failed open left a session behind: %+v", s.Sessions())
			}
		})
	}
}

func TestOpenRefusesADuplicateSessionID(t *testing.T) {
	s, _ := newTestService(t)
	openSession(t, s, "dup")

	if _, err := s.Open("dup", OpenRequest{Cwd: t.TempDir(), Shell: "/bin/sh"}); err == nil {
		t.Fatal("expected the second open to be refused")
	}
	if len(s.Sessions()) != 1 {
		t.Errorf("Sessions() = %d, want 1", len(s.Sessions()))
	}
}

func TestOpenIsCappedAtMaxSessions(t *testing.T) {
	s, _ := newTestService(t)
	for i := range maxSessions {
		openSession(t, s, string(rune('a'+i)))
	}
	if _, err := s.Open("overflow", OpenRequest{Cwd: t.TempDir(), Shell: "/bin/sh"}); err == nil {
		t.Fatal("expected the cap to be enforced")
	}
}

func TestWriteRejectsInputThatIsNotBase64(t *testing.T) {
	s, _ := newTestService(t)
	openSession(t, s, "b64")

	if err := s.Write("b64", "not base64 at all!"); err == nil {
		t.Error("expected a decode error")
	}
}

func TestUnknownSessionsAreErrorsNotPanics(t *testing.T) {
	s, _ := newTestService(t)

	if err := s.Write("ghost", ""); err == nil {
		t.Error("Write: expected an error")
	}
	if err := s.Resize("ghost", 80, 24); err == nil {
		t.Error("Resize: expected an error")
	}
	if s.Close("ghost") {
		t.Error("Close: expected false")
	}
}

func TestResolveShellPrefersTheUsersOwn(t *testing.T) {
	t.Setenv("SHELL", "/bin/sh")
	got, err := resolveShell("")
	if err != nil {
		t.Fatalf("resolveShell: %v", err)
	}
	if got != "/bin/sh" {
		t.Errorf("resolveShell() = %q, want /bin/sh", got)
	}

	// An explicit choice from Settings beats the environment.
	got, err = resolveShell("/bin/sh")
	if err != nil || got != "/bin/sh" {
		t.Errorf("resolveShell(explicit) = %q, %v", got, err)
	}

	// A bare name resolves through PATH, so "bash" is a usable answer.
	if _, err := resolveShell("sh"); err != nil {
		t.Errorf("resolveShell(sh): %v", err)
	}

	if _, err := resolveShell("/definitely/not/here"); err == nil {
		t.Error("expected a missing shell to be reported")
	}
}

func TestLoginArgs(t *testing.T) {
	// Known shells are started as login shells so the user's PATH exists;
	// anything unrecognised gets no arguments rather than a guess.
	for _, shell := range []string{"/bin/zsh", "/bin/bash", "/usr/local/bin/fish", "/bin/sh"} {
		if got := loginArgs(shell); len(got) != 1 || got[0] != "-l" {
			t.Errorf("loginArgs(%q) = %v, want [-l]", shell, got)
		}
	}
	if got := loginArgs("/opt/homebrew/bin/nushell"); got != nil {
		t.Errorf("loginArgs(unknown) = %v, want nil", got)
	}
}

func TestWinsizeNeverReturnsZero(t *testing.T) {
	// A 0×0 pty makes everything that draws itself compute a negative width.
	ws := winsize(0, 0)
	if ws.Cols == 0 || ws.Rows == 0 {
		t.Errorf("winsize(0,0) = %dx%d, want a usable default", ws.Cols, ws.Rows)
	}
	ws = winsize(120, 40)
	if ws.Cols != 120 || ws.Rows != 40 {
		t.Errorf("winsize(120,40) = %dx%d", ws.Cols, ws.Rows)
	}
}
