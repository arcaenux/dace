import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  createAnchorData,
  findExistingHighlight,
  normalizePassageText,
  passageKey,
} from "../src/reader/readerSelection.ts";
import {
  appendExcerptToContent,
  excerptFromHighlight,
  excerptMatches,
  formatExcerptBlock,
  parseNoteExcerpts,
  stripExcerptMarker,
} from "../src/reader/noteExcerpts.ts";
import {
  canCommitSnapshot,
  hasPendingChanges,
  nextSavedVersion,
  NoteSaveTracker,
  readerNoteTag,
  visibleNoteTags,
  withReaderNoteTag,
} from "../src/reader/noteSaveState.ts";
import {
  ensureReaderSession,
  getReaderSession,
  normalizeReaderSession,
  saveReaderSession,
} from "../src/reader/readerSession.ts";
import type { Highlight } from "../src/reader/types.ts";

const makeHighlight = (overrides: Partial<Highlight> = {}): Highlight => ({
  id: "hl-1",
  attachment_id: "att-1",
  doc_sha256: "sha",
  page_number: 7,
  selected_text: "Entropy in isolated systems never decreases.",
  anchor_data: JSON.stringify({
    startOffset: 12,
    endOffset: 55,
    prefix: "Second law: ",
    suffix: " In closed systems.",
    rects: [{ left: 10, top: 20, width: 300, height: 18 }],
  }),
  highlight_type: "important",
  color: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  is_stale: false,
  annotation: null,
  linked_record_count: 0,
  ...overrides,
});

test("1. Passage dedupe ignores case/whitespace but keeps exact selected text", () => {
  const highlight = makeHighlight({ selected_text: "  Exact   passage\nwith -->` markup  " });
  assert.equal(normalizePassageText("  Exact   passage\nwith -->` markup  "), "exact passage with -->` markup");
  assert.equal(
    passageKey({
      attachmentId: "att-1",
      page: 7,
      text: "  Exact   passage\nwith -->` markup  ",
    }),
    passageKey({ attachmentId: "att-1", page: 7, text: "exact passage with -->` markup" })
  );

  const found = findExistingHighlight([highlight], {
    attachmentId: "att-1",
    page: 7,
    text: "exact   passage with -->` markup",
  });
  assert.equal(found?.id, "hl-1");
  assert.equal(highlight.selected_text, "  Exact   passage\nwith -->` markup  ");

  assert.equal(
    findExistingHighlight([{ ...highlight, is_stale: true }], {
      attachmentId: "att-1",
      page: 7,
      text: highlight.selected_text,
    }),
    undefined,
    "stale anchors must not be reused"
  );
});

test("2. Highlight anchors preserve page, offsets and rectangles", () => {
  const anchor = JSON.parse(
    createAnchorData({
      rects: [{ left: 4, top: 5, width: 60, height: 12 }],
      pageNumber: 3,
      text: "sample",
      startOffset: 1,
      endOffset: 7,
      prefix: "A ",
      suffix: " sample",
    })
  );
  assert.equal(anchor.pageNumber, 3);
  assert.equal(anchor.startOffset, 1);
  assert.equal(anchor.endOffset, 7);
  assert.equal(anchor.prefix, "A ");
  assert.equal(anchor.rects[0].width, 60);
});

test("3. Excerpt markers survive hostile text and keep source references", () => {
  const highlight = makeHighlight({
    selected_text: "A quote containing --> and <!-- and JSON } characters.",
  });
  const excerpt = excerptFromHighlight(highlight, "Physics.pdf");
  assert.equal(excerpt.attachmentId, "att-1");
  assert.equal(excerpt.page, 7);
  assert.equal(excerpt.location?.startOffset, 12);
  assert.equal(excerpt.location?.rects?.[0].left, 10);

  const block = formatExcerptBlock(excerpt);
  const parsed = parseNoteExcerpts(`My writing\n\n${block}\nMore writing`);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, "hl-1");
  assert.equal(parsed[0].text, highlight.selected_text, "quote must be byte-for-byte identical");
  assert.equal(parsed[0].document, "Physics.pdf");
  assert.equal(parsed[0].attachmentId, "att-1");

  const legacy = parseNoteExcerpts(
    '<!-- dace-excerpt:{"id":"legacy","page":2,"text":"old","document":"Old.pdf","attachment_id":"att-old"} -->'
  );
  assert.equal(legacy[0].attachmentId, "att-old");
});

