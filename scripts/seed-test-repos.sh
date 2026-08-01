#!/usr/bin/env bash
#
# seed-test-repos.sh — put ../testGitHere/test-repo{1,2} into a rich state so every
# panel in the moonGit UI has something real to render (PLAN.md §13a).
#
# Creates: branches covering all six branchTag types, a working tree with every
# file status the statusBadge map handles, a staged/unstaged split, commit history
# with varied authors and dates, and local-only commits so `ahead` counts are non-zero.
#
# Guarantees:
#   * LOCAL ONLY — never runs fetch, push, or any network operation.
#   * Idempotent in state — re-running resets to origin/main first, then rebuilds
#     an identical tree, branch set, and status. Commit SHAs do differ between
#     runs, because commit dates are relative to "now" so the Journal panel keeps
#     showing plausible "2 hours ago" times instead of drifting stale. Don't
#     assert on SHAs from these repos; automated tests use tier-2 generated
#     repos (PLAN.md §13a) precisely so they can.
#   * Reversible — `--reset` restores pristine origin/main state, equivalent to:
#       git -C <repo> reset --hard origin/main && git -C <repo> clean -fd
#
# Usage:
#   ./scripts/seed-test-repos.sh          # prompts before touching anything
#   ./scripts/seed-test-repos.sh --yes    # no prompt
#   ./scripts/seed-test-repos.sh --reset  # restore to origin/main and stop
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_ROOT="${SEED_TEST_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)/testGitHere}"

ASSUME_YES=0
RESET_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --yes|-y) ASSUME_YES=1 ;;
    --reset)  RESET_ONLY=1 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

die() { echo "error: $*" >&2; exit 1; }
info() { printf '\033[36m%s\033[0m\n' "$*"; }
ok() { printf '\033[32m  ✓ %s\033[0m\n' "$*"; }

# --- safety -----------------------------------------------------------------
# These scripts run `reset --hard` and `clean -fd`. A path bug must never point
# them at a real project, so every repo is verified to be a known test repo
# with the expected remote before anything destructive happens.
assert_safe_repo() {
  local repo="$1" expected="$2"
  [[ -d "$repo/.git" ]] || die "$repo is not a git repository"
  local remote
  remote="$(git -C "$repo" remote get-url origin 2>/dev/null || true)"
  [[ -n "$remote" ]] || die "$repo has no 'origin' remote — refusing to touch it"
  [[ "$remote" == *"$expected"* ]] \
    || die "$repo origin is '$remote', expected it to contain '$expected' — refusing"
  git -C "$repo" rev-parse --verify -q origin/main >/dev/null \
    || die "$repo has no origin/main to reset onto — refusing"
}

# --- helpers ----------------------------------------------------------------
# Authors mirror the mockup's seed data so the Journal panel looks familiar.
author_name() { case "$1" in 0) echo "Alex Chen";; 1) echo "Sarah Kim";; *) echo "Mike Torres";; esac; }
author_mail() { case "$1" in 0) echo "alex@example.com";; 1) echo "sarah@example.com";; *) echo "mike@example.com";; esac; }

# ts <hours-ago> -> ISO8601 (BSD date; this script targets macOS)
ts() { date -u -v-"$1"H +%Y-%m-%dT%H:%M:%SZ; }

wfile() {
  local repo="$1" path="$2"
  mkdir -p "$repo/$(dirname "$path")"
  cat > "$repo/$path"
}

# commit <repo> <author-idx> <hours-ago> <message>
commit() {
  local repo="$1" idx="$2" hours="$3" msg="$4"
  GIT_AUTHOR_NAME="$(author_name "$idx")"  GIT_AUTHOR_EMAIL="$(author_mail "$idx")" \
  GIT_COMMITTER_NAME="$(author_name "$idx")" GIT_COMMITTER_EMAIL="$(author_mail "$idx")" \
  GIT_AUTHOR_DATE="$(ts "$hours")" GIT_COMMITTER_DATE="$(ts "$hours")" \
    git -C "$repo" commit -q --no-verify -m "$msg"
}

