import test from "node:test";
import assert from "node:assert/strict";
import {
  cloneDefaultSettings,
  normalizeSettings,
  settingsEqual,
} from "../src/settings/settingsSchema.ts";

test("1. Default settings contain only meaningful, valid values", () => {
  const settings = cloneDefaultSettings();
  assert.equal(settings.general.startupBehavior, "remember-last");
  assert.equal(settings.appearance.textScale, 1);
  assert.equal(settings.appearance.density, "comfortable");
  assert.equal(settings.appearance.appFont, "Aptos");
  assert.equal(settings.appearance.textFont, "Aptos");
  assert.equal(settings.workspace.readerDefaultMode, "research");
  assert.equal(settings.editor.autosaveDelayMs, 1200);
  assert.equal(settings.documents.defaultBackupDirectory, null);
});

test("2. Invalid values fall back individually without discarding valid settings", () => {
  const normalized = normalizeSettings({
    general: { startupBehavior: "explode", defaultActivity: "reader", confirmDestructiveActions: false },
    appearance: { density: "dull", textScale: 4, reducedMotion: true },
    editor: { autosaveDelayMs: 1 },
  });

  assert.equal(normalized.general.startupBehavior, "remember-last");
  assert.equal(normalized.general.defaultActivity, "reader");
  assert.equal(normalized.general.confirmDestructiveActions, false);
  assert.equal(normalized.appearance.density, "comfortable");
  assert.equal(normalized.appearance.textScale, 1.25);
  assert.equal(normalized.appearance.reducedMotion, true);
  assert.equal(normalized.editor.autosaveDelayMs, 300);
});

test("3. Out-of-range numeric preferences are clamped", () => {
  const normalized = normalizeSettings({
    appearance: { textScale: -3 },
    workspace: { readerSplitRatio: 99 },
    editor: { autosaveDelayMs: 999999 },
  });

  assert.equal(normalized.appearance.textScale, 0.85);
  assert.equal(normalized.workspace.readerSplitRatio, 0.76);
  assert.equal(normalized.editor.autosaveDelayMs, 5000);
});

test("4. Blank paths are normalised to null", () => {
  const normalized = normalizeSettings({
    documents: { defaultBackupDirectory: "   " },
  });
  assert.equal(normalized.documents.defaultBackupDirectory, null);
});

test("5. Equality compares the full settings tree", () => {
  const a = cloneDefaultSettings();
  const b = cloneDefaultSettings();
  assert.equal(settingsEqual(a, b), true);
  b.appearance.reducedMotion = true;
  assert.equal(settingsEqual(a, b), false);
});

test("6. Device font preferences are retained and sanitised", () => {
  const chosen = normalizeSettings({
    appearance: { appFont: "  Segoe UI  ", textFont: "Georgia" },
  });
  assert.equal(chosen.appearance.appFont, "Segoe UI");
  assert.equal(chosen.appearance.textFont, "Georgia");

  const unsafe = normalizeSettings({
    appearance: { appFont: 'Aptos"; color: red', textFont: "   " },
  });
  assert.equal(unsafe.appearance.appFont, "Aptos color red");
  assert.equal(unsafe.appearance.textFont, "Aptos");
});
