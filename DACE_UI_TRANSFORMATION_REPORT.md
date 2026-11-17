# Dace Cinematic UI Transformation — Completion Report

## Scope

The existing Dace Tauri 2 / React / TypeScript / Rust / SQLite application has been
restyled against `public/ui_spec.png` without changing application workflows,
data schemas, Rust commands, backup/restore behaviour, or the PDF.js pipeline.

- Branch: `ui/cinematic-transformation`
- Commits:
  - `dc3c262` — design research and dependency rationale
  - `cff42f2` — generated asset library, local fonts, favicon, app icons, cinematic CSS layer
  - `ffd440e` — verification screenshots and hero-artwork polish

## Design direction

- Palette: `#0B0B0B`, `#141414`, `#1E1E1E`, `#2A2A2A`, `#F8EDE1`, `#CBB9A3`,
  `#8A8A8A`, `#FF8A00`, `#8A4410`, `#FF4D4D`.
- Typography: Space Grotesk (display/interface), IBM Plex Mono (technical metadata),
  Newsreader (editorial reading), Manrope (existing compatibility layer).
- Motion: CSS-only keyframes/transitions for ambient drift, entrance, signal pulse,
  and hover feedback; all motion is disabled under `prefers-reduced-motion`.
- Appearance modes: `expression` and `dull` remain available and functional. Both are
  now cinematic dark treatments; `expression` increases amber glow and contrast.

## Assets

All artwork is original and generated locally by `scripts/generate_dace_assets.py`
using Pillow, NumPy, and hand-authored SVG. No external images, paid APIs, or remote
CDN assets are used.

- Hero: `src/assets/images/hero/hero-astronaut.webp` — 1536×1024 WebP, cratered
  planetary body, seated observer, amber rim lighting, deep-black negative space,
  no text or watermark.
- Brand: `src/assets/brand/` — mark, light/dark lockups, favicon, Windows icon set.
- Landscapes/backgrounds/textures: `src/assets/images/` — planetary surfaces,
  atmospheric glow, starfield, topographic, and grain textures.
- Decorative SVG and individual UI icons: `src/assets/decorative/` and
  `src/assets/icons/`.
- Fonts: self-hosted in `src/assets/fonts/` with OFL licence files.
- Favicon: `public/favicon.svg` and `public/favicon.ico`.
- Windows/app icons: `src-tauri/icons/` regenerated at 16–512 px.

Full inventory: `DACE_ASSET_CATALOG.md`.
Research and selection rationale: `DACE_DESIGN_RESEARCH.md`.

## Dependency / licence list

| Package | Version | Licence | Purpose |
|---|---:|---|---|
| `lucide-react` | `^1.74.0` | ISC | Single consistent outline icon family |
| `@fontsource-variable/space-grotesk` | `5.3.0` | SIL OFL 1.1 | Self-hosted display/interface font |
| `@fontsource/ibm-plex-mono` | `5.3.0` | SIL OFL 1.1 | Self-hosted monospace font |
| `@fontsource-variable/newsreader` | existing | SIL OFL 1.1 | Editorial/reading font |
| `@fontsource-variable/manrope` | existing | SIL OFL 1.1 | Compatibility interface font |

Attribution: `public/fonts/ATTRIBUTION.md`.

Deliberately avoided: Three.js, GSAP, Framer Motion/Motion, Iconoir, Phosphor,
Tailwind UI, remote font CDNs, and generated image APIs.

## Screens verified in the running production app

Captures were taken from `src-tauri/target/release/dace.exe` built with
`tauri/custom-protocol`.

| File | Screen |
|---|---|
| `screenshots/workspace-home.png` | Workspace home / cinematic hero |
| `screenshots/knowledge-desk.png` | Knowledge Desk |
| `screenshots/knowledge-graph.png` | Knowledge Graph |
| `screenshots/research-reader.png` | Research Reader |
| `screenshots/command-palette.png` | Command palette |
| `screenshots/shortcut-reference.png` | Shortcut dialog |
| `screenshots/focus-space.png` | Focus space |
| `screenshots/dull-home.png` | Dull appearance mode |
| `screenshots/expression-home.png` | Expression appearance mode |

## Verification results

| Check | Result |
|---|---|
| `npm run build` | Passed (`tsc && vite build`, Vite 8.3.8) |
| `npm test` | Passed — 43 tests, 0 failures |
| `cargo build --release --features tauri/custom-protocol --manifest-path src-tauri/Cargo.toml` | Passed |
| Production app launch | Passed; screenshots captured from release binary |

Build output includes the existing large-chunk warning for the PDF.js worker and
application bundle. No PDF.js or worker source was changed.

## Remaining gaps

- The UI implementation files (`src/styles/tokens.css`, `WorkspaceIntro.tsx`,
  `WorkspaceRail.tsx`, `WorkspaceTopBar.tsx`, and the retuned legacy CSS files) remain
  uncommitted in the working tree because they are interleaved with pre-existing
  uncommitted restore/appearance work. They are present, verified, and running.
- Reader screenshots do not show an open research document because no mock or seeded
  user data was introduced.
- Legacy exact token strings are intentionally retained in `tokens.css` for existing
  test compatibility; later cinematic declarations override them at runtime.
- Both appearance modes are dark by design; the difference is intensity/glow rather
  than light-versus-dark.
