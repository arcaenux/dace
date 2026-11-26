import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (file: string) => fs.readFileSync(path.resolve(file), "utf-8");

test("1. Quiet UI layer is imported last as the authoritative visual pass", () => {
  const entry = read("src/styles/dace-cinematic.css");
  const imports = [...entry.matchAll(/@import\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.strictEqual(imports.at(-1), "./quiet-ui.css");

  const quiet = read("src/styles/quiet-ui.css");
  for (const rule of [
    "backdrop-filter: none !important",
    "background-image: none !important",
    "animation: none !important",
    "transform: none !important",
    "tabular-nums lining-nums slashed-zero",
    "outline: 2px solid var(--brand-blue-text) !important",
  ]) {
    assert.ok(quiet.includes(rule), `quiet UI layer must contain: ${rule}`);
  }
});

test("2. Typography uses one label recipe, an 11px floor, and measured prose", () => {
  const tokens = read("src/styles/tokens.css");
  assert.ok(tokens.includes("--type-micro: 11px"));
  assert.ok(tokens.includes("--tracking-upper-label: 0.08em"));
  assert.ok(tokens.includes("--leading-prose: 1.625"));
  assert.ok(tokens.includes("--measure-reading: 65ch"));
  assert.match(tokens, /--dace-app-font:[^;]*Aptos/);
  assert.match(tokens, /--dace-text-font:[^;]*Aptos/);

  const stylesDir = path.resolve("src/styles");
  for (const name of fs.readdirSync(stylesDir).filter((file) => file.endsWith(".css"))) {
    const css = fs.readFileSync(path.join(stylesDir, name), "utf-8");
    assert.strictEqual(
      /\bfont-size:\s*(?:8|9|10)px/.test(css),
      false,
      `${name} still uses text below the 11px floor`
    );
    assert.strictEqual(
      /letter-spacing:\s*(?:0\.1|0\.12|0\.14|0\.16|0\.18|0\.2)em/.test(css),
      false,
      `${name} still uses over-tracked labels`
    );
  }
});

test("3. Product copy is concrete instead of generic discovery language", () => {
  const sources = [
    "index.html",
    "src/workspace/WorkspaceIntro.tsx",
    "src/workspace/WorkspaceTopBar.tsx",
    "src/overlays/ShortcutReference.tsx",
  ];
  const slop = ["A space for discovery", "A SPACE FOR DISCOVERY", "Shortcut Discovery & Actions"];

  for (const file of sources) {
    const content = read(file);
    for (const phrase of slop) {
      assert.strictEqual(content.includes(phrase), false, `${file} still contains: ${phrase}`);
    }
  }

  assert.ok(read("index.html").includes("<title>Dace — Research workspace</title>"));
  assert.ok(read("src/workspace/WorkspaceTopBar.tsx").includes("Research workspace"));
  assert.ok(read("src/overlays/ShortcutReference.tsx").includes("Keyboard shortcuts"));
});
