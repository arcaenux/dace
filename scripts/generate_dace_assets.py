#!/usr/bin/env python3
"""Deterministic, original asset generation for Dace.

All raster imagery is produced locally with Pillow + NumPy. No external images,
API keys, subscriptions or network calls are used. Re-run this file to recreate
the complete asset library.
"""

from __future__ import annotations

import math
import random
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "src" / "assets"
BRAND = ASSETS / "brand"
APP_ICONS = BRAND / "app-icons"
IMAGES = ASSETS / "images"
HERO = IMAGES / "hero"
BACKGROUNDS = IMAGES / "backgrounds"
TEXTURES = IMAGES / "textures"
ICONS = ASSETS / "icons"
DECORATIVE = ASSETS / "decorative"
FONTS = ASSETS / "fonts"

for directory in (
    APP_ICONS,
    HERO,
    BACKGROUNDS,
    TEXTURES,
    ICONS / "navigation",
    ICONS / "workspace",
    ICONS / "actions",
    ICONS / "status",
    DECORATIVE,
    FONTS / "space-grotesk",
    FONTS / "ibm-plex-mono",
):
    directory.mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------------------
# Noise helpers
# ---------------------------------------------------------------------------


def value_noise(shape: tuple[int, int], cells: tuple[int, int], seed: int, tileable: bool = False) -> np.ndarray:
    h, w = shape
    rng = np.random.default_rng(seed)
    gh, gw = cells[1] + 1, cells[0] + 1
    grid = rng.random((gh, gw)).astype(np.float32)
    if tileable:
        grid[-1, :] = grid[0, :]
        grid[:, -1] = grid[:, 0]
    else:
        grid[-1, :] = grid[-2, :]
        grid[:, -1] = grid[:, -2]
    image = Image.fromarray((grid * 255).astype(np.uint8), mode="L")
    upscaled = image.resize((w, h), Image.Resampling.BICUBIC)
    return np.asarray(upscaled, dtype=np.float32) / 255.0


def fbm(shape: tuple[int, int], seed: int, octaves: int = 5, base: int = 4, tileable: bool = False) -> np.ndarray:
    total = np.zeros(shape, dtype=np.float32)
    amplitude = 1.0
    norm = 0.0
    cells = base
    for octave in range(octaves):
        total += value_noise(shape, (cells, cells), seed + octave * 101, tileable) * amplitude
        norm += amplitude
        amplitude *= 0.52
        cells *= 2
    return total / norm


def save_webp(array: np.ndarray, path: Path, quality: int = 80) -> None:
    image = Image.fromarray(np.clip(array, 0, 255).astype(np.uint8), mode="RGB")
    image.save(path, "WEBP", quality=quality, method=6, exact=True)


def save_webp_rgba(image: Image.Image, path: Path, quality: int = 82) -> None:
    image.save(path, "WEBP", quality=quality, method=6, exact=True)


# ---------------------------------------------------------------------------
# Hero artwork
# ---------------------------------------------------------------------------


def draw_seated_figure(size: float = 1.0) -> Image.Image:
    """Small original silhouette of a seated observer, with a warm rim light."""
    canvas = Image.new("RGBA", (180, 220), (0, 0, 0, 0))
    d = ImageDraw.Draw(canvas)
    silhouette = (9, 7, 6, 255)
    rim = (148, 78, 24, 150)

    # Rock seat
    d.polygon([(28, 170), (52, 146), (126, 150), (154, 176), (142, 194), (38, 192)], fill=silhouette)

    # Head and neck
    d.ellipse((70, 24, 100, 56), fill=silhouette)
    d.polygon([(80, 52), (92, 52), (96, 70), (76, 70)], fill=silhouette)

    # Torso leaning slightly forward
    d.polygon([(68, 64), (98, 62), (112, 116), (72, 124)], fill=silhouette)

    # Upper arms reaching to knees
    d.line([(76, 74), (58, 112), (66, 132)], fill=silhouette, width=13, joint="curve")
    d.line([(98, 72), (122, 110), (116, 132)], fill=silhouette, width=13, joint="curve")

    # Bent legs
    d.polygon([(72, 118), (104, 112), (132, 140), (120, 154), (88, 136), (66, 138)], fill=silhouette)
    d.polygon([(118, 150), (138, 140), (154, 170), (146, 180), (120, 170)], fill=silhouette)
    d.polygon([(64, 136), (88, 134), (84, 170), (72, 176), (52, 164)], fill=silhouette)

    # Restrained amber rim on the illuminated edge
    d.line([(70, 30), (66, 50), (70, 64)], fill=rim, width=3, joint="curve")
    d.line([(68, 66), (62, 98), (57, 112)], fill=rim, width=3, joint="curve")
    d.line([(52, 146), (38, 166)], fill=rim, width=2)
    if size != 1.0:
        new = (max(1, int(canvas.width * size)), max(1, int(canvas.height * size)))
        canvas = canvas.resize(new, Image.Resampling.LANCZOS)
    return canvas


