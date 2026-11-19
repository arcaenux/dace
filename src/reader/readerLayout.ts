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

const STORAGE_KEY = "dace.reader.layout.v1";

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

export function loadReaderLayout(): ReaderLayoutPreferences {
  const fallback: ReaderLayoutPreferences = {
    mode: "research",
    splitRatio: DEFAULT_SPLIT_RATIO,
    navCollapsed: false,
    headerCollapsed: false,
  };

  if (typeof window === "undefined") return fallback;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<ReaderLayoutPreferences>;
    return {
      mode: isReaderMode(parsed.mode) ? parsed.mode : fallback.mode,
      splitRatio: clampSplitRatio(parsed.splitRatio ?? fallback.splitRatio),
      navCollapsed: Boolean(parsed.navCollapsed),
      headerCollapsed: Boolean(parsed.headerCollapsed),
    };
  } catch {
    return fallback;
  }
}

export function saveReaderLayout(preferences: ReaderLayoutPreferences): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Layout preference is non-critical; never interrupt reading for storage errors.
  }
}

export function offsetSplitRatio(
  ratio: number,
  deltaPixels: number,
  width: number
): number {
  if (width <= 0) return clampSplitRatio(ratio);
  return clampSplitRatio(ratio + deltaPixels / width);
}
