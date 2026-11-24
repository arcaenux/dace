import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildCommandList } from "../src/core/commandRegistry.ts";
import type { WorkspaceIntentRequest } from "../src/core/appIntents.ts";
import {
  activityFromHash,
  hashForActivity,
} from "../src/workspace/workspaceNavigation.ts";

function makeCommandContext(
  activeActivity: "workspace" | "knowledge-desk" | "reader" = "workspace",
  requests: WorkspaceIntentRequest[] = []
) {
  return {
    activeActivity,
    setActiveActivity: () => {},
    requestIntent: (request: WorkspaceIntentRequest) => {
      requests.push(request);
    },
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
  assert.strictEqual(settings?.available, true, "Settings must be presented as implemented");
  assert.equal(settings?.shortcut, "Alt+5");
  assert.match(settings?.description || "", /preferences/i);
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

test("4. Workspace hashes map to activities and win over persisted startup", () => {
  assert.equal(activityFromHash("#reader"), "reader");
  assert.equal(activityFromHash("#terminal"), "terminal");
  assert.equal(activityFromHash("#not-a-workspace"), null);
  assert.equal(hashForActivity("knowledge-desk"), "#knowledge-desk");

  const shell = fs.readFileSync(path.resolve("src/workspace/WorkspaceShell.tsx"), "utf-8");
  assert.match(shell, /initialHashActivityRef\.current\) return;/);
  assert.match(shell, /history\.replaceState\(window\.history\.state, "", nextHash\)/);
});

test("5. Reader toolbar stays clickable when the global top bar is hidden", () => {
  const css = fs.readFileSync(path.resolve("src/styles/reader-adaptive.css"), "utf-8");
  assert.match(
    css,
    /\.dace-app\.reader-header-hidden \.reader-toolbar-wrap \{[^}]*z-index:\s*var\(--z-topbar\)/s
  );
  assert.match(
    css,
    /\.dace-app\.reader-header-hidden \.reader-toolbar-wrap \.reader-toolbar \{[^}]*padding-right:\s*calc\(var\(--window-control-space\) \+ 16px\)/s
  );
});

test("6. Cross-view commands enqueue typed shell intents instead of custom events", () => {
  const requests: WorkspaceIntentRequest[] = [];
  const commands = buildCommandList(makeCommandContext("workspace", requests));
  const execute = (id: string) => {
    const command = commands.find((item) => item.id === id);
    assert.ok(command, `Expected command ${id}`);
    command.execute();
  };

  execute("knowledge:new-record");
  execute("attachments:import-document");
  execute("knowledge:search-records");
  execute("workspace:export-backup");
  execute("workspace:restore-backup");
  execute("reader:layout-reading");
  execute("reader:layout-research");
  execute("reader:layout-writing");

  assert.deepEqual(requests, [
    { type: "new-record" },
    { type: "import-attachment" },
    { type: "search-records" },
    { type: "export-backup" },
    { type: "restore-backup" },
    { type: "reader-mode", mode: "reading" },
    { type: "reader-mode", mode: "research" },
    { type: "reader-mode", mode: "writing" },
  ]);

  const saveRequests: WorkspaceIntentRequest[] = [];
  const deskCommands = buildCommandList(makeCommandContext("knowledge-desk", saveRequests));
  deskCommands.find((command) => command.id === "knowledge:save-record")?.execute();
  assert.deepEqual(saveRequests, [{ type: "save-active" }]);
});

test("7. Global shortcuts use shell intents and bind the advertised reader layouts", () => {
  const registry = fs.readFileSync(path.resolve("src/core/commandRegistry.ts"), "utf-8");
  const shortcuts = fs.readFileSync(path.resolve("src/core/useKeyboardShortcuts.ts"), "utf-8");

  assert.ok(!registry.includes("window.dispatchEvent"));
  assert.ok(!shortcuts.includes("window.dispatchEvent"));
  assert.match(shortcuts, /e\.altKey && e\.shiftKey && !modifier && !isInput/);
  assert.match(shortcuts, /requestIntent\(\{ type: "reader-mode", mode: "reading" \}\)/);
  assert.match(shortcuts, /requestIntent\(\{ type: "reader-mode", mode: "research" \}\)/);
  assert.match(shortcuts, /requestIntent\(\{ type: "reader-mode", mode: "writing" \}\)/);
  assert.match(shortcuts, /requestIntent\(\{ type: "save-active" \}\)/);
});

test("8. WorkspaceShell is the sole intent owner and target views consume by id", () => {
  const shell = fs.readFileSync(path.resolve("src/workspace/WorkspaceShell.tsx"), "utf-8");
  const desk = fs.readFileSync(path.resolve("src/knowledge/KnowledgeDesk.tsx"), "utf-8");
  const reader = fs.readFileSync(path.resolve("src/reader/ResearchReaderView.tsx"), "utf-8");
  const layout = fs.readFileSync(path.resolve("src/reader/useAdaptiveReaderLayout.ts"), "utf-8");

  assert.match(shell, /const \[intentQueue, setIntentQueue\]/);
  assert.match(
    shell,
    /setIntentQueue\(\(current\) => pruneIntentsForActivity\(current, activity\)\)/
  );
  assert.match(shell, /const consumeIntent = useCallback/);
  assert.equal((shell.match(/onConsumeIntent=\{consumeIntent\}/g) ?? []).length, 2);
  assert.match(shell, /requestIntent,\s*\n\s*onToggleNav: toggleRail/);
  assert.match(shell, /onSearch=\{\(\) => requestIntent\(\{ type: "search-records" \}\)\}/);
  assert.ok(!shell.includes('window.addEventListener("dace:export-backup"'));
  assert.ok(!shell.includes('window.addEventListener("dace:restore-backup"'));

  assert.match(desk, /onConsumeIntent\?\.\(intent\.id\)/);
  assert.match(reader, /onConsumeIntent\?\.\(intent\.id\)/);
  assert.ok(!desk.includes('window.addEventListener("dace:'));
  assert.ok(!reader.includes('window.addEventListener("dace:'));
  assert.ok(!layout.includes("dace:reader-mode"));
});
