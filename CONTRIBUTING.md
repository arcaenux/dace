# Contributing to Dace

Thank you for your interest in contributing. This document covers everything you need to get oriented, write code, and submit changes.

---

## Table of Contents

1. [Development Setup](#development-setup)
2. [Branch Conventions](#branch-conventions)
3. [Commit Format](#commit-format)
4. [Code Style](#code-style)
5. [Testing Requirements](#testing-requirements)
6. [Pull Request Checklist](#pull-request-checklist)
7. [Architecture Overview](#architecture-overview)
8. [Reporting Issues](#reporting-issues)

---

## Development Setup

### Prerequisites

| Tool | Version |
|------|---------|
| Node.js | 22.6 or newer (the test runner uses `--experimental-strip-types`) |
| Rust | stable (via [rustup](https://rustup.rs)) |
| Git | any recent version |
| Windows | Microsoft Edge WebView2 (preinstalled on Windows 10 and 11) |
| Linux | `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, `patchelf`, `libgtk-3-dev` |

### First-time setup

```bash
git clone https://github.com/arcaenux/dace.git
cd dace
npm install
```

### Run in development

```bash
npm run tauri dev
```

### Run all tests before submitting

```bash
# Frontend
npm test

# Rust backend
cargo test --manifest-path src-tauri/Cargo.toml

# Type-check
npx tsc --noEmit
```

All three must pass with zero errors and zero failing tests. CI runs the same
checks on Windows and Linux for every pull request.

---

## Branch Conventions

| Prefix | Use for |
|--------|---------|
| `feat/<short-name>` | New features and workspaces |
| `fix/<short-name>` | Bug fixes |
| `chore/<short-name>` | Maintenance, deps, refactors without behaviour change |
| `docs/<short-name>` | Documentation-only changes |
| `test/<short-name>` | Adding or fixing tests |

Branch off `main` for all contributions. Keep branches focused — one logical change per PR.

---

## Commit Format

Dace follows [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/).

```
<type>(<scope>): <short description>

<optional body — what and why, not how>
```

### Types

| Type | When to use |
|------|-------------|
| `feat` | A new feature or capability |
| `fix` | A bug fix |
| `perf` | A performance improvement |
| `refactor` | A code change that neither fixes a bug nor adds a feature |
| `style` | Formatting, whitespace — no logic change |
| `test` | Adding or correcting tests |
| `docs` | Documentation only |
| `chore` | Tooling, CI, deps |
| `build` | Build system or external dependency changes |

### Scope examples

`ui`, `shell`, `editor`, `reader`, `knowledge-desk`, `graph`, `assistant`, `vault`, `terminal`, `backup`, `settings`, `overlays`, `tokens`, `rust`, `ci`

### Examples

```
feat(reader): add passage deduplication for excerpt highlights
fix(overlays): close modal on backdrop click
chore(deps): update pdfjs-dist to 4.11
docs: add architecture overview to CONTRIBUTING
```

---

## Code Style

### TypeScript / React

- **Named exports.** Everything except the root `App.tsx` uses named exports; follow suit.
- **`useCallback` for callbacks passed as props or used in hook dependencies**, to avoid stale closures and needless re-renders.
- **`useRef` for mutable values that must not re-render** (timers, previous values, imperative handles).
- **Styles live in `src/styles/`** as plain CSS (no CSS modules). Avoid inline `style={{}}` for colours or spacing that belong in tokens.
- **Avoid `any`.** Where it is unavoidable, add a short comment saying why.
- **Writing surfaces** use the shared editor in `src/editor/`. Notes are stored as Markdown; keep any new formatting round-trippable to Markdown.

### Rust

- Run `cargo fmt` before committing.
- Run `cargo clippy` and do not introduce new warnings. (The existing code still has some; fixing them is welcome as a separate change.)
- Commands that do window or webview work (adding or moving a webview) must be `async`, so they never block the main thread.
- Add tests for new `#[tauri::command]` logic, in the Rust suite or the Node suite.
- Commands return `Result<T, String>` so errors reach the frontend as readable messages.

### CSS / Design Tokens

- **Prefer tokens** from `src/styles/tokens.css` for colours, radii, spacing, fonts, z-indices and durations, so light and dark mode stay consistent.
- **Text is never smaller than 11px.** The quiet-UI test suite enforces this.
- **`quiet-ui.css` is imported last** and is the authoritative visual layer. Its `!important` rules exist to override older layers; avoid adding new `!important` elsewhere and prefer a more specific selector.
- **New layers** use the `--z-*` scale where possible.

---

## Testing Requirements

### For every new frontend feature

Add at least one test in `tests/` using the Node native test runner (no external framework). Tests import directly from source; use the existing suites as examples.

```bash
# Run a single suite during development
node --experimental-strip-types --test tests/myNewSuite.test.ts
```

### For every Rust command

Add at least one test alongside the module under test. Use an in-memory database (`rusqlite::Connection::open_in_memory()`) where you can. When a test needs real files (backup, restore, vault), use a unique folder in the system temp directory and remove it afterwards, as the existing suites do.

### Minimum bar for a PR

| Check | Requirement |
|-------|-------------|
| `npx tsc --noEmit` | 0 errors |
| `npm test` | 0 failures, all previous tests still pass |
| `cargo test` | 0 failures |
| `cargo clippy` | no new warnings |

---

## Pull Request Checklist

Before marking your PR ready for review, confirm:

- [ ] Branch is up to date with `main`
- [ ] `npm test` passes (all suites)
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` passes
- [ ] `npx tsc --noEmit` reports 0 errors
- [ ] Colours, spacing and z-indices use design tokens where possible
- [ ] Any new Tauri command has a corresponding test
- [ ] CHANGELOG.md updated under `[Unreleased]` if the change is user-visible
- [ ] PR title follows the Conventional Commits format

---

## Architecture Overview

```
WorkspaceShell          # Root React component: owns activity, intents, overlays
  ├── WorkspaceTopBar   # Breadcrumb, search, commands, shortcuts, side browser, theme
  ├── WorkspaceRail     # Workspace navigation
  ├── <Activity>        # One of: WorkspaceIntro (Home), KnowledgeDesk, KnowledgeGraphView,
  │                     #         ResearchReaderView, SettingsView, TerminalView
  ├── AssistantPanel    # Side browser (a native child webview over a reserved slot)
  ├── CommandPalette    # Ctrl+K overlay
  ├── ShortcutReference # Ctrl+Shift+P overlay
  └── ContextualPanel   # Slide-in workspace details
```

### Intent system

Cross-view communication uses a typed intent queue owned by `WorkspaceShell`. Components never call each other directly — they dispatch an intent request (`requestIntent`) and the shell routes it to the correct target view when it mounts.

```
requestIntent({ type: "new-record" })
  → intentTargetActivity()  → "knowledge-desk"
  → selectActivity("knowledge-desk")
  → KnowledgeDesk receives intent prop
  → KnowledgeDesk consumes it via onConsumeIntent
```

### Writing editor

`src/editor/RichTextEditor.tsx` wraps Tiptap. It loads and saves Markdown, so
everything that reads note text (outline, search, previews, backups, the vault's
Markdown files) keeps working. Reader excerpts link back to their source with a
hidden `dace-excerpt` comment line; the `excerptMarker` node keeps those lines
intact through editing.

### Save lifecycle

The `SaveParticipantRegistry` in `src/core/saveRegistry.ts` coordinates flushing unsaved state before the application window closes. Each view that holds dirty state registers a participant; the shell calls `attemptClose()` which serialises all flushes before forwarding the close to Tauri.

### Data flow

```
Rust Tauri commands (src-tauri/src/)
  ↕  invoke / JSON
TypeScript API modules (knowledgeApi.ts, attachmentsApi.ts, readerApi.ts, vaultApi.ts, …)
  ↕  props / callbacks / intents
React components (src/knowledge/, src/reader/, …)
```

---

## Reporting Issues

Please open a [GitHub Issue](https://github.com/arcaenux/dace/issues) and include:

- Operating system and version
- Steps to reproduce
- Expected behaviour vs actual behaviour
- Your Dace version (**Settings → About**)
- Any error messages. In a development build (`npm run tauri dev`) you can open DevTools with `Ctrl+Shift+I` or right-click → Inspect; release builds do not include DevTools.

For security issues, do not open a public issue. Follow [SECURITY.md](SECURITY.md).
