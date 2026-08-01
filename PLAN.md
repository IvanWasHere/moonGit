# moonGit — Implementation Plan

Derived from the PRD, grounded in what is actually in this repo today.

---

## 0. Current state (verified)

| Thing | Reality |
|---|---|
| Wails | **v2.13.0** (`go.mod`), CLI `v2.13.0` installed. PRD says v3. |
| Go | 1.26.5 darwin/arm64, module named `myproject` |
| Backend | `app.go` — one `Greet()` method. Nothing else. |
| Frontend | Stock template: `App.jsx`, `main.jsx`, **plain JS, no TypeScript**, deps are only `react`/`react-dom`/`vite` |
| Bindings | `frontend/wailsjs/go/main/App.d.ts` → `Greet(string)` |
| UI reference | `ui-example/index.html` — single file, Mithril 2.2.2 + Dexie 3.2.7 from CDN, ~45 KB |
| git | 2.47.1 available on PATH |

**What the mockup actually contains** (this bounds the "migration" work — everything else in the PRD is net-new design, not a port):

- A 60px icon menubar: 3 sections (Pull/Sync/Push/Git-flow/Merge/Commit · Stage/Index Editor/Unstage/Remove/Abort/Discard/Delete · Log/Blame/Investigate/Main View/Review View)
- **Main View**: left column (Repositories 35% / Branches) | right column (Files 35% / Changes 35% / Journal), all percent-resizable
- **Review View**: top row (Repositories 20% / Files 50% / Commit Messages 30%) over bottom row (Origin Branch 50% / Changes 50%)
- 7 data components: `RepoList`, `BranchList`, `FileList`, `ChangesView`, `JournalView`, `OriginBranchView`, `CommitMessagesView`
- Drag resizers (`createResizer`, percent-based with min/max clamps), toast system, empty states
- A complete dark design token set (`--bg-darkest: #0d1117` … `--accent: #e8a838`), JetBrains Mono + Space Grotesk, Font Awesome 6.5.1

Everything in it is **fake data from Dexie seeds**. There is no git integration anywhere yet.

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

1. **Commit was not gold.** The mockup gives that one button `menu-btn` *and* `btn-primary` (L464) — the only filled control in the bar. Easy to miss reading the markup, obvious side by side.
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

1. **Diff viewer**: side-by-side, inline, syntax highlighting (Monaco), word diff, image diff, large-file guard
2. **Commit graph**: lane layout, branch colors, merge visualization
3. **Merge**: wizard, conflict detection, conflict viewer, resolution helper
4. **Rebase**: interactive, continue/skip/abort, squash/edit
5. **Cherry-pick**, **Stash**, **Tags**
6. **Search**: commits / files / branches / tags / messages / authors
7. **File explorer**: tree, quick open, reveal in Finder
8. **Settings**: appearance, git path, SSH, editor, diff/merge tools, keybindings
9. **Terminal**: xterm.js + `creack/pty` in Go, repo-aware cwd
10. **Repository settings**: ignore rules, git config, hooks, LFS, submodules

Each ships behind the same skeleton: `Loading | Success | Error | Retry`.

---

## 10. Phase 7 — Performance hardening *(~1 week)*

Targets are 500k files / 1M commits. Concretely:

- **History**: cursor-paged `git log --skip/--max-count` (or `--since` windows), TanStack Virtual, ~200-commit pages, graph lanes computed incrementally in the Worker
- **Status at 500k files**: enable `core.fsmonitor` + `core.untrackedCache` on open, and don't call `--untracked-files=all` on huge repos — degrade to `normal` above a file-count threshold
- **Streaming**: everything large goes through `RunStream`, parsed incrementally, never a single giant string
- **Rerenders**: `React.memo` + granular Zustand selectors; assert render counts in tests for the big lists
- **Bundle**: lazy-load Monaco and xterm.js on first use

---

## 11. Phase 8 — Quality, packaging, release *(~4 days)*

Vitest + RTL for units and components · Playwright over `wails dev` for integration flows against tier-2 generated repos (§13a) — never against `testGitHere` · Go tests for `gitexec` (spawn, stream, cancel, timeout) · a11y pass (focus management, ARIA, keyboard nav, high contrast) · central logger with Debug/Info/Warning/Error and a developer-mode log viewer · light/dark/system + custom accent (the token file already makes this a variable swap) · code signing, notarization, universal binary, auto-update.

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
Phase 0  Foundations           0.5d   ──┐
Phase 1  Go native layer       1.5d     │  MVP: ~11 days
Phase 2  TS git layer          3d       │  ends with moonGit
Phase 3  State & persistence   1d       │  committing to itself
Phase 4  Mithril → React       2.5d     │
Phase 5  Wire real git         2.5d   ──┘
Phase 6  Feature build-out     2–3w
Phase 7  Performance           1w
Phase 8  Quality & release     4d
```

Phases 2 and 4 are independent and can run in parallel (parsers need no UI; the port runs on fixtures).

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

### Also needed: a large-repo target

Neither test repo can validate the §10 performance work — the targets are 500k files and 1M commits. Before Phase 7, clone something genuinely large (the Linux kernel, ~1.3M commits, is the standard stress case) or generate a synthetic history. Worth deciding then, not now.

### ⚠️ moonGit itself is not a git repository

`git status` in this project fails — there's no `.git` here. Two consequences:

1. The Phase 5 exit criterion in §8 ("moonGit can commit to its own repository") **doesn't work as written**. Retargeting it below.
2. A Git client is being built without version control. Worth running `git init` early regardless of moonGit's own needs.

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

### Still open (not blocking — decide by the phase noted)

- **Light theme** — the mockup is dark-only, and the PRD wants light/dark/system plus custom accent. The token structure makes this mechanical, but someone has to choose the light palette. *Needed by Phase 8.*
- **Git-flow / Index Editor / Investigate** — three menubar buttons in the mockup that only fire toasts, and the PRD never defines them. *Needed by Phase 6.*
- **Merge/diff tool integration** — external tools (Kaleidoscope, Beyond Compare) or built-in only? *Needed by Phase 6.*
- **Code signing identity + notarization credentials.** *Needed by Phase 8.*
