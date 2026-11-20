import type { Highlight, HighlightAnchorData, OutlineItem } from "./types.ts";

export interface PassageRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PassageIdentity {
  attachmentId: string;
  page: number;
  text: string;
}

/**
 * Passage comparison key. Whitespace and case differences are ignored for
 * duplicate detection, but the original text is always stored separately so
 * quoted source material is never rewritten.
 */
export function normalizePassageText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

export function passageKey(identity: PassageIdentity): string {
  return `${identity.attachmentId}\u0000${identity.page}\u0000${normalizePassageText(
    identity.text
  )}`;
}

export function findExistingHighlight(
  highlights: Highlight[],
  identity: PassageIdentity
): Highlight | undefined {
  const key = passageKey(identity);
  return highlights.find((highlight) => {
    if (highlight.is_stale) return false;
    return (
      passageKey({
        attachmentId: highlight.attachment_id,
        page: highlight.page_number,
        text: highlight.selected_text,
      }) === key
    );
  });
}

export function createAnchorData(options: {
  rects: PassageRect[];
  pageNumber: number;
  text: string;
  startOffset?: number;
  endOffset?: number;
  prefix?: string;
  suffix?: string;
}): string {
  const anchor: HighlightAnchorData = {
    rects: options.rects,
    pageNumber: options.pageNumber,
    startOffset: options.startOffset,
    endOffset: options.endOffset,
    prefix: options.prefix,
    suffix: options.suffix,
  };
  return JSON.stringify(anchor);
}

export function parseAnchorData(raw: string): HighlightAnchorData | null {
  try {
    const parsed = JSON.parse(raw) as HighlightAnchorData;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

interface OutlineDocument {
  getDestination(id: string): Promise<unknown>;
  getPageIndex(ref: unknown): Promise<number>;
}

/**
 * PDF.js outline entries contain raw destinations. Resolve them once at load
 * time so navigation works without keeping the document proxy in the drawer.
 */
export async function resolveOutlinePageNumbers(
  doc: OutlineDocument,
  items: unknown[]
): Promise<OutlineItem[]> {
  const resolved: OutlineItem[] = [];

  for (const item of items) {
    const entry = item as {
      title?: string;
      dest?: unknown;
      items?: unknown[];
    };
    const rawDest = entry.dest;
    let pageNumber: number | undefined;

    try {
      let dest: unknown = rawDest;
      if (typeof rawDest === "string") {
        dest = await doc.getDestination(rawDest);
      }
      const target = Array.isArray(dest) ? dest[0] : null;
      if (target !== null && target !== undefined) {
        const index = await doc.getPageIndex(target);
        if (Number.isFinite(index) && index >= 0) pageNumber = index + 1;
      }
    } catch {
      // Some outlines use unsupported destination shapes; leave the title
      // visible but do not offer a broken jump target.
    }

    resolved.push({
      title: typeof entry.title === "string" ? entry.title : "Untitled",
      dest: rawDest,
      pageNumber,
      items:
        entry.items && entry.items.length > 0
          ? await resolveOutlinePageNumbers(doc, entry.items)
          : undefined,
    });
  }

  return resolved;
}
