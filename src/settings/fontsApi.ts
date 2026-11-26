import { invoke } from "@tauri-apps/api/core";
import { isTauriEnvironment } from "../focus/tauriWindow";
import { DEFAULT_APP_FONT, type SystemFont } from "./fonts";

const FALLBACK_FAMILIES = [
  DEFAULT_APP_FONT,
  "Arial",
  "Calibri",
  "Cambria",
  "Cascadia Mono",
  "Consolas",
  "Courier New",
  "Georgia",
  "Segoe UI",
  "Tahoma",
  "Times New Roman",
  "Verdana",
];

function fallbackFonts(): SystemFont[] {
  return FALLBACK_FAMILIES.map((family) => ({
    family,
    style: null,
    source: "browser-preview",
    path: null,
  }));
}

/**
 * Browser previews cannot enumerate OS fonts; the desktop app can. Never let a
 * failed native call break the Settings view.
 */
export async function listSystemFonts(): Promise<SystemFont[]> {
  if (!isTauriEnvironment()) return fallbackFonts();

  try {
    const fonts = await invoke<SystemFont[]>("list_system_fonts");
    return Array.isArray(fonts) && fonts.length > 0 ? fonts : fallbackFonts();
  } catch (error) {
    console.warn("[Dace] Could not enumerate installed fonts:", error);
    return fallbackFonts();
  }
}
