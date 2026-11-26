export type WorkspaceActivityId =
  | "workspace"
  | "knowledge-desk"
  | "reader"
  | "knowledge-graph"
  | "terminal"
  | "settings";

export interface WorkspaceActivity {
  id: WorkspaceActivityId;
  label: string;
  description: string;
  implemented: boolean;
  plannedMilestone?: string;
}

export type OverlayType = "command-palette" | "shortcut-reference" | "contextual-panel" | null;

export interface CommandItem {
  id: string;
  name: string;
  description?: string;
  category: "Navigation" | "Focus Space" | "Workspace" | "Appearance" | "System";
  shortcut?: string;
  available: boolean;
  unavailabilityReason?: string;
  execute: () => void | Promise<void>;
}

export interface ShortcutDefinition {
  keyCombo: string;
  description: string;
  context?: string;
  status?: "active" | "reserved" | "contextual";
}
