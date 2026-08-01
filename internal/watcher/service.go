// Package watcher reports filesystem changes in a repository so the frontend
// can invalidate its queries instead of polling.
//
// It classifies *where* a change happened, never *what* it means. Deciding that
// a refs change implies re-reading branches is TypeScript's job (PLAN.md §6).
package watcher

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Reasons a repository is considered changed. The frontend maps these to
// query invalidations.
const (
	ReasonWorktree = "worktree" // tracked/untracked files in the working tree
	ReasonIndex    = "index"    // .git/index — staging changed
	ReasonRefs     = "refs"     // branches, tags, remote-tracking refs
	ReasonHead     = "head"     // HEAD moved: checkout, commit, reset
	ReasonState    = "state"    // MERGE_HEAD, REBASE_HEAD, CHERRY_PICK_HEAD…
)

const (
	debounceInterval = 200 * time.Millisecond

	// Watching a directory costs a file descriptor. A 500k-file repository has
	// far more directories than we can afford, so past this cap we stop
	// watching the working tree and watch only .git — see degraded mode below.
	maxWatchedDirs = 6000
)

// ChangeEvent is emitted on "repo:changed".
type ChangeEvent struct {
	RepoPath string   `json:"repoPath"`
	Reasons  []string `json:"reasons"`
}

// WatchInfo describes what a Watch call actually set up.
type WatchInfo struct {
	RepoPath string `json:"repoPath"`
	Dirs     int    `json:"dirs"`
	// Degraded means the working tree was too large to watch, so only .git is
	// monitored. Commits, checkouts, and staging still report, but edits to
	// files on disk do not — the UI should offer a manual refresh and say why.
	Degraded bool `json:"degraded"`
}

type repoWatch struct {
	watcher *fsnotify.Watcher
	stop    chan struct{}
	info    WatchInfo
}

type Service struct {
	ctx context.Context

	mu      sync.Mutex
	watches map[string]*repoWatch

	// emit is swappable for tests, as in gitexec.
	emit func(event string, data any)
}

func New() *Service {
	return &Service{watches: make(map[string]*repoWatch)}
}

func (s *Service) Startup(ctx context.Context) { s.ctx = ctx }

func (s *Service) emitEvent(event string, data any) {
	if s.emit != nil {
		s.emit(event, data)
		return
	}
	if s.ctx == nil {
		return
	}
	runtime.EventsEmit(s.ctx, event, data)
}

// Watch begins monitoring a repository. Watching an already-watched path is a
// no-op that returns the existing setup.
func (s *Service) Watch(repoPath string) (WatchInfo, error) {
	abs, err := filepath.Abs(repoPath)
	if err != nil {
		return WatchInfo{}, err
	}

	s.mu.Lock()
	if existing, ok := s.watches[abs]; ok {
		s.mu.Unlock()
		return existing.info, nil
	}
	s.mu.Unlock()

	gitDir := filepath.Join(abs, ".git")
	if _, err := os.Stat(gitDir); err != nil {
		return WatchInfo{}, errors.New("not a git repository: " + abs)
	}

	w, err := fsnotify.NewWatcher()
	if err != nil {
		return WatchInfo{}, err
	}

	info := WatchInfo{RepoPath: abs}

	// .git first — it is small, bounded, and carries the highest-signal events.
	gitDirs := collectDirs(gitDir, maxWatchedDirs, isGitInternalNoise)
	for _, d := range gitDirs {
		_ = w.Add(d)
	}
	info.Dirs = len(gitDirs)

	// Then the working tree, if it fits within the budget.
	remaining := maxWatchedDirs - info.Dirs
	if remaining > 0 {
		treeDirs := collectDirs(abs, remaining+1, isWorktreeNoise)
		if len(treeDirs) > remaining {
			info.Degraded = true // too big; keep .git-only watching
		} else {
			for _, d := range treeDirs {
				_ = w.Add(d)
			}
			info.Dirs += len(treeDirs)
		}
	} else {
		info.Degraded = true
	}

	rw := &repoWatch{watcher: w, stop: make(chan struct{}), info: info}

	s.mu.Lock()
	s.watches[abs] = rw
	s.mu.Unlock()

	go s.loop(abs, rw)
	return info, nil
}

// Unwatch stops monitoring. Unwatching an unwatched path is not an error.
func (s *Service) Unwatch(repoPath string) bool {
	abs, err := filepath.Abs(repoPath)
	if err != nil {
		return false
	}
	s.mu.Lock()
	rw, ok := s.watches[abs]
	if ok {
		delete(s.watches, abs)
	}
	s.mu.Unlock()

	if !ok {
		return false
	}
	close(rw.stop)
	_ = rw.watcher.Close()
	return true
}

