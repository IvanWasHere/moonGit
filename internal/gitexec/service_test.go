package gitexec

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// makeRepo builds a throwaway repository in t.TempDir().
//
// Tests never touch testGitHere/test-repo{1,2} (PLAN.md §13a) — those are real
// repos with real GitHub remotes, and a test that hard-resets them destroys
// state a test runner cannot restore.
func makeRepo(t *testing.T, commits int) string {
	t.Helper()
	dir := t.TempDir()

	run := func(args ...string) {
		t.Helper()
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(),
			"GIT_AUTHOR_NAME=Test", "GIT_AUTHOR_EMAIL=test@example.com",
			"GIT_COMMITTER_NAME=Test", "GIT_COMMITTER_EMAIL=test@example.com",
		)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %s: %v\n%s", strings.Join(args, " "), err, out)
		}
	}

	run("init", "-q", "-b", "main")
	for i := range commits {
		name := filepath.Join(dir, fmt.Sprintf("file%03d.txt", i))
		if err := os.WriteFile(name, []byte(strings.Repeat("content\n", 40)), 0o644); err != nil {
			t.Fatal(err)
		}
		run("add", "-A")
		run("commit", "-q", "-m", fmt.Sprintf("commit number %d with a reasonably long subject line", i))
	}
	return dir
}

func newTestService(t *testing.T) *Service {
	t.Helper()
	s := New()
	s.Startup(nil) // no Wails context; emitEvent no-ops unless emit is set
	if s.Info().Version == "" {
		t.Skip("git not available on PATH")
	}
	return s
}

func TestRunReturnsOutput(t *testing.T) {
	s := newTestService(t)
	repo := makeRepo(t, 2)

	res, err := s.Run(RunRequest{RepoPath: repo, Args: []string{"rev-parse", "--abbrev-ref", "HEAD"}})
	if err != nil {
		t.Fatalf("unexpected spawn error: %v", err)
	}
	if res.ExitCode != 0 {
		t.Fatalf("exit code = %d, stderr = %q", res.ExitCode, res.Stderr)
	}
	if got := strings.TrimSpace(res.Stdout); got != "main" {
		t.Errorf("branch = %q, want %q", got, "main")
	}
}

// The central contract of this package: git failing is data, not an error.
func TestNonZeroExitIsNotAnError(t *testing.T) {
	s := newTestService(t)

	cases := []struct {
		name string
		req  RunRequest
	}{
		{"outside a repository", RunRequest{RepoPath: t.TempDir(), Args: []string{"status"}}},
		{"unknown revision", RunRequest{RepoPath: makeRepo(t, 1), Args: []string{"rev-parse", "nope"}}},
		{"bad subcommand", RunRequest{RepoPath: makeRepo(t, 1), Args: []string{"frobnicate"}}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			res, err := s.Run(tc.req)
			if err != nil {
				t.Fatalf("returned a Go error for a non-zero exit: %v", err)
			}
			if res.ExitCode == 0 {
				t.Errorf("expected non-zero exit, got 0")
			}
			if res.Stderr == "" {
				t.Errorf("expected stderr to explain the failure")
			}
		})
	}
}

func TestRunMissingArgsIsAnError(t *testing.T) {
	s := newTestService(t)
	if _, err := s.Run(RunRequest{RepoPath: t.TempDir()}); err == nil {
		t.Fatal("expected an error when no args are supplied")
	}
}

// fakeGit writes a stand-in binary that answers --version and otherwise blocks.
// Real git has no reliably slow subcommand, and racing a big `git log` against
// a short timeout makes for a flaky test. This exercises the same timeout path
// deterministically.
func fakeGit(t *testing.T, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "fake-git")
	script := "#!/bin/sh\ncase \"$1\" in\n  --version) echo 'git version 2.99.0-fake'; exit 0;;\nesac\n" + body
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestRunTimeout(t *testing.T) {
	s := newTestService(t)
	if _, err := s.SetGitPath(fakeGit(t, "sleep 30\n")); err != nil {
		t.Fatal(err)
	}

	start := time.Now()
	res, err := s.Run(RunRequest{
		RepoPath:  t.TempDir(),
		Args:      []string{"status"},
		TimeoutMs: 200,
	})
	elapsed := time.Since(start)

	if err != nil {
		// A killed process surfaces as an ExitError, which is data, not an error.
		t.Fatalf("unexpected spawn error: %v", err)
	}
	if !res.TimedOut {
		t.Errorf("TimedOut = false, want true (exit %d)", res.ExitCode)
	}
	if elapsed > 5*time.Second {
		t.Errorf("took %v; the process was not killed at the deadline", elapsed)
	}
}

func TestSetGitPathRejectsBadBinary(t *testing.T) {
	s := newTestService(t)
	before := s.Info().Path

	if _, err := s.SetGitPath("/definitely/not/git"); err == nil {
		t.Fatal("expected an error for a non-existent binary")
	}
	if s.Info().Path != before {
		t.Errorf("git path changed to %q despite validation failing", s.Info().Path)
	}
}

// --- streaming -----------------------------------------------------------

