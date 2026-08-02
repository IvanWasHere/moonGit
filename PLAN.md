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

1. **Diff viewer**: side-by-side, inline, syntax highlighting (~~Monaco~~ **Shiki** — see below), word diff, image diff, large-file guard
2. ~~**Commit graph**: lane layout, branch colors, merge visualization~~ ✅ (below)
3. ~~**Merge**: wizard, conflict detection, conflict viewer, resolution helper~~ ✅ (below)
4. **Rebase**: interactive, continue/skip/abort, squash/edit
5. ~~**Cherry-pick**, **Stash**, **Tags**~~ ✅ (below)
6. **Search**: commits / files / branches / tags / messages / authors
7. **File explorer**: tree, quick open, reveal in Finder
8. **Settings**: appearance, git path, SSH, editor, diff/merge tools, keybindings
9. **Terminal**: xterm.js + `creack/pty` in Go, repo-aware cwd
10. **Repository settings**: ignore rules, git config, hooks, LFS, submodules

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
2. **`Copy Diff` in the Changes header still fires a toast and copies nothing.** `DiffFile` keeps hunks, not the raw patch text, so making it real means either re-running `git diff` or reconstructing the patch.

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
4. **Shiki, not Monaco, for syntax highlighting** (§9.1, decided in Phase 6). A read-only diff needs a tokenizer, not an editor; Monaco's DiffEditor would also recompute diffs client-side and compete with git's own hunks. Monaco remains a candidate for the merge conflict editor (§9.3).

### Still open (not blocking — decide by the phase noted)

- **Light theme** — the mockup is dark-only, and the PRD wants light/dark/system plus custom accent. The token structure makes this mechanical, but someone has to choose the light palette. *Needed by Phase 8.*
- **Git-flow / Index Editor / Investigate** — three menubar buttons in the mockup that only fire toasts, and the PRD never defines them. *Needed by Phase 6.*
- ~~**Merge/diff tool integration**~~ — **resolved: built in.** A three-way modal with per-region choices; the escape hatch is the user's own editor, not a configured external differ. See §9.3 above.
- **Code signing identity + notarization credentials.** *Needed by Phase 8.*
