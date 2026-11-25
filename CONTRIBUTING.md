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
| Node.js | 20 LTS or 22 LTS |
| Rust | stable (via [rustup](https://rustup.rs)) |
| Git | any recent version |

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

All three must pass with zero errors and zero failing tests.

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

`ui`, `shell`, `reader`, `knowledge-desk`, `graph`, `terminal`, `backup`, `settings`, `overlays`, `tokens`, `rust`, `ci`

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

- **No default exports** except for React component files where the framework encourages it.
- **`useCallback` for all callbacks passed as props or into `useMemo`/`useEffect` dependencies** — prevents stale closures and unnecessary re-renders.
- **Prefer `useRef` for mutable state that must not cause re-renders** (timers, previous values, imperative handles).
- **CSS modules are not used** — all styles live in `src/styles/` as plain CSS with design token variables. Do not add inline `style={{}}` for layout or colour decisions that belong in tokens.
- **No `any` without a comment explaining why.**
- **No `// eslint-disable`** unless accompanied by a brief justification and a task to remove it.

### Rust

- Run `cargo clippy` before committing. Zero warnings in the output expected.
- Run `cargo fmt` — formatting is not negotiable.
- All public functions that cross the Tauri boundary (`#[tauri::command]`) must have a corresponding integration test in the Rust test suite or the Node test suite.
- Error types returned from commands must be `String` (serialisable) — do not return opaque types.

### CSS / Design Tokens

- **All colours, spacing, font sizes, z-indices, and durations must reference a token** from `src/styles/tokens.css`. Never hardcode hex or pixel values.
- **No `!important`** outside of explicit browser-reset contexts.
- **z-index values** must use the `--z-*` token scale. If a new layer is needed, add it to the token file and update this document.

---

## Testing Requirements

### For every new frontend feature

Add at least one test in `tests/` using the Node native test runner (no external framework). Tests import directly from source; use the existing suites as examples.

```bash
# Run a single suite during development
node --experimental-strip-types --test tests/myNewSuite.test.ts
```

### For every Rust command

Add at least one test in `src-tauri/src/` or alongside the module under test. Use `rusqlite::Connection::open_in_memory()` for database tests — never write to the filesystem in tests.

### Minimum bar for a PR

| Check | Requirement |
|-------|-------------|
| `npx tsc --noEmit` | 0 errors |
| `npm test` | 0 failures, all previous tests still pass |
| `cargo test` | 0 failures |
| `cargo clippy` | 0 warnings |

---

## Pull Request Checklist

Before marking your PR ready for review, confirm:

- [ ] Branch is up to date with `main`
- [ ] `npm test` passes (all suites)
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` passes
- [ ] `npx tsc --noEmit` reports 0 errors
- [ ] No new hardcoded colours, pixel values, or z-indices (use tokens)
- [ ] Any new Tauri command has a corresponding test
- [ ] CHANGELOG.md updated under `[Unreleased]` if the change is user-visible
- [ ] PR title follows the Conventional Commits format

---

## Architecture Overview

```
WorkspaceShell          # Root React component — owns all state, intents, overlays
  ├── WorkspaceTopBar   # Breadcrumb, search, command palette trigger, shortcut trigger
  ├── WorkspaceRail     # Activity sidebar navigation
  ├── <Activity>        # One of: WorkspaceIntro, KnowledgeDesk, KnowledgeGraphView,
  │                     #         ResearchReaderView, SettingsView, TerminalView
  ├── CommandPalette    # Ctrl+K overlay — filtered command list
  ├── ShortcutReference # Ctrl+Shift+P overlay — shortcut inventory
  └── ContextualPanel   # Slide-in workspace detail drawer
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

### Save lifecycle

The `SaveParticipantRegistry` in `src/core/saveRegistry.ts` coordinates flushing unsaved state before the application window closes. Each view that holds dirty state registers a participant; the shell calls `attemptClose()` which serialises all flushes before forwarding the close to Tauri.

### Data flow

```
Rust Tauri commands (src-tauri/src/)
  ↕  invoke / JSON
TypeScript API modules (src/*/api.ts, src/backup/backupApi.ts, …)
  ↕  props / callbacks / intents
React components (src/knowledge/, src/reader/, …)
```

---

## Reporting Issues

Please open a [GitHub Issue](https://github.com/arcaenux/dace/issues) and include:

- Operating system and version
- Steps to reproduce
- Expected behaviour vs actual behaviour
- Any console output or error messages (open DevTools in Tauri with `Ctrl+Shift+I`)

For security issues, do not open a public issue — email the maintainer directly.
