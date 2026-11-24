import type { WorkspaceActivityId } from "../core/types";

export const WORKSPACE_ACTIVITIES: readonly WorkspaceActivityId[] = [
  "workspace",
  "knowledge-desk",
  "reader",
  "knowledge-graph",
  "terminal",
  "settings",
] as const;

export function isWorkspaceActivity(value: unknown): value is WorkspaceActivityId {
  return typeof value === "string" && (WORKSPACE_ACTIVITIES as readonly string[]).includes(value);
}

/** Parses a URL hash such as `#reader` into a workspace activity. */
export function activityFromHash(hash: string): WorkspaceActivityId | null {
  if (typeof hash !== "string") return null;
  const value = hash.replace(/^#/, "").split("?")[0];
  return isWorkspaceActivity(value) ? value : null;
}

/** Canonical hash for an activity. */
export function hashForActivity(activity: WorkspaceActivityId): string {
  return `#${activity}`;
}
