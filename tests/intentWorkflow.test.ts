import test from "node:test";
import assert from "node:assert/strict";

import { buildCommandList } from "../src/core/commandRegistry.ts";
import {
  consumeWorkspaceIntent,
  createWorkspaceIntent,
  enqueueWorkspaceIntent,
  intentTargetActivity,
  isShellIntent,
  isTargetedKnowledgeDeskIntent,
  isTargetedResearchReaderIntent,
  pruneIntentsForActivity,
  type WorkspaceIntentRequest,
} from "../src/core/appIntents.ts";

function commandContext(
  activeActivity: "workspace" | "knowledge-desk" | "reader" | "settings",
  requests: WorkspaceIntentRequest[]
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

function routeIntent(
  request: WorkspaceIntentRequest,
  activeActivity: "workspace" | "knowledge-desk" | "reader" | "settings",
  id: string
) {
  const targetActivity = intentTargetActivity(request, activeActivity);
  const intent = createWorkspaceIntent(request, id, targetActivity);
  return { intent, targetActivity };
}

test("command execution routes a Knowledge Desk intent to the target view", () => {
  const requests: WorkspaceIntentRequest[] = [];
  const commands = buildCommandList(commandContext("workspace", requests));
  commands.find((command) => command.id === "knowledge:new-record")?.execute();

  assert.deepEqual(requests, [{ type: "new-record" }]);
  const { intent, targetActivity } = routeIntent(requests[0], "workspace", "desk-intent");

  assert.equal(targetActivity, "knowledge-desk");
  assert.equal(isTargetedKnowledgeDeskIntent(intent), true);
  assert.equal(isTargetedResearchReaderIntent(intent), false);

  let queue = enqueueWorkspaceIntent([], intent);
  queue = pruneIntentsForActivity(queue, "reader");
  assert.deepEqual(queue, [], "leaving the target view abandons the command intent");

  queue = pruneIntentsForActivity(queue, "knowledge-desk");
  assert.deepEqual(queue, [], "an abandoned command intent must not resurrect");
});

test("reader layout commands and shell commands route without crossing targets", () => {
  const readerRequests: WorkspaceIntentRequest[] = [];
  const readerCommands = buildCommandList(commandContext("reader", readerRequests));
  readerCommands.find((command) => command.id === "reader:layout-research")?.execute();

  assert.deepEqual(readerRequests, [{ type: "reader-mode", mode: "research" }]);
  const readerRoute = routeIntent(readerRequests[0], "reader", "reader-intent");
  assert.equal(readerRoute.targetActivity, "reader");
  assert.equal(isTargetedResearchReaderIntent(readerRoute.intent), true);
  assert.equal(isTargetedKnowledgeDeskIntent(readerRoute.intent), false);

  const queue = enqueueWorkspaceIntent([], readerRoute.intent);
  assert.equal(isShellIntent(queue[0]), false);
  assert.deepEqual(consumeWorkspaceIntent(queue, "reader-intent"), []);
  assert.equal(queue.length, 1, "consumer must not mutate the queued intent");

  const shellRequests: WorkspaceIntentRequest[] = [];
  const shellCommands = buildCommandList(commandContext("reader", shellRequests));
  shellCommands.find((command) => command.id === "workspace:restore-backup")?.execute();

  const shellRoute = routeIntent(shellRequests[0], "reader", "shell-intent");
  assert.equal(shellRoute.targetActivity, null);
  assert.equal(isShellIntent(shellRoute.intent), true);
  assert.deepEqual(
    pruneIntentsForActivity(enqueueWorkspaceIntent([], shellRoute.intent), "knowledge-desk"),
    [shellRoute.intent],
    "shell-owned actions must survive view changes"
  );
});
