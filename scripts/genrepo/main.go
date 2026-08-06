// Command genrepo writes a `git fast-import` stream to stdout, for building the
// large repositories PLAN.md §10 needs and §13a says do not exist yet.
//
// Two shapes, because Phase 7 has two independent axes and no single repository
// stresses both:
//
//	-mode=files     one commit, N files (default 500k) — the status axis
//	-mode=history   N commits (default 1M) over 256 files — the log/graph axis
//
// A third mode writes files rather than a stream:
//
//	-mode=untracked -dir D   an untracked tree under D, which is what makes
//	                         `--untracked-files=all` cost more than `=normal`
//	                         and is therefore the only way to measure the
//	                         threshold Phase 7 wants to set
//
// Deterministic on purpose. Timestamps come from a fixed epoch rather than from
// `now`, so a rebuild produces byte-identical object ids and a measurement taken
// last week is comparable to one taken today. This is the opposite of
// seed-test-repos.sh, which deliberately uses now-relative dates so the Journal
// shows plausible "2 hours ago" times — that script feeds a demo, this one feeds
// a stopwatch.
//
// Not invoked directly; scripts/seed-large-repo.sh drives it.
package main

import (
	"bufio"
	"flag"
	"fmt"
	"os"
)

// A fixed point in the past. With the default commit count and step the last
// commit lands in early 2026; nothing depends on that, it just keeps the dates
// inside the range a human reading the Journal would find unremarkable.
const baseEpoch = 1420070400 // 2015-01-01T00:00:00Z

// Seconds between consecutive commits. Chosen so a million of them span ~11
// years rather than piling into one afternoon, which would make `--since`
// queries meaningless.
const commitStep = 347

// Distinct blob contents to cycle through. More than one so the repository is
// not degenerate for diff and grep; few enough that the stream stays small,
// since every commit references a blob by mark rather than inlining it.
const blobCount = 64

// Distinct authors, so `author:` search has more than one answer to find.
const authorRotate = 4

// The history repository's shape: 16 directories of 16 files. Deliberately
// nested rather than flat — a commit that touches one file then rewrites one
// 16-entry subtree and the root, instead of rewriting a 256-entry root. Over a
// million commits that is the difference between a pack that delta-compresses
// well and one that does not.
const (
	histDirs   = 16
	histPerDir = 16
	sideEvery  = 50    // commits between short topic branches
	sideLength = 5     // commits on each short topic before it merges back
	tagEvery   = 10000 // annotated tags, so `for-each-ref` has a realistic load
)

// Long-lived branches, layered on top of the short topics.
//
// The short topics alone never put more than two lanes on screen at once, which
// is lane assignment at nearly its easiest case — and the easy case is the one
// that never needs optimising. These stay open across hundreds of trunk commits
// and overlap each other, so the walk sees five to seven concurrent lanes, which
// is what a busy repository actually looks like.
const (
	longEvery  = 300  // trunk commits between opening one
	longLife   = 1500 // trunk commits it stays open for
	longStride = 17   // trunk commits between commits on it
	longMax    = 6    // open at once, so the lane count has a ceiling
)

// The files repository's shape. 100 files per directory, 50 directories per
// top-level directory — roughly what a real tree looks like, and far from the
// two pathological cases (everything in one directory, or one file per
// directory) that would each measure something other than what git does on real
// repositories.
const (
	filesPerDir = 100
	subsPerTop  = 50
)

// Extensions cycled through the files repository, so the explorer's corpus and
// the diff pane's language map see something other than one extension repeated
// half a million times.
var extensions = []string{"ts", "tsx", "go", "css", "md", "json"}

func main() {
	mode := flag.String("mode", "files", "files | history | untracked")
	nFiles := flag.Int("files", 500_000, "file count for -mode=files and -mode=untracked")
	nCommits := flag.Int("commits", 1_000_000, "commit count for -mode=history")
	dir := flag.String("dir", "", "target directory for -mode=untracked")
	flag.Parse()

	out := bufio.NewWriterSize(os.Stdout, 1<<20)

	switch *mode {
	case "files":
		writeFiles(out, *nFiles)
	case "history":
		writeHistory(out, *nCommits)
	case "untracked":
		if *dir == "" {
			fmt.Fprintln(os.Stderr, "genrepo: -mode=untracked needs -dir")
			os.Exit(2)
		}
		if err := writeUntracked(*dir, *nFiles); err != nil {
			fmt.Fprintf(os.Stderr, "genrepo: %v\n", err)
			os.Exit(1)
		}
	default:
		fmt.Fprintf(os.Stderr, "genrepo: unknown mode %q\n", *mode)
		os.Exit(2)
	}

	if err := out.Flush(); err != nil {
		fmt.Fprintf(os.Stderr, "genrepo: %v\n", err)
		os.Exit(1)
	}
}

