import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("1. Typography tokens define three-layer system in tokens.css", () => {
  const tokensPath = path.resolve("src/styles/tokens.css");
  const tokensCss = fs.readFileSync(tokensPath, "utf-8");

  // Layer 1: Editorial / Naturalist
  assert.ok(
    tokensCss.includes("--font-editorial:"),
    "tokens.css must define --font-editorial token"
  );
  assert.ok(
    tokensCss.includes("Newsreader") || tokensCss.includes("Cormorant"),
    "--font-editorial must reference Newsreader or Cormorant Garamond"
  );

  // Layer 2: Interface typography
  assert.ok(
    tokensCss.includes("--font-interface:"),
    "tokens.css must define --font-interface token"
  );
  assert.ok(
    tokensCss.includes("Manrope") || tokensCss.includes("DM Sans"),
    "--font-interface must reference Manrope or DM Sans"
  );

  // Layer 3: Quotation typography
  assert.ok(
    tokensCss.includes("--font-quotation:"),
    "tokens.css must define --font-quotation token"
  );

  // Optical sizing & refined typographic spacing
  assert.ok(
    tokensCss.includes("--letter-spacing-editorial:"),
    "tokens.css must define --letter-spacing-editorial"
  );
  assert.ok(
    tokensCss.includes("--letter-spacing-quote:"),
    "tokens.css must define --letter-spacing-quote"
  );
});

test("2. Local font imports contain no runtime external CDNs", () => {
  const fontsCssPath = path.resolve("src/styles/fonts.css");
  const fontsCss = fs.readFileSync(fontsCssPath, "utf-8");

  assert.strictEqual(
    fontsCss.includes("fonts.googleapis.com"),
    false,
    "Must not reference external Google Fonts CDN"
  );
  assert.strictEqual(
    fontsCss.includes("cdnjs.cloudflare.com"),
    false,
    "Must not reference external Cloudflare CDN"
  );
  assert.ok(
    fontsCss.includes("@fontsource-variable/newsreader"),
    "Must self-host Newsreader variable font"
  );
  assert.ok(
    fontsCss.includes("@fontsource-variable/manrope"),
    "Must self-host Manrope variable font"
  );
});

test("3. Font attribution document exists with SIL Open Font License details", () => {
  const attrPath = path.resolve("public/fonts/ATTRIBUTION.md");
  assert.strictEqual(fs.existsSync(attrPath), true, "ATTRIBUTION.md must exist in public/fonts/");
  const content = fs.readFileSync(attrPath, "utf-8");
  assert.ok(content.includes("Newsreader"), "Attribution must mention Newsreader");
  assert.ok(content.includes("Manrope"), "Attribution must mention Manrope");
  assert.ok(content.includes("SIL Open Font License"), "Attribution must state SIL Open Font License");
});

test("4. Knowledge Graph canvas uses the canonical cinematic typography", () => {
  const graphViewPath = path.resolve("src/graph/KnowledgeGraphView.tsx");
  const code = fs.readFileSync(graphViewPath, "utf-8");

  // Node titles use the primary interface typeface
  assert.ok(
    code.includes('"Space Grotesk"'),
    "KnowledgeGraphView canvas must render node labels with Space Grotesk"
  );

  // Relationship labels use the technical mono typeface
  assert.ok(
    code.includes('"IBM Plex Mono"'),
    "KnowledgeGraphView canvas must render relationship badges with IBM Plex Mono"
  );
});