def planet_layer(shape: tuple[int, int], center: tuple[float, float], radius: float, seed: int, craters: int = 85) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    h, w = shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    cx, cy = center
    dist = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
    mask = dist <= radius

    nx = (xx - cx) / radius
    ny = (yy - cy) / radius
    nz = np.sqrt(np.clip(1.0 - nx * nx - ny * ny, 0.0, 1.0))

    height = fbm(shape, seed=seed, octaves=6, base=5) * 0.55
    rng = np.random.default_rng(seed + 900)
    for _ in range(craters):
        angle = rng.uniform(0, math.tau)
        radial = math.sqrt(rng.random()) * 0.9
        crater_x = cx + math.cos(angle) * radial * radius
        crater_y = cy + math.sin(angle) * radial * radius
        crater_r = rng.uniform(0.012, 0.062) * radius
        d = np.sqrt((xx - crater_x) ** 2 + (yy - crater_y) ** 2) / crater_r
        depth = rng.uniform(0.16, 0.42)
        profile = -depth * np.exp(-((d / 0.56) ** 2))
        profile += depth * 0.85 * np.exp(-(((d - 0.82) / 0.14) ** 2))
        profile -= depth * 0.55 * np.exp(-(((d - 1.08) / 0.10) ** 2))
        height += profile

    gy, gx = np.gradient(height)
    light = np.array([-0.52, -0.38, 0.77], dtype=np.float32)
    light /= np.linalg.norm(light)
    diffuse = np.clip(nx * light[0] + ny * light[1] + nz * light[2], 0.0, 1.0)
    slope = gx * light[0] * 105.0 + gy * light[1] * 105.0
    shade = np.clip(0.12 + diffuse * 0.92 + slope, 0.0, 1.28)

    base = np.array([78.0, 57.0, 40.0], dtype=np.float32)
    warm = np.array([92.0, 44.0, 10.0], dtype=np.float32)
    color = base * shade[..., None] + warm * (diffuse**3.0)[..., None]
    color *= (0.92 + fbm(shape, seed + 7, octaves=3, base=12) * 0.16)[..., None]
    return np.clip(color, 0, 255).astype(np.float32), mask, diffuse


