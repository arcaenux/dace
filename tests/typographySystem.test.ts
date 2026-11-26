import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("1. Typography tokens use Aptos as the base for app and text", () => {
  const tokensCss = fs.readFileSync(path.resolve("src/styles/tokens.css"), "utf-8");

  assert.ok(tokensCss.includes("--dace-app-font:"), "must expose the app font hook");
  assert.ok(tokensCss.includes("--dace-text-font:"), "must expose the text font hook");
  assert.ok(tokensCss.includes("--font-code:"), "must expose a monospace stack");
  assert.match(tokensCss, /--dace-app-font:[^;]*Aptos/, "app font must default to Aptos");
  assert.match(tokensCss, /--dace-text-font:[^;]*Aptos/, "text font must default to Aptos");

  assert.ok(tokensCss.includes("--font-interface: var(--font-app)"));
  assert.ok(tokensCss.includes("--font-sans: var(--font-app)"));
  assert.ok(tokensCss.includes("--font-display: var(--font-app)"));
  assert.ok(tokensCss.includes("--font-editorial: var(--font-text)"));
  assert.ok(tokensCss.includes("--font-quotation: var(--font-text)"));
  assert.ok(tokensCss.includes("--font-label: var(--font-app)"));
  assert.ok(tokensCss.includes("--font-mono: var(--font-code)"));

  assert.ok(tokensCss.includes("--letter-spacing-editorial:"));
  assert.ok(tokensCss.includes("--letter-spacing-quote:"));
});

test("2. No bundled webfonts or external font CDNs remain", () => {
  assert.strictEqual(fs.existsSync(path.resolve("src/styles/fonts.css")), false);
  assert.strictEqual(fs.existsSync(path.resolve("src/assets/fonts")), false);
  assert.strictEqual(fs.existsSync(path.resolve("public/fonts")), false);

  const packageJson = fs.readFileSync(path.resolve("package.json"), "utf-8");
  assert.strictEqual(packageJson.includes("@fontsource"), false);
  assert.strictEqual(packageJson.includes("googleapis.com"), false);
  assert.strictEqual(packageJson.includes("cdnjs.cloudflare.com"), false);

  const stylesDir = path.resolve("src/styles");
  for (const file of fs.readdirSync(stylesDir).filter((name) => name.endsWith(".css"))) {
    const css = fs.readFileSync(path.join(stylesDir, file), "utf-8");
    assert.strictEqual(css.includes("@font-face"), false, `${file} must not declare @font-face`);
    assert.strictEqual(css.includes("@import \"@fontsource"), false, `${file} must not import webfonts`);
    assert.strictEqual(css.includes("fonts.googleapis.com"), false);
    assert.strictEqual(css.includes("cdnjs.cloudflare.com"), false);
  }
});

test("3. Settings apply the selected device fonts to the document", () => {
  const context = fs.readFileSync(path.resolve("src/settings/SettingsContext.tsx"), "utf-8");
  assert.ok(context.includes('setProperty("--dace-app-font"'));
  assert.ok(context.includes('setProperty("--dace-text-font"'));
  assert.ok(context.includes("settings.appearance.appFont"));
  assert.ok(context.includes("settings.appearance.textFont"));

  const view = fs.readFileSync(path.resolve("src/settings/SettingsView.tsx"), "utf-8");
  assert.ok(view.includes("listSystemFonts()"), "settings must load installed device fonts");
  assert.ok(view.includes('label="App font"'));
  assert.ok(view.includes('label="Text font"'));
});

test("4. Knowledge Graph canvas follows the selected app font", () => {
  const code = fs.readFileSync(path.resolve("src/graph/KnowledgeGraphView.tsx"), "utf-8");
  assert.ok(code.includes('fontStack(settings.appearance.appFont, "app")'));
  assert.ok(code.includes("readFontStack(\"--font-mono\""));
  assert.strictEqual(code.includes("Space Grotesk"), false);
  assert.strictEqual(code.includes("IBM Plex Mono"), false);
});

test("5. Terminal uses the shared monospace logic", () => {
  const code = fs.readFileSync(path.resolve("src/terminal/TerminalView.tsx"), "utf-8");
  assert.ok(code.includes("terminalFontStack(settings.appearance.appFont)"));
  assert.strictEqual(code.includes("IBM Plex Mono"), false);
});
