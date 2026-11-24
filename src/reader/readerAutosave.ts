import { normalizeSettings } from "../settings/settingsSchema.ts";
import type { AppSettings } from "../settings/types.ts";

/**
 * Reader autosave uses the same normalized editor delay as the rest of Dace.
 * Keeping this pure makes the configured delay directly testable.
 */
export function resolveReaderAutosaveDelayMs(settings: Pick<AppSettings, "editor">): number {
  return normalizeSettings(settings).editor.autosaveDelayMs;
}
