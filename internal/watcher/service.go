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
	"syscall"
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

	// Descriptors held back for everything that is not a watch: git
	// subprocesses and their pipes, SQLite, the webview, sockets. This is the
	// number that matters — when the watcher takes the process to its limit it
	// does not fail quietly, it fails as `fork/exec git: too many open files`,
	// which is every git command in the app failing at once and reads to the
	// user as the repository being broken rather than as a watcher problem.
	reservedDescriptors = 2048

	// A ceiling on the budget regardless of how generous the limit is. Beyond
	// a few thousand watches the marginal one is deep inside a dependency tree
	// nobody is editing, and the cost is paid on every repository open.
	maxWatchDescriptors = 4096

	// Used when the limit cannot be read. Deliberately small: guessing high
	// risks the failure this whole budget exists to prevent.
	fallbackWatchDescriptors = 512
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
	// Descriptors is what those directories are estimated to cost. Reported
	// because the number that bounds this is a process-wide resource, so a
	// reader debugging "why is my working tree not updating" needs to see the
	// budget and not just the directory count.
	Descriptors int `json:"descriptors"`
	// Degraded means part of the working tree is not being watched, because
	// covering it would have cost more descriptors than the process can spare.
	// `.git` is always covered, so commits, checkouts and staging still report;
	// edits to files in the unwatched part do not. The UI should say so and
	// offer a manual refresh rather than letting the panel look up to date.
	Degraded bool `json:"degraded"`
}