// writeUntracked creates n files under dir, on disk rather than in a stream.
//
// This is the one thing `git status`'s two untracked modes actually disagree
// about. On a clean repository `--untracked-files=all` and `=normal` cost the
// same, because there is nothing to recurse into; the difference only appears
// once an untracked *directory* exists, where `normal` reports the directory
// and `all` walks every file under it. Without this the threshold Phase 7 wants
// to set would be a number with no measurement behind it.
//
// The shape is deliberately node_modules-ish — deep and bushy rather than one
// flat directory — since that is what the collapse is worth measuring against.
func writeUntracked(dir string, n int) error {
	body := []byte("untracked payload\n")
	perDir := 40

	i := 0
	for pkg := 0; i < n; pkg++ {
		sub := fmt.Sprintf("%s/pkg%04d/lib", dir, pkg)
		if err := os.MkdirAll(sub, 0o755); err != nil {
			return err
		}
		for f := 0; f < perDir && i < n; f++ {
			name := fmt.Sprintf("%s/mod%03d.js", sub, f)
			if err := os.WriteFile(name, body, 0o644); err != nil {
				return err
			}
			i++
		}
	}
	return nil
}

// blobMark returns the mark reserved for blob i. Blobs occupy marks 1..blobCount
// and commits start above them, so the two never collide.
func blobMark(i int) int { return 1 + i%blobCount }

// writeBlobs emits the shared blob pool every commit later references by mark.
func writeBlobs(w *bufio.Writer) {
	for i := 0; i < blobCount; i++ {
		// Content varies in length as well as in bytes: a pool of equal-sized
		// blobs would make every file the same size, and status' stat-based
		// staleness check is one of the things being measured.
		body := fmt.Sprintf("line %d\n%s\n", i, repeat("payload ", 1+i%8))
		fmt.Fprintf(w, "blob\nmark :%d\ndata %d\n%s\n", 1+i, len(body), body)
	}
}

func repeat(s string, n int) string {
	out := make([]byte, 0, len(s)*n)
	for i := 0; i < n; i++ {
		out = append(out, s...)
	}
	return string(out)
}

// identity renders an `author`/`committer` line, rotating through a few people.
func identity(role string, seq, ts int) string {
	n := seq % authorRotate
	return fmt.Sprintf("%s Bench Author %d <bench%d@moongit.invalid> %d +0000", role, n, n, ts)
}

func writeCommitHeader(w *bufio.Writer, ref string, mark, seq, ts int, message string) {
	fmt.Fprintf(w, "commit %s\nmark :%d\n", ref, mark)
	fmt.Fprintf(w, "%s\n", identity("author", seq, ts))
	fmt.Fprintf(w, "%s\n", identity("committer", seq, ts))
	// `data <n>` is followed by exactly n bytes and then an optional LF, which
	// is the trailing newline here. Getting n wrong desynchronises the whole
	// stream, so the count is always taken from the string that is written.
	fmt.Fprintf(w, "data %d\n%s\n", len(message), message)
}

// writeFiles emits a single commit containing n files.
//
// One commit, not n — the axis under test is "how long does git status take
// over a 500k-file working tree", and a history to go with it would only add
// minutes to the build and objects to the pack without changing the number
// being measured. The history repository covers the other axis.
func writeFiles(w *bufio.Writer, n int) {
	writeBlobs(w)

	msg := fmt.Sprintf("seed %d files\n", n)
	writeCommitHeader(w, "refs/heads/main", blobCount+1, 0, baseEpoch, msg)

	// A README at the root, so the repository has one path that is not buried
	// four levels down — the explorer opens on the root, and a first screen of
	// nothing but directories is not representative.
	fmt.Fprint(w, "M 100644 :1 README.md\n")

	// No `progress` inside this loop: file commands run until the blank line
	// that ends the commit, and a top-level command in the middle of them is a
	// parse error rather than a status line.
	i := 0
	for top := 0; i < n; top++ {
		for sub := 0; sub < subsPerTop && i < n; sub++ {
			for f := 0; f < filesPerDir && i < n; f++ {
				ext := extensions[i%len(extensions)]
				fmt.Fprintf(w, "M 100644 :%d src/d%03d/s%02d/f%03d.%s\n",
					blobMark(i), top, sub, f, ext)
				i++
			}
		}
	}

	fmt.Fprint(w, "\ndone\n")
}