// Watching lists the repositories currently monitored.
func (s *Service) Watching() []WatchInfo {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]WatchInfo, 0, len(s.watches))
	for _, rw := range s.watches {
		out = append(out, rw.info)
	}
	return out
}

// loop coalesces raw filesystem events into one debounced ChangeEvent.
//
// Debouncing is not a nicety. A single `git commit` touches the index, HEAD,
// a ref, and the reflog in quick succession; a fetch rewrites hundreds of refs.
// Emitting per-event would trigger a storm of redundant git queries.
func (s *Service) loop(repoPath string, rw *repoWatch) {
	pending := make(map[string]struct{})
	var timer *time.Timer
	var timerC <-chan time.Time

	flush := func() {
		if len(pending) == 0 {
			return
		}
		reasons := make([]string, 0, len(pending))
		for r := range pending {
			reasons = append(reasons, r)
		}
		sort.Strings(reasons) // stable payloads make the frontend easier to test
		clear(pending)
		s.emitEvent("repo:changed", ChangeEvent{RepoPath: repoPath, Reasons: reasons})
	}

	for {
		select {
		case <-rw.stop:
			if timer != nil {
				timer.Stop()
			}
			return

		case ev, ok := <-rw.watcher.Events:
			if !ok {
				return
			}
			reason, interesting := classify(repoPath, ev.Name)
			if !interesting {
				continue
			}
			pending[reason] = struct{}{}

			// A new directory inside the working tree needs its own watch, or
			// changes within it would be invisible.
			if ev.Op.Has(fsnotify.Create) && !rw.info.Degraded {
				if fi, err := os.Stat(ev.Name); err == nil && fi.IsDir() {
					_ = rw.watcher.Add(ev.Name)
				}
			}

			if timer == nil {
				timer = time.NewTimer(debounceInterval)
				timerC = timer.C
			} else {
				timer.Reset(debounceInterval)
			}

		case <-timerC:
			flush()
			timer, timerC = nil, nil

		case _, ok := <-rw.watcher.Errors:
			if !ok {
				return
			}
			// Watcher errors are usually a removed directory. The next real
			// event still arrives, so there is nothing useful to surface.
		}
	}
}

// classify maps a changed path to a reason, or reports it as uninteresting.
func classify(repoPath, changed string) (string, bool) {
	rel, err := filepath.Rel(repoPath, changed)
	if err != nil {
		return "", false
	}
	rel = filepath.ToSlash(rel)

	if !strings.HasPrefix(rel, ".git/") && rel != ".git" {
		if isWorktreeNoise(filepath.Base(rel)) {
			return "", false
		}
		return ReasonWorktree, true
	}

	inner := strings.TrimPrefix(rel, ".git/")
	switch {
	case inner == "HEAD" || inner == "ORIG_HEAD":
		return ReasonHead, true
	case inner == "index":
		return ReasonIndex, true
	case inner == "packed-refs" || strings.HasPrefix(inner, "refs/"):
		return ReasonRefs, true
	case strings.HasSuffix(inner, "_HEAD"),
		strings.HasPrefix(inner, "rebase-"),
		inner == "MERGE_MSG" || inner == "COMMIT_EDITMSG":
		return ReasonState, true
	default:
		// objects/, logs/, hooks/, config, lock files — no UI consequence, or
		// covered by a more specific event that accompanies it.
		return "", false
	}
}

// isGitInternalNoise reports directories inside .git not worth watching.
// objects/ churns violently during fetch and gc while carrying no UI meaning:
// what matters is the ref update that follows.
func isGitInternalNoise(name string) bool {
	switch name {
	case "objects", "lfs", "modules", "logs", "hooks":
		return true
	}
	return false
}

// isWorktreeNoise reports working-tree entries not worth watching. This is a
// deliberately small list — skipping a directory that is *not* gitignored would
// silently miss real changes, so we accept the cost of watching them and rely
// on maxWatchedDirs to bound the total.
func isWorktreeNoise(name string) bool {
	switch name {
	case ".git", ".DS_Store":
		return true
	}
	return false
}

// collectDirs walks a tree returning directories to watch, stopping once limit
// is exceeded so a huge repository cannot stall startup.
func collectDirs(root string, limit int, skip func(string) bool) []string {
	dirs := make([]string, 0, 64)
	_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil // unreadable subtree; skip it rather than abort
		}
		if !d.IsDir() {
			return nil
		}
		if path != root && skip(d.Name()) {
			return filepath.SkipDir
		}
		dirs = append(dirs, path)
		if len(dirs) > limit {
			return filepath.SkipAll
		}
		return nil
	})
	return dirs
}
