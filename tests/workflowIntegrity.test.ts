import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildCommandList } from "../src/core/commandRegistry.ts";

function makeCommandContext() {
  return {
    activeActivity: "workspace" as const,
    setActiveActivity: () => {},
    isFocusSpace: false,
    enterFocusSpace: async () => {},
    exitFocusSpace: async () => {},
    toggleFocusSpace: async () => {},
    openOverlay: () => {},
    closeOverlay: () => {},
    setNotice: () => {},
  };
}

test("1. Command registry has unique IDs and a single available Research Reader command", () => {
  const commands = buildCommandList(makeCommandContext());
  const ids = commands.map((c) => c.id);
  const uniqueIds = new Set(ids);

  assert.strictEqual(
    uniqueIds.size,
    ids.length,
    `Command IDs must be unique; duplicates: ${ids.filter((id, i) => ids.indexOf(id) !== i).join(", ")}`
  );

  const readerCommands = commands.filter((c) => c.id === "nav:reader");
  assert.strictEqual(readerCommands.length, 1, "Exactly one nav:reader command should exist");

  const reader = readerCommands[0];
  assert.strictEqual(reader.available, true, "Research Reader command must remain available");
  assert.strictEqual(reader.name, "Open Research Reader");
  assert.strictEqual(reader.shortcut, "Alt+4");
  assert.match(reader.description || "", /read|highlight|annotation/i);
});

test("2. Command descriptions are current and planned commands remain unavailable", () => {
  const commands = buildCommandList(makeCommandContext());

  const graph = commands.find((c) => c.id === "nav:knowledge-graph");
  assert.ok(graph, "Knowledge Graph command must exist");
  assert.ok(graph?.available, "Knowledge Graph command should remain available");
  assert.ok(
    !(graph?.description || "").toLowerCase().includes("astronomical"),
    "Knowledge Graph description must not contain outdated 'astronomical' wording"
  );

  const terminal = commands.find((c) => c.id === "nav:terminal");
  assert.ok(terminal, "Terminal command should remain listed");
  assert.strictEqual(terminal?.available, true, "Terminal must be presented as implemented");
  assert.equal(terminal?.shortcut, "Alt+6");
  assert.match(terminal?.description || "", /shell|pty/i);

  const settings = commands.find((c) => c.id === "system:settings");
  assert.ok(settings, "Settings command should remain listed");
  assert.strictEqual(settings?.available, false, "Settings must not be presented as implemented");
  assert.ok(settings?.unavailabilityReason, "Planned Settings command should explain unavailability");
});

test("3. Reader drawer linked-record navigation uses valid targets and no empty record ID", () => {
  const drawerPath = path.resolve("src/reader/ReaderDrawer.tsx");
  const source = fs.readFileSync(drawerPath, "utf-8");

  assert.ok(
    !source.includes('onNavigateToRecord("")'),
    "ReaderDrawer must not navigate using an empty record ID"
  );
  assert.ok(
    source.includes("getAttachmentDetails"),
    "ReaderDrawer should resolve linked records from attachment details"
  );
  assert.ok(
    source.includes("associated_records"),
    "ReaderDrawer should read associated record IDs"
  );
  assert.ok(
    source.includes("linkedRecords.map"),
    "ReaderDrawer should render navigation targets for each linked record"
  );
  assert.ok(
    source.includes("record.id.trim()"),
    "ReaderDrawer should guard against empty/invalid record IDs before navigating"
  );
  assert.ok(
    source.includes("No knowledge records currently reference this document"),
    "Empty-state messaging for unlinked documents must remain present"
  );
});