def make_hero() -> None:
    w, h = 1536, 1024
    shape = (h, w)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)

    arr = np.zeros((h, w, 3), dtype=np.float32)
    arr[:] = np.array([7.0, 7.0, 8.0], dtype=np.float32)

    # Deep amber atmospheric field.
    dx = (xx - w * 0.70) / (w * 0.62)
    dy = (yy - h * 0.40) / (h * 0.78)
    atmosphere = np.exp(-(dx * dx + dy * dy) * 2.4)
    arr += atmosphere[..., None] * np.array([46.0, 23.0, 7.0], dtype=np.float32)
    arr += (1.0 - yy / h)[..., None] * np.array([4.0, 3.0, 2.0], dtype=np.float32)

    # Sparse, restrained stars.
    star_img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    star_draw = ImageDraw.Draw(star_img)
    rng = random.Random(31)
    for _ in range(260):
        sx = rng.uniform(0, w)
        sy = rng.uniform(0, h * 0.82)
        if w * 0.42 < sx < w * 0.98 and h * 0.08 < sy < h * 0.68:
            continue
        brightness = rng.randint(26, 105)
        radius = rng.choice([1, 1, 1, 2])
        star_draw.ellipse((sx, sy, sx + radius, sy + radius), fill=(255, 226, 190, brightness))
    star_array = np.asarray(star_img, dtype=np.float32) / 255.0
    arr += star_array[..., :3] * star_array[..., 3:4]

    # Planet and limb glow.
    planet, mask, diffuse = planet_layer(shape, (w * 0.69, h * 0.375), w * 0.305, seed=17, craters=92)
    limb = np.exp(-(((np.sqrt((xx - w * 0.69) ** 2 + (yy - h * 0.375) ** 2) - w * 0.305) / (w * 0.025)) ** 2))
    arr += limb[..., None] * np.array([54.0, 24.0, 5.0], dtype=np.float32) * 0.55
    arr[mask] = planet[mask]

    # Soft outer bloom behind the planet.
    bloom = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    bd = ImageDraw.Draw(bloom)
    bd.ellipse((w * 0.36, h * 0.04, w * 1.04, h * 0.76), fill=(255, 132, 30, 26))
    bloom = bloom.filter(ImageFilter.GaussianBlur(radius=110))
    arr += np.asarray(bloom, dtype=np.float32)[..., :3] / 255.0 * np.asarray(bloom, dtype=np.float32)[..., 3:4] / 255.0 * np.array([90.0, 38.0, 8.0])

    # Rocky foreground ridge.
    ridge_noise = fbm((1, w), seed=51, octaves=5, base=8)[0]
    ridge = h * 0.805 + (ridge_noise - 0.5) * 92.0 + np.sin(xx[0] / 170.0) * 9.0
    foreground = yy >= ridge[None, :]
    arr[foreground] = arr[foreground] * 0.16 + np.array([4.0, 3.0, 3.0], dtype=np.float32)
    rim = np.exp(-(((yy - ridge[None, :]) / 3.2) ** 2))
    arr += rim[..., None] * np.array([74.0, 33.0, 8.0], dtype=np.float32) * 0.45

    # A few foreground rocks give the seated figure a physical ledge.
    rocks = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    rd = ImageDraw.Draw(rocks)
    rr = random.Random(77)
    for _ in range(28):
        rx = rr.uniform(w * 0.36, w)
        ry = rr.uniform(h * 0.82, h * 0.98)
        rw = rr.uniform(26, 120)
        rh = rr.uniform(10, 46)
        rd.polygon(
            [
                (rx - rw, ry),
                (rx - rw * 0.4, ry - rh),
                (rx + rw * 0.5, ry - rh * 0.7),
                (rx + rw, ry),
            ],
            fill=(8, 6, 5, 255),
        )
        rd.line([(rx - rw * 0.4, ry - rh), (rx + rw * 0.5, ry - rh * 0.7)], fill=(92, 44, 12, 90), width=2)
    rock_array = np.asarray(rocks, dtype=np.float32) / 255.0
    arr = arr * (1 - rock_array[..., 3:4]) + rock_array[..., :3] * rock_array[..., 3:4]

    # Solitary observer.
    figure = draw_seated_figure(1.05)
    fx, fy = int(w * 0.575), int(h * 0.69)
    figure_array = np.asarray(figure, dtype=np.float32) / 255.0
    alpha = figure_array[..., 3:4]
    region = arr[fy : fy + figure.height, fx : fx + figure.width]
    region[:] = region * (1 - alpha) + figure_array[..., :3] * alpha

    # Final cinematic grade and vignette.
    vx = (xx / w - 0.5) * 2.0
    vy = (yy / h - 0.5) * 2.0
    vignette = np.clip(1.0 - (vx * vx + vy * vy) * 0.32, 0.42, 1.0)[..., None]
    arr *= vignette
    arr += (fbm(shape, seed=91, octaves=2, base=180) - 0.5)[..., None] * 5.0
    arr[..., 0] += 2.0

    save_webp(arr, HERO / "hero-astronaut.webp", quality=81)


