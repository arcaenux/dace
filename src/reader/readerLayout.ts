export type ReaderMode = "reading" | "research" | "writing";

export interface ReaderLayoutPreferences {
  mode: ReaderMode;
  splitRatio: number;
  navCollapsed: boolean;
  headerCollapsed: boolean;
}

export interface ReaderChromeState {
  navigation: "full" | "compact" | "hidden";
  header: "full" | "hidden";
}

export const DEFAULT_SPLIT_RATIO = 0.6;
export const MIN_SPLIT_RATIO = 0.32;
export const MAX_SPLIT_RATIO = 0.76;
export const NARROW_READER_WIDTH = 960;

export const isReaderMode = (value: unknown): value is ReaderMode =>
  value === "reading" || value === "research" || value === "writing";

export function clampSplitRatio(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SPLIT_RATIO;
  return Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, value));
}

export function splitRatioFromMode(mode: ReaderMode, savedRatio: number): number {
  if (mode === "reading") return 1;
  if (mode === "writing") return 0;
  return clampSplitRatio(savedRatio);
}

export function chromeStateForMode(
  mode: ReaderMode,
  overrides: Pick<ReaderLayoutPreferences, "navCollapsed" | "headerCollapsed">
): ReaderChromeState {
  if (mode === "reading") {
    return { navigation: "hidden", header: "hidden" };
  }
  if (mode === "writing") {
    return { navigation: "compact", header: "hidden" };
  }
  return {
    navigation: overrides.navCollapsed ? "compact" : "full",
    header: overrides.headerCollapsed ? "hidden" : "full",
  };
}

export function offsetSplitRatio(
  ratio: number,
  deltaPixels: number,
  width: number
): number {
  if (width <= 0) return clampSplitRatio(ratio);
  return clampSplitRatio(ratio + deltaPixels / width);
}
