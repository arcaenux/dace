/** "highlights" is the note page; "passages" lists highlights and annotations. */
export type ReaderDrawerTab = "highlights" | "passages" | "outline" | "knowledge" | "info";

export interface ReaderSessionState {
  currentPage: number;
  zoom: number;
  fitWidth: boolean;
  drawerTab: ReaderDrawerTab;
  selectedHighlightId: string | null;
  scrollTop: number;
  writingScrollTop: number;
}

const DEFAULT_SESSION: ReaderSessionState = {
  currentPage: 1,
  zoom: 1,
  fitWidth: true,
  drawerTab: "highlights",
  selectedHighlightId: null,
  scrollTop: 0,
  writingScrollTop: 0,
};

const sessions = new Map<string, ReaderSessionState>();

export function getReaderSession(attachmentId: string | null | undefined): ReaderSessionState | null {
  if (!attachmentId) return null;
  const stored = sessions.get(attachmentId);
  return stored ? { ...stored } : null;
}

/**
 * Initialise defaults for a document without touching a session that already
 * exists. Selecting or importing a document must never overwrite its saved
 * page, zoom, or scroll position.
 */
export function ensureReaderSession(attachmentId: string | null | undefined): ReaderSessionState {
  if (!attachmentId) return { ...DEFAULT_SESSION };
  const existing = sessions.get(attachmentId);
  if (existing) return { ...existing };
  const initial = { ...DEFAULT_SESSION };
  sessions.set(attachmentId, initial);
  return initial;
}

export function saveReaderSession(
  attachmentId: string | null | undefined,
  patch: Partial<ReaderSessionState>
): void {
  if (!attachmentId) return;
  const current = sessions.get(attachmentId) || DEFAULT_SESSION;
  sessions.set(attachmentId, { ...current, ...patch });
}

export function clearReaderSession(attachmentId: string | null | undefined): void {
  if (attachmentId) sessions.delete(attachmentId);
}

export function normalizeReaderSession(
  value: Partial<ReaderSessionState> | null | undefined
): ReaderSessionState {
  if (!value) return { ...DEFAULT_SESSION };
  return {
    currentPage:
      Number.isFinite(value.currentPage) && (value.currentPage ?? 0) > 0
        ? Math.floor(value.currentPage as number)
        : 1,
    zoom: Number.isFinite(value.zoom)
      ? Math.min(2.5, Math.max(0.6, value.zoom as number))
      : 1,
    fitWidth: typeof value.fitWidth === "boolean" ? value.fitWidth : true,
    drawerTab:
      value.drawerTab === "outline" ||
      value.drawerTab === "knowledge" ||
      value.drawerTab === "info"
        ? value.drawerTab
        : "highlights",
    selectedHighlightId:
      typeof value.selectedHighlightId === "string" ? value.selectedHighlightId : null,
    scrollTop: Number.isFinite(value.scrollTop) ? Math.max(0, value.scrollTop as number) : 0,
    writingScrollTop: Number.isFinite(value.writingScrollTop)
      ? Math.max(0, value.writingScrollTop as number)
      : 0,
  };
}