reset_repo() {
  local repo="$1"
  git -C "$repo" rebase --abort 2>/dev/null || true
  git -C "$repo" merge --abort 2>/dev/null || true
  # Order matters: the working tree must be clean *before* switching branches,
  # otherwise `checkout -B` refuses with "please commit your changes".
  git -C "$repo" reset -q --hard
  git -C "$repo" clean -qfd
  git -C "$repo" checkout -q -B main origin/main
  git -C "$repo" reset -q --hard origin/main
  git -C "$repo" clean -qfd
  local b
  while read -r b; do
    [[ -z "$b" || "$b" == "main" ]] && continue
    git -C "$repo" branch -q -D "$b"
  done < <(git -C "$repo" for-each-ref --format='%(refname:short)' refs/heads/)
  git -C "$repo" tag -l | while read -r t; do
    [[ -n "$t" ]] && git -C "$repo" tag -d "$t" >/dev/null
  done
}

# branch_at <repo> <name> <commits-json-ish>  — creates branch off current HEAD
mkbranch() {
  local repo="$1" name="$2"
  git -C "$repo" checkout -q -b "$name"
}

# Give a branch an upstream so the UI's ahead/behind columns render real numbers
# without us ever pushing. Tracking origin/main is a fixture convenience, not a
# realistic topology — it just makes `git for-each-ref` emit non-zero counts.
track_main() {
  git -C "$1" branch -q --set-upstream-to=origin/main "$2" 2>/dev/null || true
}

