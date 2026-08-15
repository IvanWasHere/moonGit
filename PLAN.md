# moonGit — Implementation Plan

Derived from the PRD, grounded in what is actually in this repo today.

---

## 0. Current state (verified)

*Last verified 2026-08-06, at commit `1a1e412`.*

| Thing | Reality |
|---|---|
| Phases | **0–6 complete. Phase 7 in progress** (§10). Phase 8 not started. |
| Wails | **v2.13.0** (`go.mod`), CLI `v2.13.0`. PRD says v3 — a deliberate deviation (§14.1). |
| Go | 1.26.5 darwin/arm64, module `moongit` |
| Backend | 9 services under `internal/` — `gitexec`, `store`, `watcher`, `fsapi`, `ptyapi`, `shellapi`, `creds`, `dialogs`, `appmenu`. None of them know what a commit is (§4). |
| Frontend | TypeScript throughout, strict + `noUncheckedIndexedAccess`. React 19, TanStack Query, Zustand, CSS Modules. |
| Tests | 648 frontend across 43 files, plus Go tests for `fsapi`, `gitexec`, `ptyapi`, `store`, `watcher`. `make check` runs the lot. |
| Version control | This *is* a git repository now — see §13a, where the note saying otherwise used to be. |
| UI reference | `ui-example/index.html` — the Mithril + Dexie mockup. Ported in Phase 4; kept for comparison, with the deliberate departures listed in §14. |
| git | 2.47.1 available on PATH |

### Where this started

The snapshot the plan was originally written against, kept because it is what bounds the "migration" scope — everything not listed here was net-new design rather than a port:

| Thing | Reality at the time |
|---|---|
| Go | module named `myproject` |
| Backend | `app.go` — one `Greet()` method. Nothing else. |
| Frontend | Stock template: `App.jsx`, `main.jsx`, **plain JS, no TypeScript**, deps only `react`/`react-dom`/`vite` |
| Bindings | `frontend/wailsjs/go/main/App.d.ts` → `Greet(string)` |

**What the mockup actually contains** (this bounds the "migration" work — everything else in the PRD is net-new design, not a port):

- A 60px icon menubar: 3 sections (Pull/Sync/Push/Git-flow/Merge/Commit · Stage/Index Editor/Unstage/Remove/Abort/Discard/Delete · Log/Blame/Investigate/Main View/Review View)
- **Main View**: left column (Repositories 35% / Branches) | right column (Files 35% / Changes 35% / Journal), all percent-resizable
- **Review View**: top row (Repositories 20% / Files 50% / Commit Messages 30%) over bottom row (Origin Branch 50% / Changes 50%)
- 7 data components: `RepoList`, `BranchList`, `FileList`, `ChangesView`, `JournalView`, `OriginBranchView`, `CommitMessagesView`
- Drag resizers (`createResizer`, percent-based with min/max clamps), toast system, empty states
- A complete dark design token set (`--bg-darkest: #0d1117` … `--accent: #e8a838`), JetBrains Mono + Space Grotesk, Font Awesome 6.5.1

Everything in the mockup is **fake data from Dexie seeds** — it has no git integration at all, which is why §1.2 declines to recreate its `branches`/`files`/`commits` tables.

---

## 1. Decisions (resolved)

### 1.1 Wails **v2** ✅
Staying on stable v2.13.0 rather than the v3 alpha the PRD names. v2 delivers everything required — native menus, dialogs, events, dock, window management — without an unstable binding generator churning mid-build. A later v2 → v3 migration stays bounded to `main.go` + the binding wrappers, **provided the frontend only ever touches Wails through `src/services/wails/*`** (see §4.1). That constraint is enforced by lint, not discipline (§3.3).

### 1.2 SQLite, **hosted in Go** ✅ — and holding far less than the mockup implies
`modernc.org/sqlite` (pure Go, no CGO — keeps `wails build` simple and universal binaries painless). Go exposes only `DBQuery(sql, args) → rows` and `DBExec(sql, args)`; schema, migrations, and models are TypeScript. DB file at `~/Library/Application Support/moonGit/moongit.db`.

**Git is already the database.** The Dexie tables in the mockup (`repositories`, `branches`, `files`, `commits`, `changes`) existed only because nothing real sat behind them. Mirroring that into SQLite would produce a stale cache and the single most common Git-GUI failure mode: the client showing state that no longer matches the repo. So the architectural rule is:

> **SQLite holds app state and SHA-keyed immutable git objects. It never holds mutable git state** — refs, HEAD, working-tree status, ahead/behind counts are always read live from git.

A cache keyed on an immutable object can't go stale, which is what makes the commit/FTS index (§10) safe while the "stale UI" bug class stays structurally impossible.

Why SQLite over a JSON config file, given how little is stored: (1) **crash safety** — layout percentages are written on every resizer drag, and rewriting a whole JSON blob at that frequency risks truncation on force-quit; (2) **search is a PRD feature** — commit/message/author search wants an FTS5 index, not a `git log --grep` per keystroke. ✅ **Verified in Phase 1:** `modernc.org/sqlite` ships SQLite 3.53.3 **with FTS5 compiled in**, and the DB opens in WAL mode. The LIKE fallback is not needed; commit search gets a real full-text index in Phase 7. `store.Info()` exposes `hasFts5` at runtime so the frontend can still degrade gracefully if a future build drops it.

### 1.3 Icons: **lucide-react** ✅ · fonts vendored locally
`ui-example/index.html` pulls Font Awesome and Google Fonts from CDNs; a packaged Wails app serves from an embedded FS and may be offline. `JetBrains Mono` + `Space Grotesk` get vendored as local `woff2`. Font Awesome is replaced by `lucide-react` — tree-shakable SVG components, no 400 KB webfont for ~30 glyphs. The port maintains an explicit `fa-* → lucide` name map so every substitution is auditable, with sizes/weights matched to the mockup.

### 1.4 Repository Dashboard: **separate welcome screen** ✅
Shown at launch when no repo is open — recent repositories, clone, open, search, favorites, groups — then you enter the Main/Review workspace. The mockup's two-view layout is untouched once a repo is open. This gives clone/open a natural home and matches SmartGit/GitKraken/Fork.

Consequently **React Router is load-bearing** rather than vestigial: `/` for the dashboard, `/repo/:repoId/main`, `/repo/:repoId/review`.

### 1.5 Styling: **CSS Modules + design tokens** ✅
The mockup's `:root` block lifts verbatim into `styles/tokens.css`; the ~240 lines of component CSS port 1:1 into CSS Modules. Phase 4 stays mechanical and pixel-exact, and light/dark/custom-accent theming reduces to a variable swap. Tailwind stays available to layer in later if net-new Phase 6 screens want it.

### 1.6 Multi-repo: **switcher only** ✅
One active repository at a time; the Repositories panel switches between them, exactly as the mockup behaves today. One watcher, one git queue, one set of stores — the simplest correct model and the fastest route to the Phase 5 MVP.

⚠️ **Known future cost:** moving to multi-repo tabs later means re-keying every store by repo path. To keep that from being a rewrite, stores are built with a `repoPath` scope parameter threaded through from day one even though only one value is ever live in v1. Cheap now, expensive to retrofit.

---

## 2. Target repository structure

```
moonGit/
├── main.go                        # Wails app bootstrap, binds services
├── internal/
│   ├── gitexec/                   # git process execution + streaming + cancellation
│   ├── fsapi/                     # read/write/stat/list
│   ├── watcher/                   # fsnotify, debounced, emits repo:changed
│   ├── dialogs/                   # native open/save/message dialogs
│   ├── shellapi/                  # OpenExternal, RevealInFinder
│   ├── store/                     # SQLite open + DBQuery/DBExec passthrough
│   ├── creds/                     # keychain + SSH askpass bridge
│   └── ptyapi/                    # PTY for the embedded terminal (Phase 6)
├── frontend/
│   ├── src/
│   │   ├── app/                   # App root, providers, router
│   │   ├── components/            # presentational only (Panel, Resizer, Toast, StatusBadge…)
│   │   ├── features/              # working-tree, history, branches, diff, commit, stash…
│   │   │   └── dashboard/         # welcome screen: recent, clone, open, favorites, groups
│   │   ├── hooks/
│   │   ├── layouts/               # MainView, ReviewView
│   │   ├── pages/                 # DashboardPage, MainPage, ReviewPage
│   │   ├── services/
│   │   │   ├── wails/             # ONLY place allowed to import ../../wailsjs
│   │   │   ├── git/               # GitRunner + parsers + domain services
│   │   │   └── db/                # SQLite repositories, migrations
│   │   ├── stores/                # Zustand
│   │   ├── types/
│   │   ├── utils/
│   │   ├── workers/               # log/graph/diff parsing off the main thread
│   │   └── styles/                # tokens.css lifted verbatim from ui-example
│   └── wailsjs/                   # generated — never hand-edited
└── ui-example/index.html          # kept as the visual reference until parity is signed off
```

---

## 3. Phase 0 — Foundations *(~0.5 day)*

1. **Rename the project**: `myproject` → `moongit` in `go.mod`, `main.go` imports, `wails.json` (`name`, `outputfilename`), `build/darwin/Info.plist` (`CFBundleName`, bundle id `com.marinkovicivan.moongit`). Window title → `moonGit`, background → `#0d1117` to match the design tokens.
2. **TypeScript**: add `typescript`, `tsconfig.json` with `strict: true`, `noUncheckedIndexedAccess`, path alias `@/*`. Convert `main.jsx`/`App.jsx` → `.tsx`. Delete the Greet demo UI.
3. **Tooling**: ESLint (typescript-eslint, react-hooks) + Prettier + Vitest + React Testing Library.
   - **Enforce the PRD's architecture rules with lint, not vibes**: `no-restricted-imports` blocking `**/wailsjs/**` from anywhere except `src/services/wails/**`, and blocking `services/git/**` from `components/**`. This is what actually keeps "components never call Wails" true six months in.
