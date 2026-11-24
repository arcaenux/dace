# Security Policy

## Supported Versions

Dace is currently in pre-release (`0.1.x`). Only the latest commit on the default branch is supported for security fixes.

| Version | Supported |
|---------|-----------|
| `0.1.x` (latest) | ✅ |
| Older commits | ❌ |

## Reporting a Vulnerability

**Please do not open a public GitHub Issue for security vulnerabilities.**

Report security issues privately by emailing the maintainer. Include:

- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested remediation (optional)

You will receive an acknowledgement within 72 hours and a status update within 7 days.

## Scope

Dace processes user-owned local files only. It makes no outbound network connections at runtime. The primary attack surface is:

- **SQLite** — user-controlled database file parsing
- **PDF rendering** — `pdfjs-dist` processes user-supplied documents in the browser sandbox
- **PTY / Terminal** — the embedded terminal runs user-initiated shell sessions; no commands are executed automatically
- **File system access** — limited to paths the user explicitly selects via native file dialogs
- **Tauri IPC** — all commands are registered explicitly; the CSP restricts what the frontend can load

## Out of Scope

- Vulnerabilities that require physical access to the user's machine
- Issues in dependencies that have no available upstream fix
- Social engineering