def make_landscape_images() -> None:
    w, h = 1280, 800
    shape = (h, w)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)

    arr = np.zeros((h, w, 3), dtype=np.float32) + np.array([6, 6, 7], dtype=np.float32)
    glow = np.exp(-(((xx - w * 0.63) / (w * 0.55)) ** 2 + ((yy - h * 0.34) / (h * 0.65)) ** 2) * 2.1)
    arr += glow[..., None] * np.array([38, 19, 6], dtype=np.float32)

    planet, mask, _ = planet_layer(shape, (w * 0.72, h * 0.30), w * 0.24, seed=23, craters=70)
    arr[mask] = planet[mask] * 0.92

    ridge = h * 0.74 + (fbm((1, w), seed=35, octaves=4, base=7)[0] - 0.5) * 110
    fg = yy >= ridge[None, :]
    arr[fg] = arr[fg] * 0.13 + np.array([4, 3, 3], dtype=np.float32)
    arr += np.exp(-(((yy - ridge[None, :]) / 4) ** 2))[..., None] * np.array([60, 26, 6])
    save_webp(arr, HERO / "lunar-landscape.webp", quality=78)

    # Close planetary surface texture.
    sw, sh = 1024, 1024
    syy, sxx = np.mgrid[0:sh, 0:sw].astype(np.float32)
    surf = fbm((sh, sw), seed=61, octaves=6, base=6) * 0.6
    rng = np.random.default_rng(62)
    for _ in range(115):
        cx, cy = rng.uniform(0, sw), rng.uniform(0, sh)
        r = rng.uniform(8, 62)
        d = np.sqrt((sxx - cx) ** 2 + (syy - cy) ** 2) / r
        surf += -0.35 * np.exp(-((d / 0.6) ** 2)) + 0.30 * np.exp(-(((d - 0.82) / 0.15) ** 2))
    gy, gx = np.gradient(surf)
    shade = np.clip(0.42 + gx * 70 - gy * 46 + surf * 0.34, 0, 1)
    surface = np.array([72, 53, 38], dtype=np.float32) * shade[..., None]
    surface += np.array([58, 26, 5], dtype=np.float32) * (shade**3)[..., None]
    save_webp(surface, HERO / "planetary-surface.webp", quality=76)


