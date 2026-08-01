package watcher

import (
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"
)

func makeRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	// macOS /var/folders paths are symlinks; resolve so Rel() comparisons in
	// classify() line up with the paths fsnotify reports.
	if resolved, err := filepath.EvalSymlinks(dir); err == nil {
		dir = resolved
	}
	for _, args := range [][]string{
		{"init", "-q", "-b", "main"},
		{"config", "user.email", "t@example.com"},
		{"config", "user.name", "T"},
	} {
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %s: %v\n%s", strings.Join(args, " "), err, out)
		}
	}
	return dir
}

type collector struct {
	mu     sync.Mutex
	events []ChangeEvent
}

func (c *collector) install(s *Service) {
	s.emit = func(_ string, data any) {
		if ev, ok := data.(ChangeEvent); ok {
			c.mu.Lock()
			c.events = append(c.events, ev)
			c.mu.Unlock()
		}
	}
}

// waitFor polls until an event containing reason arrives, or the deadline hits.
func (c *collector) waitFor(t *testing.T, reason string, within time.Duration) ChangeEvent {
	t.Helper()
	deadline := time.Now().Add(within)
	for time.Now().Before(deadline) {
		c.mu.Lock()
		for _, ev := range c.events {
			if slices.Contains(ev.Reasons, reason) {
				c.mu.Unlock()
				return ev
			}
		}
		c.mu.Unlock()
		time.Sleep(20 * time.Millisecond)
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	t.Fatalf("no event with reason %q within %v; got %+v", reason, within, c.events)
	return ChangeEvent{}
}

func (c *collector) count() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.events)
}

func TestWatchReportsWorktreeChange(t *testing.T) {
	repo := makeRepo(t)
	s := New()
	col := &collector{}
	col.install(s)

	if _, err := s.Watch(repo); err != nil {
		t.Fatal(err)
	}
	defer s.Unwatch(repo)

	time.Sleep(100 * time.Millisecond) // let the watcher settle
	if err := os.WriteFile(filepath.Join(repo, "hello.txt"), []byte("hi"), 0o644); err != nil {
		t.Fatal(err)
	}

	col.waitFor(t, ReasonWorktree, 3*time.Second)
}

func TestWatchReportsCommit(t *testing.T) {
	repo := makeRepo(t)
	s := New()
	col := &collector{}
	col.install(s)

	if _, err := s.Watch(repo); err != nil {
		t.Fatal(err)
	}
	defer s.Unwatch(repo)
	time.Sleep(100 * time.Millisecond)

	if err := os.WriteFile(filepath.Join(repo, "a.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]string{{"add", "-A"}, {"commit", "-q", "-m", "first"}} {
		cmd := exec.Command("git", args...)
		cmd.Dir = repo
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}

	// A commit moves HEAD and writes a ref; at least one must be reported.
	deadline := time.Now().Add(4 * time.Second)
	for time.Now().Before(deadline) {
		col.mu.Lock()
		found := slices.ContainsFunc(col.events, func(ev ChangeEvent) bool {
			return slices.Contains(ev.Reasons, ReasonHead) ||
				slices.Contains(ev.Reasons, ReasonRefs) ||
				slices.Contains(ev.Reasons, ReasonIndex)
		})
		col.mu.Unlock()
		if found {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("commit produced no head/refs/index event")
}

// A burst of writes must collapse into very few events, or every git operation
// would trigger a storm of redundant queries.
func TestDebounceCoalescesBurst(t *testing.T) {
	repo := makeRepo(t)
	s := New()
	col := &collector{}
	col.install(s)

	if _, err := s.Watch(repo); err != nil {
		t.Fatal(err)
	}
	defer s.Unwatch(repo)
	time.Sleep(100 * time.Millisecond)

	for i := range 60 {
		p := filepath.Join(repo, "burst", "f.txt")
		_ = os.MkdirAll(filepath.Dir(p), 0o755)
		if err := os.WriteFile(p, []byte{byte(i)}, 0o644); err != nil {
			t.Fatal(err)
		}
		time.Sleep(2 * time.Millisecond)
	}

	col.waitFor(t, ReasonWorktree, 3*time.Second)
	time.Sleep(400 * time.Millisecond) // let any stragglers flush

	if n := col.count(); n > 4 {
		t.Errorf("60 rapid writes produced %d events; debounce is not coalescing", n)
	}
}

func TestUnwatchStopsEvents(t *testing.T) {
	repo := makeRepo(t)
	s := New()
	col := &collector{}
	col.install(s)

	if _, err := s.Watch(repo); err != nil {
		t.Fatal(err)
	}
	time.Sleep(100 * time.Millisecond)

	if !s.Unwatch(repo) {
		t.Fatal("Unwatch reported false for a watched repo")
	}
	if s.Unwatch(repo) {
		t.Error("second Unwatch should report false")
	}

	before := col.count()
	if err := os.WriteFile(filepath.Join(repo, "after.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	time.Sleep(600 * time.Millisecond)

	if got := col.count(); got != before {
		t.Errorf("received %d events after Unwatch", got-before)
	}
}

func TestWatchRejectsNonRepository(t *testing.T) {
	s := New()
	if _, err := s.Watch(t.TempDir()); err == nil {
		t.Fatal("expected an error for a directory that is not a repository")
	}
}

func TestWatchIsIdempotent(t *testing.T) {
	repo := makeRepo(t)
	s := New()
	first, err := s.Watch(repo)
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.Watch(repo)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Unwatch(repo)

	if first.Dirs != second.Dirs {
		t.Errorf("re-watching produced a different setup: %+v vs %+v", first, second)
	}
	if n := len(s.Watching()); n != 1 {
		t.Errorf("Watching() reports %d repos, want 1", n)
	}
}

func TestClassify(t *testing.T) {
	const repo = "/r"
	cases := []struct {
		path        string
		want        string
		interesting bool
	}{
		{"/r/src/main.go", ReasonWorktree, true},
		{"/r/.git/HEAD", ReasonHead, true},
		{"/r/.git/ORIG_HEAD", ReasonHead, true},
		{"/r/.git/index", ReasonIndex, true},
		{"/r/.git/refs/heads/main", ReasonRefs, true},
		{"/r/.git/packed-refs", ReasonRefs, true},
		{"/r/.git/MERGE_HEAD", ReasonState, true},
		{"/r/.git/rebase-merge/done", ReasonState, true},
		// Noise that must not wake the UI:
		{"/r/.git/objects/ab/cdef", "", false},
		{"/r/.git/logs/HEAD", "", false},
		{"/r/.git/config", "", false},
		{"/r/.DS_Store", "", false},
	}

	for _, tc := range cases {
		got, interesting := classify(repo, tc.path)
		if interesting != tc.interesting || got != tc.want {
			t.Errorf("classify(%q) = (%q, %v), want (%q, %v)",
				tc.path, got, interesting, tc.want, tc.interesting)
		}
	}
}
