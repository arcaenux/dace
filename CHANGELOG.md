# Changelog

All notable changes to Dace are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Dace uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- Settings view with persistent preferences for typography, layout, startup behaviour, and backup paths
- App font and text font preferences populated from fonts installed on the device via a native font-enumeration command
- Workspace navigation utility (`workspaceNavigation.ts`) with URL-hash routing
- Settings system test suite (5 tests covering defaults, validation, clamping, and equality)
- Folded-ribbon Dace logo integrated into the top bar and application window
- Multi-resolution Tauri app icons and web favicons regenerated from the new brand mark
- Workspace breadcrumb navigation in the top bar (`DACE / <Workspace>`)
- Dot-grid spatial reference background on the Knowledge Graph canvas
- `outsideClickGraceMs` on Command Palette and Shortcut Reference overlays to prevent spurious close on open
- Modern motion layer with staggered entrances, tactile button feedback, ambient depth, and animated overlays that honour reduced-motion settings
- Command Palette and Shortcut Reference now use flex layouts with internally scrollable lists and corrected text tracking
- Focus Space no longer exposes the frameless window drag strip or minimize/maximize controls that could swallow top-bar clicks
- Speed Reader for selected passages, full text/Markdown documents, highlights, and the current PDF page, with keyboard controls, WPM/chunk preferences, and progress tracking (`Ctrl+Shift+R`)

### Changed
- Typography: Aptos as the base for interface and reading text, with user-selectable device fonts; terminal keeps a monospace stack and follows monospace app-font choices
- Command Palette and Shortcut Reference now dismiss when clicking the dark backdrop area
- `closeOverlay` and `openOverlay` are now stable `useCallback` references, stopping unnecessary `commandList` rebuilds every render
- Overlay backdrop z-index raised to `var(--z-backdrop)` (1000) so it renders above native window controls (z=500)
- Quiet-notice toast z-index updated to `var(--z-toast)` (1200) to remain above open overlays
- Speed Reader redesigned as a quiet reading instrument: flat solid surfaces, a stable focus point with ORP highlighting, explicit progress/time readout, restrained controls, and real modal semantics

### Fixed
- Modal backdrop clicks no longer fall through to window controls behind the overlay
- Command palette actions called stale `closeOverlay` closure — now resolved via stable `useCallback`
- Opening a modal then immediately clicking outside no longer triggers a spurious dismiss (grace period added)
- Delete actions now report failures and reliably remove Knowledge Desk records, reader notes, relationships, attachments/files, and stale record selections
- Reader writing mode now shows a return bar to its source document
- Sidebar rail nav icons no longer slide or scale on hover/press
- Speed Reader timing scales WPM by chunk size and global shortcuts no longer fire behind modal surfaces
- A failed physical attachment delete now preserves the library row so the operation remains retryable
- Reader layouts keep the top bar and navigation rail stable; compact rail icons and focus halo stay aligned with the dock
- Brand logo is aligned consistently in the top bar and reader toolbar across every reader view
- Speed Reader no longer dismisses itself from the toolbar click that opened it
- Old logo backup removed from version control, with a regression guard against tracked copies

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
