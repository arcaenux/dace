import { FC } from "react";
import { Keyboard, Search } from "lucide-react";
import { WorkspaceActivityId } from "../core/types.ts";

interface WorkspaceTopBarProps {
  activeActivity: WorkspaceActivityId;
  isFocusSpace: boolean;
  onOpenCommands: () => void;
  onOpenShortcuts: () => void;
}

const activityNames: Record<WorkspaceActivityId, string> = {
  workspace: "Workspace",
  "knowledge-desk": "Knowledge Desk",
  reader: "Reader",
  "knowledge-graph": "Knowledge Graph",
  terminal: "Terminal",
  settings: "Settings",
};

export const WorkspaceTopBar: FC<WorkspaceTopBarProps> = ({
  activeActivity,
  isFocusSpace,
  onOpenCommands,
  onOpenShortcuts,
}) => {
  if (isFocusSpace) return null;

  return (
    <div className="workspace-topbar" role="search">
      <button
        type="button"
        className="topbar-command-trigger"
        onClick={onOpenCommands}
        aria-label="Open command palette"
        title="Search and command (Ctrl+K)"
      >
        <span className="topbar-command-label"><Search size={15} strokeWidth={1.7} aria-hidden="true" /> SEARCH / COMMAND</span>
        <span className="topbar-command-placeholder">
          Find records, navigate, or run actions…
        </span>
        <kbd className="topbar-kbd">Ctrl+K</kbd>
      </button>

      <div className="topbar-meta">
        <span className="topbar-activity">{activityNames[activeActivity] || "Workspace"}</span>
        <button
          type="button"
          className="topbar-help-btn"
          onClick={onOpenShortcuts}
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts (Ctrl+Shift+P)"
        >
          <Keyboard size={14} strokeWidth={1.7} aria-hidden="true" /> HELP <kbd>Ctrl+Shift+P</kbd>
        </button>
      </div>
    </div>
  );
};
