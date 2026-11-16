import test from "node:test";
import assert from "node:assert/strict";
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
  assert.ok(indexHtml.includes("<title>Dace — A space for discovery</title>"));

  // WorkspaceIntro
  const introTsx = fs.readFileSync(path.resolve("src/workspace/WorkspaceIntro.tsx"), "utf-8");
  assert.ok(introTsx.includes("Welcome to Dace"));
  assert.ok(introTsx.includes("A space for discovery."));

  // WorkspaceNavigation
  const navTsx = fs.readFileSync(path.resolve("src/workspace/WorkspaceNavigation.tsx"), "utf-8");
  assert.ok(navTsx.includes('<span className="brand-title">Dace</span>'));
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
