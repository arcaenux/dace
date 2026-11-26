/**
 * Pure Markdown formatting for the Knowledge Desk's plain-text canvas.
 *
 * Every action returns a single replacement (start/end in the original text
 * plus the inserted string) so the editor can apply it as one native edit and
 * keep the browser's undo stack intact.
 */

export type FormatAction =
  | "h1"
  | "h2"
  | "h3"
  | "bold"
  | "italic"
  | "strike"
  | "code"
  | "link"
  | "bullet"
  | "numbered"
  | "task"
  | "quote"
  | "divider";

export interface FormatEdit {
  start: number;
  end: number;
  insert: string;
  selectionStart: number;
  selectionEnd: number;
}

const WRAPS: Partial<Record<FormatAction, string>> = {
  bold: "**",
  italic: "_",
  strike: "~~",
  code: "`",
};

const LINE_PREFIXES: Partial<Record<FormatAction, string>> = {
  h1: "# ",
  h2: "## ",
  h3: "### ",
  bullet: "- ",
  numbered: "1. ",
  task: "- [ ] ",
  quote: "> ",
};

const HEADING_RE = /^#{1,6}\s+/;
const LIST_RE = /^(?:- \[[ xX]\] |[-*+] |\d+\. |> )/;

function wrapSelection(text: string, start: number, end: number, marker: string): FormatEdit {
  const selected = text.slice(start, end);
  const before = text.slice(Math.max(0, start - marker.length), start);
  const after = text.slice(end, end + marker.length);

  // Toggle off when the selection is already wrapped by this marker.
  if (before === marker && after === marker) {
    return {
      start: start - marker.length,
      end: end + marker.length,
      insert: selected,
      selectionStart: start - marker.length,
      selectionEnd: end - marker.length,
    };
  }

  const placeholder = selected || "text";
  return {
    start,
    end,
    insert: `${marker}${placeholder}${marker}`,
    selectionStart: start + marker.length,
    selectionEnd: start + marker.length + placeholder.length,
  };
}

function prefixLines(text: string, start: number, end: number, action: FormatAction): FormatEdit {
  const prefix = LINE_PREFIXES[action]!;
  const isHeading = action === "h1" || action === "h2" || action === "h3";
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const nextBreak = text.indexOf("\n", end > start && text[end - 1] === "\n" ? end - 1 : end);
  const lineEnd = nextBreak === -1 ? text.length : nextBreak;
  const lines = text.slice(lineStart, lineEnd).split("\n");

  const hasPrefix = (line: string) =>
    action === "numbered" ? /^\d+\. /.test(line) : line.startsWith(prefix);
  const allPrefixed = lines.every((line) => line.trim() === "" || hasPrefix(line));

  const next = lines.map((line, index) => {
    if (allPrefixed) {
      return action === "numbered" ? line.replace(/^\d+\. /, "") : line.slice(prefix.length);
    }
    const stripped = isHeading ? line.replace(HEADING_RE, "") : line.replace(LIST_RE, "");
    if (!isHeading && line.trim() === "" && lines.length > 1) return line;
    const marker = action === "numbered" ? `${index + 1}. ` : prefix;
    return `${marker}${stripped}`;
  });

  const insert = next.join("\n");
  return {
    start: lineStart,
    end: lineEnd,
    insert,
    selectionStart: lines.length === 1 ? lineStart + insert.length : lineStart,
    selectionEnd: lineStart + insert.length,
  };
}

export function applyMarkdownFormat(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  action: FormatAction
): FormatEdit {
  const start = Math.max(0, Math.min(selectionStart, selectionEnd, text.length));
  const end = Math.min(text.length, Math.max(selectionStart, selectionEnd));

  const marker = WRAPS[action];
  if (marker) return wrapSelection(text, start, end, marker);

  if (action === "link") {
    const label = text.slice(start, end) || "link";
    const insert = `[${label}](url)`;
    const urlStart = start + label.length + 3;
    return { start, end, insert, selectionStart: urlStart, selectionEnd: urlStart + 3 };
  }

  if (action === "divider") {
    const needsLeadingBreak = start > 0 && text[start - 1] !== "\n";
    const insert = `${needsLeadingBreak ? "\n" : ""}\n---\n\n`;
    const caret = start + insert.length;
    return { start, end, insert, selectionStart: caret, selectionEnd: caret };
  }

  return prefixLines(text, start, end, action);
}

/** Map editor keyboard shortcuts to formatting actions. */
export function formatActionForShortcut(key: string, shift: boolean): FormatAction | null {
  const lower = key.toLowerCase();
  if (!shift && lower === "b") return "bold";
  if (!shift && lower === "i") return "italic";
  if (!shift && lower === "e") return "code";
  if (shift && lower === "x") return "strike";
  return null;
}

/** Previews read as prose: drop Markdown markers such as "#", "**" or "- [ ]". */
export const stripMarkdownPreview = (preview: string): string =>
  preview
    .replace(/(^|\s)(?:#{1,6}|>|[-*+]|\d+\.)\s+(?:\[[ xX]\]\s+)?/g, "$1")
    .replace(/(\*\*|__|~~|`)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

