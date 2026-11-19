import { Highlight } from "./types.ts";

export interface NoteExcerpt {
  id: string;
  page: number;
  text: string;
  document: string;
}

const MARKER_PREFIX = "<!-- dace-excerpt:";
const MARKER_SUFFIX = " -->";

export function formatExcerptBlock(excerpt: NoteExcerpt): string {
  const marker = `${MARKER_PREFIX}${JSON.stringify(excerpt)}${MARKER_SUFFIX}`;
  return [
    marker,
    `> **[p. ${excerpt.page}]** ${excerpt.text}`,
    `> — Source: ${excerpt.document}`,
  ].join("\n");
}

export function parseNoteExcerpts(content: string): NoteExcerpt[] {
  const results: NoteExcerpt[] = [];
  const pattern = /<!-- dace-excerpt:(.*?) -->/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[1]) as Partial<NoteExcerpt>;
      if (
        typeof parsed.id === "string" &&
        typeof parsed.text === "string" &&
        typeof parsed.page === "number"
      ) {
        results.push({
          id: parsed.id,
          page: parsed.page,
          text: parsed.text,
          document: typeof parsed.document === "string" ? parsed.document : "",
        });
      }
    } catch {
      // Ignore malformed markers; they remain visible as ordinary note text.
    }
  }

  return results;
}

export function excerptFromHighlight(
  highlight: Highlight,
  documentTitle: string
): NoteExcerpt {
  return {
    id: highlight.id,
    page: highlight.page_number,
    text: highlight.selected_text,
    document: documentTitle,
  };
}
