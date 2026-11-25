# Dace

**A space for discovery.**

Dace is a local-first, offline personal knowledge and research workspace. It is built for people who read deeply, think carefully, and want a single distraction-free environment for importing documents, building annotated knowledge records, mapping relationships, and writing.

No cloud. No subscription. Everything lives on your machine, in an open SQLite database you own.

---

## Features

| Workspace | What it does |
|-----------|-------------|
| **Home** | Central launchpad with quick access to recent records, documents, and workspace commands |
| **Knowledge Desk** | Author, search, tag, and link structured knowledge records backed by SQLite |
| **Research Reader** | Import PDFs, highlight passages, write study notes, and connect excerpts to knowledge records |
| **Knowledge Graph** | Interactive force-directed graph of all records and their relationships |
| **Terminal** | Native PTY shell embedded directly into the workspace |
| **Settings** | Persistent preferences for typography, layout, startup behaviour, and backup paths |

### Core capabilities

- **Local-first SQLite** — all records, highlights, attachments, and relationships are stored in a single portable `.db` file
- **Managed attachments** — content-addressed storage for research documents; files are deduplicated and never overwritten
- **Backup & restore** — one-click encrypted archive export and fingerprint-verified restore
- **Focus Space** — distraction-free full-screen mode for deep reading and writing sessions
- **Command palette** — `Ctrl+K` global command and navigation launcher
- **Keyboard-first** — full shortcut coverage for every workspace action

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [Tauri v2](https://v2.tauri.app) |
| Frontend | React 19 + TypeScript |
| Bundler | Vite 8 |
| Backend | Rust (stable) |
| Database | SQLite via `rusqlite` (bundled) |
| PDF rendering | `pdfjs-dist` |
| Terminal | `portable-pty` + `xterm.js` |
| Typography | Manrope · Newsreader · IBM Plex Mono |

---

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | 20 LTS or 22 LTS |
| Rust toolchain | stable (via [rustup](https://rustup.rs)) |
| Tauri CLI | v2 (installed via npm) |
| Windows | 10 or 11 (primary platform) |

> **macOS / Linux:** Tauri v2 supports both platforms; builds are not yet tested on non-Windows targets in this repository. Community contributions welcome.

---

## Getting Started

### 1. Clone

```bash
git clone https://github.com/arcaenux/dace.git
cd dace
```

### 2. Install dependencies

```bash
npm install
```

### 3. Run in development mode

```bash
npm run tauri dev
```

This starts the Vite dev server and the Tauri application window together. Hot-reload is active for the frontend; Rust changes require a restart.

### 4. Run tests

```bash
# Frontend (TypeScript, Node test runner)
npm test

# Rust backend
cargo test --manifest-path src-tauri/Cargo.toml
```

### 5. Type-check only

```bash
npx tsc --noEmit
```

### 6. Production build

```bash
npm run tauri build
```

The installer is written to `src-tauri/target/release/bundle/`.

---

## Project Structure

```
dace/
├── src/                        # React + TypeScript frontend
│   ├── core/                   # Command registry, keyboard shortcuts, intents, save registry
│   ├── workspace/              # Shell, rail, top bar, navigation
│   ├── knowledge/              # Knowledge Desk — records, editor, relationships
│   ├── reader/                 # Research Reader — PDF viewer, highlights, notes
│   ├── graph/                  # Knowledge Graph — force-directed canvas
│   ├── terminal/               # Embedded PTY terminal
│   ├── settings/               # Persistent user preferences
│   ├── backup/                 # Backup export and restore UI
│   ├── attachments/            # Attachment detail and document preview modals
│   ├── overlays/               # Command palette, shortcut reference
│   ├── focus/                  # Focus Space context and view
│   └── styles/                 # Design token system and workspace CSS
├── src-tauri/                  # Rust backend (Tauri v2)
│   ├── src/
│   │   ├── lib.rs              # Tauri command registrations
│   │   ├── backup/             # Archive export and restore
│   │   └── ...                 # DB, attachments, records, terminal, settings
│   ├── Cargo.toml
│   └── tauri.conf.json
├── tests/                      # Node test runner suites (83 tests)
├── public/                     # Static assets (favicon)
└── index.html
```

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+K` | Open Command Palette |
| `Ctrl+Shift+P` | Open Shortcut Reference |
| `Ctrl+N` | New Knowledge Record |
| `Ctrl+S` | Save Active Record or Note |
| `Ctrl+O` | Import Research Document |
| `Ctrl+Shift+F` | Search Knowledge Records |
| `Ctrl+B` | Toggle Navigation Rail |
| `F11` | Toggle Focus Space |
| `Alt+1–6` | Switch Workspace (Home, Desk, Graph, Reader, Settings, Terminal) |
| `Alt+Shift+1–3` | Reader Layout (Reading, Research, Writing) |
| `Esc` | Dismiss overlay / exit Focus Space |
| `?` | Open Shortcut Reference (outside inputs) |

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide, including branch conventions, commit format, and the test requirements for new code.

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

---

## License

MIT © Dace contributors. See [LICENSE](LICENSE).
