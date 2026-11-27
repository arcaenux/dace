import type { WorkspaceActivityId } from "./types.ts";

export type ReaderIntentMode = "reading" | "research" | "writing";

type WorkspaceIntentPayload =
  | { type: "new-record" }
  | { type: "import-attachment" }
  | { type: "search-records"; query?: string }
  | { type: "save-active" }
  | { type: "reader-mode"; mode: ReaderIntentMode }
  | { type: "export-backup" }
  | { type: "restore-backup" };

type WithMetadata<T> = T extends unknown
  ? T & { id: string; targetActivity: WorkspaceActivityId | null }
  : never;

export type WorkspaceIntentRequest = WorkspaceIntentPayload;
export type WorkspaceIntent = WithMetadata<WorkspaceIntentPayload>;

export type KnowledgeDeskIntent = Extract<
  WorkspaceIntent,
  { type: "new-record" | "import-attachment" | "search-records" | "save-active" }
>;

export type ResearchReaderIntent = Extract<
  WorkspaceIntent,
  { type: "reader-mode" | "save-active" | "import-attachment" }
>;

export type ShellIntent = Extract<WorkspaceIntent, { type: "export-backup" | "restore-backup" }>;

const KNOWLEDGE_DESK_INTENT_TYPES: ReadonlySet<WorkspaceIntent["type"]> = new Set([
  "new-record",
  "import-attachment",
  "search-records",
  "save-active",
]);

const RESEARCH_READER_INTENT_TYPES: ReadonlySet<WorkspaceIntent["type"]> = new Set([
  "reader-mode",
  "save-active",
  "import-attachment",
]);

const SHELL_INTENT_TYPES: ReadonlySet<WorkspaceIntent["type"]> = new Set([
  "export-backup",
  "restore-backup",
]);

export function createWorkspaceIntent(
  request: WorkspaceIntentRequest,
  id: string,
  targetActivity: WorkspaceActivityId | null
): WorkspaceIntent {
  return { ...request, id, targetActivity } as WorkspaceIntent;
}

export function enqueueWorkspaceIntent(
  queue: readonly WorkspaceIntent[],
  intent: WorkspaceIntent
): WorkspaceIntent[] {
  return [...queue, intent];
}

export function consumeWorkspaceIntent(
  queue: readonly WorkspaceIntent[],
  intentId: string
): WorkspaceIntent[] {
  const index = queue.findIndex((intent) => intent.id === intentId);
  if (index === -1) return [...queue];
  return [...queue.slice(0, index), ...queue.slice(index + 1)];
}

/**
 * Drops intents whose target workspace is being abandoned. Shell intents have
 * no target view and are always retained.
 */
export function pruneIntentsForActivity(
  queue: readonly WorkspaceIntent[],
  activity: WorkspaceActivityId
): WorkspaceIntent[] {
  return queue.filter(
    (intent) => intent.targetActivity === null || intent.targetActivity === activity
  );
}

export function intentTargetActivity(
  intent: { type: WorkspaceIntentPayload["type"] },
  activeActivity: WorkspaceActivityId
): WorkspaceActivityId | null {
  switch (intent.type) {
    case "import-attachment":
      // Importing from the Reader stays in the Reader; elsewhere the desk
      // imports and (by preference) opens the document.
      return activeActivity === "reader" ? "reader" : "knowledge-desk";
    case "new-record":
    case "search-records":
      return "knowledge-desk";
    case "reader-mode":
      return "reader";
    case "save-active":
      return activeActivity === "knowledge-desk" || activeActivity === "reader"
        ? activeActivity
        : null;
    case "export-backup":
    case "restore-backup":
      return null;
  }
}

export function isKnowledgeDeskIntent(intent: WorkspaceIntent): intent is KnowledgeDeskIntent {
  return KNOWLEDGE_DESK_INTENT_TYPES.has(intent.type);
}

export function isResearchReaderIntent(intent: WorkspaceIntent): intent is ResearchReaderIntent {
  return RESEARCH_READER_INTENT_TYPES.has(intent.type);
}

export function isShellIntent(intent: WorkspaceIntent): intent is ShellIntent {
  return SHELL_INTENT_TYPES.has(intent.type);
}

export function isTargetedKnowledgeDeskIntent(intent: WorkspaceIntent): intent is KnowledgeDeskIntent {
  return intent.targetActivity === "knowledge-desk" && isKnowledgeDeskIntent(intent);
}

export function isTargetedResearchReaderIntent(intent: WorkspaceIntent): intent is ResearchReaderIntent {
  return intent.targetActivity === "reader" && isResearchReaderIntent(intent);
}
