# Security Policy

## Supported versions

Dace is pre-release (`0.1.x`). Security fixes go into the latest release and
the `main` branch only.

| Version | Supported |
|---------|-----------|
| Latest `0.1.x` release and `main` | ✅ |
| Older releases and commits | ❌ |

Installed copies receive fixes through the built-in updater
(**Settings → About → Check for updates**).

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately through GitHub: open the repository's **Security** tab
and choose **Report a vulnerability**. Please include:

- what the problem is and where it is
- steps to reproduce it
- the impact you expect
- a suggested fix, if you have one

You should get an acknowledgement within 72 hours and a status update within
7 days.

## How Dace handles your data

- **Local storage.** Notes, highlights and relationships are kept in a SQLite
  database in Dace's data folder (`%APPDATA%\com.dace.app` on Windows,
  `~/.local/share/com.dace.app` on Linux). Imported documents are kept there
  too, or in the vault folder you choose.
- **No account, no telemetry.** Dace does not send your notes, documents or
  usage data anywhere.
- **Backups are not encrypted.** A `.dacebackup` file contains your whole
  library in readable form; keep it somewhere you trust.

## Attack surface

- **Network**
  - *Updates:* Dace checks GitHub Releases for new versions. Every update is
    signed, and the updater rejects any package whose signature does not
    match the public key built into the app.
  - *Side browser:* sites you open (ChatGPT, Gemini, …) load in a separate
    browser view. Remote pages get no access to Dace's commands, so they
    cannot read your notes or files. The view shares the app's browser
    profile, so sign-ins persist.
- **Documents.** PDFs are rendered by `pdfjs-dist`, and text and Markdown
  files are shown as plain text. A Content-Security-Policy limits what the
  app's own pages can load.
- **Database.** SQLite parses the library database and, during restore, the
  database inside a backup. Restores are validated (SHA-256 fingerprints,
  size limits, path checks) before anything is replaced, and a recovery
  snapshot of the current library is kept.
- **File system.** Dace reads only the files you choose to import and writes
  only to its data folder, your vault folder and the backup locations you
  pick.
- **Terminal.** The embedded terminal runs a shell you start yourself; Dace
  never runs commands on its own.
- **App commands.** The frontend can only call commands that are registered
  explicitly in the Rust backend.

## Out of scope

- Attacks that need physical access to an unlocked computer
- Problems in dependencies that have no upstream fix yet
- The security of third-party sites opened in the side browser
- Social engineering
