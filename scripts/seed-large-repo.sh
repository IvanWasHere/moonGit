#!/usr/bin/env bash
#
# seed-large-repo.sh — build the large repositories Phase 7 is measured against
# (PLAN.md §10, and the gap §13a records under "Also needed: a large-repo target").
#
# Two repositories, because Phase 7 has two independent axes and no single one
# stresses both:
#
#   big-files/     one commit, 500k files          — the `git status` axis
#   big-history/   1M commits, ~5 parallel lanes   — the `git log` / graph axis
#
# Both are tier-2 by §13a's rule: generated, disposable, and outside any
# repository a human owns. Nothing here goes near testGitHere.
#
# The content comes from scripts/genrepo, which emits a `git fast-import` stream.
# That is what makes a million commits take a couple of minutes instead of a
# couple of days: no process per commit, no working tree writes, no index.
#
# Deterministic — genrepo dates every commit from a fixed epoch — so the object
# ids are stable across rebuilds and a measurement taken today is comparable to
# one taken next week.
#
# Usage:
#   ./scripts/seed-large-repo.sh                    # build both, skip what exists
#   ./scripts/seed-large-repo.sh --force            # rebuild from scratch
#   ./scripts/seed-large-repo.sh --only history
#   ./scripts/seed-large-repo.sh --files 100000 --commits 200000
#   ./scripts/seed-large-repo.sh --commit-graph     # also write a commit-graph
#   ./scripts/seed-large-repo.sh --clean            # delete them and stop
#   ./scripts/seed-large-repo.sh --out /path/to/dir
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

OUT="${MOONGIT_BENCH_DIR:-${TMPDIR:-/tmp}/moongit-bench}"
FILES=500000
COMMITS=1000000
UNTRACKED=50000
ONLY=""
FORCE=0
CLEAN=0
COMMIT_GRAPH=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --out)          OUT="$2"; shift 2 ;;
    --files)        FILES="$2"; shift 2 ;;
    --untracked)    UNTRACKED="$2"; shift 2 ;;
    --commits)      COMMITS="$2"; shift 2 ;;
    --only)         ONLY="$2"; shift 2 ;;
    --force)        FORCE=1; shift ;;
    --clean)        CLEAN=1; shift ;;
    --commit-graph) COMMIT_GRAPH=1; shift ;;
    -h|--help)      sed -n '2,32p' "$0"; exit 0 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

die()  { echo "error: $*" >&2; exit 1; }
info() { printf '\033[36m%s\033[0m\n' "$*"; }
ok()   { printf '\033[32m  ✓ %s\033[0m\n' "$*"; }
note() { printf '\033[90m    %s\033[0m\n' "$*"; }

[[ "$ONLY" == "" || "$ONLY" == "files" || "$ONLY" == "history" ]] \
  || die "--only takes 'files' or 'history'"

