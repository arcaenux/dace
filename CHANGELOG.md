# Changelog

All notable changes to Dace are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and Dace uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added

**Writing**
- Rich-text editor for Knowledge Desk records and Reader notes: text is written
  and shown formatted, never as Markdown symbols
- Selection toolbar for formatting: bold, italic, underline, strikethrough,
  highlight, inline code, links, headings, bulleted, numbered and check lists,
  quotes, and clear formatting
- Typed Markdown still converts once complete (`# `, `- `, `> `, `**bold**`,
  `*italic*`, `==highlight==`); notes are still stored as Markdown

**Library and data**
- Vault folder (Settings → Documents & storage): imported documents live in
  `<vault>/Documents`, and every note is mirrored as a readable Markdown file
  in `<vault>/Notes`, kept in sync on save, rename and delete
- Delete a note from its library row and an imported document from the
  Reader's document picker
- Backups are saved as `.dacebackup` files; older `.ndarchive` backups still
  restore

**Reading and research**
- Side browser (`Ctrl+Shift+A`): ChatGPT, Gemini, Perplexity or any site
  docked beside notes and papers, resizable, with sign-ins remembered
- Reader drawer with Note, Passages, Outline, Links and Info views
- Speed Reader for selected passages, documents, highlights and the current
  PDF page (`Ctrl+Shift+R`)

**App**
- Signed automatic updates from GitHub Releases, with Check for updates and
  Install and restart in Settings → About
- Light and dark mode (`Ctrl+Shift+L`), with a light-mode logo variant
- Settings for typography, layout, startup, editor, documents and backups,
  including app and text fonts chosen from the fonts installed on the device
- Workspace breadcrumb in the top bar (`DACE / <Workspace>`) and hash-based
  routing between workspaces
- Builds for Linux (`.deb`, `.rpm`, AppImage) alongside Windows (MSI, setup)
- CI that runs the frontend tests, type-check, production build and backend
  tests on Windows and Linux for every push and pull request
- Release workflow that builds installers, signed update packages and
  `latest.json` into a draft GitHub release when a version tag is pushed
  (see `RELEASING.md`)

### Changed
- Knowledge Desk: docked library, a single slim bar above the page, a page that
  grows with its text, and one side tool at a time
- Research Reader: quiet toolbar, icon-driven drawer, full-height note page,
  and a Writing layout with a small link back to the document
- Home: large clock with the greeting above and the date beneath, beside one
  clean area for continuing and recent work
- Dark mode uses neutral graphite greys instead of warm brown
- The window opens at 1280×820, centred, with a 960×600 minimum
- Quiet visual style across the app: flat surfaces, hairline structure, one
  accent colour, an 11px minimum text size and a measured reading column
- Command Palette and Shortcut Reference close when the backdrop is clicked
  and have scrollable lists

### Fixed
- PDFs could not open in release builds (the content security policy blocked
  loading the file); documents are now passed directly and previews use local
  blob URLs
- "Delete record" did nothing: a dialog opened from a menu click was closed by
  that same click
- "New record" from Home opened a different note
- `Ctrl+O` in the Reader jumped to the Knowledge Desk and attached the file to
  the note open there
- The document picker was hidden behind the note in the Reader's Writing layout
- Content, including Settings labels, slid under the navigation rail's curve,
  and the main area could scroll sideways to expose hidden panels
- Internal reader-note link tags appeared as tag chips and filters
- Bold applied after a double-click included the trailing space
- The clock showed a slashed zero
- Delete actions report failures, and a failed file delete keeps the library
  entry so it can be retried
- Modal backdrops no longer let clicks fall through to the window controls
- Remaining traces of the app's previous name were removed (data from older
  installs is still migrated automatically)

---

## [0.1.0-alpha] — 2026-11-23 (not tagged)

### Added
- Rebrand to **Dace** with automatic migration of data from installs made under
  the previous name
- **Knowledge Desk**: write, search, tag and link SQLite-backed records
- **Research Reader**: import PDFs, highlight passages, write study notes and
  connect excerpts to records
- **Knowledge Graph**: interactive force-directed graph of records and their
  relationships
- **Terminal**: shell embedded in the workspace (via `portable-pty`)
- **Backup and restore**: one-click archive export with SHA-256 fingerprints,
  validated before restore
- **Focus Space**: distraction-free full-screen mode
- **Command Palette** (`Ctrl+K`) and **Shortcut Reference** (`Ctrl+Shift+P`)
- **Managed documents**: content-addressed storage with de-duplication
- Workspace intents for cross-view communication, and a save registry that
  flushes unsaved work before the window closes
- Autosave for records and reader notes

### Infrastructure
- Tauri 2 desktop shell with custom window decorations
- SQLite via `rusqlite` (bundled) in a single user-owned database file
- Rust and frontend test suites (Node's built-in test runner)
- Release profile with LTO and `codegen-units = 1`
