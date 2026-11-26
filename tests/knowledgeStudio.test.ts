import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  applyMarkdownFormat,
  formatActionForShortcut,
  stripMarkdownPreview,
} from "../src/knowledge/markdownFormat.ts";

const apply = (text: string, start: number, end: number, action: Parameters<typeof applyMarkdownFormat>[3]) => {
  const edit = applyMarkdownFormat(text, start, end, action);
  const next = text.slice(0, edit.start) + edit.insert + text.slice(edit.end);
  return { next, selected: next.slice(edit.selectionStart, edit.selectionEnd) };
};

test("1. Inline wraps toggle on and off and keep the selection on the text", () => {
  const on = apply("so meaning flows", 3, 10, "bold");
  assert.equal(on.next, "so **meaning** flows");
  assert.equal(on.selected, "meaning");

  const off = apply(on.next, 5, 12, "bold");
  assert.equal(off.next, "so meaning flows");
  assert.equal(off.selected, "meaning");

  const empty = apply("ab", 1, 1, "italic");
  assert.equal(empty.next, "a_text_b");
  assert.equal(empty.selected, "text");
});

test("2. Line prefixes replace headings, number lists and toggle off", () => {
  assert.equal(apply("## Title", 3, 3, "h1").next, "# Title");
  assert.equal(apply("one\ntwo", 0, 7, "numbered").next, "1. one\n2. two");
  assert.equal(apply("- a\n- b", 0, 7, "bullet").next, "a\nb");
  assert.equal(apply("a\nb", 2, 2, "quote").next, "a\n> b");
  assert.equal(apply("x", 0, 0, "task").next, "- [ ] x");
});

test("3. Links select the url placeholder and dividers sit on their own line", () => {
  const link = apply("see docs", 4, 8, "link");
  assert.equal(link.next, "see [docs](url)");
  assert.equal(link.selected, "url");
  assert.equal(apply("end", 3, 3, "divider").next, "end\n\n---\n\n");
});

test("4. Editor shortcuts and previews", () => {
  assert.equal(formatActionForShortcut("b", false), "bold");
  assert.equal(formatActionForShortcut("I", false), "italic");
  assert.equal(formatActionForShortcut("x", true), "strike");
  assert.equal(formatActionForShortcut("s", false), null);
  assert.equal(stripMarkdownPreview("# Overview **bold** - [ ] task [a](b)"), "Overview bold task a");
});

test("5. Desk is a docked library, one sheet and a single view-driven side panel", () => {
  const desk = fs.readFileSync(path.resolve("src/knowledge/KnowledgeDesk.tsx"), "utf-8");
  const panel = fs.readFileSync(path.resolve("src/knowledge/KnowledgeContextPanel.tsx"), "utf-8");
  const list = fs.readFileSync(path.resolve("src/knowledge/RecordListPanel.tsx"), "utf-8");
  const css = fs.readFileSync(path.resolve("src/styles/knowledge-desk.css"), "utf-8");

  assert.match(desk, /DESK_PANEL_VIEWS\.map/);
  assert.ok(!panel.includes('role="tablist"'), "side panel should not reintroduce a tab row");
  assert.ok(!list.includes("useDismissable"), "docked library must not close on outside clicks");
  assert.match(list, /searchFocusToken > 0/);
  assert.match(css, /textarea\.kd-body:focus-visible[\s\S]*outline: none !important/);
});

test("6. Home leads with a large, light clock, a clear greeting and the date beneath it", () => {
  const intro = fs.readFileSync(path.resolve("src/workspace/WorkspaceIntro.tsx"), "utf-8");
  const css = fs.readFileSync(path.resolve("src/styles/cinematic-home.css"), "utf-8");
  assert.match(intro, /className="home-time"/);
  assert.match(intro, /className="home-date"/);
  assert.ok(!intro.includes("home-orb"), "decorative orbs are gone");
  assert.match(css, /\.home-time \{[^}]*font-weight: 300/s);
  assert.match(css, /\.home-greeting \{[^}]*font-size: clamp\(24px/s);
});

test("7. Reader drawer is one quiet header with icon views and a free note page", () => {
  const drawer = fs.readFileSync(path.resolve("src/reader/ReaderDrawer.tsx"), "utf-8");
  const reader = fs.readFileSync(path.resolve("src/reader/ResearchReaderView.tsx"), "utf-8");
  const css = fs.readFileSync(path.resolve("src/styles/reader-adaptive.css"), "utf-8");

  assert.match(drawer, /DRAWER_VIEWS\.map/);
  assert.match(drawer, /id: "passages"/);
  assert.ok(!drawer.includes("drawer-tab "), "old uppercase tab row is gone");
  assert.ok(!drawer.includes("reader-tertiary-btn"), "note actions live in the small ⋯ menu, not a link row");
  assert.match(reader, /setAnnotationRequestId\(id\);\s*revealWriting\(\);\s*setDrawerTab\("passages"\)/);
  assert.match(css, /\.reader-mode-btn \{[^}]*text-transform: none/s);
  assert.match(css, /textarea\.rd-note-body:focus-visible[\s\S]*outline: none !important/);
});