# --- safety -----------------------------------------------------------------
# This script runs `rm -rf` on whatever --out points at. A path bug must never
# reach a real project, so the target is checked before anything is removed.
assert_safe_out() {
  local dir="$1"
  [[ "$dir" == /* ]] || die "--out must be an absolute path, got '$dir'"
  [[ "$dir" != "/" ]] || die "refusing to use / as the bench directory"
  case "$dir" in
    "$PROJECT_DIR"|"$PROJECT_DIR"/*)
      die "refusing to build bench repositories inside the project ($dir)" ;;
  esac
  # A directory that exists and holds anything other than our own two repos is
  # somebody else's — the marker file is what distinguishes them.
  if [[ -e "$dir" && ! -e "$dir/.moongit-bench" ]]; then
    [[ -z "$(ls -A "$dir" 2>/dev/null)" ]] \
      || die "$dir exists, is not empty, and was not created by this script — refusing"
  fi
}

assert_safe_out "$OUT"

if (( CLEAN )); then
  if [[ -e "$OUT" ]]; then
    info "Removing $OUT"
    rm -rf "$OUT"
    ok "removed"
  else
    note "$OUT does not exist"
  fi
  exit 0
fi

command -v git >/dev/null || die "git not found"
command -v go  >/dev/null || die "go not found — genrepo is a Go program"

mkdir -p "$OUT"
touch "$OUT/.moongit-bench"

# Seconds elapsed since the given epoch. Plain shell arithmetic rather than
# awk's systime(), which is a gawk extension and absent from the awk macOS ships.
elapsed() { echo "$(( $(date +%s) - $1 ))s"; }

# build <name> <genrepo-args...>
#
# init → fast-import → checkout, timing each. The checkout is separate because
# for the 500k-file repository it is most of the wall clock, and that number is
# itself worth knowing: it is roughly what any tool that writes the working tree
# has to pay.
build() {
  local name="$1"; shift
  local dir="$OUT/$name"

  if [[ -d "$dir" && $FORCE -eq 0 ]]; then
    note "$name exists — skipping (use --force to rebuild)"
    return 0
  fi
  rm -rf "$dir"

  info "Building $name"
  git init -q -b main "$dir"

  # Local config that makes the build itself fast and keeps the repository from
  # picking up whatever the user's global config says. `gc.auto=0` matters most:
  # without it git may decide to repack in the middle of a million-commit import.
  git -C "$dir" config gc.auto 0
  git -C "$dir" config core.autocrlf false
  git -C "$dir" config core.fsmonitor false
  git -C "$dir" config core.untrackedCache false

  local t0
  t0=$(date +%s)
  ( cd "$PROJECT_DIR" && go run ./scripts/genrepo "$@" ) \
    | git -C "$dir" fast-import --quiet --force
  ok "imported in $(elapsed "$t0")"

  t0=$(date +%s)
  git -C "$dir" reset -q --hard main
  ok "checked out in $(elapsed "$t0")"

  if (( COMMIT_GRAPH )); then
    t0=$(date +%s)
    git -C "$dir" commit-graph write --reachable >/dev/null 2>&1
    ok "commit-graph written in $(elapsed "$t0")"
  fi

  note "path:     $dir"
  note "size:     $(du -sh "$dir" 2>/dev/null | cut -f1)"
  note "commits:  $(git -C "$dir" rev-list --count --all)"
  note "files:    $(git -C "$dir" ls-files | wc -l | tr -d ' ')"
  note "refs:     $(git -C "$dir" for-each-ref | wc -l | tr -d ' ')"
}

# seed_untracked <dir> <n>
#
# An untracked tree inside an already-built repository. Separate from build()
# and separately guarded, so it can be added to a repository that already exists
# without paying for the 500k-file checkout again.
seed_untracked() {
  local dir="$1" n="$2"
  [[ -d "$dir" ]] || return 0
  if [[ -d "$dir/untracked" ]]; then
    note "untracked tree exists — skipping"
    return 0
  fi
  local t0; t0=$(date +%s)
  ( cd "$PROJECT_DIR" && go run ./scripts/genrepo -mode=untracked -dir "$dir/untracked" "-files=$n" )
  ok "wrote $n untracked files in $(elapsed "$t0")"
}

if [[ "$ONLY" == "" || "$ONLY" == "files" ]]; then
  build big-files -mode=files "-files=$FILES"
  # A tenth of the tracked count. Enough that `--untracked-files=all` has real
  # work to do and `=normal` visibly does not, which is the whole comparison.
  seed_untracked "$OUT/big-files" "$UNTRACKED"
fi
if [[ "$ONLY" == "" || "$ONLY" == "history" ]]; then
  build big-history -mode=history "-commits=$COMMITS"
fi

echo
info "Bench repositories in $OUT"
if (( COMMIT_GRAPH )); then
  note "a commit-graph was written — log numbers are the best case, not the cold one"
else
  note "no commit-graph was written — pass --commit-graph to measure with one"
fi
note "delete them with: $0 --clean"
