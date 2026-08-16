<div align="center">

<img src="build/appicon.png" alt="" width="128" height="128">

# 🌙 moonGit

**A Git client for macOS.**

Wails v2 · React 19 · TypeScript · SQLite · no Electron

</div>

---

## 📸 Screenshots

| | |
|:---:|:---:|
| <img src="docs/screenshots/workspace.png" alt="Main view"> | <img src="docs/screenshots/diff.png" alt="Diff viewer"> |
| **Workspace** — repositories, branches, files, changes and history, all resizable | **Diff viewer** — side-by-side or inline, syntax highlighted, staged by hunk or by line |
| <img src="docs/screenshots/history.png" alt="Commit graph"> | <img src="docs/screenshots/merge.png" alt="Merge resolver"> |
| **History** — a real lane graph, with qualifier search over authors, paths and dates | **Merge** — a three-way resolver with per-region choices |

---

## ✨ What it does

### 📝 Working tree

- **Stage and unstage by file, by hunk, or by individual line.** The index editor builds a patch and applies it with `git apply --cached`, so the staged result is git's own, not an approximation.
- **Status columns** — `STATUS | FILE | PATH`, with the path truncating from the left so the leaf directory stays readable, and renames split correctly across the two columns.
- **Seven status filter chips** — staged, unstaged, added, untracked, deleted, conflicted, ignored — combinable with a text filter.
- **Stage all**, **discard**, and **commit** with a composer, amend, and `⌘↵`.

### 🔍 Diff

- Side-by-side and inline views.
- Syntax highlighting via **Shiki**, loaded per language on demand, following the active theme.
- **Word-level diff** inside changed lines.
- **Image diff** for binary image files.
- A **large-file guard**, so opening a 40MB generated file does not lock the window.

### 🕰️ History

- **Commit graph** with lane assignment, branch colours and merge visualisation.
- **Blame** — per-line authorship, with runs collapsed so a label appears only where authorship actually changes.
- **Search** with the qualifier syntax every code host has trained people on — `author:`, `path:`, `since:`, `until:`, with quoting. An unrecognised `key:value` is searched as literal text rather than rejected.
- **File log** — history filtered to one path, from the file's context menu or a commit.
- Commit context menu: show changes, cherry-pick (with or without committing), create a tag here, history from here, copy SHA or subject.

### 🌿 Branching and integration

- **Branches** — checkout, create, rename and delete, from the Branch menu or the panel header.
- **Merge** — a wizard with conflict detection, plus a three-way conflict resolver with per-region choices and an escape hatch to your own editor.
- **Rebase** — interactive, with a todo editor supporting pick, edit, squash, fixup, drop and reorder, and continue/skip/abort while the rebase is in progress. `reword` is deliberately absent — it would open `GIT_EDITOR` on the message, which here is a no-op, so `edit` offers the same power honestly.
- **Reset** — soft, mixed or hard onto any commit, with each mode's consequence spelled out and the destructive one confirmed twice.
- **Cherry-pick** — onto the current branch, with or without committing.
- **Stash** — push, apply, pop and drop.
- **Tags** — create at HEAD or at any commit.
- **Compare** — what differs between the current branch and any remote branch, as a file list with counts.
- **Clone** — from a URL, with the destination folder shown before anything is written.
- **Remotes** — fetch, pull, push, and remote management. Credential and SSH prompts become UI rather than a hung process.

### 🧭 Around the edges

- **File explorer** with a lazily-loaded tree and **quick open** (`⌘P`).
- **Terminal** (`⌃\``) — a real pty in a bottom drawer, scoped to the repository, so you can run `git rebase --continue` while reading the file list rather than instead of it.
- **Repository settings** — ignore rules with an explainer for which rule matches, and git config for the local scope against the effective one.
- **Settings** (`⌘,`) — light, dark or system theme, a **custom accent colour** with a live readability figure, the git binary path, and your editor command.
- **Native macOS menu bar**, driven from the same structure as the in-window menubar — the two cannot disagree, and a test enforces that no label is one macOS silently rewrites.
- **Live refresh from a file watcher.** No polling, no refresh button — a Go-side watcher debounces filesystem noise into one event carrying *which* areas changed, and that maps onto the exact queries those areas affect. Saving a file does not re-read the ref list.
- **Adaptive tuning for large repositories.** A repository whose status is slow gets `core.fsmonitor`, an untracked cache and a commit-graph, and degrades to collapsed untracked directories — measured at 4442ms → 132ms on 500k files. It says so on screen and the degrade is reversible.
- **An application log** at `#/dev/log` — a ring buffer that records every level regardless of what reaches the console, because a packaged app has no devtools window to read.

---

## 🚧 Not built

Kept honest on purpose.

