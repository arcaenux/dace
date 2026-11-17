# Dace Design Research

This document records the focused research behind the Dace visual transformation. It covers only tools, libraries, resources and licences relevant to implementing the supplied cinematic UI reference in the existing Tauri 2 / React 19 / TypeScript / Vite application.

## 1. Repository and reference audit

- Existing app stack: React 19.1, Vite 8, TypeScript 6, Tauri 2, SQLite, managed local attachments, PDF.js 4.10.38.
- No URL router. The active screen is `activeActivity` state in `src/workspace/WorkspaceShell.tsx`.
- Global style entry point is `src/App.tsx` importing `src/styles/workspace.css`, which imports `fonts.css`, `tokens.css`, `knowledge.css`, `graph.css`, `attachments.css` and `reader.css` in that order.
- Existing appearance system has two modes, `expression` and `dull`, persisted through `src/appearance/appearanceStorage.ts` and applied through `data-theme` / `theme-*` classes on the document root.
- `public/ui_spec.png` is the supplied primary visual reference (1536 × 1024 RGB). It is untracked and left untouched.
- Large amounts of pre-existing uncommitted restore/appearance/UI work were preserved. The visual work was started on a new branch `ui/cinematic-transformation` without stashing or resetting.

## 2. Image generation and visual production

### Tools evaluated

| Tool | Availability | Decision |
|---|---|---|
| Python 3.14 + Pillow 12.3 | Installed; WebP encoder available | **Selected** for seeded procedural art and raster export. |
| NumPy / SciPy | Installed | **Selected** for radial fields, noise, contour bands and optimisation. |
| CairoSVG | Installed | **Selected** for deterministic SVG → PNG rasterisation when needed. |
| FFmpeg | Installed with libwebp/libavif | Used only for evaluation; final assets are still images via Pillow. |
| Inkscape / ImageMagick / rsvg-convert | Not installed | Not depended upon. |
| CSS gradients / SVG filters / Canvas 2D | Native browser APIs | **Selected** for lightweight atmosphere and motion. |
| Paid image-generation APIs | No configured credentials or subscriptions | Deliberately not assumed or used. |

### Selected strategy

All raster artwork is generated locally by a deterministic, seeded Python generator using Pillow and NumPy. This produces original Dace-specific artwork without external licences, API keys, subscriptions or downloaded imagery.

The generator creates separate production assets rather than one flattened collage:

- cinematic hero artwork with a cratered planetary body, solitary seated figure, rocky foreground, warm amber illumination and deep negative space;
- supporting lunar/planetary-surface images;
- ambient gradients and glows;
- seamless-ish topographic, starfield and grain textures;
- master PNG source kept only in the generator pipeline, with WebP shipped to the app.

The hero is authored at a higher internal resolution and downsampled with LANCZOS before WebP export (`quality=78–82`, `method=6`). Decorative images are kept small and lazy-loaded where possible.

### Licence notes

- Pillow: HPND-style permissive licence; used as build-time tooling.
- CairoSVG: MIT; used as build-time tooling.
- FFmpeg build may be GPL-enabled; used only as a local evaluation tool and not redistributed.
- Generated artwork is original to this task and owned by the project.

## 3. SVG and vector production

### Libraries evaluated

| Library | Version / licence | Decision |
|---|---|---|
| Lucide | `lucide-react` 1.74.0, ISC, React 19 peer support | **Selected** as the single icon family for UI actions/navigation. |
| Iconoir | 7.12.2, MIT | Not selected; overlapping vocabulary and larger package. |
| Phosphor Icons | MIT | Not selected; multiple weights unnecessary for this interface. |
| Hand-authored SVG | Project-owned | **Selected** for brand mark, orbital motifs, brackets and crosshairs. |

Sources: <https://lucide.dev>, <https://registry.npmjs.org/lucide-react/latest>, <https://github.com/iconoir-icons/iconoir>, <https://github.com/phosphor-icons/react>.

Lucide is tree-shakeable with named imports. Only a small, explicit vocabulary of icons is used; no `import * as Icons` pattern is introduced. The Dace mark itself remains a custom SVG rather than a generic library glyph.