// writeHistory emits n commits on refs/heads/main, with periodic side branches
// merged back so the graph has lanes to lay out.
//
// A purely linear million commits would measure lane assignment at its easiest
// case — one lane, forever — which is the one case that never needs optimising.
// Every sideEvery commits the trunk sprouts a branch of sideLength commits and
// merges it back, so the walk sees real forks, real merges, and a lane count
// that rises and falls.
func writeHistory(w *bufio.Writer, n int) {
	writeBlobs(w)

	mark := blobCount
	seq := 0

	nextMark := func() int { mark++; return mark }

	// commitOn writes one commit and returns its mark.
	//
	// `from` is passed only when starting a new ref. Continuing a ref needs no
	// parent line at all — fast-import uses that ref's current head — and
	// repeating it on every commit would be 20 bytes per commit of nothing.
	commitOn := func(ref string, from, merge int, message string) int {
		m := nextMark()
		ts := baseEpoch + seq*commitStep
		writeCommitHeader(w, ref, m, seq, ts, message)
		if from != 0 {
			fmt.Fprintf(w, "from :%d\n", from)
		}
		if merge != 0 {
			fmt.Fprintf(w, "merge :%d\n", merge)
		}
		// One file per commit, walking the whole set so the tree keeps changing
		// rather than the same path being rewritten a million times.
		dir := (seq / histPerDir) % histDirs
		file := seq % histPerDir
		fmt.Fprintf(w, "M 100644 :%d pkg/m%02d/f%02d.go\n", blobMark(seq), dir, file)
		fmt.Fprint(w, "\n")
		seq++
		return m
	}

	// deleteRef writes fast-import's way of removing a ref: a reset to the null
	// object id.
	deleteRef := func(ref string) {
		fmt.Fprintf(w, "reset %s\nfrom %040d\n\n", ref, 0)
	}

	// An open long-lived branch. `mergeAt` is the trunk position it is due back
	// at, `phase` staggers its commits so several open branches do not all
	// commit on the same tick.
	type longBranch struct {
		ref     string
		tip     int
		mergeAt int
		phase   int
	}
	var open []longBranch

	trunk := 0
	side := 0
	long := 0
	for seq < n {
		at := seq
		trunk = commitOn("refs/heads/main", 0, 0,
			fmt.Sprintf("commit %d\n\nRoutine change on main.\n", at))

		// Grow the open branches, then merge the ones that are due, then open a
		// new one — in that order, so a branch is never merged on the same tick
		// it was created and every merge bubble has something inside it.
		for i := range open {
			if seq%longStride == open[i].phase {
				open[i].tip = commitOn(open[i].ref, 0, 0,
					fmt.Sprintf("%s: ongoing work\n", open[i].ref))
			}
		}
		kept := open[:0]
		for _, b := range open {
			if seq < b.mergeAt {
				kept = append(kept, b)
				continue
			}
			trunk = commitOn("refs/heads/main", 0, b.tip, fmt.Sprintf("Merge %s\n", b.ref))
			deleteRef(b.ref)
		}
		open = kept

		// No "will it finish in time" guard, deliberately. A branch still open
		// when the walk ends stays open, which is both realistic — every
		// repository has unmerged feature branches — and the case that matters
		// most here: it leaves lanes running off the top of the graph, and the
		// top of the graph is the first screenful the Journal renders and the
		// only one an unscrolled measurement ever sees.
		if at%longEvery == 0 && len(open) < longMax {
			ref := fmt.Sprintf("refs/heads/feature/%d", long)
			tip := commitOn(ref, trunk, 0, fmt.Sprintf("%s: open\n", ref))
			open = append(open, longBranch{ref, tip, seq + longLife, seq % longStride})
			long++
		}

		if at > 0 && at%tagEvery == 0 {
			body := fmt.Sprintf("release %d\n", at/tagEvery)
			fmt.Fprintf(w, "tag v%d\nfrom :%d\ntagger %s\ndata %d\n%s\n",
				at/tagEvery, trunk,
				fmt.Sprintf("Bench Author 0 <bench0@moongit.invalid> %d +0000",
					baseEpoch+at*commitStep),
				len(body), body)
		}
		if at > 0 && at%100_000 == 0 {
			fmt.Fprintf(w, "progress %d/%d commits\n", at, n)
		}

		// Leave room for the whole side branch plus its merge, or skip it —
		// a half-written topic branch would leave a dangling ref rather than
		// the merge bubble the graph is meant to lay out.
		if at%sideEvery != 0 || seq+sideLength+1 > n {
			continue
		}

		ref := fmt.Sprintf("refs/heads/topic/%d", side)
		tip := commitOn(ref, trunk, 0, fmt.Sprintf("topic %d: start\n", side))
		for k := 1; k < sideLength; k++ {
			tip = commitOn(ref, 0, 0, fmt.Sprintf("topic %d: step %d\n", side, k))
		}
		trunk = commitOn("refs/heads/main", 0, tip, fmt.Sprintf("Merge topic %d\n", side))

		// Most topic branches are deleted after merging, as they would be in a
		// real repository; every tenth is kept, so the branch list has a
		// plausible number of entries rather than one or twenty thousand.
		if side%10 != 0 {
			deleteRef(ref)
		}
		side++
	}

	fmt.Fprint(w, "done\n")
}