| | Why |
|---|---|
| **Content search** (`git grep`) | Search covers commits, not file contents — it needs a results surface of its own rather than a commit list. |
| **Pull request review** | The menu opens your host's pull requests in a browser. There is no forge integration and none planned. |
| **Hooks, LFS, submodules** | **Cut**, not deferred — none of the three matched how this app's author works. `PLAN.md` §14. |
| **Keybindings editor** | The app has four shortcuts. An editor for rebinding four things is a settings page for nothing. |
| **Code signing, notarization, auto-update** | Declined, and they move as a group: an unsigned updater is an unverified download replacing the running app. See **Installing** below. |
| **End-to-end tests** | The unit layer is there; the scaffolding for driving the whole app costs more than it saves at one user. |

All nine phases in `PLAN.md` are complete. It is the real record — what was built, what was measured, and the places where the measurement argued with the plan and won.

---

## 📥 Installing

Download the `.dmg` or the `.zip` from [Releases](https://github.com/IvanWasHere/moonGit/releases). Both hold the same universal build (Intel + Apple Silicon).

> ⚠️ **moonGit is not signed with an Apple Developer certificate.** macOS quarantines anything downloaded through a browser, and refuses to open an unsigned quarantined app — the message says the app is *damaged*, which it is not. After moving it to Applications:
>
> ```sh
> xattr -dr com.apple.quarantine /Applications/moonGit.app
> ```

---

## 🔨 Building

Requires macOS, Go 1.25+, Node 22+, and the [Wails v2 CLI](https://wails.io/docs/gettingstarted/installation).

```sh
go install github.com/wailsapp/wails/v2/cmd/wails@v2.13.0

make dev        # run with hot reload
make build      # universal .app in build/bin
make archcheck  # assert the built binary really is universal
```

Releases are built by `.github/workflows/release.yml` when a release is published: it runs the full check, builds universal, verifies with `lipo`, and attaches a DMG and a zip.

## 🧪 Development

```sh
make check         # everything CI runs: lint, typecheck, tests
make test          # Go + frontend tests
make lint          # go vet + eslint
make typecheck     # tsc --noEmit
make bindings      # regenerate the TypeScript bindings from the Go services
```

### Test repositories

```sh
make seed          # put ../testGitHere/test-repo{1,2} into a rich state
make seed-reset    # restore them to pristine origin/main
```

Automated tests never mutate those — they are real repositories with real remotes. Tests build their own throwaway repositories in a temp directory. See `PLAN.md` §13a.

### Benchmarks

```sh
make seed-large    # generate 500k-file and 1M-commit repositories (~4 min, ~2.1G)
make bench         # time the app's own git commands against them
make seed-large-clean
```

The benchmark imports its argument vectors from the application source rather than restating them, so it cannot drift from what the app actually runs.

---

## 🏗️ Architecture

The one rule everything else follows: **Go knows nothing about git.**

`internal/gitexec` spawns a process and returns `{stdout, stderr, exitCode}`. It has no concept of a commit, a branch or a diff. Every parser, every domain service and every decision lives in TypeScript, which means the interesting logic is testable without a running application — and it is: **782 frontend tests**, most of them over parsers fed real captured git output, plus Go tests over the process layer.

```
internal/          Go — 9 services, one native capability each
  gitexec            spawn, stream, cancel, timeout
  store              SQLite (modernc.org/sqlite, no CGO) — app state only, never git state
  watcher            filesystem events, debounced and classified
  fsapi ptyapi shellapi creds dialogs appmenu

frontend/src/
  services/git/    parsers + domain services — the whole git layer
  queries/         TanStack Query bindings and the invalidation rules
  features/        one directory per feature, CSS Modules alongside
  stores/          Zustand, repo-scoped
```

**What "no Electron" does and does not mean.** The interface is React and CSS rendered by **WKWebView** — the system's own WebKit — so nothing bundles a browser and the download is ~17MB rather than ~150MB. The shell around it is genuinely native: an `NSMenu` menu bar, the system file dialogs, the Keychain, a real pty. But the panels you look at are web technology, not AppKit, and this README does not claim otherwise.

That boundary is not cosmetic — it caused real bugs. `window.prompt` and `window.confirm` exist in the browser the app is *developed* in and do nothing in the WebKit it *ships* in, which silently broke four controls (`PLAN.md` §11, 8.11).

**SQLite stores app state only** — window layout, preferences, the repository list. Never refs, HEAD, status or ahead/behind counts. Git is the source of truth for git data; a cache of it would be a cache that goes stale in ways the user notices.

**No CGO**, which is why a universal binary is one flag rather than a cross-toolchain project.

Two rules are enforced by tests rather than by convention, because both were broken by copying an example that was already wrong: every overlay must paint above the menu bar, and nothing may call `window.prompt` or `window.confirm` — in a packaged Wails app they silently return `null` and `false`.

Full rationale, including the deliberate deviations from the original PRD, is in `PLAN.md`.

---

## 📄 License

[MIT](LICENSE.md) © 2026 Ivan Marinkovic
