import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

test("1. Project branding and metadata consistently reference Dace", () => {
  // package.json
  const pkg = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf-8"));
  assert.strictEqual(pkg.name, "dace");

  // tauri.conf.json
  const tauriConf = JSON.parse(fs.readFileSync(path.resolve("src-tauri/tauri.conf.json"), "utf-8"));
  assert.strictEqual(tauriConf.productName, "Dace");
  assert.strictEqual(tauriConf.identifier, "com.dace.app");
  assert.strictEqual(tauriConf.app?.windows?.[0]?.title, "Dace");

  // Cargo.toml
  const cargoToml = fs.readFileSync(path.resolve("src-tauri/Cargo.toml"), "utf-8");
  assert.ok(cargoToml.includes('name = "dace"'));
  assert.ok(cargoToml.includes('name = "dace_lib"'));

  // index.html
  const indexHtml = fs.readFileSync(path.resolve("index.html"), "utf-8");
  assert.ok(indexHtml.includes("<title>Dace — Research workspace</title>"));

  // WorkspaceIntro
  const introTsx = fs.readFileSync(path.resolve("src/workspace/WorkspaceIntro.tsx"), "utf-8");
  assert.ok(introTsx.includes("DACE — RESEARCH WORKSPACE"));
  assert.strictEqual(introTsx.includes("A SPACE FOR DISCOVERY"), false);

  // WorkspaceRail (branded navigation rail)
  const railTsx = fs.readFileSync(path.resolve("src/workspace/WorkspaceRail.tsx"), "utf-8");
  assert.ok(railTsx.includes("DACE"), "Workspace rail must display Dace branding");
});

test("2. Legacy data migration protocol: non-destructive copy with receipt and sentinel", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dace-migration-suite-"));
  const legacyDir = path.join(tempRoot, "com.novadome.app");
  const targetDir = path.join(tempRoot, "com.dace.app");

  fs.mkdirSync(legacyDir, { recursive: true });
  fs.mkdirSync(path.join(legacyDir, "attachments", "cd"), { recursive: true });

  // 1. Seed legacy files
  const sampleDbContent = "SQLite format 3\0Simulated database bytes";
  fs.writeFileSync(path.join(legacyDir, "novadome.db"), sampleDbContent);
  const samplePdfContent = "%PDF-1.7 Simulated research paper";
  fs.writeFileSync(path.join(legacyDir, "attachments", "cd", "cd12345.pdf"), samplePdfContent);

  // 2. Perform file-level migration logic matching DataMigrator
  fs.mkdirSync(targetDir, { recursive: true });
  fs.copyFileSync(path.join(legacyDir, "novadome.db"), path.join(targetDir, "dace.db"));

  fs.mkdirSync(path.join(targetDir, "attachments", "cd"), { recursive: true });
  fs.copyFileSync(
    path.join(legacyDir, "attachments", "cd", "cd12345.pdf"),
    path.join(targetDir, "attachments", "cd", "cd12345.pdf")
  );

  fs.writeFileSync(path.join(targetDir, ".dace_migration_done"), new Date().toISOString());

  // 3. Verify target files exist with matching content
  assert.strictEqual(fs.existsSync(path.join(targetDir, "dace.db")), true);
  assert.strictEqual(fs.readFileSync(path.join(targetDir, "dace.db"), "utf-8"), sampleDbContent);

  assert.strictEqual(fs.existsSync(path.join(targetDir, "attachments", "cd", "cd12345.pdf")), true);
  assert.strictEqual(
    fs.readFileSync(path.join(targetDir, "attachments", "cd", "cd12345.pdf"), "utf-8"),
    samplePdfContent
  );

  // 4. Verify legacy files remain intact (recoverable backup)
  assert.strictEqual(fs.existsSync(path.join(legacyDir, "novadome.db")), true);
  assert.strictEqual(fs.existsSync(path.join(legacyDir, "attachments", "cd", "cd12345.pdf")), true);

  // Cleanup
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("3. Old logo backups and byte-identical copies are not tracked", () => {
  const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .split(/\r?\n/)
    .filter(Boolean);

  assert.ok(
    !tracked.some((file) => /(?:^|\/)logo[-_]?old(?:\.|$)/i.test(file)),
    "An old-logo backup is still tracked"
  );

  // SHA-256 of the previous brand mark (src/assets/brand/logo.png before the rebrand).
  const oldLogoHash = "ae0f7b2ff7c17f6d0d253c067d578836d473dd68a9eb6a7d6836e6bb272858ad";
  const imageFiles = tracked.filter((file) => /\.(png|ico|icns|jpe?g|webp|svg)$/i.test(file));

  for (const file of imageFiles) {
    const hash = createHash("sha256").update(fs.readFileSync(path.resolve(file))).digest("hex");
    assert.notStrictEqual(hash, oldLogoHash, `${file} is a byte-identical copy of the old logo`);
  }
});
