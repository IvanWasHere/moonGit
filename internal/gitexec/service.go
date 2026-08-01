// Package gitexec runs the git binary and hands raw bytes back to the frontend.
//
// It deliberately knows nothing about git semantics. There is no notion here of
// a commit, a branch, or a status code — those live in TypeScript (PLAN.md §5).
// This package spawns processes, streams their output, and reports how they
// exited. Keeping it that dumb is what allows the whole product model to live
// in one language.
package gitexec

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// RunRequest describes one git invocation.
type RunRequest struct {
	RepoPath string   `json:"repoPath"`
	Args     []string `json:"args"`
	Stdin    string   `json:"stdin,omitempty"`
	// Env entries in "KEY=VALUE" form, layered over the managed defaults.
	Env       []string `json:"env,omitempty"`
	TimeoutMs int      `json:"timeoutMs,omitempty"`
}

// RunResult is the outcome of a git invocation.
//
// Note what is NOT here: an error field. A non-zero exit code is data, not a
// failure — `git merge` exits 1 on conflict, `git diff --quiet` exits 1 when
// there are changes, `git rev-parse` exits 128 outside a repository. All of
// those are answers the UI needs to act on. Only a failure to *spawn* git at
// all is returned as a Go error, which is what makes the frontend's
// "never throw uncaught exceptions" rule achievable (PLAN.md §4.1).
type RunResult struct {
	Stdout     string `json:"stdout"`
	Stderr     string `json:"stderr"`
	ExitCode   int    `json:"exitCode"`
	DurationMs int64  `json:"durationMs"`
	TimedOut   bool   `json:"timedOut"`
}

// StreamRequest is a RunRequest plus how to cut the output into chunks.
type StreamRequest struct {
	RunRequest
	// Delimiter marks record boundaries so chunks never split a record.
	// "nul" for `-z` output, "lf" for line-oriented, "raw" for no structure.
	Delimiter string `json:"delimiter,omitempty"`
	ChunkSize int    `json:"chunkSize,omitempty"`
}

// StreamResult summarises a completed stream. Stdout is absent by design —
// it was already delivered as events.
type StreamResult struct {
	Stderr     string `json:"stderr"`
	ExitCode   int    `json:"exitCode"`
	DurationMs int64  `json:"durationMs"`
	TimedOut   bool   `json:"timedOut"`
	Canceled   bool   `json:"canceled"`
	BytesOut   int64  `json:"bytesOut"`
	Chunks     int    `json:"chunks"`
}

// ChunkEvent is emitted on "git:chunk:<runID>".
type ChunkEvent struct {
	RunID string `json:"runId"`
	Seq   int    `json:"seq"`
	Data  string `json:"data"`
}

// Service executes git. One instance is bound to Wails.
type Service struct {
	ctx     context.Context
	gitPath string
	version string

	mu      sync.Mutex
	running map[string]context.CancelFunc

	// emit is swappable so tests can observe the event stream without a live
	// Wails runtime. Unexported on purpose: Wails binds exported methods, and a
	// function-valued parameter has no meaningful TypeScript signature.
	emit func(event string, data any)
}

func New() *Service {
	return &Service{
		gitPath: "git",
		running: make(map[string]context.CancelFunc),
	}
}

func (s *Service) emitEvent(event string, data any) {
	if s.emit != nil {
		s.emit(event, data)
		return
	}
	if s.ctx == nil {
		return // not running under Wails (tests, CLI use)
	}
	runtime.EventsEmit(s.ctx, event, data)
}

// Startup receives the Wails context used for event emission.
func (s *Service) Startup(ctx context.Context) {
	s.ctx = ctx
	if v, err := s.detectVersion(s.gitPath); err == nil {
		s.version = v
	}
}

// --- configuration -------------------------------------------------------

// GitInfo reports the resolved git binary and its version.
type GitInfo struct {
	Path      string `json:"path"`
	Version   string `json:"version"`
	Available bool   `json:"available"`
}

