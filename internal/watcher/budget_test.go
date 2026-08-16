package watcher

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/fsnotify/fsnotify"
)

// The bug this budget exists to prevent, reproduced end to end.
//
// 30,000 files in 150 directories took the whole process to
// `fork/exec git: too many open files` — not a watcher failure but every git
// command in the app failing at once. The assertion is therefore not about the
// watcher at all: it is that git still runs afterwards.
func TestWatchDoesNotStarveGitOfDescriptors(t *testing.T) {
	if testing.Short() {
		t.Skip("creates 30,000 files")
	}
	repo := t.TempDir()
	run(t, repo, "git", "init")

	for i := 0; i < 30000; i++ {
		dir := filepath.Join(repo, fmt.Sprintf("d%03d", i/200))
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		f := filepath.Join(dir, fmt.Sprintf("f%05d.txt", i))
		if err := os.WriteFile(f, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	s := New()
	s.emit = func(string, any) {}
	info, err := s.Watch(repo, nil)
	if err != nil {
		t.Fatalf("watch: %v", err)
	}
	defer s.Unwatch(repo)

	t.Logf("dirs=%d descriptors=%d degraded=%v", info.Dirs, info.Descriptors, info.Degraded)

	if info.Descriptors > maxWatchDescriptors {
		t.Errorf("spent %d descriptors, budget is %d", info.Descriptors, maxWatchDescriptors)
	}
	if !info.Degraded {
		t.Error("a 30,000-file tree cannot be watched in full; should report degraded")
	}

	// The real assertion. Before the budget this failed with
	// "fork/exec: too many open files".
	for i := 0; i < 20; i++ {
		if out, err := exec.Command("git", "-C", repo, "status", "--porcelain").CombinedOutput(); err != nil {
			t.Fatalf("git failed after watching (%d): %v: %s", i, err, out)
		}
	}

	// .git is always covered, so commits and checkouts still report.
	if info.Dirs == 0 {
		t.Error("nothing watched at all; .git should always be covered")
	}
}

func run(t *testing.T, dir string, name string, args ...string) {
	t.Helper()
	cmd := exec.Command(name, args...)
	cmd.Dir = dir
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("%s %s: %v: %s", name, strings.Join(args, " "), err, out)
	}
}

// collectWatchTargets is the decision inside the fix, so it is asserted
// directly as well as through the end-to-end test above.
func TestCollectWatchTargetsCountsFilesNotDirectories(t *testing.T) {
	root := t.TempDir()
	// One directory, many files. A cap on directories sees "1" and watches it;
	// the descriptors it actually costs are 501.
	for i := 0; i < 500; i++ {
		if err := os.WriteFile(filepath.Join(root, fmt.Sprintf("f%d", i)), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	got := collectWatchTargets(root, 100, func(string) bool { return false }, nil)

	if len(got.dirs) != 0 {
		t.Errorf("watched %d dirs on a budget of 100; the directory alone costs 501", len(got.dirs))
	}
	if !got.truncated {
		t.Error("should report truncation")
	}
}

func TestCollectWatchTargetsStaysWithinBudget(t *testing.T) {
	root := t.TempDir()
	for d := 0; d < 40; d++ {
		dir := filepath.Join(root, fmt.Sprintf("d%d", d))
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		for i := 0; i < 20; i++ {
			if err := os.WriteFile(filepath.Join(dir, fmt.Sprintf("f%d", i)), []byte("x"), 0o644); err != nil {
				t.Fatal(err)
			}
		}
	}

	const budget = 200
	got := collectWatchTargets(root, budget, func(string) bool { return false }, nil)

	if got.descriptors > budget {
		t.Errorf("spent %d, budget %d", got.descriptors, budget)
	}
	if !got.truncated {
		t.Error("40 dirs of 20 files cannot fit in 200 descriptors")
	}
}

// Breadth-first is what makes a truncated walk useful rather than arbitrary:
// the directories a person edits are shallow, and the ones that exhaust the
// budget are deep inside dependency trees.
func TestCollectWatchTargetsIsBreadthFirst(t *testing.T) {
	root := t.TempDir()
	// A deep chain, and a shallow sibling that must not be starved by it.
	deep := root
	for i := 0; i < 6; i++ {
		deep = filepath.Join(deep, fmt.Sprintf("deep%d", i))
	}
	if err := os.MkdirAll(deep, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "src"), 0o755); err != nil {
		t.Fatal(err)
	}

	got := collectWatchTargets(root, 6, func(string) bool { return false }, nil)

	var sawSrc bool
	var deepest int
	for _, d := range got.dirs {
		rel, _ := filepath.Rel(root, d)
		if rel == "src" {
			sawSrc = true
		}
		if n := len(strings.Split(rel, string(filepath.Separator))); rel != "." && n > deepest {
			deepest = n
		}
	}
	if !sawSrc {
		t.Error("a shallow sibling was skipped while a deep chain was followed")
	}
	if deepest > 2 {
		t.Errorf("reached depth %d on a budget that should not leave the top levels", deepest)
	}
}

func TestWatchBudgetLeavesHeadroom(t *testing.T) {
	// Whatever the machine's limit, the watcher must never be allowed to claim
	// all of it — the descriptors left over are what git runs on.
	if got := watchBudget(); got > maxWatchDescriptors {
		t.Errorf("budget %d exceeds the ceiling %d", got, maxWatchDescriptors)
	}
}

// Excluding the gitignored directories is what takes a JavaScript project from
// "degraded, and the folders you edit are not watched" to "watched in full".
// This repository is 18,451 files with node_modules and 366 without.
func TestExcludedDirectoriesAreNotWatched(t *testing.T) {
	repo := t.TempDir()
	run(t, repo, "git", "init")

	// A source tree small enough to watch, buried under a dependency tree that
	// is not — the shape that made the budget degrade in the first place.
	for i := 0; i < 300; i++ {
		dir := filepath.Join(repo, "node_modules", fmt.Sprintf("pkg%03d", i))
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		for j := 0; j < 20; j++ {
			f := filepath.Join(dir, fmt.Sprintf("f%d.js", j))
			if err := os.WriteFile(f, []byte("x"), 0o644); err != nil {
				t.Fatal(err)
			}
		}
	}
	deep := filepath.Join(repo, "src", "features", "history")
	if err := os.MkdirAll(deep, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(deep, "Journal.tsx"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	without := collectWatchTargets(repo, watchBudget(), isWorktreeNoise, nil)
	with := collectWatchTargets(repo, watchBudget(), isWorktreeNoise,
		excludedSet(repo, []string{"node_modules"}))

	if !without.truncated {
		t.Fatal("fixture is too small to demonstrate anything; it should not fit")
	}
	if with.truncated {
		t.Errorf("excluding node_modules should leave the tree watchable, spent %d", with.descriptors)
	}

	covered := func(tt watchTargets, rel string) bool {
		for _, d := range tt.dirs {
			if d == filepath.Join(repo, rel) {
				return true
			}
		}
		return false
	}
	if covered(with, "node_modules") {
		t.Error("node_modules was excluded and should not be watched")
	}
	// The point of the whole exercise: the deep source directory is watched.
	if !covered(with, filepath.Join("src", "features", "history")) {
		t.Error("the source tree should be fully covered once node_modules is excluded")
	}
	t.Logf("descriptors: %d without exclusion (truncated=%v), %d with (truncated=%v)",
		without.descriptors, without.truncated, with.descriptors, with.truncated)
}

// The exclusion list crosses the bridge from the frontend, so it is input.
func TestExcludedSetRejectsPathsOutsideTheRepository(t *testing.T) {
	root := filepath.Join("/repos", "project")
	got := excludedSet(root, []string{
		"node_modules",     // kept
		"../../etc",        // escapes
		"/etc/passwd",      // absolute
		"",                 // empty
		".",                // the repository itself
		"  frontend/dist ", // kept, trimmed
	})

	if _, ok := got[filepath.Join(root, "node_modules")]; !ok {
		t.Error("a plain relative directory should be kept")
	}
	if _, ok := got[filepath.Join(root, "frontend", "dist")]; !ok {
		t.Error("a nested relative directory should be kept, whitespace trimmed")
	}
	if len(got) != 2 {
		t.Errorf("kept %d entries, want 2 — the rest escape the repository", len(got))
	}
}

// The feedback loop, as a unit.
//
// Reading `.git/index` moves its access time, which kqueue reports as Chmod.
// Treating that as "the index changed" makes every `git status` cause the next
// one: measured at 42 events in five seconds on an idle app, with the index's
// modification time never moving.
func TestAttributeOnlyEventsInsideGitAreIgnored(t *testing.T) {
	repo := "/repos/project"

	chmod := func(p string) fsnotify.Event {
		return fsnotify.Event{Name: filepath.Join(repo, p), Op: fsnotify.Chmod}
	}
	write := func(p string) fsnotify.Event {
		return fsnotify.Event{Name: filepath.Join(repo, p), Op: fsnotify.Write}
	}

	for _, p := range []string{".git/index", ".git/HEAD", ".git/refs/heads/main", ".git"} {
		if meaningful(repo, chmod(p)) {
			t.Errorf("%s: an attribute change inside .git is what causes the loop", p)
		}
	}

	// A write to the same paths is the real signal and must survive.
	for _, p := range []string{".git/index", ".git/HEAD", ".git/refs/heads/main"} {
		if !meaningful(repo, write(p)) {
			t.Errorf("%s: a write inside .git is exactly what the watcher is for", p)
		}
	}

	// In the working tree a mode change is a change `git status` reports, so it
	// is kept — the loop is a property of .git, not of Chmod.
	if !meaningful(repo, chmod("src/build.sh")) {
		t.Error("chmod +x in the working tree is a real change")
	}
}