test("4. Excerpt insertion does not overwrite writing and strips only its marker", () => {
  const highlight = makeHighlight();
  const excerpt = excerptFromHighlight(highlight, "Physics.pdf");
  const original = "# Research\n\nMy own analysis stays here.";

  const withExcerpt = appendExcerptToContent(original, excerpt);
  assert.ok(withExcerpt.startsWith(original));
  assert.equal(parseNoteExcerpts(withExcerpt).length, 1);
  assert.ok(excerptMatches(excerpt, parseNoteExcerpts(withExcerpt)[0]));

  const withoutMarker = stripExcerptMarker(withExcerpt, excerpt.id);
  assert.ok(withoutMarker.includes("My own analysis stays here."));
  assert.ok(withoutMarker.includes(highlight.selected_text));
  assert.equal(parseNoteExcerpts(withoutMarker).length, 0);
});

test("5. Save version guards prevent stale writes and tag loss", () => {
  assert.equal(hasPendingChanges(5, 4), true);
  assert.equal(hasPendingChanges(4, 4), false);
  assert.equal(canCommitSnapshot("record-a", "record-a"), true);
  assert.equal(canCommitSnapshot("record-b", "record-a"), false);
  assert.equal(nextSavedVersion(3, 5), 5, "older saves cannot downgrade saved version");
  assert.equal(nextSavedVersion(7, 5), 7);

  const tag = readerNoteTag("att-1");
  const tagged = withReaderNoteTag(["project", "reader-note:legacy"], "att-1");
  assert.deepEqual(tagged, [tag, "project"]);
  assert.deepEqual(visibleNoteTags(tagged), ["project"]);
});

test("6. Reader session preserves page, zoom, scroll and drawer state", () => {
  saveReaderSession("att-session", {
    currentPage: 12,
    zoom: 1.35,
    fitWidth: false,
    drawerTab: "outline",
    selectedHighlightId: "hl-9",
    scrollTop: 480,
    writingScrollTop: 90,
  });
  const restored = normalizeReaderSession(getReaderSession("att-session"));
  assert.equal(restored.currentPage, 12);
  assert.equal(restored.zoom, 1.35);
  assert.equal(restored.fitWidth, false);
  assert.equal(restored.drawerTab, "outline");
  assert.equal(restored.selectedHighlightId, "hl-9");
  assert.equal(restored.scrollTop, 480);
  assert.equal(restored.writingScrollTop, 90);

  const clamped = normalizeReaderSession({ currentPage: -3, zoom: 99, drawerTab: "bad" as never });
  assert.equal(clamped.currentPage, 1);
  assert.equal(clamped.zoom, 2.5);
  assert.equal(clamped.drawerTab, "highlights");
});

test("7. PDF viewer destroys resources, cancels text layer and avoids callback-driven reloads", () => {
  const source = fs.readFileSync(path.resolve("src/reader/PdfViewer.tsx"), "utf-8");
  assert.match(source, /loadingTask\?\.destroy/);
  assert.match(source, /loadedDoc\?\.destroy/);
  assert.match(source, /activeTextLayer\?\.cancel/);
  assert.match(source, /activePage\?\.cleanup/);
  assert.match(source, /\}\s*,\s*\[dataUrl\]\);/, "load effect must depend only on dataUrl");
  assert.match(source, /export const PdfViewer = memo/);
  assert.ok(!source.includes("highlight.is_stale &&"), "stale highlights must not be painted");
  assert.match(source, /if \(event\.defaultPrevented\) return;/, "handled shortcuts must not also change pages");
  assert.match(source, /role"\) === "separator"/, "divider keys must not navigate the PDF");
});