# ============================================================================
# repo 1 — mirrors the mockup's "frontend-app"
# ============================================================================
seed_repo1() {
  local r="$TEST_ROOT/test-repo1"
  info "seeding test-repo1 (frontend-app)"
  reset_repo "$r"

  wfile "$r" package.json <<'EOF'
{
  "name": "frontend-app",
  "version": "2.3.1",
  "private": true,
  "dependencies": {
    "react": "^19.1.0",
    "react-dom": "^19.1.0"
  }
}
EOF
  wfile "$r" src/components/Header.tsx <<'EOF'
export function Header() {
  return (
    <header className="header">
      <div className="header-inner">
        <Logo />
        <nav className="nav-links">
          {links.map(link => (
            <a key={link.id} href={link.href}>{link.label}</a>
          ))}
        </nav>
      </div>
    </header>
  );
}
EOF
  git -C "$r" add -A && commit "$r" 0 24 "Initial project setup with Vite and React"

  wfile "$r" src/components/Sidebar.tsx <<'EOF'
import React from "react";

interface SidebarProps {
  collapsed: boolean;
}

export function Sidebar({ collapsed }: SidebarProps) {
  return <aside data-collapsed={collapsed} />;
}
EOF
  git -C "$r" add -A && commit "$r" 1 12 "Update dependencies and fix audit warnings"

  wfile "$r" src/styles/theme.css <<'EOF'
:root {
  --bg: #0d1117;
  --fg: #e2e8f0;
}
EOF
  git -C "$r" add -A && commit "$r" 2 8 "Fix router guard redirect loop"

  wfile "$r" src/utils/helpers.ts <<'EOF'
export const noop = () => {};
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
EOF
  wfile "$r" src/pages/Dashboard.tsx <<'EOF'
export default function Dashboard() {
  return <main className="dashboard" />;
}
EOF
  git -C "$r" add -A && commit "$r" 0 4 "Add dark mode theme variables"

  wfile "$r" src/legacy/OldWidget.tsx <<'EOF'
export function OldWidget() {
  return <div className="widget" />;
}
EOF
  git -C "$r" add -A && commit "$r" 1 2 "Refactor header component with responsive layout"

  # --- branches: one per branchTag type in the mockup ------------------------
  mkbranch "$r" develop
  wfile "$r" src/hooks/useFeatureFlags.ts <<'EOF'
export const useFeatureFlags = () => ({ newNav: true });
EOF
  git -C "$r" add -A && commit "$r" 2 6 "Add feature flag plumbing"
  track_main "$r" develop

  git -C "$r" checkout -q main
  mkbranch "$r" feature/auth-flow
  wfile "$r" src/auth/oauth.ts <<'EOF'
export async function exchangeCode(code: string) {
  return fetch("/oauth/token", { method: "POST", body: code });
}
EOF
  git -C "$r" add -A && commit "$r" 0 3 "WIP: auth flow with token refresh"
  wfile "$r" src/auth/session.ts <<'EOF'
export const SESSION_KEY = "app.session";
EOF
  git -C "$r" add -A && commit "$r" 0 1 "Implement OAuth2 callback handler"
  track_main "$r" feature/auth-flow

  git -C "$r" checkout -q main
  mkbranch "$r" feature/dashboard-v2
  wfile "$r" src/pages/Charts.tsx <<'EOF'
export function Charts() {
  return <section className="charts" />;
}
EOF
  git -C "$r" add -A && commit "$r" 2 5 "Dashboard chart components with real-time data"
  track_main "$r" feature/dashboard-v2

  git -C "$r" checkout -q main
  mkbranch "$r" fix/memory-leak
  wfile "$r" src/hooks/useInterval.ts <<'EOF'
export function useInterval(fn: () => void, ms: number) {
  // cleanup was missing — this is the leak
}
EOF
  git -C "$r" add -A && commit "$r" 1 7 "Clear interval on unmount to stop leak"
  track_main "$r" fix/memory-leak

  git -C "$r" checkout -q main
  mkbranch "$r" release/2.4.0
  git -C "$r" checkout -q main
  mkbranch "$r" hotfix/db-connection
  git -C "$r" checkout -q main

  git -C "$r" tag -a v2.3.0 -m "Release 2.3.0" HEAD~2 2>/dev/null || true
  git -C "$r" tag v2.3.1-rc1 HEAD~1 2>/dev/null || true

  # --- working tree: one file per status the UI renders ----------------------
  # staged: modified
  wfile "$r" src/components/Header.tsx <<'EOF'
export function Header() {
  return (
    <header className="header">
      <div className="header-inner flex items-center justify-between w-full px-6">
        <Logo />
        <nav className="nav-links hidden md:flex items-center gap-4">
          {links.map(link => (
            <NavLink key={link.id} {...link} active={currentPath === link.href} />
          ))}
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
EOF
  # staged: modified
  wfile "$r" src/components/Sidebar.tsx <<'EOF'
import React from "react";
import { useLocation } from "react-router-dom";

interface SidebarProps {
  collapsed: boolean;
  activeRoute?: string;
}

export function Sidebar({ collapsed, activeRoute }: SidebarProps) {
  const location = useLocation();
  return <aside data-collapsed={collapsed} data-route={activeRoute ?? location.pathname} />;
}
EOF
  # staged: added
  wfile "$r" src/hooks/useAuth.ts <<'EOF'
export function useAuth() {
  return { user: null, signIn: async () => {}, signOut: async () => {} };
}
EOF
  # staged: renamed
  git -C "$r" mv src/legacy/OldWidget.tsx src/components/Widget.tsx
  git -C "$r" add src/components/Header.tsx src/components/Sidebar.tsx src/hooks/useAuth.ts

  # unstaged: modified
  wfile "$r" src/pages/Dashboard.tsx <<'EOF'
import { Charts } from "./Charts";

export default function Dashboard() {
  return (
    <main className="dashboard">
      <Charts />
    </main>
  );
}
EOF
  # unstaged: modified
  wfile "$r" src/styles/theme.css <<'EOF'
:root {
  --bg: #0d1117;
  --fg: #e2e8f0;
  --accent: #e8a838;
}
EOF
  # unstaged: modified
  wfile "$r" package.json <<'EOF'
{
  "name": "frontend-app",
  "version": "2.4.0",
  "private": true,
  "dependencies": {
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "react-router-dom": "^7.0.0"
  }
}
EOF
  # unstaged: deleted
  rm -f "$r/src/utils/helpers.ts"
  # untracked
  wfile "$r" tsconfig.json <<'EOF'
{ "compilerOptions": { "strict": true, "jsx": "react-jsx" } }
EOF
  wfile "$r" .env.local <<'EOF'
VITE_API_URL=http://localhost:8080
EOF

  ok "test-repo1: $(git -C "$r" rev-list --count origin/main..main) local commits, $(git -C "$r" for-each-ref --format='%(refname:short)' refs/heads/ | wc -l | tr -d ' ') branches"
}

# ============================================================================
# repo 2 — mirrors the mockup's "api-service"
# ============================================================================
seed_repo2() {
  local r="$TEST_ROOT/test-repo2"
  info "seeding test-repo2 (api-service)"
  reset_repo "$r"

  wfile "$r" src/routes/users.ts <<'EOF'
import { Router } from "express";

export const users = Router();
users.get("/", async (_req, res) => res.json([]));
EOF
  wfile "$r" src/config/database.ts <<'EOF'
export const dbConfig = {
  host: "localhost",
  port: 5432,
  pool: 10,
};
EOF
  git -C "$r" add -A && commit "$r" 1 30 "Initial API service scaffold"

  wfile "$r" src/routes/health.ts <<'EOF'
export const health = (_req: unknown, res: { send: (s: string) => void }) => res.send("ok");
EOF
  git -C "$r" add -A && commit "$r" 2 18 "Add health check endpoint"

  wfile "$r" src/lib/logger.ts <<'EOF'
export const log = (...args: unknown[]) => console.log("[api]", ...args);
EOF
  git -C "$r" add -A && commit "$r" 0 9 "Introduce structured logging"

  mkbranch "$r" feature/rate-limiter
  wfile "$r" src/middleware/rateLimiter.ts <<'EOF'
export function rateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, number>();
  return (req: { ip: string }, _res: unknown, next: () => void) => {
    hits.set(req.ip, (hits.get(req.ip) ?? 0) + 1);
    next();
  };
}
EOF
  git -C "$r" add -A && commit "$r" 0 2 "Add sliding-window rate limiter"
  track_main "$r" feature/rate-limiter

  git -C "$r" checkout -q main
  mkbranch "$r" hotfix/db-connection
  wfile "$r" src/config/database.ts <<'EOF'
export const dbConfig = {
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 5432),
  pool: 25,
  connectionTimeoutMillis: 5000,
};
EOF
  git -C "$r" add -A && commit "$r" 2 1 "Fix connection pool exhaustion under load"
  track_main "$r" hotfix/db-connection

  git -C "$r" checkout -q main
  git -C "$r" tag v1.0.0 HEAD~1 2>/dev/null || true

  # working tree
  wfile "$r" src/middleware/rateLimiter.ts <<'EOF'
export function rateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (req: { ip: string }, _res: unknown, next: () => void) => {
    const now = Date.now();
    const entry = hits.get(req.ip);
    if (!entry || entry.resetAt < now) hits.set(req.ip, { count: 1, resetAt: now + windowMs });
    else entry.count += 1;
    next();
  };
}
EOF
  wfile "$r" src/config/database.ts <<'EOF'
