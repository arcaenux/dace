import test from "node:test";
import assert from "node:assert/strict";
import {
  consumeWorkspaceIntent,
  createWorkspaceIntent,
  enqueueWorkspaceIntent,
  intentTargetActivity,
  isShellIntent,
  pruneIntentsForActivity,
  isTargetedKnowledgeDeskIntent,
  isTargetedResearchReaderIntent,
} from "../src/core/appIntents.ts";

test("intents carry metadata and queue in submission order", () => {
  const first = createWorkspaceIntent({ type: "new-record" }, "intent-1", "knowledge-desk");
  const second = createWorkspaceIntent(
    { type: "reader-mode", mode: "writing" },
    "intent-2",
    "reader"
  );

  assert.deepEqual(first, {
    id: "intent-1",
    type: "new-record",
    targetActivity: "knowledge-desk",
  });
  assert.deepEqual(second, {
    id: "intent-2",
    type: "reader-mode",
    mode: "writing",
    targetActivity: "reader",
  });

  const queue = enqueueWorkspaceIntent(enqueueWorkspaceIntent([], first), second);
  assert.deepEqual(
    queue.map((intent) => intent.id),
    ["intent-1", "intent-2"]
  );
});

test("consuming an intent removes only that id and does not mutate the source queue", () => {
  const first = createWorkspaceIntent({ type: "new-record" }, "intent-1", "knowledge-desk");
  const second = createWorkspaceIntent(
    { type: "search-records", query: "sqlite" },
    "intent-2",
    "knowledge-desk"
  );
  const third = createWorkspaceIntent({ type: "export-backup" }, "intent-3", null);
  const queue = [first, second, third];

  const remaining = consumeWorkspaceIntent(queue, "intent-2");

  assert.deepEqual(
    remaining.map((intent) => intent.id),
    ["intent-1", "intent-3"]
  );
  assert.equal(queue.length, 3, "consumeWorkspaceIntent must not mutate its input");
  assert.deepEqual(consumeWorkspaceIntent(queue, "missing"), queue);
});

test("intent target activity preserves workspace routing", () => {
  assert.equal(intentTargetActivity({ type: "new-record" }, "reader"), "knowledge-desk");
  assert.equal(intentTargetActivity({ type: "import-attachment" }, "workspace"), "knowledge-desk");
  assert.equal(intentTargetActivity({ type: "search-records" }, "terminal"), "knowledge-desk");
  assert.equal(
    intentTargetActivity({ type: "reader-mode", mode: "reading" }, "workspace"),
    "reader"
  );
  assert.equal(intentTargetActivity({ type: "save-active" }, "knowledge-desk"), "knowledge-desk");
  assert.equal(intentTargetActivity({ type: "save-active" }, "reader"), "reader");
  assert.equal(intentTargetActivity({ type: "save-active" }, "workspace"), null);
  assert.equal(intentTargetActivity({ type: "export-backup" }, "reader"), null);
  assert.equal(intentTargetActivity({ type: "restore-backup" }, "settings"), null);
});

test("typed target guards keep intents from being delivered to the wrong view", () => {
  const desk = createWorkspaceIntent({ type: "search-records" }, "desk-1", "knowledge-desk");
  const deskSave = createWorkspaceIntent({ type: "save-active" }, "desk-2", "knowledge-desk");
  const reader = createWorkspaceIntent(
    { type: "reader-mode", mode: "research" },
    "reader-1",
    "reader"
  );
  const readerSave = createWorkspaceIntent({ type: "save-active" }, "reader-2", "reader");
  const shell = createWorkspaceIntent({ type: "restore-backup" }, "shell-1", null);

  assert.equal(isTargetedKnowledgeDeskIntent(desk), true);
  assert.equal(isTargetedKnowledgeDeskIntent(deskSave), true);
  assert.equal(isTargetedKnowledgeDeskIntent(reader), false);
  assert.equal(isTargetedKnowledgeDeskIntent(readerSave), false);

  assert.equal(isTargetedResearchReaderIntent(reader), true);
  assert.equal(isTargetedResearchReaderIntent(readerSave), true);
  assert.equal(isTargetedResearchReaderIntent(desk), false);
  assert.equal(isTargetedResearchReaderIntent(deskSave), false);

  assert.equal(isShellIntent(shell), true);
  assert.equal(isShellIntent(desk), false);
});

test("leaving a target workspace before consumption discards the stale intent", () => {
  const shellIntent = createWorkspaceIntent({ type: "export-backup" }, "shell-1", null);
  const deskIntent = createWorkspaceIntent({ type: "new-record" }, "desk-1", "knowledge-desk");

  // Normal delivery: requestIntent routes to the target, then enqueues.
  let queue = pruneIntentsForActivity([shellIntent], "knowledge-desk");
  queue = enqueueWorkspaceIntent(queue, deskIntent);
  assert.deepEqual(
    queue.map((intent) => intent.id),
    ["shell-1", "desk-1"]
  );

  // Regression: user navigates away before Knowledge Desk consumes "desk-1".
  queue = pruneIntentsForActivity(queue, "workspace");
  assert.deepEqual(
    queue.map((intent) => intent.id),
    ["shell-1"],
    "the abandoned workspace intent must be dropped immediately"
  );

  // Returning to the target must not resurrect or execute the stale intent.
  queue = pruneIntentsForActivity(queue, "knowledge-desk");
  assert.deepEqual(
    queue.map((intent) => intent.id),
    ["shell-1"],
    "a later visit must not execute the stale intent"
  );

  // Shell intents are not tied to a target view and remain available.
  assert.equal(queue[0].type, "export-backup");
});
