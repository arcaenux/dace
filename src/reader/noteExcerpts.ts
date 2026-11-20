import { parseAnchorData, normalizePassageText } from "./readerSelection.ts";
import type { Highlight, HighlightAnchorData } from "./types.ts";

export interface NoteExcerptLocation {
  pageNumber?: number;
  startOffset?: number;
  endOffset?: number;
  prefix?: string;
  suffix?: string;
  rects?: HighlightAnchorData["rects"];
}

export interface NoteExcerpt {
  id: string;
  page: number;
  text: string;
  document: string;
  attachmentId: string;
  location?: NoteExcerptLocation;
}

interface LegacyNoteExcerpt extends Partial<NoteExcerpt> {
  attachment_id?: string;
}

const MARKER_PREFIX = "<!-- dace-excerpt:";
const MARKER_SUFFIX = " -->";
const LEGACY_PATTERN = /<!-- dace-excerpt:(.*?) -->/g;

const ENCODING_VERSION = "v2:";

function encodeMarkerPayload(excerpt: NoteExcerpt): string {
  // Percent-encoding keeps "-->" out of the payload, so a selection containing
  // HTML comment terminators cannot truncate or corrupt the marker.
  return ENCODING_VERSION + encodeURIComponent(JSON.stringify(excerpt));
}

function decodeMarkerPayload(payload: string): NoteExcerpt | null {
  try {
    const raw = payload.startsWith(ENCODING_VERSION)
      ? decodeURIComponent(payload.slice(ENCODING_VERSION.length))
      : payload;
    const parsed = JSON.parse(raw) as LegacyNoteExcerpt;
    if (
      typeof parsed.id !== "string" ||
      typeof parsed.text !== "string" ||
      typeof parsed.page !== "number"
    ) {
      return null;
    }

    return {
      id: parsed.id,
      page: parsed.page,
      text: parsed.text,
      document: typeof parsed.document === "string" ? parsed.document : "",
      attachmentId:
        typeof parsed.attachmentId === "string"
          ? parsed.attachmentId
          : typeof parsed.attachment_id === "string"
            ? parsed.attachment_id
            : "",
      location: parsed.location,
    };
  } catch {
    return null;
  }
}

export function formatExcerptBlock(excerpt: NoteExcerpt): string {
  const marker = `${MARKER_PREFIX}${encodeMarkerPayload(excerpt)}${MARKER_SUFFIX}`;
  return [
    marker,
    `> **[p. ${excerpt.page}]** ${excerpt.text}`,
    `> — Source: ${excerpt.document}`,
  ].join("\n");
}

export function parseNoteExcerpts(content: string): NoteExcerpt[] {
  const results: NoteExcerpt[] = [];
  const pattern = new RegExp(LEGACY_PATTERN.source, "g");
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    const excerpt = decodeMarkerPayload(match[1]);
    if (excerpt) results.push(excerpt);
  }

  return results;
}

export function excerptMatches(
  excerpt: NoteExcerpt,
  candidate: Pick<NoteExcerpt, "id" | "page" | "text" | "attachmentId">
): boolean {
  if (excerpt.id === candidate.id) return true;
  if (excerpt.attachmentId && candidate.attachmentId && excerpt.attachmentId !== candidate.attachmentId) {
    return false;
  }
  return (
    excerpt.page === candidate.page &&
    normalizePassageText(excerpt.text) === normalizePassageText(candidate.text)
  );
}

export function appendExcerptToContent(content: string, excerpt: NoteExcerpt): string {
  const block = formatExcerptBlock(excerpt);
  const trimmed = content.replace(/\s+$/, "");
  return trimmed ? `${trimmed}\n\n${block}\n` : `${block}\n`;
}

/** Remove only the machine-readable marker, preserving the user-visible quote. */
export function stripExcerptMarker(content: string, excerptId: string): string {
  const pattern = new RegExp(LEGACY_PATTERN.source, "g");
  return content.replace(pattern, (full, payload: string) => {
    const excerpt = decodeMarkerPayload(payload);
    return excerpt?.id === excerptId ? "" : full;
  });
}

export function excerptFromHighlight(
  highlight: Highlight,
  documentTitle: string
): NoteExcerpt {
  const anchor = parseAnchorData(highlight.anchor_data);
  const location: NoteExcerptLocation | undefined = anchor
    ? {
        pageNumber: anchor.pageNumber,
        startOffset: anchor.startOffset,
        endOffset: anchor.endOffset,
        prefix: anchor.prefix,
        suffix: anchor.suffix,
        rects: anchor.rects,
      }
    : undefined;

  return {
    id: highlight.id,
    page: highlight.page_number,
    text: highlight.selected_text,
    document: documentTitle,
    attachmentId: highlight.attachment_id,
    location,
  };
}
