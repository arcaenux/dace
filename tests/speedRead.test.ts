import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  estimateSpeedMinutes,
  formatSpeedDuration,
  normalizeSpeedText,
  pdfItemsToText,
  speedChunkIntervalMs,
  speedFocusSplit,
  speedWordCount,
  tokenizeSpeedText,
} from "../src/reader/speedRead.ts";

test("1. Speed-read text normalization and word counting ignore ragged whitespace", () => {
  assert.strictEqual(normalizeSpeedText("  one\n\ttwo   three  "), "one two three");
  assert.strictEqual(speedWordCount("  one\n\ttwo   three  "), 3);
  assert.strictEqual(speedWordCount("   "), 0);
});

test("2. Tokenization splits whole words into bounded chunks", () => {
  const text = "alpha beta gamma delta epsilon";
  assert.deepEqual(tokenizeSpeedText(text, 1), [
    ["alpha"],
    ["beta"],
    ["gamma"],
    ["delta"],
    ["epsilon"],
  ]);
  assert.deepEqual(tokenizeSpeedText(text, 2), [
    ["alpha", "beta"],
    ["gamma", "delta"],
    ["epsilon"],
  ]);
  assert.deepEqual(tokenizeSpeedText(text, 3), [
    ["alpha", "beta", "gamma"],
    ["delta", "epsilon"],
  ]);
});

test("3. Chunk size and WPM values stay in a safe range", () => {
  assert.deepEqual(tokenizeSpeedText("a b c", 0), [["a"], ["b"], ["c"]]);
  assert.deepEqual(tokenizeSpeedText("a b c d e f", 99), [
    ["a", "b", "c", "d", "e"],
    ["f"],
  ]);
  assert.strictEqual(estimateSpeedMinutes(0, 320), 0);
  assert.strictEqual(estimateSpeedMinutes(320, 0), 0);
  assert.strictEqual(estimateSpeedMinutes(640, 320), 2);
  assert.strictEqual(formatSpeedDuration(0.25), "15 sec");
  assert.strictEqual(formatSpeedDuration(1.5), "1m 30s");
  assert.strictEqual(speedChunkIntervalMs(320, 1), 188);
  assert.strictEqual(speedChunkIntervalMs(320, 4), 750);
  assert.strictEqual(speedChunkIntervalMs(0, 4), 0);
});

test("4. PDF text items become readable plain text", () => {
  const text = pdfItemsToText([
    { str: "Speed ", hasEOL: false },
    { str: "reading ", hasEOL: true },
    { str: "works.", hasEOL: false },
  ]);
  assert.strictEqual(text, "Speed reading\nworks.");
  assert.deepEqual(tokenizeSpeedText(text, 2), [
    ["Speed", "reading"],
    ["works."],
  ]);
});

test("5. Speed Reader is wired into the Research Reader, toolbar, and shortcut list", () => {
  const readSource = (relativePath: string) =>
    readFileSync(new URL(relativePath, import.meta.url), "utf8");

  const view = readSource("../src/reader/ResearchReaderView.tsx");
  for (const needle of [
    "SpeedReadModal",
    "handleSpeedRead",
    "handlePageTextLoaded",
    "onSpeedRead={handleSpeedRead}",
    "speedRead && (",
  ]) {
    assert.ok(view.includes(needle), `ResearchReaderView is missing ${needle}`);
  }

  const toolbar = readSource("../src/reader/ReaderToolbar.tsx");
  assert.ok(toolbar.includes("onSpeedRead"), "ReaderToolbar is missing onSpeedRead prop");
  assert.ok(toolbar.includes("Speed Read (Ctrl+Shift+R)"), "ReaderToolbar is missing Speed Read button");

  const modal = readSource("../src/reader/SpeedReadModal.tsx");
  assert.ok(
    modal.includes("speedChunkIntervalMs(wpm, chunkSize)"),
    "Speed Reader timer must scale WPM by chunk size"
  );
  assert.ok(
    modal.includes("outsideClickGraceMs: 200"),
    "Speed Reader must ignore the click that opened it"
  );

  const pdfViewer = readSource("../src/reader/PdfViewer.tsx");
  assert.ok(pdfViewer.includes("onPageTextLoaded"), "PdfViewer is missing page text extraction");
  assert.ok(pdfViewer.includes("pdfItemsToText"), "PdfViewer is missing PDF text conversion");

  const markdownReader = readSource("../src/reader/MarkdownReader.tsx");
  assert.ok(markdownReader.includes("onSpeedRead"), "MarkdownReader is missing onSpeedRead prop");

  const shortcuts = readSource("../src/overlays/ShortcutReference.tsx");
  assert.ok(shortcuts.includes("Ctrl + Shift + R"), "ShortcutReference is missing Speed Read shortcut");
});

test("6. Focus split anchors words at a stable recognition point", () => {
  assert.deepEqual(speedFocusSplit(""), { before: "", focus: "", after: "" });
  assert.deepEqual(speedFocusSplit("a"), { before: "", focus: "a", after: "" });
  assert.deepEqual(speedFocusSplit("at"), { before: "", focus: "a", after: "t" });
  assert.deepEqual(speedFocusSplit("read"), { before: "r", focus: "e", after: "ad" });
  assert.deepEqual(speedFocusSplit("research"), { before: "re", focus: "s", after: "earch" });
  assert.deepEqual(speedFocusSplit("understanding"), {
    before: "und",
    focus: "e",
    after: "rstanding",
  });
});

test("7. Speed Reader styling stays restrained and instrument-like", () => {
  const readSource = (relativePath: string) =>
    readFileSync(new URL(relativePath, import.meta.url), "utf8");

  const css = readSource("../src/styles/speed-read.css");
  const modal = readSource("../src/reader/SpeedReadModal.tsx");
  const motion = readSource("../src/styles/motion.css");

  for (const tell of ["radial-gradient", "linear-gradient", "text-shadow", "backdrop-filter: blur"]) {
    assert.ok(!css.includes(tell), `Speed Reader CSS still contains ${tell}`);
  }
  assert.ok(!css.includes("border-radius: 16px"), "Oversized card radius is still present");
  assert.ok(css.includes("speed-read-orp"), "Focus-point styling is missing");
  assert.ok(css.includes(":focus-visible"), "Visible keyboard focus styling is missing");
  assert.ok(css.includes("prefers-reduced-motion"), "Reduced-motion handling is missing");

  assert.ok(modal.includes('aria-labelledby="speed-read-title"'), "Dialog title is not associated");
  assert.ok(modal.includes('role="progressbar"'), "Progress is not exposed to assistive tech");
  assert.ok(modal.includes("speed-read-sr-status"), "Screen-reader status region is missing");
  assert.ok(modal.includes("Comprehension typically drops above 500 WPM"), "High-WPM caution is missing");
  assert.ok(
    !motion.includes(".dace-app .speed-read-modal"),
    "Speed Reader should not use the generic spring entrance"
  );
});
