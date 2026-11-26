/** Pure text helpers for the Research Reader's speed-reading mode. */

export function normalizeSpeedText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function speedWordCount(text: string): number {
  const normalized = normalizeSpeedText(text);
  return normalized ? normalized.split(" ").length : 0;
}

export function tokenizeSpeedText(text: string, chunkSize = 1): string[][] {
  const size = Math.max(1, Math.min(5, Math.floor(chunkSize) || 1));
  const words = normalizeSpeedText(text).split(" ").filter(Boolean);
  const chunks: string[][] = [];

  for (let index = 0; index < words.length; index += size) {
    chunks.push(words.slice(index, index + size));
  }

  return chunks;
}

export interface SpeedFocusSplit {
  before: string;
  focus: string;
  after: string;
}

/**
 * Locate the optimal recognition point so each word can be aligned to one
 * fixed visual anchor. Short words anchor near the start; longer words shift
 * the anchor right, capped at the fifth character.
 */
export function speedFocusSplit(word: string): SpeedFocusSplit {
  const characters = Array.from(word);
  if (characters.length === 0) return { before: "", focus: "", after: "" };

  const length = characters.length;
  const index = length <= 2 ? 0 : length <= 5 ? 1 : length <= 9 ? 2 : length <= 13 ? 3 : 4;
  const safeIndex = Math.min(index, length - 1);

  return {
    before: characters.slice(0, safeIndex).join(""),
    focus: characters[safeIndex] ?? "",
    after: characters.slice(safeIndex + 1).join(""),
  };
}

/** Interval for one displayed chunk, keeping WPM measured in words rather than chunks. */
export function speedChunkIntervalMs(wpm: number, chunkSize = 1): number {
  const size = Math.max(1, Math.min(5, Math.floor(chunkSize) || 1));
  if (!Number.isFinite(wpm) || wpm <= 0) return 0;
  return Math.max(1, Math.round((60000 * size) / wpm));
}

export function estimateSpeedMinutes(wordCount: number, wpm: number): number {
  if (wordCount <= 0 || wpm <= 0) return 0;
  return wordCount / wpm;
}

export function formatSpeedDuration(minutes: number): string {
  if (minutes <= 0) return "0 sec";
  const totalSeconds = Math.max(1, Math.round(minutes * 60));
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  if (mins === 0) return `${secs} sec`;
  return `${mins}m ${String(secs).padStart(2, "0")}s`;
}

/** Convert pdf.js text items into readable plain text without changing layout logic. */
export function pdfItemsToText(items: Array<{ str?: string; hasEOL?: boolean }>): string {
  return items
    .map((item) => `${item.str ?? ""}${item.hasEOL ? "\n" : " "}`)
    .join("")
    .replace(/[ \t]+/g, " ")
    .replace(/ +\n/g, "\n")
    .replace(/\n +/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
