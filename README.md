# Dace

**A research workspace for reading, highlighting and writing.**

Dace is a desktop app for people who read deeply and write about what they
read. Import papers and documents, highlight passages, write notes beside the
source, link ideas together, and see how they connect.

Your library lives on your own computer, in a SQLite database and a document
folder you can choose. There is no account, no subscription and no telemetry.

---

## What you can do

| Area | What it does |
|------|--------------|
| **Home** | A clock and date, your most recent note to continue, recent records, and quick ways into each workspace |
| **Knowledge Desk** | Write and organise notes: a docked library with search and tag filters, a clean writing page, and one side tool at a time (Outline, Connections, Documents, Graph, Info) |
| **Research Reader** | Read PDFs, Markdown and text files; highlight passages by type; write a note beside the document; see passages, the document outline, linked records and file info |
| **Knowledge Graph** | An interactive map of your records and the relationships between them |
| **Side browser** | Keep ChatGPT, Gemini, Perplexity or any other site open beside your notes or paper, to copy text across (`Ctrl+Shift+A`) |
| **Terminal** | A shell inside the app |
| **Settings** | Appearance, fonts, startup, editor, documents and storage (including the vault folder), backup and recovery, updates |

### Writing

- **Write normally.** Text is shown formatted, never as Markdown symbols.
- **Select text to format it.** A small toolbar appears over the selection:
  bold, italic, underline, strikethrough, highlight, code, link, headings,
  bulleted, numbered and check lists, quotes, and clear formatting.
- **Or type the symbols if you know them.** `# ` starts a heading, `- ` a
  list and `> ` a quote, while `**bold**`, `*italic*` and `==highlight==`
  turn into formatting as soon as they are closed.
- Notes are saved automatically and stored as Markdown.

### Your data

- **Vault folder.** In **Settings → Documents & storage** you can choose a
  folder (for example inside OneDrive or Dropbox). Imported documents are kept
  in `<vault>/Documents`, and every note is also written as a readable Markdown
  file in `<vault>/Notes`, kept up to date as you edit, rename and delete.
  Without a vault, documents stay in Dace's own data folder.
- **Backups.** **Settings → Backup & recovery** exports your whole library
  (database and documents) to a single `.dacebackup` file, checked with SHA-256
  fingerprints. Restoring validates the file first and keeps a recovery
  snapshot of your current library. Backups are not encrypted, so store them
  somewhere you trust. Older `.ndarchive` backups can still be restored.
- **Imported documents** are stored by content hash, so the same file is never
  stored twice and damaged files can be detected.

Dace's own data folder is `%APPDATA%\com.dace.app` on Windows and
`~/.local/share/com.dace.app` on Linux.

### Network use

Dace works offline. It only goes online to:

- check GitHub Releases for a signed update (shortly after launch, and from
  **Settings → About**), and
- load the sites you open in the side browser.

---

## Platforms

| Platform | Status |
|----------|--------|
| Windows 10 / 11 | Primary platform: MSI and setup installers |
| Linux | Built in CI as `.deb`, `.rpm` and AppImage; less tested than Windows |
| macOS | Not built or tested yet |

---

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+K` | Command palette |
| `Ctrl+Shift+P` or `?` | Keyboard shortcut reference (`?` outside text fields) |
| `Ctrl+N` | New record |
| `Ctrl+S` | Save the open record or note now |
| `Ctrl+O` | Import a document |
| `Ctrl+Shift+F` | Search records |
| `Ctrl+Shift+A` | Show or hide the side browser |
| `Ctrl+Shift+L` | Switch light / dark mode |
| `Ctrl+Shift+R` | Speed Read (in the Reader) |
| `Ctrl+B` | Hide or show the navigation rail (outside the writing area) |
| `Ctrl+B` / `Ctrl+I` / `Ctrl+U` | Bold / italic / underline (while writing) |
| `F11` | Focus Space |
| `Alt+1` … `Alt+6` | Home, Knowledge Desk, Knowledge Graph, Reader, Settings, Terminal |
| `Alt+Shift+1` … `Alt+Shift+3` | Reader layout: Reading, Research, Writing |
| `Esc` | Close the open overlay, or leave Focus Space |

---

## Development

### Prerequisites

| Tool | Version |
|------|---------|
| Node.js | 22.6 or newer (the test runner uses `--experimental-strip-types`) |
| Rust | stable, via [rustup](https://rustup.rs) |
| Windows | Microsoft Edge WebView2 (preinstalled on Windows 10 and 11) |
| Linux | `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, `patchelf`, `libgtk-3-dev` |

### Get started

```bash
git clone https://github.com/arcaenux/dace.git
cd dace
npm install
npm run tauri dev
```

`npm run tauri dev` starts the Vite dev server and the app window together.
Frontend changes reload instantly; Rust changes rebuild the app.

### Check your changes

```bash
npm test                                        # frontend tests (Node test runner)
cargo test --manifest-path src-tauri/Cargo.toml # backend tests
npx tsc --noEmit                                # type-check
```

### Build installers

```bash
npm run tauri build
```

Installers are written to `src-tauri/target/release/bundle/`. Official
releases are built by GitHub Actions; see [RELEASING.md](RELEASING.md).

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| App framework | [Tauri 2](https://v2.tauri.app) |
| Frontend | React 19, TypeScript, Vite |
| Writing editor | [Tiptap 3](https://tiptap.dev) with Markdown storage |
| Backend | Rust (stable) |
| Database | SQLite via `rusqlite` (bundled), with full-text search when available |
| Documents | `pdfjs-dist` for PDFs |
| Terminal | `portable-pty` and `xterm.js` |
| Updates | Tauri updater plugin, signed releases from GitHub |

---

## Project structure

```
dace/
├── src/                     React + TypeScript frontend
│   ├── workspace/           App shell, navigation rail, top bar, home screen
│   ├── knowledge/           Knowledge Desk: library, editor, context panel, relationships
│   ├── editor/              Rich-text writing editor (shared by Desk and Reader)
│   ├── reader/              Research Reader: PDF and text viewers, highlights, notes, Speed Read
│   ├── graph/               Knowledge Graph
│   ├── assistant/           Side browser panel
│   ├── attachments/         Document storage API and previews
│   ├── backup/              Backup and restore dialogs
│   ├── settings/            Settings view, vault, updates, fonts
│   ├── terminal/            Embedded terminal
│   ├── overlays/            Command palette, shortcut reference
│   ├── focus/               Focus Space
│   ├── core/                Intents, commands, keyboard shortcuts, save coordination
│   └── styles/              Design tokens and stylesheets
├── src-tauri/               Rust backend
│   ├── src/
│   │   ├── knowledge/       Records, tags, relationships, graph
│   │   ├── attachments/     Content-addressed document storage
│   │   ├── reader/          Highlights, annotations, excerpts
│   │   ├── backup/          Backup export and safe restore
│   │   ├── vault.rs         Vault folder and Markdown note files
│   │   ├── assistant.rs     Side browser view
│   │   ├── settings/        Preferences and app info
│   │   ├── terminal/        PTY sessions
│   │   ├── migration.rs     Moves data from installs made under the app's previous name
│   │   └── lib.rs           App setup and command registration
│   └── tauri.conf.json
├── tests/                   Frontend test suites
└── .github/workflows/       CI and release builds (Windows and Linux)
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Report security issues as described
in [SECURITY.md](SECURITY.md).

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

MIT © Dace contributors. See [LICENSE](LICENSE).