test("8. Layout switching keeps both panes mounted and scrolling independent", () => {
  const reader = fs.readFileSync(path.resolve("src/reader/ResearchReaderView.tsx"), "utf-8");
  assert.match(reader, /style=\{\{ display: showDocument \? undefined : "none" \}\}/);
  assert.match(reader, /style=\{\{ display: showWriting \? undefined : "none" \}\}/);
  assert.match(reader, /onAnnotationRequested/);
  assert.match(reader, /Research note is already saved/);

  const drawer = fs.readFileSync(path.resolve("src/reader/ReaderDrawer.tsx"), "utf-8");
  assert.match(drawer, /onJumpToPage\(excerpt\.page, excerpt\.attachmentId\)/);

  const focus = fs.readFileSync(path.resolve("src/focus/FocusSpaceView.tsx"), "utf-8");
  assert.match(focus, /focus-space-shell/);
  assert.ok(!focus.includes("return <>"), "focus wrapper must not change component shape");

  const divider = fs.readFileSync(path.resolve("src/reader/ReaderDivider.tsx"), "utf-8");
  assert.match(divider, /detachListeners\(\)/);
  assert.match(divider, /removeEventListener\("pointermove"/);

  const css = fs.readFileSync(path.resolve("src/styles/reader-adaptive.css"), "utf-8");
  assert.match(css, /body\.reader-is-resizing \.dace-app \.reader-adaptive-body/);
});

test("9. Notes autosave reports explicit save results instead of unconditional success", () => {
  const source = fs.readFileSync(path.resolve("src/reader/useReaderNote.ts"), "utf-8");
  assert.match(source, /Promise<ReaderNoteSaveResult>/);
  assert.match(source, /inFlightRef/);
  assert.match(source, /trackerRef\.current\.markDirty/);
  assert.match(source, /trackerRef\.current\.commit/);
  assert.match(source, /stateRef\.current = next/);
  assert.match(source, /listRecords\(tag\)/);
  assert.ok(!source.includes("versionRef"), "autosave must not use an undeclared version ref");
});

test("10. Autosave tracker keeps the newest edit when saves fail or overlap", () => {
  const tracker = new NoteSaveTracker();
  tracker.markClean();
  assert.equal(tracker.hasPending, false);

  const first = tracker.markDirty();
  const second = tracker.markDirty();
  const third = tracker.markDirty();
  assert.equal(tracker.hasPending, true);

  // A failed save never commits, so the newest edit is still pending.
  assert.equal(tracker.hasPending, true);

  // An older in-flight save can commit without marking later edits as saved.
  assert.equal(tracker.commit(first, "record-a", "record-a"), true);
  assert.equal(tracker.hasPending, true);
  assert.equal(tracker.lastSavedVersion, first);

  // A later save catches up, and an older completion cannot downgrade it.
  assert.equal(tracker.commit(third, "record-a", "record-a"), true);
  assert.equal(tracker.hasPending, false);
  assert.equal(tracker.commit(second, "record-a", "record-a"), true);
  assert.equal(tracker.lastSavedVersion, third);

  // A save captured before the user switched notes must not affect the new note.
  tracker.reset();
  tracker.markClean();
  const switched = tracker.markDirty();
  assert.equal(tracker.commit(switched, "record-b", "record-a"), false);
  assert.equal(tracker.hasPending, true);
});

test("11. Document selection never clobbers a saved reader session", () => {
  saveReaderSession("att-pick", { currentPage: 14, zoom: 1.4, scrollTop: 820 });
  const selected = ensureReaderSession("att-pick");
  assert.equal(selected.currentPage, 14);
  assert.equal(selected.zoom, 1.4);
  assert.equal(selected.scrollTop, 820);

  const fresh = ensureReaderSession("att-new");
  assert.equal(fresh.currentPage, 1);
  assert.equal(fresh.zoom, 1);

  const reader = fs.readFileSync(path.resolve("src/reader/ResearchReaderView.tsx"), "utf-8");
  assert.ok(
    !reader.includes("saveReaderSession(document.id, { currentPage: 1 })"),
    "picking a document must restore its session instead of resetting its page"
  );
});