def make_backgrounds() -> None:
    w, h = 1600, 1000
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)

    d = np.sqrt(((xx - w * 0.62) / (w * 0.72)) ** 2 + ((yy - h * 0.42) / (h * 0.85)) ** 2)
    ambient = np.exp(-(d**2) * 1.8)
    ambient_arr = np.zeros((h, w, 3), dtype=np.float32)
    ambient_arr[:] = np.array([8, 8, 9], dtype=np.float32)
    ambient_arr += ambient[..., None] * np.array([44, 21, 6], dtype=np.float32)
    save_webp(ambient_arr, BACKGROUNDS / "ambient-gradient.webp", quality=74)

    glow = Image.new("RGBA", (1200, 800), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse((180, 110, 1020, 690), fill=(255, 138, 24, 128))
    glow = glow.filter(ImageFilter.GaussianBlur(radius=150))
    save_webp_rgba(glow, BACKGROUNDS / "atmospheric-glow.webp", quality=72)

    lw, lh = 1600, 900
    ly, lx = np.mgrid[0:lh, 0:lw].astype(np.float32)
    dark = np.zeros((lh, lw, 3), dtype=np.float32) + np.array([7, 7, 8], dtype=np.float32)
    dark += np.exp(-(((lx - lw * 0.7) / (lw * 0.5)) ** 2 + ((ly - lh * 0.3) / (lh * 0.8)) ** 2) * 2.0)[..., None] * np.array([24, 12, 4])
    ridge = lh * 0.72 + (fbm((1, lw), seed=83, octaves=4, base=6)[0] - 0.5) * 90
    mask = ly >= ridge[None, :]
    dark[mask] = dark[mask] * 0.2 + np.array([3, 3, 3], dtype=np.float32)
    save_webp(dark, BACKGROUNDS / "dark-landscape.webp", quality=72)


def make_textures() -> None:
    size = 512
    noise = fbm((size, size), seed=101, octaves=6, base=6, tileable=True)
    bands = np.floor(noise * 14.0) / 14.0
    edges = np.abs(np.gradient(bands, axis=0)) + np.abs(np.gradient(bands, axis=1))
    lines = np.clip(edges * 42.0, 0, 1)
    topo = np.zeros((size, size, 3), dtype=np.float32) + np.array([12, 11, 10], dtype=np.float32)
    topo += lines[..., None] * np.array([94, 57, 24], dtype=np.float32) * 0.55
    save_webp(topo, TEXTURES / "topographic.webp", quality=70)

    stars = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    sd = ImageDraw.Draw(stars)
    rng = random.Random(211)
    for _ in range(520):
        sx, sy = rng.uniform(0, 1024), rng.uniform(0, 1024)
        a = rng.randint(18, 120)
        r = rng.choice([1, 1, 1, 2])
        sd.ellipse((sx, sy, sx + r, sy + r), fill=(255, 236, 208, a))
    for _ in range(14):
        sx, sy = rng.uniform(0, 1024), rng.uniform(0, 1024)
        sd.ellipse((sx, sy, sx + 2, sy + 2), fill=(255, 176, 88, 170))
    save_webp_rgba(stars, TEXTURES / "starfield.webp", quality=68)

    rng = np.random.default_rng(307)
    grain = rng.normal(0, 1, (512, 512)).astype(np.float32)
    grain = np.clip(128 + grain * 9, 0, 255)
    grain_arr = np.repeat(grain[..., None], 3, axis=2)
    save_webp(grain_arr, TEXTURES / "subtle-grain.webp", quality=62)


# ---------------------------------------------------------------------------
# SVG assets
# ---------------------------------------------------------------------------


MARK_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
  <circle cx="32" cy="32" r="25" stroke="#F8EDE1" stroke-width="2.2"/>
  <path d="M20 42V22h8.5c7.2 0 11.5 4.2 11.5 10s-4.3 10-11.5 10H20Z" stroke="#F8EDE1" stroke-width="2.6" stroke-linejoin="round"/>
  <ellipse cx="32" cy="32" rx="29" ry="11" transform="rotate(-24 32 32)" stroke="#FF8A00" stroke-width="1.8" opacity=".9"/>
  <circle cx="54.6" cy="20.4" r="3.2" fill="#FF8A00"/>
</svg>
"""

LOGO_LIGHT_SVG = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 80" fill="none">
  <g transform="translate(4 8) scale(.9)">{MARK_SVG.replace('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">', '').replace('</svg>', '')}</g>
  <text x="78" y="43" fill="#F8EDE1" font-family="Space Grotesk, sans-serif" font-size="34" font-weight="600" letter-spacing="7">DACE</text>
  <text x="80" y="63" fill="#CBB9A3" font-family="IBM Plex Mono, monospace" font-size="10" letter-spacing="2.4">A SPACE FOR DISCOVERY</text>
</svg>
"""

LOGO_DARK_SVG = LOGO_LIGHT_SVG.replace('#F8EDE1', '#0B0B0B').replace('#CBB9A3', '#5A5046').replace('#FF8A00', '#8A4410')

FAVICON_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#0B0B0B"/>
  <circle cx="32" cy="32" r="22" fill="none" stroke="#F8EDE1" stroke-width="2"/>
  <path d="M22 42V22h7.5c6.2 0 10 3.7 10 10s-3.8 10-10 10H22Z" fill="none" stroke="#F8EDE1" stroke-width="2.6"/>
  <ellipse cx="32" cy="32" rx="27" ry="10" transform="rotate(-24 32 32)" fill="none" stroke="#FF8A00" stroke-width="1.7"/>
  <circle cx="52" cy="21" r="3" fill="#FF8A00"/>
</svg>
"""


def write_svg(path: Path, content: str) -> None:
    path.write_text(content.strip() + "\n", encoding="utf-8")


def make_brand_svgs() -> None:
    write_svg(BRAND / "dace-mark.svg", MARK_SVG)
    write_svg(BRAND / "dace-logo.svg", LOGO_LIGHT_SVG)
    write_svg(BRAND / "dace-logo-light.svg", LOGO_LIGHT_SVG)
    write_svg(BRAND / "dace-logo-dark.svg", LOGO_DARK_SVG)
    write_svg(APP_ICONS / "favicon.svg", FAVICON_SVG)
    write_svg(ROOT / "public" / "favicon.svg", FAVICON_SVG)


def make_decorative_svgs() -> None:
    assets = {
        "orbit-arc.svg": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" fill="none"><path d="M32 184C58 92 142 38 218 62" stroke="#FF8A00" stroke-width="1.2" opacity=".55"/><circle cx="218" cy="62" r="3" fill="#FF8A00"/></svg>',
        "orbit-ring.svg": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" fill="none"><ellipse cx="120" cy="120" rx="104" ry="46" transform="rotate(-24 120 120)" stroke="#CBB9A3" stroke-width="1" opacity=".36"/><circle cx="120" cy="120" r="68" stroke="#CBB9A3" stroke-width="1" opacity=".2"/></svg>',
        "corner-bracket.svg": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" fill="none"><path d="M3 15V3h12M25 3h12v12M37 25v12H25M15 37H3V25" stroke="#FF8A00" stroke-width="1.6"/></svg>',
        "crosshair.svg": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="10" stroke="#CBB9A3" stroke-width="1"/><path d="M20 2v10M20 28v10M2 20h10M28 20h10" stroke="#FF8A00" stroke-width="1.2"/></svg>',
        "diagonal-slash.svg": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" fill="none"><path d="M6 34 34 6" stroke="#FF8A00" stroke-width="2"/><path d="M14 34 34 14" stroke="#F8EDE1" stroke-width=".8" opacity=".5"/></svg>',
        "planetary-ring.svg": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" fill="none"><circle cx="120" cy="120" r="56" fill="#141414" stroke="#CBB9A3" stroke-width="1"/><ellipse cx="120" cy="120" rx="106" ry="34" transform="rotate(-18 120 120)" stroke="#FF8A00" stroke-width="1.4" opacity=".75"/></svg>',
        "ambient-glow.svg": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" fill="none"><defs><radialGradient id="g"><stop stop-color="#FF8A00" stop-opacity=".32"/><stop offset="1" stop-color="#FF8A00" stop-opacity="0"/></radialGradient></defs><circle cx="200" cy="200" r="200" fill="url(#g)"/></svg>',
    }
    for name, content in assets.items():
        write_svg(DECORATIVE / name, content)


def make_icons() -> None:
    icons: dict[str, dict[str, str]] = {
        "navigation": {
            "home.svg": '<path d="m4 10 8-6 8 6v9a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z"/>',
            "spaces.svg": '<rect x="3" y="4" width="7" height="7" rx="1"/><rect x="14" y="4" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="6" rx="1"/><rect x="14" y="14" width="7" height="6" rx="1"/>',
            "knowledge.svg": '<path d="M5 4h11l3 3v13H5z"/><path d="M8 9h8M8 13h8M8 17h5"/>',
            "graph.svg": '<circle cx="6" cy="7" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="m7.7 8.2 8.5-1.5M7.3 8.8l3.5 7.7M17 7.8l-3.8 8.6"/>',
            "reader.svg": '<path d="M4 5h7a3 3 0 0 1 3 3v11a3 3 0 0 0-3-3H4z"/><path d="M20 5h-3a3 3 0 0 0-3 3v11a3 3 0 0 1 3-3h3z"/>',
            "files.svg": '<path d="M8 3h7l4 4v14H8z"/><path d="M15 3v5h4M5 7h7l4 4v10H5z"/>',
            "search.svg": '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
        },
        "workspace": {
            "command.svg": '<path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z"/>',
            "focus.svg": '<path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5"/><circle cx="12" cy="12" r="3"/>',
            "settings.svg": '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1-2.8 2.8-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21h-4v-.2a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1L4.2 17l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3v-4h.2a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8L4.2 7 7 4.2l.1.1a1.6 1.6 0 0 0 1.8.3 1.6 1.6 0 0 0 1-1.5V3h4v.2a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1L19.8 7l-.1.1a1.6 1.6 0 0 0-.3 1.8 1.6 1.6 0 0 0 1.5 1H21v4h-.2a1.6 1.6 0 0 0-1.4 1z"/>',
            "panel.svg": '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
            "grid.svg": '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"/>',
            "orbit.svg": '<circle cx="12" cy="12" r="4"/><ellipse cx="12" cy="12" rx="10" ry="5" transform="rotate(-25 12 12)"/>',
        },
        "actions": {
            "add.svg": '<path d="M12 5v14M5 12h14"/>',
            "import.svg": '<path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v3h16v-3"/>',
            "export.svg": '<path d="M12 15V3m0 0-4 4m4-4 4 4M4 17v3h16v-3"/>',
            "backup.svg": '<path d="M4 7a8 8 0 1 1 16 0v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M8 7h8M8 12h8M8 17h5"/>',
            "restore.svg": '<path d="M4 11a8 8 0 1 1 2.3 6.7"/><path d="M4 5v6h6"/>',
            "close.svg": '<path d="M6 6l12 12M18 6 6 18"/>',
            "arrow-left.svg": '<path d="M19 12H5m0 0 6-6m-6 6 6 6"/>',
            "arrow-right.svg": '<path d="M5 12h14m0 0-6-6m6 6-6 6"/>',
            "more.svg": '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
            "edit.svg": '<path d="m4 20 4-.8L19 8.2 15.8 5 4.8 16z"/><path d="m14 7 3 3"/>',
            "trash.svg": '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
            "check.svg": '<path d="m5 12 4.5 4.5L19 7"/>',
        },
        "status": {
            "alert.svg": '<path d="M12 3 2.5 20h19z"/><path d="M12 9v5M12 17h.01"/>',
            "info.svg": '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
            "success.svg": '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
            "sync.svg": '<path d="M20 7a8 8 0 0 0-14-2L4 7"/><path d="M4 3v4h4"/><path d="M4 17a8 8 0 0 0 14 2l2-2"/><path d="M20 21v-4h-4"/>',
            "loading.svg": '<path d="M12 3a9 9 0 1 0 9 9"/>',
        },
    }
    for category, group in icons.items():
        for name, body in group.items():
            svg = (
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" '
                'stroke="#CBB9A3" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'
                + body
                + "</svg>"
            )
            write_svg(ICONS / category / name, svg)


def make_app_icons() -> None:
    master = Image.new("RGBA", (512, 512), (11, 11, 11, 255))
    d = ImageDraw.Draw(master)
    d.rounded_rectangle((12, 12, 500, 500), radius=96, outline=(255, 138, 0, 160), width=4)
    d.ellipse((112, 112, 400, 400), outline=(248, 237, 225, 255), width=16)
    d.arc((86, 86, 426, 426), start=200, end=340, fill=(255, 138, 0, 255), width=12)
    d.ellipse((372, 128, 408, 164), fill=(255, 138, 0, 255))
    # Stylised D
    d.line((190, 158, 190, 354), fill=(248, 237, 225, 255), width=28)
    d.arc((178, 150, 350, 362), start=280, end=80, fill=(248, 237, 225, 255), width=28)

    master.save(APP_ICONS / "icon-512.png")
    sizes = [16, 24, 32, 48, 64, 128, 256]
    for size in sizes:
        master.resize((size, size), Image.Resampling.LANCZOS).save(APP_ICONS / f"icon-{size}.png")
    master.save(
        APP_ICONS / "favicon.ico",
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (256, 256)],
    )

    # Keep the actual Tauri application icon aligned with the new identity.
    tauri_icons = ROOT / "src-tauri" / "icons"
    if tauri_icons.exists():
        master.save(tauri_icons / "icon.png")
        master.resize((128, 128), Image.Resampling.LANCZOS).save(tauri_icons / "128x128.png")
        master.resize((256, 256), Image.Resampling.LANCZOS).save(tauri_icons / "128x128@2x.png")
        master.resize((32, 32), Image.Resampling.LANCZOS).save(tauri_icons / "32x32.png")
        master.save(
            tauri_icons / "icon.ico",
            format="ICO",
            sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (256, 256)],
        )


def copy_fonts() -> None:
    import shutil

    node_modules = ROOT / "node_modules"
    sources = [
        (node_modules / "@fontsource-variable" / "space-grotesk" / "files" / "space-grotesk-latin-wght-normal.woff2", FONTS / "space-grotesk" / "space-grotesk-latin-wght-normal.woff2"),
        (node_modules / "@fontsource-variable" / "space-grotesk" / "LICENSE", FONTS / "space-grotesk" / "OFL.txt"),
    ]
    for weight in (400, 500, 600):
        sources.append(
            (
                node_modules / "@fontsource" / "ibm-plex-mono" / "files" / f"ibm-plex-mono-latin-{weight}-normal.woff2",
                FONTS / "ibm-plex-mono" / f"ibm-plex-mono-latin-{weight}-normal.woff2",
            )
        )
    sources.append((node_modules / "@fontsource" / "ibm-plex-mono" / "LICENSE", FONTS / "ibm-plex-mono" / "OFL.txt"))
    for source, destination in sources:
        if source.exists():
            shutil.copy2(source, destination)


def write_catalog() -> None:
    usage = {
        "brand": "Brand identity and application iconography",
        "hero": "Workspace home cinematic artwork",
        "backgrounds": "Ambient application backgrounds",
        "textures": "Subtle reusable surface texture",
        "navigation": "Navigation icons",
        "workspace": "Workspace/tool icons",
        "actions": "Action/control icons",
        "status": "Status indicators",
        "decorative": "Orbital/geometric decorative motifs",
        "fonts": "Locally bundled typography",
    }
    lines = [
        "# Dace Asset Catalog",
        "",
        "All artwork in this catalog is generated locally by `scripts/generate_dace_assets.py` unless noted. Fonts are self-hosted under SIL OFL 1.1.",
        "",
        "| Asset | Type | Dimensions | Format | Source / method | Licence | Intended usage |",
        "|---|---|---:|---|---|---|---|",
    ]
    catalog_files = sorted([p for p in ASSETS.rglob("*") if p.is_file()])
    catalog_files.extend([ROOT / "public" / "favicon.svg", ROOT / "public" / "favicon.ico"])
    for path in catalog_files:
        if not path.exists():
            continue
        try:
            rel = path.relative_to(ROOT).as_posix()
        except ValueError:
            rel = path.as_posix()
        if path.is_relative_to(ASSETS):
            category = path.relative_to(ASSETS).parts[0]
        else:
            category = "brand"
        suffix = path.suffix.lower().lstrip(".")
        dimensions = "—"
        if suffix in {"png", "webp", "ico"}:
            with Image.open(path) as image:
                dimensions = f"{image.width}×{image.height}"
        elif suffix == "svg":
            text = path.read_text(encoding="utf-8")
            if 'viewBox="' in text:
                vb = text.split('viewBox="', 1)[1].split('"', 1)[0]
                dimensions = vb.replace(" ", "×", 1)
        licence = "Project original"
        source = "Seeded Pillow/NumPy generator"
        if category == "fonts":
            licence = "SIL OFL 1.1"
            source = "Fontsource package, copied locally"
        elif suffix == "svg" and "icon" not in category:
            source = "Hand-authored SVG"
        lines.append(f"| `{rel}` | {suffix.upper()} | {dimensions} | {suffix} | {source} | {licence} | {usage.get(category, 'UI asset')} |")
    (ROOT / "DACE_ASSET_CATALOG.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    make_hero()
    make_landscape_images()
    make_backgrounds()
    make_textures()
    make_brand_svgs()
    make_decorative_svgs()
    make_icons()
    make_app_icons()
    copy_fonts()
    write_catalog()
    print("Generated Dace asset library.")


if __name__ == "__main__":
    main()