func (s *Service) Info() GitInfo {
	s.mu.Lock()
	path, version := s.gitPath, s.version
	s.mu.Unlock()
	return GitInfo{Path: path, Version: version, Available: version != ""}
}

// SetGitPath points the service at a different git binary (Settings requirement).
// The path is validated before being adopted, so a bad value can't silently
// break every subsequent command.
func (s *Service) SetGitPath(path string) (GitInfo, error) {
	if strings.TrimSpace(path) == "" {
		path = "git"
	}
	version, err := s.detectVersion(path)
	if err != nil {
		return GitInfo{Path: path}, fmt.Errorf("not a usable git binary: %w", err)
	}
	s.mu.Lock()
	s.gitPath, s.version = path, version
	s.mu.Unlock()
	return GitInfo{Path: path, Version: version, Available: true}, nil
}

func (s *Service) detectVersion(path string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, path, "--version").Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

// --- execution -----------------------------------------------------------

// Run executes git and buffers the whole output.
//
// Use this for bounded output (status, rev-parse, config). For anything that
// can grow without bound — log, diff of a large change — use RunStream, or the
// buffered result will stall the Wails bridge.
func (s *Service) Run(req RunRequest) (RunResult, error) {
	started := time.Now()

	ctx, cancel := s.contextFor(req.TimeoutMs)
	defer cancel()

	cmd, err := s.command(ctx, req)
	if err != nil {
		return RunResult{}, err
	}

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if req.Stdin != "" {
		cmd.Stdin = strings.NewReader(req.Stdin)
	}

	runErr := cmd.Run()
	code, spawnErr := exitCode(runErr)
	if spawnErr != nil {
		return RunResult{}, spawnErr
	}

	return RunResult{
		Stdout:     stdout.String(),
		Stderr:     stderr.String(),
		ExitCode:   code,
		DurationMs: time.Since(started).Milliseconds(),
		TimedOut:   errors.Is(ctx.Err(), context.DeadlineExceeded),
	}, nil
}

// RunStream executes git and emits stdout as a series of chunk events on
// "git:chunk:<runID>", resolving once the process exits. Cancel with Cancel(runID).
func (s *Service) RunStream(runID string, req StreamRequest) (StreamResult, error) {
	if runID == "" {
		return StreamResult{}, errors.New("runID is required")
	}
	started := time.Now()

	ctx, cancel := s.contextFor(req.TimeoutMs)
	defer cancel()

	s.mu.Lock()
	if _, exists := s.running[runID]; exists {
		s.mu.Unlock()
		return StreamResult{}, fmt.Errorf("runID %q is already in flight", runID)
	}
	s.running[runID] = cancel
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.running, runID)
		s.mu.Unlock()
	}()

	cmd, err := s.command(ctx, req.RunRequest)
	if err != nil {
		return StreamResult{}, err
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return StreamResult{}, err
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if req.Stdin != "" {
		cmd.Stdin = strings.NewReader(req.Stdin)
	}

	if err := cmd.Start(); err != nil {
		return StreamResult{}, err
	}

	delim, raw := parseDelimiter(req.Delimiter)
	ch := newChunker(delim, raw, req.ChunkSize)

	var (
		seq      int
		bytesOut int64
		readBuf  = make([]byte, 32<<10)
	)
	emit := func(b []byte) {
		if len(b) == 0 {
			return
		}
		s.emitEvent("git:chunk:"+runID, ChunkEvent{
			RunID: runID, Seq: seq, Data: string(b),
		})
		seq++
	}

	for {
		n, readErr := stdout.Read(readBuf)
		if n > 0 {
			bytesOut += int64(n)
			for _, chunk := range ch.write(readBuf[:n]) {
				emit(chunk)
			}
		}
		if readErr != nil {
			break // io.EOF, or the pipe closing because the process was killed
		}
	}
	emit(ch.flush())

	waitErr := cmd.Wait()
	code, spawnErr := exitCode(waitErr)
	if spawnErr != nil {
		return StreamResult{}, spawnErr
	}

	res := StreamResult{
		Stderr:     stderr.String(),
		ExitCode:   code,
		DurationMs: time.Since(started).Milliseconds(),
		TimedOut:   errors.Is(ctx.Err(), context.DeadlineExceeded),
		Canceled:   errors.Is(ctx.Err(), context.Canceled),
		BytesOut:   bytesOut,
		Chunks:     seq,
	}
	s.emitEvent("git:done:"+runID, res)
	return res, nil
}