type repoWatch struct {
	watcher *fsnotify.Watcher
	stop    chan struct{}
	info    WatchInfo

	// Budget left for directories created after the initial walk. Read and
	// written only by loop, which is single-threaded, so it needs no lock.
	remaining int
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
//
// excludeDirs are repository-relative directories to leave unwatched, decided
// by the caller. In practice they are the gitignored ones, and passing them in
// rather than working them out here is what keeps git knowledge out of Go
// (PLAN.md §4): this package cannot read a `.gitignore`, and a `.gitignore` is
// not a list of paths anyway — it is nested files with negations, which only
// git resolves correctly.
//
// It is worth more than the descriptors it saves. An ignored directory
// produces events that are, by definition, invisible to `git status`, so every
// one of them is a query invalidation that finds nothing changed. Watching
// `node_modules` during an `npm install` is a self-inflicted event storm.
func (s *Service) Watch(repoPath string, excludeDirs []string) (WatchInfo, error) {
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
	budget := watchBudget()
	excluded := excludedSet(abs, excludeDirs)

	// .git first, and unconditionally. It is small, bounded, and carries the
	// highest-signal events — a commit, a checkout, a fetch. A repository whose
	// working tree is too large to watch should still report those, which is
	// what makes degraded mode useful rather than merely honest.
	gitTargets := collectWatchTargets(gitDir, budget, isGitInternalNoise, nil)
	for _, d := range gitTargets.dirs {
		_ = w.Add(d)
	}
	info.Dirs = len(gitTargets.dirs)
	info.Descriptors = gitTargets.descriptors

	// Then as much of the working tree as the rest of the budget covers.
	//
	// Partial coverage rather than none, unlike the previous behaviour, which
	// dropped the whole working tree the moment it did not fit. Breadth-first
	// makes the part that is kept the shallow part — a project's own source
	// rather than the inside of its dependencies — so partial coverage is
	// worth having, and `Degraded` is what says it is partial.
	treeTargets := collectWatchTargets(abs, budget-gitTargets.descriptors, isWorktreeNoise, excluded)
	for _, d := range treeTargets.dirs {
		_ = w.Add(d)
	}
	info.Dirs += len(treeTargets.dirs)
	info.Descriptors += treeTargets.descriptors
	info.Degraded = treeTargets.truncated || gitTargets.truncated

	rw := &repoWatch{
		watcher:   w,
		stop:      make(chan struct{}),
		info:      info,
		remaining: budget - info.Descriptors,
	}

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
			if !meaningful(repoPath, ev) {
				continue
			}
			reason, interesting := classify(repoPath, ev.Name)
			if !interesting {
				continue
			}
			pending[reason] = struct{}{}

			// A new directory inside the working tree needs its own watch, or
			// changes within it would be invisible.
			//
			// Charged against the same budget as the initial walk. Without
			// that, checking out a branch that adds a dependency tree, or a
			// build writing thousands of directories, walks the process
			// straight into the descriptor limit that the walk was careful to
			// stay under — the slow version of the same crash.
			if ev.Op.Has(fsnotify.Create) {
				rw.watchNewDir(ev.Name)
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

// watchNewDir adds a watch for a directory created since the initial walk, if
// there is budget for it. Marks the watch degraded when there is not, because
// from that moment changes inside that directory go unreported.
func (rw *repoWatch) watchNewDir(path string) {
	fi, err := os.Stat(path)
	if err != nil || !fi.IsDir() {
		return
	}

	children, err := os.ReadDir(path)
	if err != nil {
		return
	}
	cost := 1 + len(children)
	if cost > rw.remaining {
		rw.info.Degraded = true
		return
	}

	if err := rw.watcher.Add(path); err != nil {
		return
	}
	rw.remaining -= cost
	rw.info.Dirs++
	rw.info.Descriptors += cost
}

// meaningful rejects events that report no change to anything the UI shows.
//
// **An attribute change inside `.git` is a feedback loop, not news.** kqueue
// raises NOTE_ATTRIB — which fsnotify calls Chmod — when a file's access time
// moves, and reading a file moves its access time. Every `git status` reads
// `.git/index`; that raised a Chmod, which was classified as "the index
// changed", which invalidated the status query, which ran `git status`, which
// read the index. Measured at 42 events on `.git/index` in five seconds with
// the app idle and nothing on disk actually changing — the index's own
// modification time never moved.
//
// Only inside `.git`, deliberately. In the working tree a mode change is a
// real change that `git status` reports, so a Chmod there is worth acting on;
// inside `.git` nothing is ever communicated by an attribute alone, because
// git signals through the contents it writes.
func meaningful(repoPath string, ev fsnotify.Event) bool {
	if ev.Op != fsnotify.Chmod {
		return true
	}
	rel, err := filepath.Rel(repoPath, ev.Name)
	if err != nil {
		return true
	}
	rel = filepath.ToSlash(rel)
	return rel != ".git" && !strings.HasPrefix(rel, ".git/")
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

// excludedSet turns caller-supplied repository-relative directories into the
// absolute paths the walk compares against.
//
// Entries that escape the repository are dropped rather than trusted: this
// list crosses the bridge from the frontend, and a `../` in it would silently
// change which tree is being reasoned about.
func excludedSet(root string, dirs []string) map[string]struct{} {
	if len(dirs) == 0 {
		return nil
	}
	out := make(map[string]struct{}, len(dirs))
	for _, d := range dirs {
		clean := filepath.Clean(strings.TrimSpace(d))
		if clean == "" || clean == "." || filepath.IsAbs(clean) || strings.HasPrefix(clean, "..") {
			continue
		}
		out[filepath.Join(root, clean)] = struct{}{}
	}
	return out
}

// watchBudget is how many file descriptors the watcher may spend, read from
// the process limit rather than assumed.
//
// A constant would be wrong on both sides: too high and the app dies on a
// machine with a tighter limit, too low and it degrades on a machine that
// could have coped. Go raises the soft limit to 10240 on macOS at startup, but
// that is an implementation detail of the runtime and not a promise.
func watchBudget() int {
	var lim syscall.Rlimit
	if err := syscall.Getrlimit(syscall.RLIMIT_NOFILE, &lim); err != nil {
		return fallbackWatchDescriptors
	}
	// Cur is RLIM_INFINITY on some systems, which overflows int on 32-bit and
	// is meaningless here regardless — the ceiling below is the real answer.
	soft := int64(lim.Cur)
	if soft <= 0 || soft > int64(maxWatchDescriptors+reservedDescriptors) {
		return maxWatchDescriptors
	}
	budget := int(soft) - reservedDescriptors
	if budget < 0 {
		return 0
	}
	return budget
}

// watchTargets is a set of directories to hand to fsnotify, what they are
// expected to cost, and whether the tree was covered completely.
type watchTargets struct {
	dirs        []string
	descriptors int
	truncated   bool
}

// collectWatchTargets chooses directories to watch within a descriptor budget.
//
// **The budget counts files, not directories, and that is the whole point of
// this function.** fsnotify's kqueue backend opens a descriptor for the
// directory *and one for every entry inside it* — `watchDirectoryFiles`, which
// exists to make kqueue behave like inotify. So the cost of watching a tree
// tracks its file count, and a cap on directories measures the wrong thing
// entirely: 150 directories holding 30,000 files cost 30,000 descriptors and
// took every git command in the app down with `too many open files`.
//
// **Breadth-first, so a truncated walk keeps the useful part.** Depth-first
// spends the budget on whatever subtree it happens to enter first, which in a
// JavaScript project is `node_modules` and is nobody's source code. Level by
// level, the directories a person actually edits are claimed before the
// dependency trees, and what gets dropped is the deepest and least interesting.
//
// A directory too expensive to afford is skipped rather than ending the walk —
// its siblings may well fit, and one enormous folder should not cost coverage
// everywhere else.
func collectWatchTargets(
	root string,
	budget int,
	skip func(string) bool,
	excluded map[string]struct{},
) watchTargets {
	out := watchTargets{dirs: make([]string, 0, 64)}
	queue := []string{root}

	for len(queue) > 0 && out.descriptors < budget {
		dir := queue[0]
		queue = queue[1:]

		children, err := os.ReadDir(dir)
		if err != nil {
			continue // unreadable subtree; skip it rather than abort
		}

		// One descriptor for the directory, one per entry inside it. This
		// over-counts slightly, since a subdirectory we also watch is counted
		// by its parent and again as itself — fsnotify keeps one watch per
		// path. Over-counting is the safe direction for a limit like this.
		cost := 1 + len(children)
		if out.descriptors+cost > budget {
			out.truncated = true
			continue
		}

		out.dirs = append(out.dirs, dir)
		out.descriptors += cost

		for _, child := range children {
			if !child.IsDir() || skip(child.Name()) {
				continue
			}
			path := filepath.Join(dir, child.Name())
			if _, ok := excluded[path]; ok {
				continue
			}
			queue = append(queue, path)
		}
	}

	if len(queue) > 0 {
		out.truncated = true
	}
	return out
}