## 4. Fonts

### Initial direction

- Interface/headings: **Space Grotesk**.
- Technical metadata/commands: **IBM Plex Mono**.

### Existing fonts

The app already bundles and documents:

- Newsreader Variable (editorial/quotation serif), SIL OFL 1.1.
- Manrope Variable (interface sans), SIL OFL 1.1.

These are retained for reading comfort and existing typography tests.

### New fonts selected

| Family | Source | licence | npm package |
|---|---|---|---|
| Space Grotesk | <https://github.com/floriankarsten/space-grotesk>, <https://fonts.google.com/specimen/Space+Grotesk> | SIL OFL 1.1 | `@fontsource-variable/space-grotesk@5.3.0` |
| IBM Plex Mono | <https://github.com/IBM/plex>, <https://www.ibm.com/plex> | SIL OFL 1.1 | `@fontsource/ibm-plex-mono@5.3.0` |

Fontsource packages are self-hosted through Vite and match the existing font strategy. They avoid CDN calls at runtime, work offline in Tauri, and preserve licence files. Only latin normal subsets are imported. `public/fonts/ATTRIBUTION.md` is updated with the new families.

## 5. Motion

| Option | licence | Decision |
|---|---|---|
| CSS transitions/keyframes and transforms | Platform | **Selected** for all interaction and ambient motion. |
| Motion (formerly Framer Motion) | MIT | Not needed; CSS covers the required transitions. |
| GSAP | Custom “no charge” licence with restrictions | Avoided. |
| Three.js | MIT | Avoided: WebGL/GPU cost and ~21 MB package for purely decorative effects. |

Motion is limited to transform/opacity transitions, short panel/dialog entrances, subtle artwork drift, and focus/search feedback. All animation is disabled or reduced through the existing `prefers-reduced-motion` handling.

## 6. Open-source references

Used as technical references only; no branding, screenshots or copied product assets.

| Reference | licence | URL |
|---|---|---|
| Radix UI Primitives | MIT | <https://github.com/radix-ui/primitives> |
| shadcn/ui | MIT | <https://github.com/shadcn-ui/ui> |
| IBM Carbon | Apache-2.0 | <https://github.com/IBM/carbon> |
| GitHub Primer React | MIT | <https://github.com/primer/react> |
| Tauri icons guide | Tauri docs | <https://v2.tauri.app/develop/icons/> |

These inform accessible dialog/menu patterns and icon export conventions. No application is cloned and no third-party branding is reused.

## 7. Dependencies

### Added

- `lucide-react@^1.74.0` — single consistent outline icon family (ISC).
- `@fontsource-variable/space-grotesk@^5.3.0` — self-hosted display/interface font (OFL-1.1).
- `@fontsource/ibm-plex-mono@^5.3.0` — self-hosted technical font (OFL-1.1).

### Deliberately avoided

- Three.js, GSAP, Framer Motion/Motion.
- Iconoir, Phosphor Icons, large icon bundles.
- Tailwind CSS and Tailwind UI markup.
- Any remote font/CDN or remote image dependency.
- Any database, attachment, backup, restore or PDF.js dependency changes.

## 8. Asset production and integration strategy

1. Generate all raster assets locally with a committed seeded Python generator.
2. Export production WebP files to `src/assets/images/{hero,backgrounds,textures}`.
3. Hand-author SVG brand/decorative assets in `src/assets/brand`, `src/assets/decorative`, and action/navigation/status icon SVGs where a custom glyph is required.
4. Use Lucide for common UI icons and keep the custom Dace mark distinct.
5. Extend `src/styles/tokens.css` with cinematic palette, typography, spacing, glow, shadow and motion tokens while preserving both appearance modes.
6. Add a shared UI layer in CSS rather than scattering new hardcodes through components.
7. Integrate the hero into `WorkspaceIntro.tsx` and use atmosphere assets only where they support reading.
8. Restyle all existing screens through the shared token/component layer, preserving functionality and the no-router activity model.
9. Verify with `npm test`, `npm run build`, Tauri build, and a launched desktop application with screenshots.
