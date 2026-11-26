export const DEFAULT_APP_FONT = "Aptos";
export const DEFAULT_TEXT_FONT = "Aptos";

export const FONT_FALLBACKS = {
  app: '"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  text: 'Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Courier New", monospace',
} as const;

export interface SystemFont {
  family: string;
  style: string | null;
  source: string;
  path: string | null;
}

const MONOSPACE_FAMILIES = new Set(
  [
    "Cascadia Code",
    "Cascadia Mono",
    "Consolas",
    "Courier New",
    "Fira Code",
    "Hack",
    "IBM Plex Mono",
    "Inconsolata",
    "JetBrains Mono",
    "Lucida Console",
    "Menlo",
    "Monaco",
    "SFMono-Regular",
    "Source Code Pro",
    "Ubuntu Mono",
  ].map((family) => family.toLowerCase())
);

const UNSAFE_FONT_CHARS = /[\u0000-\u001f\u007f,;:{}()<>"'\\]/g;

/**
 * Installed font names are untrusted input from the OS and from persisted
 * settings. Strip CSS syntax characters so a family can only ever be used as
 * a quoted font-family value, never as arbitrary CSS.
 */
export function sanitizeFontFamily(value: unknown, fallback = DEFAULT_APP_FONT): string {
  if (typeof value !== "string") return fallback;
  const cleaned = value.replace(UNSAFE_FONT_CHARS, "").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 120) || fallback;
}

export function fontStack(
  family: unknown,
  role: keyof typeof FONT_FALLBACKS = "app"
): string {
  const safeFamily = sanitizeFontFamily(family);
  return `"${safeFamily}", ${FONT_FALLBACKS[role]}`;
}

/**
 * A proportional app font would break terminal cell alignment, so the terminal
 * follows the app selection only when it is a known monospace family.
 */
export function terminalFontStack(appFont: unknown): string {
  const family = sanitizeFontFamily(appFont);
  return MONOSPACE_FAMILIES.has(family.toLowerCase())
    ? fontStack(family, "mono")
    : FONT_FALLBACKS.mono;
}

/** Read a resolved font stack from CSS custom properties, with a safe fallback. */
export function readFontStack(variable: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  return value || fallback;
}
