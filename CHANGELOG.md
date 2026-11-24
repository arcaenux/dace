# Changelog

All notable changes to Dace are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Dace uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- Settings view with persistent preferences for typography, layout, startup behaviour, and backup paths
- Workspace navigation utility (`workspaceNavigation.ts`) with URL-hash routing
- Settings system test suite (5 tests covering defaults, validation, clamping, and equality)
- Folded-ribbon Dace logo integrated into the top bar and application window
- Multi-resolution Tauri app icons and web favicons regenerated from the new brand mark
- Workspace breadcrumb navigation in the top bar (`DACE / <Workspace>`)
- Dot-grid spatial reference background on the Knowledge Graph canvas
- `outsideClickGraceMs` on Command Palette and Shortcut Reference overlays to prevent spurious close on open

### Changed
- Typography: Manrope for UI/display, Newsreader for editorial study notes, IBM Plex Mono for technical output and shortcuts
- Command Palette and Shortcut Reference now dismiss when clicking the dark backdrop area
- `closeOverlay` and `openOverlay` are now stable `useCallback` references, stopping unnecessary `commandList` rebuilds every render
- Overlay backdrop z-index raised to `var(--z-backdrop)` (1000) so it renders above native window controls (z=500)
- Quiet-notice toast z-index updated to `var(--z-toast)` (1200) to remain above open overlays

### Fixed
- Modal backdrop clicks no longer fall through to window controls behind the overlay
- Command palette actions called stale `closeOverlay` closure — now resolved via stable `useCallback`
- Opening a modal then immediately clicking outside no longer triggers a spurious dismiss (grace period added)

---

## [0.1.0-alpha] — 2026-11-23

### Added
- Complete rebrand from internal codename to **Dace** with automatic legacy data migration
- **Knowledge Desk** — author, search, tag, and navigate SQLite-backed knowledge records
- **Research Reader** — PDF import, highlight passages, write study notes, connect excerpts to records
- **Knowledge Graph** — interactive force-directed graph of records and relationships
- **Terminal** — native PTY shell embedded in the workspace (Windows, via `portable-pty`)
- **Backup & Restore** — one-click encrypted archive export with SHA-256 fingerprint verification before restore
- **Focus Space** — distraction-free full-screen environment (Tauri fullscreen + custom overlay)
- **Command Palette** (`Ctrl+K`) with filtered command list, keyboard navigation, and intent routing
- **Shortcut Reference** (`Ctrl+Shift+P`) with full action inventory
- **Contextual Panel** — slide-in workspace detail drawer
- **Managed Attachments** — content-addressed document storage with deduplication
- Workspace intent system for type-safe cross-view communication
- Save participant registry with flush-before-close lifecycle guarantees
- Autosave debounce for knowledge records and reader notes
- Hash-based URL routing for direct workspace deep-links
- Persistent `lastActiveActivity` via settings for `remember-last` startup behaviour
- P0 verification GitHub Actions workflow (frontend + Rust, Windows runner)

### Infrastructure
- Tauri v2 desktop shell with custom decorations and drag region
- SQLite via `rusqlite` (bundled) — single portable `.db` file, user-owned
- Rust test suite: 57 tests across backup, restore, records, attachments, terminal, and graph
- Frontend test suite: 83 tests via Node native test runner (no test framework dependency)
- Production release profile with LTO, `codegen-units = 1`, and binary stripping

[Unreleased]: https://github.com/arcaenux/dace/compare/v0.1.0-alpha...HEAD
[0.1.0-alpha]: https://github.com/arcaenux/dace/releases/tag/v0.1.0-alpha
