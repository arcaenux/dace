import test from "node:test";
import assert from "node:assert/strict";
import { resolveReaderAutosaveDelayMs } from "../src/reader/readerAutosave.ts";
import { normalizeSettings } from "../src/settings/settingsSchema.ts";

test("reader autosave delay follows the configured editor setting", () => {
  const configured = normalizeSettings({ editor: { autosaveDelayMs: 2500 } });
  assert.equal(resolveReaderAutosaveDelayMs(configured), 2500);

  const rounded = normalizeSettings({ editor: { autosaveDelayMs: 1800.6 } });
  assert.equal(resolveReaderAutosaveDelayMs(rounded), 1801);

  const boundedLow = normalizeSettings({ editor: { autosaveDelayMs: 1 } });
  assert.equal(resolveReaderAutosaveDelayMs(boundedLow), 300);

  const boundedHigh = normalizeSettings({ editor: { autosaveDelayMs: 99999 } });
  assert.equal(resolveReaderAutosaveDelayMs(boundedHigh), 5000);

  const fallback = normalizeSettings({ editor: { autosaveDelayMs: 0 } });
  assert.equal(resolveReaderAutosaveDelayMs(fallback), 1200);
});