type capture struct {
	mu     sync.Mutex
	chunks []ChunkEvent
	done   []StreamResult
}

func (c *capture) install(s *Service) {
	s.emit = func(event string, data any) {
		c.mu.Lock()
		defer c.mu.Unlock()
		switch v := data.(type) {
		case ChunkEvent:
			c.chunks = append(c.chunks, v)
		case StreamResult:
			c.done = append(c.done, v)
		}
	}
}

func (c *capture) joined() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	var b strings.Builder
	for _, ch := range c.chunks {
		b.WriteString(ch.Data)
	}
	return b.String()
}

func TestRunStreamMatchesBufferedRun(t *testing.T) {
	s := newTestService(t)
	repo := makeRepo(t, 60)
	cap := &capture{}
	cap.install(s)

	args := []string{"log", "-z", "--format=%H%x00%an%x00%s"}

	buffered, err := s.Run(RunRequest{RepoPath: repo, Args: args})
	if err != nil {
		t.Fatal(err)
	}

	res, err := s.RunStream("run-1", StreamRequest{
		RunRequest: RunRequest{RepoPath: repo, Args: args},
		Delimiter:  "nul",
		ChunkSize:  512, // small, to force many chunks
	})
	if err != nil {
		t.Fatal(err)
	}

	if res.ExitCode != 0 {
		t.Fatalf("exit %d: %s", res.ExitCode, res.Stderr)
	}
	if res.Chunks < 2 {
		t.Errorf("expected output to span multiple chunks, got %d", res.Chunks)
	}
	if got := cap.joined(); got != buffered.Stdout {
		t.Errorf("streamed output differs from buffered output (%d vs %d bytes)",
			len(got), len(buffered.Stdout))
	}
	if len(cap.done) != 1 {
		t.Errorf("expected exactly one done event, got %d", len(cap.done))
	}
	// Sequence numbers must be gapless so the frontend can detect drops.
	for i, ch := range cap.chunks {
		if ch.Seq != i {
			t.Fatalf("chunk %d has seq %d; sequence is not contiguous", i, ch.Seq)
		}
	}
}

func TestCancelStopsStream(t *testing.T) {
	s := newTestService(t)
	repo := makeRepo(t, 120)
	cap := &capture{}
	cap.install(s)

	done := make(chan StreamResult, 1)
	go func() {
		res, err := s.RunStream("cancel-me", StreamRequest{
			RunRequest: RunRequest{RepoPath: repo, Args: []string{"log", "-p", "--format=%H"}},
			Delimiter:  "lf",
			ChunkSize:  8 << 10,
		})
		if err != nil {
			t.Errorf("stream returned error: %v", err)
		}
		done <- res
	}()

	// Wait until the stream is actually registered before cancelling, otherwise
	// the test races the goroutine and cancels nothing.
	deadline := time.After(5 * time.Second)
	for {
		if s.Cancel("cancel-me") {
			break
		}
		select {
		case <-deadline:
			t.Fatal("stream never registered as running")
		case <-time.After(2 * time.Millisecond):
		}
	}

	select {
	case res := <-done:
		if !res.Canceled && res.ExitCode == 0 {
			t.Errorf("expected cancellation to be visible; got %+v", res)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("stream did not stop after Cancel")
	}
}

func TestCancelUnknownRunIsNotAnError(t *testing.T) {
	s := newTestService(t)
	if s.Cancel("never-existed") {
		t.Error("Cancel reported true for an unknown run")
	}
}

func TestDuplicateRunIDRejected(t *testing.T) {
	s := newTestService(t)
	repo := makeRepo(t, 60)

	started := make(chan struct{})
	go func() {
		close(started)
		_, _ = s.RunStream("dup", StreamRequest{
			RunRequest: RunRequest{RepoPath: repo, Args: []string{"log", "-p"}},
			ChunkSize:  8 << 10,
		})
	}()
	<-started

	// Give the goroutine a moment to register, then assert the second call fails.
	for range 200 {
		s.mu.Lock()
		_, running := s.running["dup"]
		s.mu.Unlock()
		if running {
			break
		}
		time.Sleep(2 * time.Millisecond)
	}

	if _, err := s.RunStream("dup", StreamRequest{
		RunRequest: RunRequest{RepoPath: repo, Args: []string{"status"}},
	}); err == nil {
		t.Error("expected an error for a duplicate in-flight runID")
	}
	s.Cancel("dup")
}

// Paths with non-ASCII characters must survive intact. Without
// core.quotePath=false git emits "\303\251.txt" and every parser downstream
// would need to undo that escaping.
func TestNonAsciiPathsAreNotEscaped(t *testing.T) {
	s := newTestService(t)
	repo := makeRepo(t, 1)

	name := "café-ünïcode.txt"
	if err := os.WriteFile(filepath.Join(repo, name), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	res, err := s.Run(RunRequest{
		RepoPath: repo,
		Args:     []string{"status", "--porcelain=v2", "-z", "--untracked-files=all"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(res.Stdout, name) {
		t.Errorf("expected raw UTF-8 path %q in output, got %q", name, res.Stdout)
	}
}