export const dbConfig = {
  host: process.env.DB_HOST ?? "localhost",
  port: 5432,
  pool: 20,
};
EOF
  git -C "$r" add src/middleware/rateLimiter.ts src/config/database.ts

  wfile "$r" src/routes/users.ts <<'EOF'
import { Router } from "express";
import { rateLimiter } from "../middleware/rateLimiter";

export const users = Router();
users.use(rateLimiter(100, 60_000));
users.get("/", async (_req, res) => res.json([]));
EOF
  wfile "$r" tests/integration/api.test.ts <<'EOF'
import { describe, it, expect } from "vitest";

describe("api", () => {
  it("responds to health", () => expect(true).toBe(true));
});
EOF

  ok "test-repo2: $(git -C "$r" rev-list --count origin/main..main) local commits, $(git -C "$r" for-each-ref --format='%(refname:short)' refs/heads/ | wc -l | tr -d ' ') branches"
}

# ============================================================================
main() {
  [[ -d "$TEST_ROOT" ]] || die "test root not found: $TEST_ROOT"
  assert_safe_repo "$TEST_ROOT/test-repo1" "test-repo1"
  assert_safe_repo "$TEST_ROOT/test-repo2" "test-repo2"

  if [[ "$RESET_ONLY" == 1 ]]; then
    for n in test-repo1 test-repo2; do
      reset_repo "$TEST_ROOT/$n"
      ok "$n restored to origin/main"
    done
    exit 0
  fi

  if [[ "$ASSUME_YES" != 1 ]]; then
    echo "This will 'git reset --hard origin/main' and 'git clean -fd' in:"
    echo "  $TEST_ROOT/test-repo1"
    echo "  $TEST_ROOT/test-repo2"
    echo "Nothing is pushed. Continue? [y/N]"
    read -r reply
    [[ "$reply" == "y" || "$reply" == "Y" ]] || { echo "aborted"; exit 1; }
  fi

  seed_repo1
  seed_repo2
  echo
  info "done — undo with: $0 --reset"
}

main