4. **Dependencies**: `zustand`, `@tanstack/react-query`, `@tanstack/react-table`, `@tanstack/react-virtual`, `react-hook-form`, `zod`, `framer-motion`, `react-router-dom`, `lucide-react`. (Monaco and xterm.js deferred to their phases — they're heavy and unused until then.)
5. **Styling**: CSS Modules (§1.5). Wire `styles/tokens.css` from the mockup's `:root` block verbatim; every component stylesheet references tokens only, never literal hex.
6. **Vendor fonts** (`JetBrains Mono`, `Space Grotesk` as `woff2`), and write the `fa-* → lucide` icon map (§1.3).
7. Scaffold the directory tree above with index barrels.
8. **`git init` this project** (§13a) — it isn't under version control yet.
   ⚠️ **Committing is Ivan's call.** Nothing in this repo gets `git add`-ed or committed automatically at any phase; work is reported and he commits it.
9. Write `scripts/seed-test-repos.sh` (§13a) so Phase 4 has a repo state that actually renders.

**Exit criteria**: `wails dev` boots a dark empty shell with the correct fonts and tokens; `npm run lint` and `npm run test` both pass on an empty suite; `./scripts/seed-test-repos.sh` puts both test repos into a rich state and `git reset --hard origin/main && git clean -fd` restores them.

---

## 4. Phase 1 — Go native layer *(~1.5 days)*

Go stays dumb. It runs processes, touches the OS, and returns bytes. **No parsing, no git semantics.**

### 4.1 `gitexec` — the critical piece
```go
type RunRequest struct {
    RepoPath string; Args []string; Stdin string; Env []string; TimeoutMs int
}
type RunResult struct {
    Stdout string; Stderr string; ExitCode int; DurationMs int64; TimedOut bool
}
func (s *GitService) Run(req RunRequest) (RunResult, error)          // buffered
func (s *GitService) RunStream(runID string, req RunRequest) error   // emits events
func (s *GitService) Cancel(runID string) error
```
- **Streaming matters.** `git log` on a 1M-commit repo is hundreds of MB; a single buffered RPC return will stall the webview bridge. `RunStream` emits `git:chunk:<runID>` / `git:done:<runID>` via `runtime.EventsEmit`, chunked at ~64 KB on NUL/newline boundaries so the TS parser never sees a split record.
- `RunResult` is **never** an error for a non-zero exit — a failed merge is data, not an exception. Only process-spawn failures return `error`. This is what makes the PRD's "never throw uncaught exceptions" achievable.
- Always inject `GIT_TERMINAL_PROMPT=0`, `GIT_OPTIONAL_LOCKS=0`, `LC_ALL=C` so output is stable and never blocks on a hidden prompt.
- Configurable git binary path (Settings requirement), validated at startup.

### 4.2 The rest
- `fsapi`: `ReadFile`, `ReadFileBase64` (images for image-diff), `WriteFile`, `Stat`, `ListDir`
- `watcher`: `Watch(repoPath)` / `Unwatch`, fsnotify with a 200 ms debounce, ignores `.git/objects` churn but *does* watch `.git/HEAD`, `.git/index`, `.git/refs`; emits `repo:changed` with a coarse reason (`worktree` | `index` | `refs` | `head`)
- `dialogs`: `SelectDirectory`, `SelectFile`, `SaveFile`, `MessageDialog`
- `shellapi`: `OpenExternal(url)`, `RevealInFinder(path)`
- `store`: SQLite open + `DBQuery`/`DBExec`
- `creds`: keychain get/set/delete (`zalando/go-keyring`), plus an `SSH_ASKPASS`/`GIT_ASKPASS` helper binary so credential prompts surface as native UI instead of hanging git
- App menu, dock badge, notifications, window state persistence

Go deps to add: `fsnotify/fsnotify`, `modernc.org/sqlite`, `zalando/go-keyring`, later `creack/pty`.

**Exit criteria**: a TS scratch page can run `git status` in a chosen repo, stream `git log`, cancel mid-stream, and receive a `repo:changed` event on `touch`.

### ✅ Phase 1 verified

Harness at `#/dev/bridge` (`DevBridgePage.tsx`), driven against the live Go backend through `wails dev`'s browser server on :34115. Not linked from product UI.

| Criterion | Result |
|---|---|
| Run git | `status --porcelain=v2` on test-repo1 → exit 0 in 41 ms, correct porcelain output |
| Non-zero exit is data | `rev-parse does-not-exist` → **resolved** with `exit=128`, did not throw |
| Stream | 215 chunks / **6,970,463 bytes in 424 ms**, contiguous seq, reassembly matches buffered `Run` byte-for-byte |
| Cancel mid-stream | 18.1 MB in, then `canceled=true`, `exit=-1` — process group killed |
| Watcher | `touch` → exactly **1** debounced event, `reasons: ["worktree"]`, 19 dirs watched, not degraded |
| SQLite | 3.53.3, **FTS5 available**, WAL mode, DB open |

**Two findings worth carrying forward:**

1. **Killing git does not kill git's children.** A timeout fired correctly but `cmd.Wait()` still blocked for the full 30 s, because the child process inherited the stdout pipe and `Wait` waits on the pipe, not the process. In production that is `ssh` during a push, or a credential helper, turning every timeout into an indefinite hang. Fixed with `Setpgid` + a process-group kill (`internal/gitexec/proc_unix.go`) and `cmd.WaitDelay` as a second layer. This also cut the Go suite from 41 s to 10 s. **Windows has no equivalent yet** — it needs a Job Object, deferred to the cross-platform milestone.

2. **`go test ./...` matches a vendored Go package inside `frontend/node_modules`.** The Makefile pins the package list to `. ./internal/...` instead; use `make test-go`, not bare `./...`, in any CI config.

---

## 5. Phase 2 — TypeScript git layer *(~3 days)*

This is where the product actually lives.

**`services/git/GitRunner.ts`** — one door to git. Owns: typed `exec()` and `execStream()`, per-repo serialization (never two index-mutating commands at once), cancellation tokens, and mapping stderr into a discriminated `GitError` union (`NotARepository`, `MergeConflict`, `AuthRequired`, `LockExists`, `DetachedHead`, `Unknown`).

**Parsers** — pure functions, zero I/O, the highest-value unit tests in the codebase:

| Parser | Command (chosen for machine-readability) |
|---|---|
| Status | `status --porcelain=v2 -z --branch --untracked-files=all` |
| Log | `log -z --format=%H%x00%h%x00%P%x00%an%x00%ae%x00%at%x00%s%x00%b` |
| Diff | `diff --patch --no-color -U3` → hunks/lines (feeds the `.diff-line` renderer) |
| Refs | `for-each-ref --format=...` (local + remote + upstream + ahead/behind) |
| Stash | `stash list --format=...` |
| Blame | `blame --porcelain` |
| Graph | commit DAG → lane assignment, computed in a Worker |

`-z` and `%x00` everywhere: filenames with spaces, quotes, and newlines are a real source of bugs in git clients, and NUL-delimited output makes them free.

**Domain services** (`RepositoryService`, `BranchService`, `CommitService`, `DiffService`, `StashService`, `TagService`, `RemoteService`, `MergeService`, `RebaseService`) each compose `GitRunner` + parsers and return `Result<T, GitError>`. No React import anywhere in this directory — enforced by lint.

**Workers**: log parsing and graph layout run in a Web Worker. At 1M commits, parsing on the main thread will visibly hitch the UI; this isn't optional at the target scale.

**Exit criteria**: full test suite over parser fixtures (including pathological filenames, merge commits, binary diffs, renames, submodule entries) with no UI written yet.

### ✅ Phase 2 verified — everything except the graph

Built: `GitRunner` (+ `RepoLock`, `errors`, `commands`), parsers for **status, refs, log, diff, stash, blame**, and `Repository` / `Branch` / `Commit` / `Diff` / `Stash` / `Merge` / `Rebase` / `Remote` / `Tag` / `Blame` services. 249 unit tests. **Still to do: graph lane assignment and the Web Workers** (§5, "Workers") — both are better judged against a rendered UI than a fixture, so they are deferred to Phase 4/7.

**Fixtures are generated, not written.** Every parser fixture was captured by running the real command against purpose-built repositories and escaping the bytes into a TS module. Each fixture re-exports the exact format string or arg list it was captured with, and a test asserts the parser still matches it — a format and parser that disagree don't crash, they shift every field by one.

Verified against the live backend via `#/dev/bridge` → *Phase 2 — services against real git* (`DevServicesPanel.tsx`):

| Criterion | Result |
|---|---|
| Bridge preserves path bytes | `newline⏎in⇥name.txt` → code points include **000a** and **0009** intact through Go → JSON → webview |
| Bridge preserves UTF-8 | `Ivan Marinković` → **0107** (ć) intact |
| Incremental log parser | **2001 commits in 8 batches** — 7 real chunk boundaries crossed, every record's oid guard passed |
| status / refs / diff | test-repo1: 10 entries (4 staged), 7 branches with upstream ahead counts, 4-file working-tree diff |
| Error boundary | non-repo path → `NotARepository`, not an exception |
| Conflicts & submodules | `conflict.txt [conflict]`, `sub [submodule]` detected in a live worktree |

**Three findings worth carrying forward:**

1. **The bridge assumption held.** Four parsers were built on "NUL-delimited UTF-8 survives the trip" before anything tested it. It does — but that was luck of timing, not diligence. Verify the seam before stacking more on it.
2. **A bad `repoPath` blames git.** Pointing the runner at a non-existent directory surfaces as `SpawnFailed: fork/exec /opt/homebrew/bin/git: no such file or directory` — Go's `exec` reports a missing *working directory* by naming the *binary*. Anyone debugging that message will look in the wrong place. Worth pre-checking the path, or rewriting the message, when the repo picker lands.
3. **`git show` on a merge prints nothing** — zero bytes, which renders as "this commit changed no files". `DiffService.commit()` passes `--first-parent`; `-m` would emit one raw+patch section per parent, which the parser cannot read.

**Write-side verification** (`DevMutationPanel.tsx`, guarded to paths containing `/scratchpad/` — a dev tool that can rewrite the user's working tree because a field held yesterday's path is not worth the convenience). 7/7: stash push→pop round trip, conflicted merge, conflicted paths read back from `status()`, `merge --abort`, blame, remote and stash listing.

4. **Exit code 1 does not mean "conflict".** Measured on git 2.47, `git merge` fails four different ways:

   | Case | Exit | Message |
   |---|---|---|
   | Genuine conflict | **1** | `CONFLICT (content): …` / `Automatic merge failed` |
   | Unknown ref | **1** | `merge: X - not something we can merge` |
   | Dirty working tree | 2 | `error: Your local changes … would be overwritten` |
   | `--ff-only`, diverged | 128 | `hint: Diverging branches can't be fast-forwarded` |

   The first draft of `IntegrationService` classified any exit 1 as `conflicted`, so `git merge nosuchbranch` would have reported a conflict for a merge that never started — opening a conflict-resolution flow over a working tree with nothing conflicted in it. A conflict now requires the exit code **and** git saying so. This is precisely what the live run existed to catch; the unit tests were happy with the wrong rule because they were written from the same wrong assumption.

---

## 6. Phase 3 — State & persistence *(~1 day)*

- **Zustand stores** exactly per PRD (`App`, `Repository`, `Git`, `Branch`, `Commit`, `WorkingTree`, `Settings`, `Theme`, `Notification`, `Window`), each in its own file with actions colocated and selectors exported. Repo-scoped stores take a `repoPath` parameter from the start (§1.6) even though v1 only ever has one live value. Persist `Settings`/`Theme`/`Window`/layout to SQLite, not localStorage.
- **TanStack Query** owns all git *reads*, keyed `[repoPath, 'status' | 'log' | 'refs', ...params]`. The `repo:changed` event from Phase 1 drives `invalidateQueries` — this is what makes the app feel live without polling.
- **SQLite schema** (TS-owned migrations) — app state only, per §1.2:
  `repositories` (path, name, last-opened), `repo_groups`, `favorites`, `layout_state`, `preferences`, `window_state`, `commit_templates`, `recent_messages`.
  **Deliberately absent**: `branches`, `files`, `commits`, `changes`. The mockup had those because it had no git; here they'd be a stale mirror. The SHA-keyed `commit_cache` / `graph_cache` / FTS index arrive in Phase 7, when there's a measured perf reason.
- Optimistic updates for stage/unstage (the PRD's responsiveness bar), rolled back on a failed `RunResult`.

### ✅ Phase 3 — schema, persistence and the query layer

Built: `services/db/{migrations,repositories,keyValue}`, `queries/{keys,git,useRepoWatcher}`, `stores/layoutPersistence`, and `app/bootstrap` running migrations before first render. 271 tests.

Verified against the live database via `#/dev/bridge` → *Phase 3 — schema & persistence*, **11/11**: migration applied (`user_version=1`), all seven tables present, **no git state mirrored**, `ON CONFLICT` de-duplicating a repository path, favourite/last-opened round trip, JSON preferences round trip, missing key falling back, corrupted JSON falling back rather than throwing, layout persisted from a real resizer drag, probe rows cleaned up.

**Design notes:**

- **Invalidation is driven by the watcher's reason codes, not blanket refetch.** Saving a file invalidates status and the working-tree diff; it does not re-read the ref list or re-walk history. Two mappings are non-obvious and are tested: `refs` also invalidates **status** (ahead/behind lives in `# branch.ab`) and the **stash list** (the stash *is* `refs/stash`). `head` invalidates the repository whole, since a checkout moves everything at once.
- **Query keys lead with `repoPath`**, so switching repositories cannot show another's data for even a frame, and closing one drops its cache in a single call.
- **The services' `Result` is converted into Query's error channel** by `GitQueryError`. That is not an escape from the no-throw discipline — Query catches it and hands it back as a typed `error`.
- **Layout saves are gated on the load completing and debounced 400ms.** Without the gate, the mockup defaults would overwrite the user's saved layout on every launch; without the debounce, a resize drag writes on every mouse move.
- **Deviation from §6's table list**: `favorites` is an `is_favorite` column on `repositories` rather than its own table. A join table buys nothing until something other than a repository can be favourited; if branches become favouritable, that is the migration that adds it.

**Not done**: optimistic stage/unstage (needs Phase 5's mutations to exist first), and the remaining PRD stores — `App`, `Repository`, `Settings`, `Theme`, `Window` — whose shape is still better decided by the components that will consume them.

**Tooling note for future sessions**: the browser automation's `left_click_drag` does not emit document-level `mousemove`, so it cannot drive the resizers. Driving them needs an explicit `mousedown` → `document.mousemove` → `mouseup` sequence via the JS tool. The resizer itself is correct — `620/1373 = 45.157%`, matching the mockup's maths exactly.

---

## 7. Phase 4 — Mithril → React port *(~2.5 days)*

Pixel-for-pixel. The mockup is the spec.

| Mithril (`ui-example/index.html`) | React target |
|---|---|
| `:root` CSS block (L12–41) | `styles/tokens.css`, **copied verbatim** |
| all component CSS (L43–241) | CSS Modules, selectors preserved 1:1 |
| `createResizer(type, …)` (L384) | `useResizer()` hook + `<Resizer axis="v"\|"h">`, same percent math, same min/max clamps, same `.active` class |
| `MenuBar` (L454) | `<MenuBar>` driven by a typed button-config array; handlers dispatch to services, not inline `showToast` |
| `RepoList` / `BranchList` / `FileList` | `features/repositories`, `features/branches`, `features/working-tree` |
| `ChangesView` | `features/diff/DiffPane` |
| `JournalView` / `CommitMessagesView` | `features/history` |
| `OriginBranchView` | `features/branches/RemoteBranchList` |
| `MainView` (L716) | `layouts/MainView.tsx` — same 30%/35%/35%/35% defaults |
| `ReviewView` (L766) | `layouts/ReviewView.tsx` — same 55/45, 20/50/30, 50/50 defaults |
| `showToast` + `state.toasts` | `NotificationStore` + `<ToastContainer>`, Framer Motion reproducing the `toastIn` keyframe |
| `timeAgo` / `fName` / `fPath` | `utils/format.ts` |
| `statusBadge` / `branchTag` | `<StatusBadge>` / `<BranchTag>` |
| `.empty-state` blocks | `<EmptyState icon message>` |
| `i.fa-solid.fa-*` (CDN webfont) | `lucide-react` components via the §1.3 name map, sizes/weights matched |

Ported against the Dexie **seed data reshaped as TS fixtures**, so the port is validated in isolation before real git is attached. The seeded `testGitHere` repos (§13a) then give the same panels real data to render during the dev loop. Side-by-side screenshot comparison against `ui-example/index.html` at 1280×800 and 900×600 (the mockup has a `@media (max-width: 900px)` rule that collapses menu labels — it must survive).

**Exit criteria**: both views indistinguishable from the mockup, all resizers behaving identically, no Mithril/Dexie anywhere.

### ✅ Phase 4 ported — both views, against fixtures

12 components (`Panel`, `Resizer`, `ListItem`, `Badges`, `EmptyState`, `Button`, `MenuBar`, `ToastContainer`), 7 feature panels under `features/`, `layouts/MainView` + `ReviewView` + `Workspace`, `stores/workspaceStore` + `notificationStore`, `utils/format` (9 tests). 258 tests total. Rendered side by side against `ui-example/index.html` served locally.

**Three differences the comparison caught**, all now fixed:

1. **Commit was not gold.** The mockup gives that one button `menu-btn` *and* `btn-primary` (L464) — the only filled control in the bar. Easy to miss reading the markup, obvious side by side. *(Later reverted on purpose — the button opens the composer rather than committing, so the emphasis overstated it. See §14 deviation 5.)*
2. **`+3 -1` instead of `+3-1`.** A `gap: 4px` on `.meta` that the mockup does not have. Fixed by removing it and giving remote-branch rows two separate `.meta` elements, which is how the mockup spaces `lastCommit` from the counters (L678–682).
3. **Section headers under-indented by 24px.** The mockup renders an empty `i.icon` in the "Staged Changes (3)" divider (L595, L601) so the label lines up with the filenames beneath it.

**Two notes:**

- **Font Awesome does not load from the CDN here**, so the mockup renders with no icons at all. That is §1.3's rationale demonstrated rather than argued: the port's vendored lucide icons render offline, the mockup's do not.
- **The 900px breakpoint could not be checked visually** — the browser automation viewport is pinned at 1373px and ignores window resizes. Verified structurally instead: the `max-width: 900px` rules exist in the served stylesheet and target the exact hashed classes on the live menubar (`span { display: none }`, `padding: 0 8px`, `height: 44px`). Worth a manual look at 900×600 before Phase 5.

**One fix outside the port**: `onEvent`'s unsubscribe (`services/wails/events.ts`) now catches. Wails routes `EventsOff` back through the IPC bridge, which in browser dev mode can be gone after a hot reload — the throw escaped a React unmount effect and took down the entire route. Navigating away from `#/dev/bridge` crashed the app before this.

**Not done**: graph lane assignment and the Web Workers (deferred from §5), and the layout percentages do not persist yet — that is Phase 3's `layout_state` table.

---

## 8. Phase 5 — Wire real git *(~2.5 days)*

Swap fixtures for live data, one panel at a time, each independently verifiable:

1. **Repository Dashboard** (§1.4) — net-new screen, no mockup to port: recent repositories, clone, open via native dialog, search, favorites, groups. Built in the mockup's visual language using the same tokens and `Panel`/`EmptyState` primitives from Phase 4.
2. Working tree — real `status --porcelain=v2`, staged/unstaged grouping as in the mockup
3. Stage / unstage / discard (with confirm), optimistic + watcher reconciliation
4. Commit — message box, validation, amend, signoff, author override, templates, recent messages
5. History — real `git log`, virtualized, replacing `JournalView`
6. Diff — real patches into the existing `.diff-line` renderer
7. Branches — checkout, create, rename, delete, ahead/behind from `for-each-ref`
8. Remotes — fetch, push, pull, prune, with the credential flow from Phase 1

**Exit criteria**: **moonGit stages, commits, and pushes a change to `testGitHere/test-repo1`, and the commit appears on GitHub.** That's the milestone that matters — it proves the whole stack end to end, including the credential path, which a local-only test would skip. Secondary check: switching to `test-repo2` swaps every panel's contents cleanly (§1.6).

*(Originally written as "commit to its own repository" — but moonGit isn't under version control, see §13a.)*

### ✅ Phase 5 — mutations

Added `WorkingTreeService` (stage / unstage / discard / remove), `CommitService.create`, branch checkout / create / rename / delete, `RemoteService.push` / `pull`, `queries/mutations.ts`, and a `CommitBox`. The menubar drives real git; buttons whose features land in Phase 6 say so rather than pretending.

Verified end to end on a scratch repository with a local origin — **stage → commit → push all work**:

| | Result |
|---|---|
| Stage | File moved to Staged Changes; `git status` on disk agreed |
| Unstage | Moved back, **selection followed it**, diff still rendered |
| Commit | `eff1532` in the journal, `main` decoration moved, `+1` ahead appeared |
| Message | Subject *and* body preserved through stdin |
| Push | `origin/main` decoration moved onto the new commit, `+1` cleared |
| Discard | `restore --worktree` for tracked, `clean -f -d` for untracked, both confirmed |

**Three git behaviours that shaped the code, each measured first:**

1. **`git restore --staged` fails on an unborn branch** — "could not resolve HEAD", and the file stays staged. The first files added to a fresh repository are exactly the ones a user unstages, so that path falls back to `rm --cached`.
2. **`git restore` will not delete an untracked file** — it errors with "pathspec did not match". Discarding an untracked file means `git clean`, so the caller has to say which paths are tracked; the status entry already knows.
3. **Commit messages go in on stdin** (`commit --file -`), not argv. A message is multi-line with arbitrary quoting, and stdin sidesteps all of it.

**A bug the live run caught:** after staging the selected file, the diff pane showed "No diff data available" — the selection still pointed at the *worktree* side, which was now empty, while the row stayed highlighted. It read as a broken diff rather than a stale selection. Stage and unstage now move the selection with the file.

**Deliberate choices:**

- **Optimism is bounded to staging.** Stage/unstage move a row between two lists — cheap to predict, cheap to roll back. Commit, checkout and push are not optimistic: their failure modes have no obvious rollback. Every mutation invalidates afterwards, so even a successful optimistic update ends up showing git's own answer.
- **`push` uses `--force-with-lease`, never `--force`** — with-lease refuses if the remote moved since the last fetch, so it cannot silently discard someone else's commits.
- **`pull` defaults to `--ff-only`.** A pull that quietly creates a merge commit is how unwanted merge bubbles get into history; refusing lets the user choose merge or rebase deliberately.
- **`switch`, not `checkout`,** for branches: `git checkout foo` is ambiguous when a *file* named `foo` exists and silently discards that file's changes instead.
- **Discard confirms via a native dialog** naming the file. The confirm lives in the UI, not the service — a service that opens dialogs cannot be tested or scripted.

**Not verified interactively**: the discard confirmation dialog, because it is a native window the browser automation cannot answer. The two commands behind it were verified directly.

### ✅ Exit criterion met — commit pushed to GitHub from moonGit

`4c5e77b05a6b4a03f3ed362bffab1a1c483d1d37` on `github.com/IvanWasHere/test-repo1`, branch `moongit-verify`. Staged, written and pushed entirely through the app: porcelain v2 status → the diff renderer → the commit path over stdin → push over HTTPS with the osxkeychain credential helper. Local and remote object ids match.

**Pushed to a branch, not `main`.** `main` had 5 *pre-existing seeded* commits unpushed; pushing it would have sent those to GitHub as a side effect of a verification run. The branch was cut from `origin/main` so it carried exactly one new commit. `main` is untouched at `d564383`, still ahead 5.

**The push failed the first time, and the bug was ours.** moonGit ran `git push --set-upstream` with no remote or branch, relying on git's defaults. Git refused:

    fatal: The upstream branch of your current branch does not match
    the name of your current branch.

A branch created with `switch -c work origin/main` inherits `origin/main` as its upstream, so a bare push is ambiguous — and what it does otherwise depends on `push.default` too. **`queries/pushTarget.ts` now resolves the remote and branch explicitly**, sets an upstream when there is none *or* when the inherited one names a different branch, and refuses with a clear message on a detached HEAD or with no remote. 10 tests, including the exact case that failed.

Worth noting the failure was nearly invisible: the toast had already expired by the time the screenshot was taken, and the only evidence was the branch missing from `ls-remote`. A verification that had checked "did the button click work" rather than "is the commit on the remote" would have reported success.

**Repository restored.** The seeded working tree was parked with `git stash push -u` and popped afterwards — but `stash pop` does not restore the *index*, so two staged files came back unstaged and a staged rename decomposed into an add plus an unstaged delete. Re-staged to match the original byte for byte. Use `git stash push --index`, or better, do not park a user's working tree at all.

### Phase 5 read path (completed earlier)

**Done (1, 2, 5, 6, and the read halves of 7 and 8).** Fixtures are deleted; every panel renders live git. `queries/repositories.ts` (SQLite inventory + open-via-dialog), a real Repository Dashboard, and `workspaceStore` reshaped so selection is by **identity, not index** — a file is its path, a branch its ref name, a commit its oid. A row number does not survive a refetch; a path does.

**Not done (3, 4, and the write halves of 7 and 8)**: stage / unstage / discard, commit, checkout / create / delete branch, fetch / push / pull. **The exit criterion — stage, commit and push to `test-repo1` — is therefore not met yet.**

Verified live against the seeded test repos:

| | Result |
|---|---|
| Dashboard | Both repositories listed from SQLite, search, favourites, open by click |
| Working tree | `test-repo2`: 2 staged / 2 unstaged with correct A/M/? badges |
| Diff | Real patch with hunk header `@@ -1,4 +1,6 @@`, correct per-side line numbers |
| History | Real commits with author, relative time, and ref decorations (`main`, `v1.0.0`) |
| Branches | 7 branches with real ahead counts, HEAD marked green |
| Renames | `Widget.tsx  src/legacy/OldWidget.tsx → src/components/` with an `R` badge |
| **Watcher** | Creating an untracked file made "Changes (2)" become "(3)" **with no interaction** |
| Repo switch | Every panel swapped cleanly between test-repo1 and test-repo2 (§1.6) |

**Notes:**

- **Selection survives a refetch.** The watcher fires constantly while an editor is open; the selected file stayed selected across the invalidation, which is the identity-keyed store doing its job.
- **The diff is fetched per selected path**, not fetched whole and filtered. On a branch switch with hundreds of changed files that is the difference between instant and not.
- **The status badge grew four states** beyond the mockup's four (renamed, copied, typechange, conflicted). Showing a conflict as "modified" would invite staging a file with conflict markers still in it.
- **`branchType` is derived from the name**, since real branches have no `type` field — `feature/x` by the git-flow convention the mockup's tags were describing. Anything unrecognised is just "branch"; tagging every prefix would fill the panel with labels like `ivan` that mean nothing.
- **A dashboard CSS bug caught on screen**: `direction: rtl` to truncate long paths from the left also relocates the leading `/`, rendering `/Users/x` as `Users/x/`. Reverted to ordinary right-truncation.
- **`RepoList` no longer shows a clean/dirty tag.** The mockup's came from seed data; doing it for real is a `git status` per row per render. It belongs in Phase 6 with a cached badge.

---

## 9. Phase 6 — Feature build-out *(~2–3 weeks)*

Nothing below exists in the mockup — each needs UI design as well as implementation. Ordered by value:

1. **Diff viewer**: side-by-side, inline, syntax highlighting (~~Monaco~~ **Shiki** — see below), word diff, image diff, large-file guard
2. ~~**Commit graph**: lane layout, branch colors, merge visualization~~ ✅ (below)
3. ~~**Merge**: wizard, conflict detection, conflict viewer, resolution helper~~ ✅ (below)
4. ~~**Rebase**: interactive, continue/skip/abort, squash/edit~~ ✅ (below)
5. ~~**Cherry-pick**, **Stash**, **Tags**~~ ✅ (below)
6. ~~**Search**: commits / files / branches / tags / messages / authors~~ ✅ (below)
7. ~~**File explorer**: tree, quick open, reveal in Finder~~ ✅ (below)
8. ~~**Settings**: appearance, git path, SSH, editor, diff/merge tools, keybindings~~ ✅ (below)
9. ~~**Terminal**: xterm.js + `creack/pty` in Go, repo-aware cwd~~ ✅ (below)
10. ~~**Repository settings**: ignore rules, git config~~ ✅ (below) — hooks, LFS and submodules deliberately not built, with reasons in that entry
11. ~~**Native menu bar**: the same menus in macOS's own bar, not only the window's~~ ✅ (below) — not in the mockup, which drew the in-window bar and stopped there
12. ~~**Files panel**: a PATH column of its own, and status filter chips beside the Changes/Tree tabs~~ ✅ (below)

Each ships behind the same skeleton: `Loading | Success | Error | Retry`.

### ✅ Phase 6.1 — diff viewer, complete

All six parts of item 1: side-by-side, inline, syntax highlighting, word diff, image diff, large-file guard.

`features/diff/wordDiff.ts` (intra-line LCS) and `features/diff/diffView.ts` (patch → the two view shapes) are pure and tested — including one test that runs a real `git diff` payload through `parseDiff` and out the other side. `DiffPane` renders either shape; the mode lives in `workspaceStore` and persists as a preference in SQLite.

Verified live against `test-repo1`:

| | Result |
|---|---|
| Word diff | `<a key={link.id} href={link.href}>` → `<NavLink key={link.id} {...link} …>` marked at `a`/`NavLink` and the changed attributes, not the whole line |
| Side-by-side | Deletion left, addition right, per-side line numbers, empty half dimmed for a pure add |
| Wrapping | A long addition wrapped and **its paired deletion row grew with it** — the halves stayed level |
| Guard | A 2,502-line change refused to render, named the count, offered "Show anyway"; rendering on demand worked |
| Persistence | Split survived a reload — the preference round-tripped through SQLite |
| Highlighting | `Header.tsx` coloured by the TSX grammar, with the word-diff marks still legible on top |
| Image diff | A staged 16×16 PNG against a modified 48×32 one, both rendered with dimensions and byte sizes |
| Test repo | `README.md` and the test PNG both removed; status and HEAD byte-identical to before |

**Decisions worth keeping:**

- **Split is one CSS grid, not two scrolling columns.** A grid row holds both halves, so a deletion and the addition that replaced it cannot drift apart when one side wraps or grows a scrollbar. It also means split can *wrap* rather than scroll horizontally, which is what a narrow Changes pane needs.
- **Deletions and additions are paired by position within a change block.** Anything cleverer is also a heuristic; `wordDiff` is what corrects it, by declining pairs that share less than 25% of their characters. A "rewritten line" marked token-by-token reads as a rendering bug.
- **The word diff trims common prefixes and suffixes before the LCS runs**, so the quadratic part sees a handful of tokens on a normal edit. Lines over 1,000 characters skip it entirely — a minified bundle on one line would otherwise hang the renderer.
- **`\ No newline at end of file` follows the side of the line it annotates.** Putting it on both would claim the new file also lacks a final newline.
- **The guard's "show anyway" is keyed by path**, so selecting a different large file re-arms it instead of inheriting the last file's answer.
- **The threshold (2,000 lines) is a placeholder for virtualization.** It exists because nothing is virtualized yet (§10); once the diff list is, it can be raised or dropped.

#### Syntax highlighting — **Shiki, not Monaco** (deviation from §9.1)

The plan named Monaco. Monaco is an *editor*, and its `DiffEditor` recomputes diffs client-side, which would put a second opinion next to git's hunks — the ones hunk-level staging will need to be authoritative. Using it purely as a tokenizer costs ~2 MB for a job Shiki does with the same TextMate grammars VS Code ships. Monaco stays on the table for the merge conflict editor (§9.3), where an editable surface is the actual requirement.

- **Whole blobs are tokenized, never hunks.** A hunk is a fragment; a tokenizer handed one cannot know it began inside a block comment and will colour the tail of that comment as code. `BlobService` reads the old and new files in full, and the renderer indexes tokens by line number. Confirmed against a file with a comment spanning a hunk boundary.
- **The two sides come from different places.** Anything git has an object for is `cat-file` and cached forever, because an object id names one sequence of bytes for all time. The working-tree side of an unstaged diff **has no object** — `git diff --raw` prints an all-zero destination id, verified — so it is read off disk, and its query is keyed under the `fileText` prefix so the watcher's existing invalidation reaches it. Without that it would serve tokens for the previous save.
- **Syntax colour and word-diff marks are merged, not nested.** They partition a line at different points (`retries: 3` is three tokens and two segments), and crossing spans are not expressible in HTML — so both are cut at the union of their boundaries. If the two partitions do not cover the same length, highlighting is dropped for that line: colouring that shifts partway through reads as corruption, plain text just reads as plain.
- **`github-dark-default` because its background is `#0d1117`** — the same value as the mockup's `--bg-darkest`. The palette the UI was designed around and the one the code is coloured with are the same palette, not two dark themes that nearly agree.
- **Shiki's core plus the JavaScript regex engine**, so no Oniguruma WASM ships at all. Confirmed in the build: every grammar is its own chunk (`tsx` 176 KB, `go` 47 KB, …), the engine and core are two more, and the main bundle is untouched at 572 KB. Nothing loads until a file of that kind is opened.

#### Image diff, and a Go change it needed

`RunBase64` was added to `gitexec` — Run with stdout base64-encoded. **The reason is not what it first looked like:** a Go string holds arbitrary bytes, so `Run` does not damage binary output. The damage happens where results are marshalled to JSON for the bridge, and `encoding/json` replaces invalid UTF-8 with U+FFFD silently. A PNG read through the ordinary path arrives corrupted with no error anywhere. The first version of the test asserted the wrong layer and failed, which is how the real culprit was found; it now asserts a JSON round trip, and `GitRunner` refuses base64 on a bridge that cannot do it rather than downgrading to text.

The panes show dimensions and byte size beside each version, because that is usually where the answer is — an asset re-exported at half resolution looks identical until the numbers are side by side — and sit on a checkerboard so a transparent PNG does not read as a white one.

### ✅ When an empty history is a lie

Chasing the Journal that briefly read "No commits yet" over a repository full of commits. **The theory first recorded for it was wrong**, and measuring said so: every `git log` exit code was captured against git 2.47 rather than reasoned about.

| situation | exit | stderr |
|---|---|---|
| fresh `git init`, no revisions | 128 | `your current branch 'main' does not have any commits yet` |
| fresh `git init`, `--all` | **0** | *nothing at all* |
| a ref pointing at a dead object | 128 | `bad object refs/stash` |
| a revision that does not exist | 128 | `ambiguous argument 'x': unknown revision or path…` |

So the guessed cause — `--all` tripping over a `refs/stash` mid-delete — was already handled: "bad object" never matched the empty-history clause and would have surfaced as an error. Two other things were wrong, though, and one of them is what actually happened.

**1. `unknown revision` was treated as an empty history.** That clause covered a real failure: a ref that is gone. The merge wizard asks for `HEAD..<branch>`, so a branch deleted between the ref list and the log made it report **"already up to date"** for a branch that no longer existed — a wrong answer presented confidently. Now an error.

**2. Nothing checked that git's output arrived.** Chunks travel as *events*, and an event bus can drop one — a reconnecting WebSocket in browser dev mode does exactly that, and the console showed it doing so. The process still exits 0, so a log whose output never reached us returned an empty array and the Journal dutifully rendered "No commits yet". This is what was actually seen.

Go already counted what it sent (`chunks`, `bytesOut`); nothing compared that with what arrived. Now `list` does, and a mismatch is a failure naming both numbers rather than a history. Seven tests cover the table above plus the truncation cases, and each was confirmed to fail with the fix reverted.

**Still on the same footing elsewhere**: `CommitService.get` returns `ok(null)` for *any* exit 128, so a genuine failure reads as "no such commit". Narrower blast radius — it is a single-oid lookup where null is a sensible answer — but the same shape of problem, and worth the same treatment when something needs it.

### ✅ Invalidation that only fired on success

The `Local ▸ Stash` bug — a mutation bypassing React Query, so the panels kept showing changes it had just taken away — turned out to have one sibling, found by auditing every service call made outside `mutations.ts`.

`useFileMenuActions` refreshed **only when the command succeeded**. `resolveUsing` is two commands, `checkout --ours` then `add`: if the second fails the working tree has already been rewritten by the first, and the panels were left describing a repository that no longer existed. It now refreshes in a `finally`, exactly as the mutation layer's `onSettled` does, and for the same reason — an error does not mean nothing happened.

Everything else the audit turned up was either a read inside a query (fine) or the dev panels, which are guarded to scratchpad paths.

### ✅ Phase 6.4 — rebase

All four parts of item 4: interactive, continue/skip/abort, squash/edit. A wizard to plan one, a banner to get out of one.

#### Driving `git rebase -i` with no terminal to open

Interactive rebase is defined by an editor: git writes a todo list, opens `$GIT_SEQUENCE_EDITOR` on it, and replays whatever comes back. moonGit has no terminal to host one, so it hands git **a sequence editor that is not an editor** — `GIT_SEQUENCE_EDITOR` is set to `cp '<our file>'`, which overwrites git's todo with one `features/rebase/rebaseTodo.ts` produced. Git carries on as though the user had saved it.

That path has two sharp edges, both handled where they are created rather than where they bite:

- **Git runs the value through `sh -c`**, not `exec`. A repository under a path with a space in it would produce a command that copies the wrong file, or nothing — so the path is single-quoted with the usual `'\''` escape, which is the only form safe for every byte a path may hold.
- **`GIT_EDITOR=true`** for everything else git might want to open. Commit messages during `squash` are the case that matters: git combines them itself and merely *offers* to edit the result, so a no-op editor accepts its default.

**`reword` is deliberately not offered.** It stops the rebase and opens `GIT_EDITOR` on the message — which, being a no-op, would silently keep the message unchanged. A menu item that claims to rename a commit and doesn't is worse than no menu item. `edit` gives the same power honestly: the rebase stops and the commit composer can amend the message along with anything else.

**The list is shown oldest-first, git's apply order** — not the Journal's newest-first. "Fold into the commit above" means the opposite of what it says if the list is reversed, and `todoFromCommits` reverses the log rather than leaving the two orders to be reconciled by eye.

**`todoProblem` refuses a list git would refuse**, before anything is rewritten. The rule that actually bites: the first surviving commit cannot `squash` or `fixup`, because there is no commit above it — git stops with `cannot 'squash' without a previous commit` *after* it has begun rewriting history, which is a far worse place to learn it than a disabled button. Dropping everything is caught for the same reason.

**Dropped commits stay in the list, struck through.** Removing the row would make the change unreviewable and un-undoable in one motion.

#### The banner, and why continue and skip are not symmetrical

A stopped rebase is the one state where the app's ordinary affordances are all slightly wrong: HEAD is detached partway through a replay, and committing would not do what it looks like. So it gets a bar across the top of the workspace reading the step out of `.git/rebase-merge` (`msgnum` / `end`), with the three ways out.

**Skip and abort confirm; continue does not.** Skip throws the current commit's changes away entirely and abort unwinds the whole operation — continue is the intended path. The banner also does not claim to know *why* the rebase stopped: nothing on disk distinguishes a stop for an `edit` line from a conflict that has since been resolved, since both leave a clean tree partway through, so it says "Nothing left to resolve — continue when ready" rather than naming the wrong one.

**A conflict is not a failure**, the same as merge and cherry-pick: exit 1 with unmerged paths is an outcome, and `okExitCodes: [0, 1]` lets it through to `toOutcome`. Continuing into another conflict re-opens the resolver rather than reporting success.

#### The resolver had to learn it was mid-rebase

**Git swaps what "ours" means during a rebase**, and the three-way tool was labelling the columns `Ours (current branch)` / `Theirs (incoming)` — correct for a merge and backwards here. Mid-rebase, *ours* is the branch being replayed **onto** and *theirs* is the commit being applied. The labels now read `Ours (the new base)` and `Theirs (commit being replayed)` when `.git/rebase-merge` exists. Nothing else changed: stages 1/2/3 are already whatever git put in the index, so only the words were wrong — which is the dangerous kind of wrong, since the user picks a side by reading them.

#### Two unmount bugs, the same shape

The wizard was supposed to close and hand off to the resolver on a conflict. It did not, twice, and both times because **React Query's `mutate()` callbacks do not fire if the component that called it has unmounted** — the mutation completes, the cache updates, and the `onSuccess` that was going to close the wizard simply never runs.

1. The plan component re-read the current branch, and a rebase detaches HEAD — so it unmounted the moment the rebase started. Fixed by capturing `{upstream, branch}` together up front.
2. Less obvious: the component is keyed on the commit range so it remounts when the range changes, and the range changes as commits are replayed. `useRebase` lived inside that boundary. Lifting the hook to the parent and passing it down fixed it — the observer now outlives the thing it is rendering.

The lesson generalises: **a mutation's callbacks belong above every `key` that its own side effects can change.**

Verified live end to end, twice, against a scratch repo with a feature branch of three commits over a main that had moved:

| | Result |
|---|---|
| Interactive plan | Four commits oldest-first; `fixup` on "fix beta typo" folded it into "add beta" |
| Guard | `Squash` on the first row disabled Rebase and named the rule |
| Conflict handoff | Wizard closed on its own; resolver opened on `f.txt` with the single conflict |
| Rebase-aware labels | Ours showed `MAIN AGAIN`, theirs `FEATURE` — with the new wording |
| Resolve → Continue | Chose theirs, saved and staged (`UU` → `M.`), continued; `Rebase finished` |
| Result | Linear history onto `main`, three new oids, `f.txt` = the chosen side, clean tree, HEAD back on `feature` |
| Skip | Discarded the replayed commit and left the base version in place — exactly what it warns it will do |
| Fixup | 4 commits became 3, `b.txt` = `beta fixed`, the folded message gone |

**A guard fired in the wild while doing this.** The chunk-count check added in "When an empty history is a lie" caught a genuine dropped event mid-rebase and rendered *"git emitted 1 chunks but 0 arrived — 604 bytes of output were lost in transit"* where the Journal would previously have shown "No commits yet". The failure it was written for is real and happens.

**A toast ate a click.** The toast stack is fixed to the bottom-right corner at `z-index: 9999` — the same corner every modal puts its primary action in — and toasts were clickable so they could be dismissed. A rebase toast landed over `Save & mark resolved` and swallowed the press; the only symptom was a button that appeared to do nothing. Toasts are now non-interactive and rely on their three-second expiry. Click-to-dismiss on a three-second toast is worth less than never stealing a click.

**Not exercised interactively**: the skip and abort confirmations are native windows the automation cannot answer — the same limitation Discard, Remove, Delete and merge Abort have. The commands behind them were run directly.

### ✅ Phase 6.5 — cherry-pick, stash, tags

`StashService` and `TagService` were built and tested in Phase 2 and had never been rendered. This is the UI for them, plus the one service the trio was missing.

**`CherryPickService`** joins merge and rebase as the third operation whose failure is not a failure: a conflicted pick stops with unmerged paths carrying stages 1, 2 and 3, which is exactly what the three-way resolver already reads. Nothing new was needed to get out of one. Its summary comes from **stderr** — `git merge` prints "Automatic merge failed" to stdout, cherry-pick prints "could not apply" to stderr, a difference `errors.ts` documents and `toOutcome` takes as a parameter rather than guessing.

**A commit context menu** in the Journal is where cherry-pick and tagging live, decided by `commitMenu.ts` the way `fileMenu.ts` decides the file one. Two states suppress items:

- **The checked-out commit** offers no cherry-pick — picking the commit you are sitting on is "nothing to do", and git says so with an error.
- **A merge** offers none either. Git needs `-m` to say which parent is the mainline, and choosing one on the user's behalf is a guess about intent that can quietly bring in an entire branch.

**The stash panel** says two things git does not. Apply and pop are both offered, apply first, because pop drops the entry once it lands and an abandoned conflicted apply loses it. Dropping confirms, because a dropped stash is unreachable from any ref. Git's auto-generated messages render dimmed and italic against ones the user wrote, and `+untracked` is called out because it changes what popping does to the working tree. "Include untracked" defaults **on**: `git stash` without it silently leaves new files behind, which is how people lose work they thought was saved.

**The tag prompt** is in-app rather than native because there is no native prompt for free text — `ShowMessage` is buttons, `SaveFile` returns a path, and a ref name is neither. A message makes the tag annotated, which is git's rule rather than a UI convention, so the hint says which kind the current input would make instead of offering a checkbox meaning the same thing twice.

#### The Journal needed an "all branches" toggle

Cherry-pick's input is a commit you do **not** have, and the Journal showed only HEAD's history — so the one place the action is offered could never reach anything to pick. The toggle deferred during the graph work turned out to be load-bearing, and is now in the Journal header, off by default.

Verified live on a repository with two branches, three stashes and an uncommitted change:

| | Result |
|---|---|
| All branches | Revealed `feature/pickme` and the stash refs, each in its own lane |
| Cherry-pick | `add a helper worth picking` landed on `main` as a **new oid**, `helper.ts` appeared, and the uncommitted change survived |
| Stash list | Git's auto-name dimmed and italic, the user's message plain, `+untracked` only on the one made with `-u` |
| Stash push | New entry at the top, count 2 → 3, field cleared |
| Pop | Entry gone, `a = 5` back in the working tree |
| Tag validation | A space turned the field red, disabled Create, and named the rule |
| Tag creation | `v1.0` as a real **tag object** at the right commit, message intact, decoration appeared in the Journal |

**A pre-existing bug found on the way**: the app menu's `Local ▸ Stash` called the service directly and never invalidated, so a successful stash left the panels still showing the changes it had just taken away. Both it and `Shelve` now open the panel, which is where stashing and restoring both live.

**One thing I could not explain at the time** — since chased down, and the theory recorded here was wrong. See "When an empty history is a lie" below.

### ✅ Three menubar buttons that were pretending

**Remove** and **Delete** now run the file context menu's implementations rather than growing their own. Both need a confirmation, both split on tracked versus untracked, and both already existed a few files away — a second copy would have been a second place for those rules to drift. The label doubles as the dialog's wording, so it is passed in rather than hard-coded.

- **Remove** — `git rm --cached`: untracks the file, leaves it on disk.
- **Delete** — `git rm -f` for a tracked file, `fsapi.DeletePath` for an untracked one git has never heard of.

**Copy Diff** copies a real patch. `DiffFile` holds hunks rather than the bytes git printed, so the text is rebuilt with `buildPatch` — cheaper than retaining a second copy of every diff on the chance somebody presses a button, and already proven against real git by `patchApply.test.ts`. The button reads the *same query key* the diff pane fetched, so it costs a cache lookup rather than a git call, and it is disabled when no file is selected instead of toasting a lie.

Verified live: the copied text was a well-formed unified diff that `git apply --cached --check` accepted forward and `--reverse --check` accepted backward. Only git's `index <old>..<new>` line is missing, since the abbreviated hashes it wants are not what the raw section carries.

**Not exercised interactively**: the Remove and Delete confirmations, which are native windows the browser automation cannot answer — the same limitation Discard and Abort have. Both commands were run directly and behaved correctly: `rm --cached` left the file on disk as untracked, `rm -f` took it from the index and the disk.

Four menubar stubs remain — Git-flow, Log, Blame, Investigate — of which two (Git-flow, Investigate) are still undefined by the PRD (§14).

### ✅ The Index Editor — hunk and line staging

Staging part of a file, from the diff pane where the hunks already are. Each hunk header carries a **Stage hunk** / **Unstage hunk** button; clicking changed lines selects them and a bar offers **Stage selected**. Selecting a whole hunk is the same operation with all its lines selected, so there is one mechanism rather than two.

`features/diff/patch.ts` builds a patch from the selection and `git apply --cached` applies it — `--reverse` to unstage. The patch goes in on **stdin**, for the reason commit messages do.

**Neutralising unselected lines is direction-dependent**, and getting it backwards silently stages the wrong thing:

| | unselected addition | unselected deletion |
|---|---|---|
| **stage** (index ← worktree) | dropped — not in the index, not going in | becomes context — it is in the index and stays |
| **unstage** (index → HEAD, reversed) | becomes context — in the index and stays | dropped — not in the index |

**Line numbers follow the same rule.** Whichever side git matches against the file keeps git's numbers; the other is derived by accumulating the size change of the hunks actually included. Skipping a hunk shifts everything after it.

#### The bug only real git could find

`patchApply.test.ts` runs generated patches through actual git in throwaway repositories — the one test in the frontend suite that shells out, and it earns the exception: a *malformed* patch fails loudly, but a merely **wrong** one applies cleanly and stages something nobody asked for. No fixture can tell those apart.

It found exactly that. Staging one line of a block replacing `a,b` with `A,B` produced a patch git accepted and that left the index reading `b,A,c` instead of `A,b,c`. The cause: emitting lines in git's source order puts the retained context line before the addition.

The fix is in the ordering rule. **The side git matches must keep its original order** — applying forward it checks the old side, so every deletion-slot line appears, as `-` if taken and as context if not, in file order. The *other* side is unconstrained, and that freedom is what makes this correct rather than merely valid: taken lines from it are emitted **beside the first line taken from the anchored side**, not where git happened to put them.

Verified live on a two-hunk file, each step checked against `git show :path`:

| | Result |
|---|---|
| Stage hunk 2 only | Staged `version`, left `retries`/`timeout` unstaged; status `MM` |
| Stage 2 lines | Index took `retries: 10` but kept `timeout: 1000` — and `retries` landed in the right position |
| Unstage hunk | `retries` reverted in the index, `version` still staged, **working tree untouched** |
| Split view | Selecting either half of a row stages that line; `timeout` staged, `retries` left behind |
| Status column | Showed `M M`, matching git's `MM` |

**Failure is safe.** Git applies all of a patch or none, so a patch this app builds wrongly leaves the index exactly as it was and surfaces git's complaint.

**The context menu's two disabled rows are gone**, replaced by one enabled `Stage Lines or Hunks…` that selects the file and points at the diff pane — a second mechanism there would be a worse version of the one that has the diff in front of it.

### ✅ Phase 6.2 — the commit graph

Lanes, colours and merge topology beside every row in the Journal. `features/history/graph.ts` is pure and tested; `CommitGraph.tsx` draws one row.

**The model is a set of lanes**, each holding the object id it is next expecting. Walking newest-first: a commit takes the lane already waiting for it (other lanes waiting for the same id are its other children, and converge); a commit nothing waits for is a tip and opens a lane; its **first parent continues in the same lane**, which is what makes a branch one straight column of one colour; every further parent peels off into its own.

**Lanes are never renumbered.** Compacting after a branch ends would narrow the graph at the cost of every line to its right shifting sideways — and a line that moves for reasons unrelated to its own history is worse than an empty column. Freed slots are reused by later branches instead, with a fresh colour, because a reused lane is a different branch.

**Edges carry a span — `top`, `bottom` or `full`.** The first model only knew "lane at the top, lane at the bottom", which cannot tell a line that stops at the node from one passing through: every branch tip would have rendered with a line running out of the top of it, to a commit that is not there.

**`--topo-order` is now on for the Journal.** Without it `git log` interleaves branches by date and the lanes zig-zag; `git log --graph` turns it on for itself for exactly this reason.

**The SVG stretches and the node does not.** Journal rows are not a fixed height — a commit carrying ref decorations is taller — so the lines live in an SVG with `preserveAspectRatio="none"` that scales to whatever the row turned out to be, with `vector-effect="non-scaling-stroke"` keeping the strokes even. That would also squash a node into an ellipse, so the node is a CSS circle positioned over the top. The alternative, forcing every row to one height, would have meant truncating decorations.

Verified live against a repository with two merges, a reused lane and a shared root:

| | Result |
|---|---|
| Merge | Filled node, with the second parent curving off into its own lane |
| Side branch | Ran alongside in its own colour and converged back at the common ancestor |
| Lane reuse | The second feature took the freed column and rendered **green** where the first was blue |
| Tip and root | No line above the newest commit, none below the root |
| Variable rows | Nodes stayed circular on rows made taller by ref badges |

**Not done here:** the Web Workers §5 deferred alongside lane assignment. Lane assignment is an O(commits × lanes) walk over one page — a few hundred rows — and moving that to a Worker before measuring the full-history case would be speculation. It belongs with the virtualized history in §10, where there is something to measure.

**Scope note:** the graph shows whatever the Journal is showing, which is `HEAD`'s history. Merge topology appears in full, because `git log` walks both parents of a merge — but branches not reachable from HEAD do not. An "all branches" toggle is a small addition when someone wants it.

### ✅ File context menu

Right-click on any row in the Files panel. **What appears is decided by git status**, in `features/working-tree/fileMenu.ts` — pure, and tested the way `menuConfig.ts` is, because the interesting part of a context menu is *which items are in it*.

The rule: an item is present when it would do something. "Unstage" on a file with nothing staged is an invitation to a no-op; "Revert to HEAD" on a staged addition names a version that does not exist. So the four states get four menus:

| | |
|---|---|
| **Modified** | the full set — open, stage, discard, revert, ignore, remove, rename, delete, file log, copy paths |
| **Untracked** | staging is called **Add**, as git calls it; no unstage, revert, remove, rename or file log, none of which mean anything without a tracked history |
| **Staged** | adds Unstage and Commit Selected |
| **Conflicted** | its own menu entirely — the four ways out of the conflict first, and **no staging or discarding at all**. Staging a file with conflict markers still in it is the mistake this prevents, and "discard the changes" is meaningless when there are two sides of them |

**Unbuilt features are absent, not greyed** — a disabled row says "this exists and you cannot have it", which is right for something blocked by state and wrong for something we have not written. The one exception is `Stage Hunk` / `Stage Selected Lines`, shown disabled and labelled *Index Editor*, because their absence from a file menu would read as an oversight rather than as a feature that has not landed.

**Destructive actions are data, not special cases.** The menu model marks them; one gate in `useFileMenuActions` confirms every one through a native dialog. Adding a destructive item cannot forget its confirmation.

New plumbing this needed: `shellapi.OpenPath` and `OpenTerminal`, `fsapi.DeletePath` (deliberately non-recursive — a recursive delete reachable from the frontend is one wrong path away from removing a working tree), `WorkingTreeService.removeFromDisk` / `revert` / `resolveUsing` / `move`, and clipboard access through the Wails runtime rather than `navigator.clipboard`, which needs a secure context the webview does not grant.

Verified live against a repository holding a modified, a staged, an untracked and a conflicted file:

| | Result |
|---|---|
| Menu shape | Modified and untracked menus matched the model exactly, including `Add` rather than `Stage` |
| Submenu | `Ignore by Name` / `Ignore *.ts` / `Edit .gitignore`, with the extension read from the file |
| Ignore | `Ignore *.log` wrote `*.log` to a `.gitignore` that did not exist, and the file left the list |
| File Log | Journal filtered to `src/app.ts` with a sticky bar and "Show all" |
| Copy Relative Path | `src/app.ts` on the system clipboard, confirmed with `pbpaste` |

**Three bugs the live run caught, two of them mine from earlier work:**

1. **`OpenExternal` refuses file paths** — by design, so a hostile remote URL cannot become a local `open`. Which means the merge tool's "Edit in editor", shipped in the previous session, **never worked**: it passed a path to a function that only accepts http/https/mailto. Fixed by adding `OpenPath` and pointing both callers at it. The security property is intact — the new call takes a path, and its callers pass paths from `git status`, not strings from repository content.
2. **The submenu rendered as an empty sliver.** The parent menu needs `overflow-y: auto` to scroll, and CSS computes `overflow-x: visible` to `auto` the moment the other axis is not visible — so the submenu was clipped at the parent's right edge. Portalled it, like the parent, which is the same fix for a sharper version of the same problem.
3. **Every menu item was unclickable.** The dismiss listener is on `window` in the capture phase, so it ran before the event reached any React handler and the menu unmounted on mousedown — no click ever landed. `stopPropagation` inside the menu cannot fix that because it is already too late. The menu surfaces now carry a `data-context-menu` attribute and the listener tests `closest()` instead, which also covers submenus in their own portals.

**Left out, and why:**

- **Stage Hunk / Stage Selected Lines** — this is the Index Editor (a menubar button in its own right). It needs patch construction and `git apply --cached`, not a menu entry.
- **Open With, Open in External Compare Tool, Open in External Editor** — all three name a *configured* tool, and there is no settings surface yet (§9.8). `Open` uses the OS default handler, which for a source file is usually the user's editor anyway.
- **Annotate (Blame)** and **Compare Against HEAD** — both need a view that does not exist; Blame is its own menubar button. `File Log` is the one History item that could be real today, so it is.
- **Properties** — a file-info panel of its own, overlapping what a future file view will show.

### ✅ Phase 6.3 — the merge wizard

The other half of §9.3: picking what to merge, and **seeing what it would do before it does it**.

`git merge` says whether it fast-forwarded or made a commit *after* the fact, and by then a merge bubble is in the history. Two commit counts answer it in advance — `HEAD..<ref>` for what is coming in, `<ref>..HEAD` for what we have that the ref does not:

| incoming | outgoing | shape |
|---|---|---|
| 0 | any | already up to date; Merge is disabled |
| >0 | 0 | fast-forward — linear, no merge commit |
| >0 | >0 | diverged — a merge commit is needed |

`--ff-only` is **disabled, not offered**, on a diverged pair. Offering it produces git's `hint: Diverging branches can't be fast-forwarded` and exit 128 — an error for a choice the UI should never have allowed. Dimmed rather than hidden, because "you cannot fast-forward this" is information and a control that vanishes leaves the user hunting for it.

**One Merge button, routed by state.** Conflicts on the floor open the resolver; a clean tree opens the wizard. Offering a branch picker mid-conflict would invite starting a second merge on top of an unfinished one, which git refuses anyway. A conflicted result closes the wizard and opens the resolver on it, which is the only useful next step.

**`Abort` is now real** — `merge --abort`, behind a native confirm. It does not check whether a merge is in progress first: git answers that itself (`fatal: There is no merge to abort (MERGE_HEAD missing)`), and a check of ours would be a second, staler opinion about the same question.

Verified live on a repo with one fast-forwardable branch and one diverged:

| | Result |
|---|---|
| Fast-forward preview | "2 commits would move onto **main** with no merge commit" — matching `rev-list --count` exactly; both commits listed |
| Diverged preview | "Merge commit. …1 commit to bring into **main**, which also has commits **feature/diverged** does not" |
| `--ff-only` | Enabled for the fast-forwardable branch, greyed with "Not possible: the branches have diverged" for the other |
| Message field | Disabled on a fast-forward, which writes no commit |
| Conflicted merge | Wizard closed, resolver opened on `config.ts` with the single conflict |
| Fast-forward run | Linear history, **one parent, no merge commit**, `main` == `feature/ahead` |
| Abort | Restored `main` and cleared `MERGE_HEAD`; the watcher returned the UI to clean unprompted |

**The outgoing side deliberately has no number.** Its query asks for one commit, because all it has to answer is "any?" — so the summary says "which also has commits X does not" rather than naming a count that would be the query's limit, not the repository's truth. The incoming count is capped at 50 and renders as `50+` past it.

**Not exercised interactively**: the abort confirmation (a native window the browser automation cannot answer — the command behind it was run directly), and `--no-ff` / `--squash`, which pass straight to `MergeService` and were verified in Phase 2.

### ✅ Phase 6.3 (part) — the three-way merge tool

**Merge/diff tooling is built in, not delegated to an external tool** — this settles the §14 question. The escape hatch is the user's own editor rather than a configured diff tool.

A modal over the workspace, three columns, **result in the middle** so each side is adjacent to what it would produce. Opened from the Merge button, `Branch ▸ Merge`, or a `Resolve` button that appears on conflicted rows in the Files panel.

**Every region where the sides differ is a decision, not only the conflicts.** The regions git resolved on its own arrive with a side already chosen and can be overridden; conflicts arrive with nothing chosen, and `Save & mark resolved` stays disabled until each has an answer.

**Git does the diffing.** Both sides are diffed against the merge base with `git diff -U0 <baseOid> <sideOid>`, so the hunks share a coordinate system and can be laid over one another: edits touching the same base lines are a conflict, edits that do not are independent. Writing our own line differ would have meant a second opinion about a merge git has already performed. `-U0` is essential — with context the hunks grow until they touch and two independent edits merge into one region.

**The three sides come from the index, never from the markers.** `status --porcelain=v2` reports an unmerged path with its three stage hashes (1 base, 2 ours, 3 theirs), each an ordinary blob. The `<<<<<<<` markers in the working file are git's *rendering* of the conflict; a user who already edited that file would have broken them, and the stages cannot be broken by accident.

Verified live on a scratch repo whose conflict had one genuine clash and two auto-resolved regions:

| | Result |
|---|---|
| Regions | 1 conflict (`retries`/`timeout`), 2 `auto: theirs`, shared text as context — matching git exactly |
| Empty side | Ours showed `(nothing)` for a line only theirs added |
| Override | Forced an auto-resolved region back to ours; the label said `overridden` |
| Save | File on disk byte-exact, no markers, staged, and `git commit` completed the merge |
| Guard | `Save & mark resolved` disabled while the conflict was undecided |

**Decisions worth keeping:**

- **A conflict has no default.** Undecided regions contribute nothing to the result rather than something plausible — the middle column shows a gap where the decision belongs. Silently defaulting is how a merge tool loses somebody's work.
- **After an external edit, the file wins.** "Edit in editor" writes the resolution so far *first* (opening a file still full of markers would throw away the work already done), then opens it and reads it back. From then on region choices stop driving the result and a banner says so — two sources of truth for one file is worse than either.
- **`agreed` is not `conflict`.** Both sides making the identical change is not a decision, and marking it as one would bury the real conflicts.
- **Edits that merely touch are one region.** A deletion of base lines 3–4 and an insertion at line 4 cannot be applied independently, so they group — which is what diff3 does.
- **The label says what git did; the highlighted button says what is chosen.** When they disagree the label says `overridden`, because "auto: theirs" over a result showing ours reads as a bug.

**A layering bug the live run caught**: the modal rendered at `z-index: 100` and lost to the top menu (200) and the menubar (100), so its own header and column titles were painted over and appeared to be missing off the top of the window. Now 1000, still below the toasts at 9999 — which report what the modal does.

**Not built here**: starting a merge. That needs a branch picker, and the Merge button says so rather than opening an empty resolver.

### ✅ Files panel — a Status column instead of sections

The mockup's "Staged Changes (n)" / "Changes (n)" section headers are gone; the Files panel is one flat, path-sorted list with a **Status** column.

**The column carries two badges, because git's status does.** Porcelain reports an **XY** pair — X for the index, Y for the working tree — and a file staged and then edited again has a different status in each (`AM`: added, then modified). One badge would have to drop one of them, and those two halves are also two different patches. So the column is positional: left is what is going into the commit, right is what is not, and a dot holds the slot of an unchanged side. Blank would let the eye slide the badges left and read an unstaged change as a staged one.

Clicking either badge opens that side's diff and the badge takes an accent ring, so the row highlight says *which file* and the ring says *which half of it*. Clicking the row body takes the working tree when both sides have changes — that is the change still being worked on; the staged half is already decided.

Verified live on `test-repo1` with `Header.tsx` made `MM`: the two badges rendered side by side, the left one opened the staged patch (`@@ -1,12 +1,13 @@`, +4 −3) and the right one the unstaged patch (`@@ -13,3 +13,5 @@`, +2 −0). Restored with `checkout --`; status and HEAD unchanged.

**Two things noticed while verifying, neither in scope here:**

1. **A repository row survives its directory.** `live-scratch` still lists on the dashboard although the path it points at was deleted with an old scratch directory. Opening it will fail on the first git call. The dashboard needs an existence check, or a "missing" state — Phase 6.7.
2. ~~**`Copy Diff` in the Changes header still fires a toast and copies nothing.**~~ **Resolved** — `features/diff/useCopyDiff.ts`, wired into both views.

### ✅ Phase 6.6 — search

Item 6, and it splits in two along a line worth naming: **branches, remote branches and working-tree files are already in memory, so filtering them is a predicate; commits are not, so searching them is a git command.** Two mechanisms, deliberately, because pretending otherwise means either running `git log` to filter eight branches or holding a million commits in a store to `Array.filter` them.

**Commits — the Journal search bar** (the mockup's L755 Search button, made real).

The design question was what a bare word means. `git log --grep` takes a **regex** and **ORs** multiple patterns, so git's literal reading of `fix parser` is "matches /fix/ or /parser/" — not what anyone typing two words into a search box wants, and worse the moment they search for `v1.2` and `.` starts matching anything. So `features/search/commitQuery.ts` inverts all three defaults: **fixed strings, case-insensitive, ANDed** (`--all-match`). A regex is still reachable by writing the term as `/…/`, which keeps it visible in the query rather than hidden behind a toggle.

Qualifiers are the syntax every code host has trained people on — `author:`/`by:`, `path:`/`file:`/`in:`, `since:`/`after:`, `until:`/`before:` — with quoting (`author:"Ivan Marinković"`, `since:"2 weeks ago"`). An **unrecognised** `key:value` is searched as literal text rather than rejected: `TODO:refactor` is a plausible thing to look for, and the chips under the box are what reveal that `autor:ivan` was read as text, not as an author.

Four things the implementation turns on, each with a test that fails without it:

| | Why it matters |
|---|---|
| **Pattern type is one flag for the whole command** | `--fixed-strings` / `--extended-regexp` govern *every* limiting pattern including `--author`, so a query mixing `v1.2` with `/parse.*/` cannot be expressed as-is — it has to pick extended-regexp and **escape the literals into it**. Getting this backwards silently turns `v1.2` into a pattern matching `v1x2` |
| **The flag must precede its patterns** | Git's parser applies it to what follows. `--grep=x --fixed-strings` is accepted and reads the pattern as a regex anyway — no error, no exit code, just wrong rows |
| **`--flag=value`, never two arguments** | A search for `-v` passed separately is read as an option, and a leading dash is exactly what ends up in a commit message |
| **A bare `path:` value is wrapped as `:(icase)*value*`** | `file:log` should find `services/git/parsers/log.ts`; git's wildcards cross `/`, so one star each side reaches any depth. A value already containing `/` or `*` is passed through — at that point the user is writing a pathspec, not a word |

**A search implies `--all`.** Searching only the current branch would miss the commit being hunted for whenever it is on another one, which is most of the time — or the user would already know where it was.

**The graph is not drawn over a filtered log.** `buildGraph` expects a contiguous walk; over a filtered set almost no commit's parent is present, so every row becomes a branch tip, opens its own lane, and the output is a staircase widening by one column per result. This also fixes the same latent bug in the existing File Log filter.

**Panels — `FilterBox` + `matchText.ts`.** Substring per space-separated term, ANDed: strict enough that `git log` matches `parsers/log.ts` and not `GitRunner.ts`, loose enough that a path need not be typed in full. Fuzzy matching was rejected for keeping every list non-empty — a filter that never says "nothing" is one you stop trusting. State lives in `workspaceStore.panelFilters` keyed by panel, using the `tagPromptOid` idiom already in that store: **the value is the open state** (`null` closed, `''` open and matching everything), so a bar can never be dismissed while its list stays filtered.

Typing is local to the input and pushes to the store on a 250ms pause. The store value is a query key, so writing per keystroke would start a `git log` per character — seven of the eight for "parser" already stale on arrival.

Verified live against `test-repo1`:

| Query | Result |
|---|---|
| `author:sarah dark` | **0** — correct: "Add dark mode theme variables" is Alex Chen's |
| `author:sarah` | **3**, one of them on `fix/memory-leak`, an unchecked-out branch — the `--all` widening |
| `file:header` | **1**, and `git log --all --oneline -- ':(icase)*header*'` returns the same single commit. The seed's "Refactor header component" does not match because it touches `src/legacy/OldWidget.tsx` — the fixture's message and its files disagree, the app does not |
| Branches `feature` | 2 of 8 |
| Files `components tsx` | 3 of 10 — two terms ANDed across one path |
| Origin Branch `stack end` | 1 of 2, matched on the **commit subject**, not the ref name |

All three filters were open at once in different panels, and Escape closed and cleared each.

**The mockup's second Journal button** (the funnel at L755) now opens the same box primed with `path:`. Two independent filter mechanisms over one list could only ever disagree, and the search bar already does what a filter there would mean.

**Not built**: a tag list to filter — tags exist only as commit decorations, so `tag:` has nothing to filter *in*; **content search** (`git grep`), which needs a results surface of its own rather than a commit list; and the FTS5 index, still Phase 7 and still unmotivated — `git log --grep` over `test-repo1` returns instantly, and the index should be added against a measurement, not a plan.

### ✅ Phase 6.7 — file explorer

Item 7. The Files panel gained a **Changes | Tree** tab strip rather than a new panel: the mockup's layout has no room for one, both tabs answer "which file" with one of them filtered to what changed, and keeping them under one header keeps one selection driving one Changes pane.

**The tree is read from the filesystem, not from git.** `git ls-files` would build it in a single call — and it would be missing every file the user just created, which are the exact files someone opens an explorer to find. So each level is a `listDir` plus a `check-ignore`, fetched only when its directory is opened. `.git` is excluded by name; the PRD's 500k-file target is met by never walking more than the one directory that was expanded.

Two facts about `check-ignore` that the tests pin down, because both fail quietly:

- **Exit 1 is the answer "none of them"**, not a failure. `check-ignore` reports its result in the exit status, so classifying 1 as an error makes every unignored directory in the tree render as broken.
- **Paths go in on stdin** (`--stdin -z`), never as argv. A directory listing can be thousands of entries containing spaces, quotes and newlines, and stdin has no quoting rules to get wrong.

Ignored files are shown, dimmed and tagged, rather than hidden — a tree that silently omits `node_modules` is a tree that disagrees with the user's own `ls`.

**Quick open (⌘P)** is the other half, and it inverts the trade deliberately: one `ls-files --cached --others --exclude-standard` for a flat corpus, because at the target size browsing to a file is thousands of rows of scrolling and typing three characters is not. Matching reuses §6.6's `matchText`, so `git log` behaves identically in the palette and in the Files filter box. It is mounted conditionally rather than self-hiding, which is what keeps the query and the highlight fresh without a reset effect. Results cap at 50 with the footer saying so — a silent cap reads as "that's all there is".

`ls-files` prints one line per *index entry*, so a conflicted path appears three times, once per stage. Quick open lists files, not index entries; it de-duplicates.

The tree's context menu (Open, Reveal in Finder, Copy Path, Show History) is deliberately **not** the Changes tab's menu. That one is built from a `StatusEntry` and offers staging and discarding, which mean nothing for a file with no changes — and most of a repository has none. `RevealInFinder` already existed in `shellapi` from the Phase 6 file menu; this reuses it.

Verified live against `test-repo1`:

| | Result |
|---|---|
| Tree | `src/` expanded to `components` `hooks` `pages` `styles`, correctly indented; `.git` absent |
| Status badges | `package.json` **M**, `.env.local` and `tsconfig.json` **?**, matching `git status --porcelain` exactly |
| Ignored | `src/.DS_Store` dimmed and tagged — and it is ignored via the user's **global** `core.excludesfile`, not any file in the repo. The tree inherits global ignore rules because `check-ignore` does |
| Quick open | `components tsx` → Header/Sidebar/Widget with their badges; Enter opened `Header.tsx`'s word diff |
| Clean file | Selecting `README.md` shows the Changes pane's empty state, not an error |
| Show History | Filtered the Journal to `README.md` and switched back to the Changes tab |

**Two fixes the live run produced:**

1. **`/src/components` instead of `src/components`.** Quick open truncates the directory column from the left via `direction: rtl`, and `fileDir` returns a trailing slash — a bidi-*neutral* character, which at the end of the string gets reordered to the visual left. Stripped at the call site.
2. **"No diff data available for this file"** now reads **"No changes in this file"**. Before the tree, every selectable file had changes, so that state only ever meant something had gone wrong. The tree makes every clean file in the repository selectable, which turns the message into the ordinary case — and describing a perfectly good answer as a missing response sends people looking for a bug.

**Not built**: a viewer for clean files. Selecting one says it is unchanged rather than rendering its contents — a read-only file viewer is a different surface from a diff pane, and the Changes panel is honest about not being one. Also deferred: the dashboard's missing-repository check noted earlier in this section, which is a dashboard concern rather than an explorer one.

### ✅ Phase 6.8 — settings, and the light theme

Item 8, and it pulled §14's open **light theme** question forward from Phase 8 rather than shipping an Appearance section with nothing in it.

**The "tokens only, never literal hex" rule (§7) was 90% true.** An audit found ~30 literal colours across 12 stylesheets — diff line fills, toast surfaces, modal scrims, the primary button's hover, the menubar's sheen. Each is now a token whose **dark value is exactly what the literal was**, so the dark theme is byte-identical to the mockup and the rule is now enforceable rather than aspirational. Two things needed no work at all: `LANE_COLORS` was already `var(--…)` references, so the commit graph themed itself.

Three things the light palette could not do by simply inverting:

| | Why |
|---|---|
| **The surface ramp inverts, it does not lighten** | In dark, `--bg-darkest` is the list body with a *lighter* `--bg-panel` header above it. Mapping each token to its lightness complement would put a darker body under a lighter header and every panel would read inside-out. The body becomes white and the chrome becomes grey — the ordering flips, not just the values |
| **The accent is not the mockup's gold** | #e8a838 on white is 1.9:1, and `--accent` is *text* — the commit hash, the active menu item, the ahead counter. Light uses #9a6700 (GitHub's own light amber) at 4.87:1. Dark keeps the mockup's value untouched |
| **Tints need different alpha, not a different hue** | 6% green over #0d1117 reads as a green wash; 6% green over white is invisible. The diff and toast fills are tokens with per-theme values rather than one hue at one opacity |

**Shiki follows the theme, and the theme is part of the cache key.** `github-light-default` joins `github-dark-default` — the same reasoning as §9.1's original choice, since its background is white, which is what `--bg-darkest` becomes. Both are registered once and selected per call. The key matters: Shiki *bakes colours into the tokens it returns*, so a run tokenized in dark is a different value, not the same value rendered differently. Without the theme in `useDiffHighlight`'s key the diff would keep serving dark hex after a switch and the code would stay unreadable until the file was reselected.

**The theme loads in `bootstrap`, before first render** — the one preference that does. Read it after the first paint and a user on a light desktop watches the app render fully dark and then switch, every launch. A failed settings read is *not* fatal, unlike a failed migration: starting in the wrong theme beats not starting.

The rest of the panel: **git path** (validated through `SetGitPath` and kept only if the binary answers `--version`, since it is the one setting that can break every other screen), **editor command**, and **credentials** — which reports rather than edits, because secrets live in the OS keychain and a UI implying moonGit holds a copy would be lying. `shellapi.OpenInEditor` is new and runs the command with **no shell**: that is its whole security posture, since without a shell there is no metacharacter for a path to inject through.

Nothing has a Save button. A preferences panel with pending state has to answer what escape means, and the answer people expect is "it already applied".

**Deliberate menu deviation**: `Preferences…` is added to the Repository menu — the first menu, since the mockup's bar has no app menu — and `menuConfig.test.ts` was updated with the reason rather than loosened. ⌘, and ⌘P are both bound on `window`.

**Verified live**, switching themes with the app in front of it: every panel, the side-by-side diff with its word marks, Shiki re-tokenizing light, the graph lanes, the badges, and the segmented control. Dark after a round trip is indistinguishable from before.

**A contrast measurement, run in the live DOM rather than by eye, caught a real defect and one inherited one:**

| Pair | First attempt | Now |
|---|---|---|
| light `--text-muted` on body | **3.73** ✗ | **5.25** ✓ |
| light `--text-muted` on panel | **3.50** ✗ | **4.93** ✓ |

`--text-muted` is panel header labels, commit timestamps and the directory half of every path — none of which qualify for the large-text exemption. #7d8590 became #656d76.

**Left standing, and worth naming: the *dark* theme fails the same check.** `--text-muted` on `--bg-darkest` measures **3.21:1**, and on the panel grey **2.93:1** — worse than the light value that was just rejected. That value is the mockup's, and §7 says the mockup's tokens must not drift, so changing it is a design decision rather than a fix to slip in here. **It belongs to Phase 8's a11y pass**, and it is now a measured number rather than a suspicion.

**Not built**: keybindings. The app has exactly three shortcuts (⌘P, ⌘,, ⌘Enter), and an editor for rebinding three things is a settings page for nothing. It belongs after there are bindings worth rebinding.

### ✅ Phase 6.9 — the terminal

Item 9: `internal/ptyapi` (creack/pty) under `features/terminal` (xterm.js). `shellapi.OpenTerminal` already launched Terminal.app at the repository, so this is not new *capability* — it is about not leaving the app to use it.

**A drawer, not a modal — the one presentation departure from Stash, Merge, Rebase and Settings.** Those are all sheets over the workspace, and that is right for them: each is a task you finish and dismiss. A terminal is not. `git rebase --continue` is run *while* reading the file list, and a sheet would cover the thing the command is about. It sits in the flex column after the view, so it takes height from the panels rather than floating over them, and the divider is the same `Resizer` every pane uses.

**ptyapi is gitexec's sibling, with one guarantee inverted.** gitexec sets `GIT_TERMINAL_PROMPT=0` so a credential prompt fails fast rather than hanging a process with no terminal attached. Here there *is* a terminal, so a prompt is a prompt — and being able to answer one is much of the reason to embed a shell.

| Decision | Why |
|---|---|
| **Base64 both directions** | A pty carries bytes. A read lands mid-rune, and plenty of what runs in a shell emits binary outright; `encoding/json` replaces every invalid sequence with U+FFFD silently. Exactly the trap `RunBase64` exists for. Input is encoded too — not because it must be, but because a second encoding for the other direction would be a second thing to get wrong, and arrow keys and control chords are escape sequences rather than text |
| **Login shell (`-l`), and `$SHELL` before any default** | What Terminal.app does. Skip it and the shell never reads `.zprofile`, so `PATH` is missing everything `path_helper` and the user's profile add — very often including the git and node the rest of their tooling expects |
| **Output batched on an 8 ms tick, flushed early at 128 KB** | A shell outruns the bridge easily (`yes`, a build, a large `git log`). Per-read events would drown the frontend; batching bounds the rate to ~125/s however loud the process is. The reader is a separate goroutine feeding a bounded channel, so a process louder than the bridge blocks on the pty — backpressure through the terminal, rather than dropped output |
| **Closing the master, not signalling the shell** | Closing the pty master makes the kernel send SIGHUP to the whole foreground process group — the shell *and* whatever it is running. Signalling the shell alone would orphan a running build with a half-dead terminal. A 2 s grace then a hard kill covers a shell that ignores the hangup |

**`OnShutdown` had to learn about it, and this is the part that would have been a real bug.** A terminal session is a child *process*, not a subscription: closing the window does not end it. Verified by quitting the app with six sessions open (the dev-reload leak below) and confirming every `zsh` was gone.

**Two ordering bugs, one of them only findable by using it.** Typing `git status -sb` into the running app produced `git sattus  - i gb slotg` in the shell — the characters genuinely reordered in flight, because every keystroke was its own promise across the bridge with no ordering between them. `inputQueue.ts` now keeps one write in flight and accumulates the rest, which also turns a twenty-key burst into one call. `term.onResize` had the same hazard for the same reason — a drag fires on every mouse move, and out-of-order arrivals would leave the pty at a size from the middle of the drag — so those are chained too.

**Resize is answered twice, deliberately.** A `ResizeObserver` on the host is the general answer and covers the window and the panes above rearranging. But it only delivers during the rendering lifecycle, so anything that starves the page of frames starves the terminal of its size — which is not hypothetical: the browser-automation tab used for verification produced no animation frames at all, and the drawer could be dragged with the grid never refitting while `tput lines` kept reporting the old value. The drag has a cause that can be observed directly, so `terminalH` drives a refit as well. One effect, and the path no longer depends on frame delivery.

**xterm cannot read CSS variables** — it paints to a canvas and wants 20 resolved colours up front. So the theme is pushed into it on change, the same lesson as Shiki's baked-in colours in §9.1, and 20 tokens joined `tokens.css`: the 16 ANSI slots plus background, foreground, cursor and selection, in both themes. The ANSI palette is not ours to invent — `git status` picks "red" by number — so it is GitHub's, matching the Shiki themes already in use. In light, the *bright* variants are **darker** than their base counterparts, which is what "bright" has to mean on white if it is to mean anything; bright yellow on white is invisible, and shells use it for warnings.

**Lazy-loaded**, as §10 asks: xterm and the fit addon are a 333 KB chunk that only a session which opens the drawer pays for.

**Verified live** against `testGitHere/test-repo1`: a real zsh in the repository, coloured `git status`/`git log` output, theme switched under a running session with no restart, `exit` reporting `[session ended]` with a New session button, and `tput lines`/`tput cols` matching the grid after a drag.

**A leak worth naming, and its limit.** A page *reload* never runs an effect cleanup, so `wails dev`'s reloads left orphaned shells — six of them by the end of a verification session, against a cap of 8. There is now a `pagehide` handler, and it is best-effort by construction: it posts an IPC message into a page that is being torn down, which the production WKWebView delivers synchronously but the dev websocket may drop. A packaged app never reloads, and `OnShutdown` is the real backstop.

**Not built**: multiple sessions per repository (tabs or a split), and a shell picker in Settings. The Go side takes both — `Open` is keyed by a caller-chosen session id and `OpenRequest.Shell` is honoured — but the UI is one drawer with one shell, which is what "run a git command without leaving the app" needs. Closing the drawer ends the session; the tooltip says so rather than letting a long-running command disappear quietly.

### ✅ Phase 6.10 — repository settings

Item 10, and the last of Phase 6. `services/git/ConfigService.ts`, `services/ignoreFiles.ts`, four new methods on `RemoteService`, and one panel in `features/repo-settings` with three sections.

**Three of the five areas the item names, chosen rather than defaulted to.** Config, ignore rules and remotes are the three with dead menu items already pointing at them — `repository.settings`, `remote.manage` and `local.ignore` were all `soon()` stubs — and all three are things a person edits by hand today. Hooks, LFS and submodules are named as not built at the end of this entry, with their reasons.

**Repository versus application is the distinction the panel exists to hold.** `SettingsModal` (§9's Phase 6.8 entry) edits moonGit's own preferences, which live in SQLite and follow the install. Everything here belongs to the repository: it lives in `.git/config` and `.gitignore`, the command line sees the same values, and a colleague who clones gets some of them. One panel for both would make "does this follow me to my other machine?" unanswerable. Nothing here is mirrored into SQLite either — git's files are the source of truth, the same rule §1.2 sets for refs and status.

| Decision | Why |
|---|---|
| **Config is read twice — `--local` and no scope at all** | A repository sets almost nothing. `user.email` is normally the global one, and an empty box for it would say "unset" when the truth is "the address every commit made here will carry". So each field resolves to **set here**, **inherited** (shown greyed, as a placeholder) or **not set**, and clearing a field runs `--unset` rather than writing `""` — different things to git |
| **Seven keys have controls; every other local key is listed read-only underneath** | The panel writes to the same file the user's own `git config` does. Showing only the seven would imply the rest is not there, and a repository with a `core.hooksPath` or an `includeIf` behaves in a way no form explains. The list is the panel declining to lie by omission — not a config editor, which would be a worse text editor than the one in the terminal drawer |
| **Keys and values are validated before they reach argv** | `git config --local` takes its key *positionally*, so a "key" of `--global` would be read as an option and quietly write the user's global file. There is no `--` separator to hide behind, so `isValidConfigKey` refuses anything that is not `section[.subsection].name` and `isSafeConfigValue` refuses a leading dash. Every key today comes from a fixed list in the UI; the guard belongs next to the command, not in the caller that happens to be safe |
| **The Ignore tab has a Save button** — the deliberate exception to §6.8's rule | Preferences apply on change because a half-set preference is still a preference. A half-typed ignore rule is not: it is a *file* in an intermediate state, which the next `git add` would commit, and every keystroke would wake the watcher to re-run `status` against rules nobody has finished writing |
| **Two ignore files, not three** | `.gitignore` is committed and shared; `.git/info/exclude` is neither. "Ignore this, but only for me" — a scratch directory, an editor's droppings — is a real intention, and serving it from `.gitignore` means committing a rule that is nobody else's business. The third layer, `core.excludesFile`, is deliberately absent: it is not part of *this* repository, and changing every repository at once from a repository panel would be a surprise |
| **`ruleForPath` and the duplicate check moved into `services/ignoreFiles`** | The Files panel's "Ignore by Name" and this editor must not disagree about what counts as the same rule. `!build` is not `build` and `/dist` is not `dist` — both change what git does — and getting that wrong in one of two implementations silently drops rules in whichever one is wrong |
| **A remote's URL is an editable field; its name is a button** | `git remote rename` is not a config edit. It rewrites `refs/remotes/<old>/*` and every branch's `branch.*.remote`, so a branch that tracked `origin/main` still tracks it afterwards — and a text box that ran that when focus moved is the wrong shape for it. Remote names are validated against git's own ref rules for the same reason config keys are: the name becomes a ref path, and `git remote add` has no `--` either |
| **Remote URLs are checked for argv safety and nothing else** | `git@host:org/repo.git`, `../sibling`, `file:///srv/git/x` and `ssh://…` are all legitimate. A validator strict enough to be worth having would reject something real, so the only exclusions are a leading dash and whitespace |
| **The open tab is part of the open state, not remembered separately** | Three menu items open this panel at three different places. A remembered "last tab" would make two of the three land somewhere other than where the user aimed |
| **Fields are keyed by their resolved value, so a write remounts them** | Rather than an effect syncing a draft to a refetch. Same outcome, one fewer place for the two to disagree, and no frame that shows the old value before the effect corrects it |

**Verified live** against `testGitHere/test-repo1`, with every write checked against `git config`/`git remote` on disk afterwards, and the repository restored to its starting state:

| Path | Result |
|---|---|
| `user.email` typed, Enter | `git config --local` has it; the row flips `inherited` → `set here` |
| the same field cleared | key gone from `.git/config`, row falls back to the greyed global address |
| `core.autocrlf` → `input` | written; and the read-only list below correctly excludes the managed keys while showing `remote.origin.*`, `branch.*` and the keys git wrote at init |
| `.gitignore` written from empty | file created, trailing newline present |
| a rule added to `.git/info/exclude` | `.env.local` **left the Files panel live** — the watcher saw the file, `status` re-ran, no refresh |
| switching ignore files while dirty | native "Discard changes?" alert; Cancel keeps the draft, and Revert restores the on-disk text |
| remote add / rename / retarget | all three on disk, and `rename` moved the fetch refspec with it |
| remote remove | native confirm naming the remote; Cancel removes nothing, Remove does |
| Escape, and the backdrop | both close the panel |
| switching repositories | the panel is repo-scoped — reopened against `test-repo2` it shows that repository's remotes and identity |

**One rough edge found while verifying, not a bug**: the config and remote queries are cached, so a change made on the command line while the panel is open is not noticed until some mutation invalidates them. The watcher covers the working tree, not `.git/config`. Left as is — a panel that refetched on every `.git` write would be re-running `git config` during a rebase.

**Not built, and why**: **hooks** — listing and toggling them is easy, but the useful version opens and edits a shell script, which is an editor feature and not a settings one. **LFS** — untestable here: no LFS repository exists in `testGitHere`, and shipping a panel verified only against a repository without the thing it manages is worse than not shipping it. **Submodules** — init, update, sync and their failure modes are a feature in their own right, not a tab; it belongs beside the branch and merge work, not under Settings. All three keep their `soon()` stubs, which say what they are rather than pretending to exist.

608 frontend tests pass (66 new, in `config.test.ts` and `ignoreFiles.test.ts`), and `tsc --noEmit` is clean.

### ✅ Phase 6.11 — the native menu bar

The window has had an application menubar since Phase 4, because the mockup drew one. macOS also gives every app a menu bar of its own, and until now this one held `moonGit`, `Edit` and `Window` — Wails' default, and none of it the application's. `internal/appmenu` puts Repository, Local, Branch, Remote, Query and Help where a Mac user looks for them.

**Both menus exist, deliberately.** The in-window bar is the design's, and it is also load-bearing: the window is `TitleBarHiddenInset`, so that strip is the inset that clears the traffic lights *and* the only `--wails-draggable` region — removing it would take the window's drag handle with it. The native bar is where macOS puts an app's menu whether the app agrees or not. What matters is that they cannot disagree.

| Decision | Why |
|---|---|
| **The structure is pushed from the frontend, not declared in Go** | `menuConfig.ts` already holds it as data and the in-window bar is drawn from it. A second copy in `main.go` would be a second place to add an item to, and forgetting one would produce two menus that quietly differ — with nothing failing to compile. So `appmenu.Service` is a native capability and nothing else, like every other service under `internal/` (§4): it knows how to build an NSMenu and how to report a click, and what the items *mean* stays in TypeScript next to the handlers |
| **A click emits the item's own `MenuItemId`** | Both surfaces land in `useMenuActions`, which is already a `Record<MenuItemId, …>` — so an item can never do one thing in the window and another in the menu bar, and adding one still fails to compile until it is wired |
| **The id is guarded on arrival, not cast** | It crosses a process boundary. `isMenuItemId` drops anything unrecognised rather than indexing a map with it — the difference between a no-op and a crash if the two sides ever fall out of step |
| **No accelerators on the native items** | The frontend owns the app's shortcuts (⌘P, ⌘,, ⌃`). A native accelerator for the same action would fire *alongside* the frontend's handler rather than instead of it: two handlers, one keystroke |
| **No Window menu** | Its contents do not work in a frameless window, which this one is |
| **Edit stays, and this is the one that was nearly wrong** | The ask was a menu bar holding `moonGit` and the app's own menus, nothing else. Removing Edit costs ⌘C/⌘X/⌘V/⌘A/⌘Z **app-wide**: macOS routes those key equivalents through menu items, and with no Edit menu there are none for WKWebView to inherit. Measured rather than assumed — see below. Wails v2 exposes whole-menu roles only (`AppMenu`, `EditMenu`, `WindowMenu`), so there is no per-item Copy role to hide inside the app menu. A visible Edit menu is the price of a working ⌘V, and in a client whose daily work is pasting a remote URL and copying a SHA that is not a close call |

**The clipboard measurement.** Same keystroke sequence both times — type into Quick Open, ⌘A, ⌘C — with the system clipboard primed with a sentinel first:

| Menu bar | Clipboard after ⌘C |
|---|---|
| `moonGit` + the six | unchanged — the sentinel survived |
| `moonGit` + `Edit` + the six | the typed text |

A control ruled out the obvious alternative explanation: ⌃` sent the same way opened the terminal drawer and spawned a shell, so the keystrokes were reaching the app.

**Verified live** against the running app, read back through the accessibility API rather than by eye: the bar reads `moonGit · Edit · Repository · Local · Branch · Remote · Query · Help`; every menu's items match `menuConfig.ts` item for item, separators included; **Repository → Terminal** clicked from the native bar opened the drawer and spawned a real `zsh`, which is the whole path — Go callback → `menu:action` → guard → handler map.

**One free win.** macOS retitles a menu item called `Preferences…` to `Settings…` on Ventura and later, so the native menu says `Settings…` while the in-window one still says `Preferences…`. Each bar matches its own convention, from one source.

615 frontend tests pass (7 new, for `isMenuItemId`), `tsc --noEmit`, `go build ./...` and `go vet ./...` are clean.

### ✅ Phase 6.12 — the Files panel's path column and status filters

**The one entry in this section written before the work rather than after it**, and left standing below so the plan and the result can be compared. Everything it planned was built; the four places reality argued back are recorded at the end. Two changes to the Files panel, agreed 2026-08-04 and independent of each other.

#### A. `STATUS | FILE | PATH`

`FileList`'s row puts the filename and its directory in one cell, back to back, which renders as `Header.tsxsrc/components/`. The directory moves to a column of its own.

| Decision | Why |
|---|---|
| **The header and the rows become one grid** | They are two independent flex rows today. That survives two columns of which one is fixed-width; it does not survive a third whose width depends on the content, and the header would drift off the rows as soon as a path got long |
| **PATH truncates from the left** | `…/components/` is informative and `src/comp…` is not — the leaf directory is the part that identifies the file, and it is at the end |
| **The rename split is fixed on the way past** | `displayPath` returns `old → new`, and the current row runs `fileDir()` over that whole string — so a rename's "directory" today is `src/legacy/OldWidget.tsx → src/components/`. Two columns make the right answer expressible: FILE is `OldWidget.tsx → Widget.tsx`, PATH is `src/legacy/ → src/components/`. This is a bug the column removes rather than a feature it adds |
| **The split is a pure function in `statusDisplay.ts`** | Rename-aware name/dir is the only interesting part, and that file already holds `displayPath`, `sidesOf` and `defaultSide` for the same reason: the decisions are testable without a DOM |

The `submodule` marker, which currently trails the path cell, moves into PATH as a suffix.

#### B. Status filter chips in the tabs row

Seven toggles, right-aligned in the `Changes | Tree` row. Hidden on the Tree tab — the tree is not status-driven, and a control that cannot affect what is on screen is a control that lies.

| Chip | Matches | Role |
|---|---|---|
| Staged | index half non-`.` | asked for; also half the coverage floor |
| Not staged | worktree half non-`.` | asked for; the other half |
| Added | index `A` | refinement |
| Untracked | `kind: 'untracked'` | outside the staged/unstaged axis |
| Deleted | either half `D` | refinement |
| Conflicted | `kind: 'unmerged'` | outside the axis, and never safe to hide during a merge |
| Ignored | `kind: 'ignored'` | asked for; the expensive one, below |

**Why seven is enough, and why there is no Modified or Renamed chip.** Every tracked change has an XY pair, so it is staged or unstaged or both — those two chips already reach Modified, Renamed, Copied and Typechange. The only entries with no XY pair are untracked, unmerged and ignored, which is exactly what the other chips add. Adding a chip per badge letter would be enumeration for its own sake; the invariant that matters is that **nothing on screen can be filtered into being unreachable**, and five of the seven are what establish it.

| Decision | Why |
|---|---|
| **Glyphs are `StatusBadge`'s own letters and colours** | The STATUS column already teaches `M A D ? R !`. A second vocabulary for the same facts, in a row 30px away from the first, would be two things to learn for one idea |
| **None selected shows everything; any selected is an OR** | The natural reading of "show only what I picked". It does mean Staged + Deleted shows staged-anything *plus* deleted-anything, not staged deletions — if the intersection is ever wanted, the side chips and the status chips become two groups ANDed together, which is a change to the predicate and nothing else |
| **The predicate is pure and fixture-tested** | `parsers/__fixtures__/status.ts` already holds real porcelain captured from git 2.47.1. A filter that decides what the user can see should be asserted against real `AM`/`RM`/`UU` rows, not against hand-written objects that agree with the implementation |
| **ANDed with the existing text FilterBox** | They answer different questions ("which kind" and "which name"), and the `n of m` count reflects both |
| **Persisted as a *preference*, not a layout** | It is a choice, like `diff.viewMode`, so it goes through `layoutPersistence`'s preference path. It also survives a repository switch, unlike the text filters, which reset: a way of working travels with the user, a selection belongs to the thing selected |
| **Icon-only at narrow widths** | The Files pane can sit at ~300px, and seven chips share that row with two tabs and a count. To be checked live at the minimum pane width rather than assumed |

**Ignored is not a UI change, and it is most of the work.** `STATUS_ARGS` deliberately omits `--ignored` (`parsers/status.ts`), so the parser's `ignored` kind is currently unreachable and `FileList` filters it out defensively. The chip needs a second query: enabled only while it is on, its own key, a long `staleTime`, **not** invalidated by the watcher, and `--directory`-collapsed so a repository with `node_modules` produces one row rather than thirty thousand. Two consequences to accept rather than engineer away: switching the chip on has a visible pause on a large repository, and because chips persist, that pause happens at launch if it was left on. Ignored rows have no XY pair, so they get their own muted badge instead of the two empty dots the STATUS column would otherwise show.

**Also needed**: an empty state for "the chips hid everything" that offers to clear them, distinct from today's "No files match this filter".

**Order**: A first (three files, self-contained), then the six cheap chips, then Ignored — it is the only piece that touches the query layer, and the only one that can be slow.

#### What the work changed about the plan

Built: `splitPath` in `statusDisplay.ts`, `statusFilters.ts`, `IGNORED_STATUS_ARGS` + `RepositoryService.ignored`, `gitKeys.ignored` + `useIgnoredFiles`, `statusFilters` on the workspace store persisted through `layoutPersistence`, and the grid in `FileList` / chips in `FilesPane`. 637 frontend tests (22 new), `tsc`, `eslint`, `go vet` clean.

**Five things measured rather than assumed, four of which changed the design:**

1. **`git status` has no `--directory` option.** The plan named it; it belongs to `ls-files`, and passing it is `error: unknown option 'directory'`. The collapse that makes the Ignored chip viable comes from `--ignored` (traditional) together with **`--untracked-files=normal`** — `=all` defeats it. On this repository that is **6 rows against 18,163**. Also unstated in the plan and load-bearing: `--ignored` *adds* the `!` records to an otherwise normal status rather than replacing it, so the service has to select them or the caller gets a second copy of every file it already has.

2. **A conflict wears `AA`, so the letter chips claimed it.** `index === 'A'` put `conflict.txt` under Added — while the row itself shows `!` on both sides, because `displayStatus` had already decided an unmerged path's XY letters describe *how* it conflicts rather than what happened to it. The rule is now explicit: **a chip matches an entry when the entry's own row could wear that chip's glyph.** Added and Deleted therefore exclude unmerged; the two axis chips still match it, deliberately, because the row does show a badge on both sides and a merge in progress is the worst moment for conflicts to drop out of a list. A unit test caught this, but only because the fixture was real porcelain — hand-written entries would have carried the same wrong assumption as the code.

3. **The empty state's escape hatch was below the fold.** "Clear status filters" rendered at y=327 in a panel body ending at y=317 — in a panel whose entire content was the message telling the user to press it. Two causes: `EmptyState` claims `height: 100%` for its own centring, and the sticky column header ate 27px of a pane that routinely sits at ~115px. Fixed by centring on the wrapper instead, and by **not rendering a column header over no columns of data** — which also removes the odd sight of `STATUS FILE PATH` sitting above "no files match". Found by measuring the DOM rather than by looking at the screenshot, where it simply appeared absent.

4. **Chips wrap; they do not collapse to icons.** The plan said icon-only at narrow widths. Two of the seven are *positions* in the XY pair rather than status letters and have no glyph to collapse to, and inventing one would add a vocabulary to a row whose whole argument is that it borrows the one below it. The group wraps to a second line instead — measured at 520/420/360/300px: the row grows from 29px to 52px at ≤360px and nothing overflows at any width down to 300.

5. **Ignored is `I`, not git's `!!`.** Porcelain v1 writes ignored as `!!`, but `!` is already spent on conflicted here, and a grey `!` beside a red one is the one confusion in this vocabulary that costs something — it pairs "nothing to do" with "stop and fix this".

**One thing the plan did not anticipate at all**: `mutations.ts`'s `refresh` invalidates `[repoPath]`, which is a prefix of every key including the new one — so *every* stage, commit and checkout would have re-walked `node_modules` while the chip was on, at the highest frequency in the app. `refresh` now excludes it by predicate and `useWriteIgnoreFile` asks for it explicitly. Keeping it out of `keysToInvalidate` was necessary but not sufficient.

**Verified live** against `testGitHere/test-repo1`, seeded with an ignored directory, an ignored file and a root→subdirectory rename for the occasion, then restored — final `git status` byte-identical to the starting state, HEAD unmoved at `d564383`:

| | Result |
|---|---|
| Columns | Header and rows both computed `52px 486.5px 486.5px` — read out of the live DOM, since the whole reason for one template is that they cannot drift |
| Rename split | `OldWidget.tsx → Widget.tsx` in FILE, `src/legacy → src/components` in PATH. The old row rendered that entire string as the directory |
| Pure move | `package.json` with PATH `. → config` and no arrow in FILE — the half the rename left alone is not repeated |
| Bidi | The `→` and the leading `.` stayed put under the left-truncating `direction: rtl`. `unicode-bidi: plaintext` on an inner span, since it overrides `direction` on the element it sits on |
| Staged | 5 rows, exactly the non-`.` index halves git reports |
| Deleted | 1 row, the `.D` file — and `git status` agreed |
| Ignored | `.env.local`, `src/.DS_Store` (via the user's **global** `core.excludesfile`) and **`vendor/` as a single collapsed row**, its trailing slash intact in the FILE column |
| Text filter | ANDed with the chips: `components` over Staged+Ignored gave 3 rows and `3 of 12` |
| Persistence | Both chips survived a reload, and the ignored query re-ran at launch — the accepted consequence, now observed |
| Repository switch | Chips survived it; `test-repo2`'s two staged files matched `git status` and its lack of ignored files showed as nothing added |
| Tree tab | Chips hidden, selection preserved on return |
| Review view | Same columns, same chips, same state |

**Not exercised**: the Ignored chip against a genuinely large repository. `vendor/` proves the collapse; it does not measure the pause the plan warns about. The honest test is this repository's own 18,163 ignored files, and it belongs with the §10 performance work, where there is somewhere to record the number.

### ✅ The white flash at launch, and why `BackgroundColour` did not stop it

Not a feature — a Wails platform behaviour worth writing down, because the code that was supposed to prevent this looked correct and carried a comment claiming it did.

`main.go` set `BackgroundColour` to `--bg-darkest` "so there is no white flash before the webview paints". On macOS that is not what the option does. Wails v2.13's `SetBackgroundColour` is one line — `[self.mainWindow setBackgroundColor:]` — and colours the **NSWindow** only. The WKWebView laid over it keeps WebKit's default `drawsBackground: YES`, which is opaque white, so the dark window was painted and then immediately covered until the frontend's CSS painted over it. The window colour was never visible at all.

Wails overrides `drawsBackground` in exactly one place:

```objc
if (webviewIsTransparent) {
    [self.webview setValue:@(!webviewIsTransparent) forKey:@"drawsBackground"];
}
```

So `Mac.WebviewIsTransparent` is not a cosmetic option here — **it is the switch that makes `BackgroundColour` do anything on macOS**, and it is now set. Safe because `global.css` gives html/body an opaque background, so the transparency is only ever visible in the gap before first paint.

A second, smaller gap sat on top: `global.css` is imported from `main.tsx`, so under `wails dev` Vite injects it with JavaScript and the document is white until that executes — and even a production build has a gap between the document parsing and the stylesheet arriving. `index.html` now carries an inline `<style>` with the `--bg-darkest` value for each theme, keyed off `prefers-color-scheme`.

Two consequences to accept rather than engineer away:

- **The two hex values are duplicated in `index.html`.** A token cannot be referenced before the file that defines it has loaded, which is the entire problem being solved. If the surface ramp is ever restyled, that file is the second place to change.
- **`prefers-color-scheme`, not the stored setting.** The real theme lives in SQLite and cannot be read synchronously, so a user whose explicit choice disagrees with their desktop still sees the wrong colour briefly — on an empty window, for the length of one indexed read. A `localStorage` cache of the last resolved theme, read by an inline script, would close it if it ever proves annoying.

**Not verified visually.** The diagnosis is read off the Wails source rather than observed, and the fix has not been watched on a cold launch.

---

## 10. Phase 7 — Performance hardening *(~1 week)*

Targets are 500k files / 1M commits. Concretely:

1. ~~**History**: cursor-paged `git log --skip/--max-count` (or `--since` windows), TanStack Virtual, ~200-commit pages,~~ ✅ **built in 7.3 and 7.4** — `--skip`, 200-commit pages, TanStack Virtual; ~~graph lanes computed incrementally in the Worker~~ — **the Worker is withdrawn, measured at 39ms for 20,000 commits** (below)
2. ~~**Status at 500k files**: enable `core.fsmonitor` + `core.untrackedCache` on open, and don't call `--untracked-files=all` on huge repos — degrade to `normal` above a file-count threshold~~ ✅ (below) — built, but not as written: the two mitigations turned out to be one, and the threshold is a duration rather than a file count
3. **Streaming**: everything large goes through `RunStream`, parsed incrementally, never a single giant string
4. **Rerenders**: `React.memo` + granular Zustand selectors; assert render counts in tests for the big lists
5. ~~**Bundle**: lazy-load Monaco on first use~~ — **withdrawn: Monaco was never adopted** (§14.4). xterm ✅ and Shiki ✅ are both already lazy

**And one item this list does not contain, which turned out to be the largest win in the phase: the commit-graph.** See Phase 7.1.

### ✅ Phase 7.0 — somewhere to measure

§13a's "Also needed: a large-repo target" said to decide between cloning something huge and generating one. **Generated**, and by `git fast-import` rather than by a commit at a time — a million commits takes 93 seconds that way and roughly a day the obvious way.

`scripts/genrepo` (Go, ~300 lines) emits the stream; `scripts/seed-large-repo.sh` drives it. Two repositories, because the two axes have no overlap:

| | contents | built in | on disk |
|---|---|---|---|
| `big-files` | 500,001 files, one commit, plus 50,000 untracked | 62s | 1.9G |
| `big-history` | 1,000,000 commits, 256 files, 1,772 refs | 93s | 217M |

Four things about the generator are deliberate and were not obvious:

- **Deterministic dates from a fixed epoch**, not now-relative. This is the opposite of `seed-test-repos.sh` and for the opposite reason: that script feeds a demo and wants plausible "2 hours ago" times, this one feeds a stopwatch and wants a measurement from last week to be comparable to one from today.
- **Long-lived parallel branches, not just short topics.** Short topics alone never put more than two lanes on screen, and two lanes is lane assignment at nearly its easiest case. Up to six branches stay open across hundreds of commits, giving 4–5 concurrent lanes — and branches still open when the walk ends are left open, because unmerged feature branches are realistic *and* they are what puts lanes at the top of the graph, which is the only screenful an unscrolled measurement ever sees.
- **16×16 nested files rather than 256 flat ones.** A commit then rewrites one 16-entry subtree instead of a 256-entry root, which over a million commits is the difference between a pack that delta-compresses and one that does not.
- **An untracked tree is part of the fixture.** On a clean repository `--untracked-files=all` and `=normal` cost the same, because there is nothing to recurse into — so without 50,000 untracked files the threshold this phase exists to set would have had no measurement behind it at all.

The stopwatch is `frontend/bench/git.bench.test.ts`, run with `npm run bench`. It **imports the argument vectors from the source the app uses** rather than restating them — `STATUS_ARGS`, `LOG_BASE_ARGS`, `refArgs`, and `LS_FILES_ARGS`, the last two exported for the purpose. A benchmark holding a copy of a command stops measuring the product the first time somebody edits a flag. It is double-gated (`MOONGIT_BENCH=1` *and* the repositories existing) so `npm test` never grows a four-minute tail.

### ✅ Phase 7.1 — the commit-graph, which is not in the list above

~~**Measured and written, but not yet triggered on the axis it matters most for.**~~ **Triggered as of 2026-08-16.** The entry below used to end by saying the graph was written, measured at 25×, and reachable only from a slow *status* — so `big-history`, a million commits answering status instantly, was the one repository that would never be given one. That gap is closed, and closing it turned out to be a smaller change than the "belongs with the paging work" note predicted; it did not need paging at all.

**The fix was to split a function, not to add a trigger to it.** `configureRepository` did the file axis and the history axis in one body, which is why one measurement had to stand for both. It is now `configureForStatus` (fsmonitor, untracked cache, `update-index`) and `configureForHistory` (`commit-graph write --reachable`, `fetch.writeCommitGraph`), each called from its own measurement: `noteStatusDuration` as before, and a new `noteLogDuration` timing `useLog` the way `useStatus` was already timed. `Tuning` gains a `graphed` flag beside `configured`, and `loadTuning` now spreads over the defaults so rows written before the field existed read as "not yet" rather than as `undefined`.

**"Big" is two properties, and the split is the point.** `big-history` is 256 files; an fsmonitor daemon and a modified index format buy it nothing. `big-files` is one commit; a graph is equally beside the point. Configuring both axes from either measurement would have been the same mistake in the other direction — and note that the *old* behaviour did exactly that, writing a graph for any repository with a slow status. Three consequences worth stating:

- **`forcedAll` is not consulted on the history axis.** It is a statement about untracked files. Reading it as "leave this repository untuned generally" would punish someone who asked to keep seeing their new folders' contents with a Journal that stays 25× slower — two unrelated things joined by nothing but sharing a record.
- **Nothing waits for the write.** `noteLogDuration` returns void. A degraded status changes the command the *next* status runs, so its caller has something to invalidate; a commit-graph changes nothing about the commits already parsed and in hand. Awaiting it would hold the Journal on "Reading history…" for the thirteen seconds the write takes, to deliver rows that were ready before it started.
- **One write, however many slow logs.** The Journal re-runs its log on every keystroke in the search box, each one slow while the graph is still missing, each one returning long before the write it would start has finished. An in-flight guard makes a typed word one write instead of a word's worth of concurrent `commit-graph write` processes against one object store. The status path never needed this — a status is one query, awaited inside itself.

**Verified end to end, from a cold repository through the real app.** Not a benchmark this time: `big-history` was reset to no graph, added to the app's own SQLite, and the app launched so it would restore into that repository. Nothing was clicked. **A 57MB commit-graph appeared 25 seconds after launch** — build, restore, one slow log, trigger, write.

The measured payoff on this machine, against the app's exact query (`--decorate=full`, the full field format, `--max-count=200 --topo-order`), best of three against the graph *the app itself wrote*:

| | cold | after the app configured it |
|---|---|---|
| page 1 | 3990ms | **40ms** |
| `--skip=500000` | — | 270ms |
| `--topo-order --all` (search, `logAll`) | — | 680ms |

Faster than the 275ms recorded below, which is a warmer OS cache rather than a better graph — the ratio is the durable part, and it is not smaller than the 25× first measured. The write itself took 7.5s.

**And the split is visible in the result, which is the part worth checking.** The seed script deliberately writes `core.fsmonitor=false` and `core.untrackedCache=false` so a bench repository starts cold. After the app had configured itself, both were still `false` and the only line it had added was `[fetch] writeCommitGraph = true`. A slow log configured the history axis and nothing else — on a repository where the old single-function behaviour would have started an fsmonitor daemon over 256 files.

Covered by `tuningTrigger.test.ts`, which asserts the wiring rather than the rule: which git commands come out of which measurement, that the flag is persisted only *after* the write (so an interrupted write is retried rather than made permanent), and — in both directions — that neither axis configures the other.

**The baseline finding, and the one that reordered the phase.** Against `big-history`, with the Journal's own query:

| | time | output |
|---|---|---|
| `log --topo-order --max-count=200` (page 1) | 6893ms | 45K |
| the same with `--skip=100000` | 6790ms | 45K |
| the same with `--skip=500000` | 6834ms | 45K |
| `log --max-count=200`, **no ordering flag** | **99ms** | 45K |

Page 500 costing the same as page 1 is not a paging problem; it is the sign that **both pages were already walking the entire history**. `--topo-order` has to prove no parent is emitted before a child, and with no generation numbers to reason with git can only establish that by walking everything first — so `--max-count=200` was bounding the *output* and not the work. `--date-order` is the same at 6780ms. Only git's default ordering, which can stream as it walks, was ever cheap.

A commit-graph supplies the generation numbers. Same repository, same query:

| | no commit-graph | with |
|---|---|---|
| `log --topo-order`, page 1 | 6796ms | **275ms** |
| `--skip=100000` | — | 159ms |
| `--skip=500000` | — | 395ms |
| `--topo-order --all` (search, and `logAll`) | — | 1012ms |

**25× on the query the Journal runs every time it opens**, for a 60MB sidecar file that takes 13 seconds to write once. And it retroactively answers the paging design question §10 left open as "`--skip/--max-count` (or `--since` windows)": with the graph in place `--skip=500000` costs 395ms, so **`--skip` paging is viable and the `--since` windowing fallback is not needed**.

### ✅ Phase 7.2 — status at 500k files, built differently than planned

Two mitigations in the bullet, measured separately:

| | `--untracked-files=all` | `=normal` |
|---|---|---|
| neither | 4442ms | 3935ms |
| `core.fsmonitor` | 2047ms | 680ms |
| `+ core.untrackedCache` | 2075ms | **132ms** |

**The two mitigations are one.** The untracked cache holds a verdict per directory, and `--untracked-files=all` recurses into every directory by definition, so there is nothing for it to answer from — 4442ms against 4457ms is noise. It is worth nothing until you have already degraded, and then it is worth 5×. The plan lists them as independent items; a build that shipped only the cache, as the bullet's ordering invites, would have shipped a no-op.

**The threshold is a duration, not a file count.** A count is a proxy for the thing actually being asked — whether the panel feels slow — and it is a proxy that means different things on an M4 and a 2015 laptop, so any constant would have been right on one machine and wrong on the next. `useStatus` times its own round trip and degrades the repository past 1000ms; `GitRunner` was already reporting durations, so nothing extra is run to find out. Decided with Ivan against a fixed count, an always-`normal` mode, and not degrading at all.

**Nothing is applied to a repository that does not need it.** A daemon, a modified index format and a 60MB sidecar are a bad trade for a three-hundred-file project, and moonGit should not leave them behind in every repository a user opens. The same measurement that degrades the untracked mode is what triggers `configureRepository`.

**The degrade is visible and reversible.** `normal` collapses an untracked directory to one row, so a Files panel that degraded silently would stop listing files with no answer on screen to "where did my new folder's contents go". A banner says so and offers "List every file", which sets `forcedAll` — one-way on purpose, since someone who asks for every file back has been told what it costs, and the next slow status overriding them would be the app arguing with a decision it had just surfaced. The banner is deliberately the same shape as the Journal's file-log filter bar: two different-looking answers to "you are not seeing everything, and here is the button" would be two things to learn for one idea.

Verified end to end on `big-files`, from a config reset to the untuned state the app would first meet:

| | |
|---|---|
| cold `status --untracked-files=all` | 5108ms — trips the 1000ms threshold |
| after `configureRepository`, `=normal` | **292ms** — what the panel runs from then on |
| after `configureRepository`, `=all` | 2719ms — what "List every file" costs |

### ✅ Two bugs the benchmark found that reasoning had not

Neither was reachable through the app today; both were directly in the path of the paging work about to be built.

1. **`parseLog` crashed above roughly 6,500 commits.** `fields.push(...parts)` passes one argument per field, and a large enough input overflows the call stack — `RangeError`, not a slow parse. Go's 64 KB chunks kept `execStream` far below the limit, so only `parseLog`, which hands over the whole output in one call, could reach it. Paging is about to make multi-thousand-commit parses ordinary.
2. **The streaming parser's `drain()` was quadratic.** Re-slicing the field array once per commit copies every remaining field for every commit taken. Invisible at 64 KB a time; the dominant cost of any batch parse.

Both fixed, both with regression tests. The 20,000-commit parse that provoked them now runs in 56ms.

### What the measurements withdrew from this phase

Three of the five bullets shrank or disappeared, which is worth as much as the two that grew:

- **The graph Worker is withdrawn.** `buildGraph` over 20,000 commits — a hundred pages deep, with 4–5 concurrent lanes — takes **39ms**, and over a 200-commit page it is below the timer's resolution. Moving that to a Worker would add a serialisation boundary, a second copy of every commit and an async seam through `JournalView`, to save 39ms that nobody waits for. Lane assignment stays on the main thread. Revisit only if a measurement, not an intuition, says otherwise.
- **The Monaco bullet is void.** Monaco was never adopted (§14.4); Shiki won for the diff and is already lazy per-language, and the merge tool was built without an embedded editor. xterm has been a lazy 333 KB chunk since Phase 6.9. There is nothing left in this item.
- **The parsers are not the bottleneck and never were.** `parseStatus` over 1.6MB of porcelain: 21ms. `parseRefs` over 1,772 refs: 3ms. `parseLog` over a page: below resolution. Every one of them is one to three orders of magnitude cheaper than the git command that produced its input. The phase's remaining effort belongs on what git is asked and how the payload crosses the bridge, not on how it is parsed.

### ✅ Phase 7.4 — the Journal, paged

The data half. 200 commits is now a page rather than a ceiling: scrolling toward the end of the loaded rows fetches the next one with `--skip`, and `JournalView` no longer caps anything.

**Four decisions, none of them the obvious default:**

- **The cursor is an offset, not a commit.** `--skip=n` re-walks from the tip every time, which sounds wasteful and is what the measurements endorse — with a commit-graph, page 2,500 costs 270ms, because the walk stopped being the expensive part the moment generation numbers existed. Resuming from the previous page's last commit cannot express `--topo-order`'s ordering as a revision range without re-deriving the frontier, which is more machinery for something already fast.
- **The offset counts commits received, not pages requested.** `pages.length × pageSize` is the same number while every page is full and diverges the moment one is not — and then it skips exactly the commits the short page failed to return. `nextLogPageParam` is a pure function in `queries/logPaging.ts` with that case asserted, for the same reason `nextTuning` is one: an off-by-one here repeats a commit at every boundary, and a wrong end condition either truncates the history or fetches empty pages forever.
- **A short page means the end.** The alternative is `rev-list --count`, which is a second full walk of the history to learn a number the last page reveals for free — the exact unbounded walk this phase exists to remove. The cost is one wasted round trip when a history divides exactly into pages.
- **`useLog` stays.** The other four callers — `MergeWizard` twice, `RebaseWizard`, `CommitMessagesView` — want a bounded preview of a range and would be worse for being able to scroll further into it. Only the Journal is a window onto a whole history, so only the Journal got `useLogPages`.

**One thing paging broke, and the fix.** The search bar's "N matches" silently became "N loaded so far", growing as the reader scrolled with no explanation. It now reads **"200+ matches"** while pages remain. Counting the rest properly would be that same second full walk.

**Measured against `big-history` through the running app**, driving the real scroll and watching the DOM:

| | |
|---|---|
| pages fetched by scrolling | 31 (~8,000 commits) |
| rows in the DOM, ever | **30** |
| page fetch, median | **83ms** (slowest 427ms) |
| gap between adjacent rows, at depth | 0.0000px |

**Verified against git itself, not just for smoothness.** At the page-1/page-2 boundary the app showed `7b353d0101` then `56e37742d0`; `git log --topo-order --skip=199` and `--skip=200` give exactly those, and a single uninterrupted 202-commit walk ends with the same three oids as indices 199–201. No duplicated commit at the seam, none missed — `--skip` paging reproduces one continuous walk. Row indices stayed contiguous and no oid appeared twice.

### ✅ Phase 7.3 — the Journal, virtualized

The rendering half of "cursor-paged, virtualized history". `@tanstack/react-virtual` had been a dependency imported nowhere since Phase 6; `JournalView` now renders only the rows in view plus twelve either side, so the DOM holds a screenful however long the history is.

**Rows are measured, not assumed, and that was not the cheap choice.** A fixed row height makes virtualization trivial — every offset is arithmetic and nothing needs measuring. It also means truncating ref decorations, and `CommitGraph` is explicitly built around *not* doing that: its SVG carries `preserveAspectRatio="none"` so the lines stretch to whatever height the row turned out to be, with the node drawn as CSS on top so it does not stretch into an ellipse. Fixing the row height would have quietly undone a decision Phase 6 made deliberately. So `estimateSize` is only a starting guess and every rendered row reports its real height back.

**What the estimate is actually for.** Nothing on screen — those rows are measured. It governs the rows that are *not*: the scrollbar's length, and where a given offset lands. Wrong enough and the thumb resizes as you scroll, which is the characteristic tell of a virtualized list guessing. `rowHeight.ts` holds it as a pure function (53px, plus 18px for a commit carrying refs) with the derivation from `History.module.css` written down, because a number like that decays silently the first time somebody edits the stylesheet. It deliberately does **not** scale with the number of refs: labels wrap, so the true height needs the pane width and every ref's name, and under-estimating the rare heavily tagged commit beats over-estimating the common bare one — the common one is what a scrollbar is mostly made of.

**Two smaller things the build turned up:**

- **The scroll position needed resetting.** The virtualizer holds its offset across a count change, which is right for appending a page and wrong for a new search, a File Log filter, or a different repository — all of which replace the list outright. Narrowing a search from a scrolled position otherwise lands you somewhere arbitrary in the results, or past the end of them looking at nothing.
- **`PanelBody` now takes a `ref`.** It is the only scrolling element in a panel, which is what pins every header in the app; the virtualizer had to attach to *it* rather than to a container of its own, or the Journal would have had two nested scrollers and a header that scrolled away with the content.

**This is the codebase's first component test**, which Phase 8 lists as its own work but which this change could not honestly go in without. jsdom has no layout, so a virtualized list that silently renders everything looks identical to one that works — the same shape of failure as 7.1's trigger that was written but never fired. The test supplies the two things virtual-core reads (`offsetHeight`, a `ResizeObserver`) and asserts what a screenshot cannot: **24 rows in the DOM out of 2,000**, the window starting at the newest commit rather than the middle, the spacer sized for all 2,000 so the scrollbar is honest, and every row carrying a distinct offset — because absolutely positioned rows with the translate dropped would all stack on the first and still "render".

**Two bugs that only a real browser found, both invisible to the test suite and to a screenshot.** Both were caught by driving the running app through `wails dev`'s browser endpoint and measuring `getBoundingClientRect` on the rendered rows — jsdom has no layout to be wrong, and at a glance a fifth of a pixel is nothing.

1. **Rows must be a whole number of pixels tall.** The virtualizer measures with `offsetHeight`, an integer, and positions rows at the running total of those measurements. Rows were 72.797px — `line-height: 1.4` on a 12px subject is 16.8, and `normal` on the hash chip resolved to 16.5 — so each was recorded as 73 and the next one began 0.2px after the previous ended. A transparent hairline under every row. Invisible in the text column; through the graph it slices a vertical lane once per row, which is one continuous line versus a column of dashes. **It showed on a single branch and not on `--all` for the same reason:** a curve crosses the gap diagonally and hides it, a vertical stroke cannot. Fixed by pinning three line-heights so rows land on 55px and 74px exactly, marked as such in `History.module.css`. Measuring fractionally instead was tried first and is worse — the fractional rect and the settled row disagree by 2–3px, turning a hairline gap into an outright overlap.
2. **The size cache must be keyed by commit, not by row number.** virtual-core keys measurements by index by default, and the index is not stable here: `--all`, a search, or a file filter replaces what sits at every position. A tall decorated commit at index 3 left its 74px behind for the 55px commit that replaced it, and the list laid out with **±19px gaps and overlaps** — exactly the difference between the two row heights — until each row happened to be re-measured. `getItemKey` now returns the oid, which is the right key for the same reason it is the React key: a commit's height is a property of the commit.

Verified after both fixes with the rows measured directly in the page: heights exactly 55 and 74, and **the largest gap between any two adjacent rows is 0.0000px** — in the single-branch view, in `--all` with 38 graph segments on screen, scrolled deep, and scrolled back.

**Found on the way, not fixed:** `features/working-tree/FileList.tsx` maps over its entries with no cap and no virtualization. On the 500k-file repository that is 500,000 DOM rows. It is the obvious second consumer of this work, but extracting a shared list component from one caller would be guessing at the abstraction — worth doing when it has two real users, which is now next door. Added to the list below.

### Still open in this phase

- ~~**A trigger for the commit-graph on the history axis.**~~ ✅ **Built and verified 2026-08-16** — see Phase 7.1 above. It was the shape the entry predicted (time the log, configure when slow) but reached by splitting `configureRepository` in two rather than by adding a caller to it.
- ~~**Cursor-paged, virtualized history**~~ ✅ **both halves built and verified 2026-08-16** — virtualized in 7.3, paged in 7.4, both above.
- **The streaming audit.** `CommitService` is still the only service that streams. Two measured payloads argue it should not be: `ls-files` returns **11.9MB in a single buffered string** (2191ms) for quick open's corpus, and an unbounded `log` is **219MB**. The second is already streamed; the first is not.
- **The Files panel, virtualized.** `FileList` renders every entry — 500,000 rows on `big-files`. Discovered while building 7.3 and left alone deliberately; doing it now gives the shared list component two real callers instead of one guessed-at abstraction.
- **Rerender hardening.** Untouched.
- **The Ignored chip against a genuinely large repository** — carried over from §9's Phase 6.12 entry, which deferred it here. `status --ignored` on `big-files` is 4407ms, so the pause that entry warns about is real and now has a number.

---

## 11. Phase 8 — Quality, packaging, release *(~4 days)*

Vitest + RTL for units and components · Playwright over `wails dev` for integration flows against tier-2 generated repos (§13a) — never against `testGitHere` · Go tests for `gitexec` (spawn, stream, cancel, timeout) · a11y pass (focus management, ARIA, keyboard nav, high contrast) · central logger with Debug/Info/Warning/Error and a developer-mode log viewer · light/dark/system + custom accent (the token file already makes this a variable swap) · ~~code signing, notarization~~ · universal binary · ~~auto-update~~.

**Two struck items, and the decision behind them (2026-08-16, with Ivan).** Apple Developer enrolment is declined — moonGit ships unsigned and un-notarized, and the Gatekeeper warning on first open is accepted. That is a coherent position for a tool whose audience is its author, but it takes **auto-update down with it**: an updater without a signature is an unverified download replacing the running application, which is a worse thing to ship than no updater at all. Both are therefore out of Phase 8 rather than deferred inside it. If the audience ever widens, they come back as a pair — never the updater alone.

What survives is the part that was always the point: the tests, the a11y pass, the logger, the accent, and a universal binary, none of which need a certificate.

---

## 12. Risk register

| Risk | Mitigation |
|---|---|
| **Wails bridge chokes on large payloads** — the single biggest architectural risk | Streaming (§4.1) designed in from Phase 1, not retrofitted |
| **Business logic drifts into Go** | Go returns only `{stdout, stderr, exitCode}`; enforced by code review + the fact that no git types exist in Go |
| **Components reach for Wails directly** | ESLint `no-restricted-imports` from Phase 0 |
| **Git edge cases** (weird filenames, submodules, LFS, detached HEAD, worktrees) | `-z`/NUL parsing everywhere + a fixture corpus built in Phase 2 |
| **Credential/SSH prompts hang git** | `GIT_TERMINAL_PROMPT=0` + askpass bridge; a prompt becomes UI, never a hang |
| **PRD scope is very large** | Phase 5 ("can commit to its own repo") is the real MVP gate; Phase 6 is sequenced by value and can be cut |
| **v2 → v3 migration later** | Contained to `main.go` + `services/wails/*` |
| **Multi-repo tabs wanted later** (§1.6) | Repo-scoped stores take a `repoPath` param from day one, so it's a wiring change rather than a store rewrite |

---

## 13. Suggested sequencing

```
Phase 0  Foundations           0.5d   ──┐  ✅
Phase 1  Go native layer       1.5d     │  ✅  MVP: ~11 days
Phase 2  TS git layer          3d       │  ✅  ended with moonGit
Phase 3  State & persistence   1d       │  ✅  committing to itself
Phase 4  Mithril → React       2.5d     │  ✅
Phase 5  Wire real git         2.5d   ──┘  ✅
Phase 6  Feature build-out     2–3w        ✅  all 12 items, §9
Phase 7  Performance           1w          ◐   §10 — see below
Phase 8  Quality & release     4d
```

Phases 2 and 4 are independent and can run in parallel (parsers need no UI; the port runs on fixtures).

**Phase 7, in progress.** Done: the bench repositories and the stopwatch (7.0), the commit-graph and its history-axis trigger (7.1), status at 500k files (7.2), the virtualized Journal (7.3), its paging (7.4), and two parser bugs the benchmark found. Withdrawn on measurement: the graph Worker, the Monaco bundle item, and any parser optimisation. Remaining, in value order:

1. The Files panel, virtualized — `FileList` renders all 500k rows today
2. The streaming audit — `ls-files` still returns 11.9MB in one buffered string
3. Rerender hardening
4. The Ignored chip against a genuinely large repository

The estimate has not been revised. Four of the eight items in §10 turned out to be cheaper or void and two turned out to be worth far more than the plan implied, which roughly cancels; the honest position is that the week was never measured either.

---

## 13a. Test environment

### Available now

`../testGitHere/` sits alongside the moonGit project:

```
vibe-weekends/
├── moonGit/                 ← this project
└── testGitHere/
    ├── test-repo1/          789970b "first commit" · main → origin/main · clean
    └── test-repo2/          505f1e1 "first commit" · main → origin/main · clean
```

Both have **real GitHub remotes** (`github.com/IvanWasHere/test-repo{1,2}.git`) with upstream tracking configured. That's their key value: fetch, push, pull, prune, and the whole credential/keychain/askpass path (§4.2) can be exercised against a live remote, which no synthetic fixture can do. Two repos also exercises the repository switcher (§1.6) and the dashboard's recent/favorites/groups lists.

**But they are too clean to render the UI.** One commit, no extra branches, empty working tree — every panel in the mockup (staged files, unstaged changes, branch list with ahead/behind, journal) would show its empty state. So they need seeding before Phase 4/5 dev is useful.

### Three-tier strategy

| Tier | What | Used for | Mutable by automated tests? |
|---|---|---|---|
| **1. Fixtures** | Static command-output samples committed under `src/services/git/__fixtures__/` | Parser unit tests (§5). Pathological filenames, merge commits, renames, binary diffs, submodules, detached HEAD, CRLF | n/a — plain text |
| **2. Generated repos** | Scripted throwaway repos built in `os.tmpdir()` per test | Integration tests, and **all destructive operations**: discard, reset, force-push, rebase, conflict resolution | ✅ yes — disposable by design |
| **3. `testGitHere/`** | The two real repos above | Manual dev loop, and network/auth operations against a live remote | ⚠️ **no** — see below |

**Rule: automated tests never mutate `testGitHere/`.** These are user-owned and pushed to GitHub; a test that force-pushes or hard-resets them destroys real state and can't be undone by a test runner. Playwright specs create their own repos in a temp dir via a `makeRepo()` helper and tear them down after. `testGitHere` is for the human-in-the-loop dev cycle and manual verification of the auth flow.

### Seeding script — `scripts/seed-test-repos.sh`

Needed by Phase 4 so the ported UI has something to render. Puts the two repos into a state that lights up every panel in the mockup:

- Several branches matching the mockup's `branchTag` types so the tag colors are all exercised: `main`, `develop`, `feature/*`, `fix/*`, `release/*`, `hotfix/*`
- A dirty working tree: modified, added, deleted, renamed, and untracked files — one of each status the `statusBadge` map handles
- Some files staged, some not, so the Files panel's staged/unstaged grouping renders
- Enough commit history for the Journal panel and virtualization to be meaningful
- Local-only commits to produce **ahead** counts

**Idempotent and reversible** — safe to re-run, and undone by `git reset --hard origin/main && git clean -fd`.

Two constraints worth stating up front:

- **Nothing is pushed to GitHub.** Seeding is local-only, so it never touches the real remotes. That means it can produce *ahead* counts but not *behind* ones.
- **Behind/diverged states use a local bare remote instead.** A generated repo with a `file://` bare remote lets us fabricate behind, diverged, and non-fast-forward cases without inventing commits on Ivan's GitHub repos.

### ~~Also needed: a large-repo target~~ ✅ resolved in Phase 7.0

Neither test repo can validate the §10 performance work — the targets are 500k files and 1M commits. ~~Before Phase 7, clone something genuinely large (the Linux kernel, ~1.3M commits, is the standard stress case) or generate a synthetic history. Worth deciding then, not now.~~

**Decided: generated, not cloned.** `make seed-large` builds both in about four minutes with no network and no multi-gigabyte clone, and the result is deterministic, so a measurement taken today is comparable to one taken next week. They are tier-2 by the rule above — generated, disposable, and nowhere near `testGitHere`. Full detail in §10's Phase 7.0 entry.

### ~~⚠️ moonGit itself is not a git repository~~ ✅ resolved in Phase 0

~~`git status` in this project fails — there's no `.git` here. Two consequences:~~

1. ~~The Phase 5 exit criterion in §8 ("moonGit can commit to its own repository") **doesn't work as written**. Retargeting it below.~~
2. ~~A Git client is being built without version control. Worth running `git init` early regardless of moonGit's own needs.~~

`git init` was run in Phase 0, so both consequences are gone: the repository exists, and the Phase 5 exit criterion was met as originally written rather than retargeted — moonGit's own first commits were made from moonGit (§8).

It has also become the app's most-used test repository, and an accidental tier-4 the strategy above does not name: unlike `testGitHere` it is safe to read from constantly, and unlike the generated repos it has real history, real renames and a real `.gitignore` covering 18,163 files. Phase 6.12's status-filter work was verified largely against it. **The tier-3 rule still applies to it in full** — no automated test may mutate it, for exactly the reasons that rule exists.

---

## 14. Resolved decisions

| # | Question | Decision |
|---|---|---|
| 1 | Wails version | **v2.13.0 stable** — not the v3 alpha the PRD names |
| 2 | Database | **Yes, SQLite hosted in Go** (`modernc.org/sqlite`) — app state only, never mutable git state |
| 3 | Styling | **CSS Modules + design tokens** lifted from the mockup |
| 4 | Icons | **lucide-react**, fonts vendored locally |
| 5 | Dashboard | **Separate welcome screen** at `/`, workspace at `/repo/:repoId/*` |
| 6 | Multi-repo | **Switcher only** in v1; stores pre-scoped by `repoPath` to keep tabs cheap later |

### Deviations from the PRD, and why

Three places where this plan knowingly diverges — worth a second look before Phase 0 starts:

1. **Wails v2, not v3** (PRD §Tech Stack). Stability over spec-compliance; migration path kept cheap.
2. **lucide-react, not the mockup's Font Awesome** (PRD §Migration Plan says "preserve where possible"). CDN assets can't ship in an offline app, and a 400 KB webfont for ~30 glyphs isn't worth it. Visually indistinguishable.
3. **SQLite stores much less than the Dexie mockup did.** The PRD's migration section implies a table-for-table conversion; that would build a stale cache. Git stays the source of truth for git data.
4. **Shiki, not Monaco, for syntax highlighting** (§9.1, decided in Phase 6). A read-only diff needs a tokenizer, not an editor; Monaco's DiffEditor would also recompute diffs client-side and compete with git's own hunks. Monaco remains a candidate for the merge conflict editor (§9.3).

5. **The menubar has no filled button, and two fewer buttons.** Three separate departures from the mockup's bar (L454–504), all deliberate:

   - **Commit is styled like every other button.** The mockup gives it `btn-primary` (L464) and Phase 4's screenshot comparison specifically restored that gold — see "Commit was not gold" in §7. It is now reverted on purpose. The button *opens the composer*; it does not commit. Filling the one control that is a step on the way somewhere overstated it, and with the emphasis gone, a highlighted button in that bar now means "active view" and nothing else.
   - **Git-flow and Investigate are gone**, per §14 above.

   A future session comparing against `ui-example/index.html` will find all three as differences. They are not drift — do not restore them.

### Still open (not blocking — decide by the phase noted)

- ~~**Light theme**~~ — **resolved: built in Phase 6.8**, ahead of schedule because Settings needed an Appearance section with something in it. Light/dark/system, GitHub-derived light palette, Shiki following the theme. The token structure was *nearly* mechanical as predicted — the 30 literal colours the audit found are the part that was not. Custom accent is still open. See §9's Phase 6.8 entry, including the dark theme's own measured contrast failure now waiting on Phase 8.
- ~~**Git-flow / Index Editor / Investigate**~~ — **all three resolved.** Index Editor was built (§9, hunk and line staging). **Git-flow and Investigate were removed**: the PRD never defined either, both only ever fired a toast, and a control that does nothing is worse than an absent one — it costs a click to discover that. Their icons went with them, since an icon with no caller is a mapping to nothing. `icons.test.ts` records the reason.
- ~~**Merge/diff tool integration**~~ — **resolved: built in.** A three-way modal with per-region choices; the escape hatch is the user's own editor, not a configured external differ. See §9.3 above.
- ~~**Hooks, LFS and submodules**~~ — **resolved 2026-08-16: all three cut.** Asked plainly rather than by feature name — do you work with projects nested inside projects, with huge binary files, with scripts that run on every save — and the answer was none of the three. So the LFS blocker (§13a, no LFS repository to verify against) never needs resolving, and submodules stays a feature nobody here has asked for. **Cut, not deferred**: leaving them on a list makes every future review re-read three entries to reach the same conclusion. They return only if the audience does (see below), and then as new work with a real repository behind them.
- ~~**Code signing identity + notarization credentials**~~ — **resolved 2026-08-16: declined.** See §11. The audience is the author; the first-open warning is accepted; auto-update goes with it.

**Both answers rest on the same premise — that moonGit's audience is Ivan.** It is not written down anywhere else, so it is written down here: if that ever stops being true, these two entries are the first things to reopen, and they reopen together. A wider audience is what makes a certificate worth $99, and it is also what makes somebody arrive with a submodule.