// Cancel stops an in-flight stream. Cancelling an unknown or finished run is
// not an error — the caller often races with natural completion.
func (s *Service) Cancel(runID string) bool {
	s.mu.Lock()
	cancel, ok := s.running[runID]
	s.mu.Unlock()
	if ok {
		cancel()
	}
	return ok
}

// --- internals -----------------------------------------------------------

func (s *Service) contextFor(timeoutMs int) (context.Context, context.CancelFunc) {
	base := s.ctx
	if base == nil {
		base = context.Background()
	}
	// Detach from the Wails context's values but keep cancellation semantics
	// scoped to this call.
	if timeoutMs > 0 {
		return context.WithTimeout(context.Background(), time.Duration(timeoutMs)*time.Millisecond)
	}
	return context.WithCancel(context.Background())
}

func (s *Service) command(ctx context.Context, req RunRequest) (*exec.Cmd, error) {
	if len(req.Args) == 0 {
		return nil, errors.New("no git arguments supplied")
	}
	s.mu.Lock()
	gitPath := s.gitPath
	s.mu.Unlock()

	cmd := exec.CommandContext(ctx, gitPath, append(managedArgs(), req.Args...)...)
	if req.RepoPath != "" {
		cmd.Dir = req.RepoPath
	}
	cmd.Env = append(managedEnv(), req.Env...)

	// Kill git's whole process tree on cancel, and never let Wait block on
	// inherited pipes indefinitely. See proc_unix.go for why both are needed.
	configureProcessGroup(cmd)
	cmd.WaitDelay = waitDelay

	return cmd, nil
}

// How long Wait may block on I/O after the process has been signalled. Long
// enough to collect a dying process's final stderr, short enough that a stuck
// grandchild cannot wedge the UI.
const waitDelay = 2 * time.Second

// managedArgs are injected before every subcommand.
func managedArgs() []string {
	return []string{
		// Without this git escapes non-ASCII paths as C-style quoted strings
		// ("\303\251.txt"), which every downstream parser would have to undo.
		// Combined with -z output, paths arrive as raw UTF-8 bytes.
		"-c", "core.quotePath=false",
		// Never let a pager attach; it would block waiting for a terminal.
		"-c", "core.pager=cat",
	}
}

// managedEnv are the environment guarantees every invocation gets.
func managedEnv() []string {
	return append(os.Environ(),
		// A credential prompt with no terminal attached hangs forever. Failing
		// fast turns an auth problem into a UI affordance instead of a freeze
		// (PLAN.md §12).
		"GIT_TERMINAL_PROMPT=0",
		// Read-only commands must not take the index lock, or a background
		// status refresh can block the user's actual commit.
		"GIT_OPTIONAL_LOCKS=0",
		// Stable, parseable, English output regardless of the user's locale.
		"LC_ALL=C",
	)
}

func parseDelimiter(d string) (byte, bool) {
	switch strings.ToLower(d) {
	case "", "nul", "null", "zero":
		return 0x00, false
	case "lf", "line", "newline":
		return '\n', false
	case "raw", "none":
		return 0, true
	default:
		return 0x00, false
	}
}

// exitCode separates "git ran and exited non-zero" from "git could not run".
// The first is data; only the second is a Go error.
func exitCode(err error) (int, error) {
	if err == nil {
		return 0, nil
	}
	var ee *exec.ExitError
	if errors.As(err, &ee) {
		return ee.ExitCode(), nil
	}
	return -1, err
}
