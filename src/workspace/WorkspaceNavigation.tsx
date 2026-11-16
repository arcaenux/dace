import { FC } from "react";
import { WorkspaceActivityId } from "../core/types";

interface WorkspaceNavigationProps {
  activeActivity: WorkspaceActivityId;
  isFocusSpace: boolean;
  onOpenCommands: () => void;
  onOpenShortcuts: () => void;
  onTogglePanel: () => void;
  isPanelOpen: boolean;
}

export const WorkspaceNavigation: FC<WorkspaceNavigationProps> = ({
  activeActivity,
  isFocusSpace,
  onOpenCommands,
  onOpenShortcuts,
  onTogglePanel,
  isPanelOpen,
}) => {
  const activityNames: Record<WorkspaceActivityId, string> = {
    workspace: "Workspace",
    "knowledge-desk": "Knowledge Desk",
    reader: "Reader",
    "knowledge-graph": "Knowledge Graph",
    terminal: "Terminal",
    settings: "Settings",
  };

  return (
    <header className={`workspace-header ${isFocusSpace ? "hidden" : ""}`}>
      <div className="brand-section">
        <div className={`brand-symbol ${isFocusSpace ? "in-focus" : ""}`} />
        <span className="brand-title">Dace</span>
        <span className="activity-badge">{activityNames[activeActivity] || "Workspace"}</span>
      </div>

      <div className="header-actions">
        <button
          className="header-btn"
          onClick={onOpenCommands}
          title="Command Palette (Ctrl+K)"
          aria-label="Command Palette"
        >
          <span>Search</span>
          <kbd>Ctrl+K</kbd>
        </button>

        <button
          className="header-btn"
          onClick={onOpenShortcuts}
          title="Shortcuts & Actions (Ctrl+Shift+P)"
          aria-label="Keyboard Shortcuts"
        >
          <span>Help</span>
          <kbd>Ctrl+Shift+P</kbd>
        </button>

        <button
          className={`header-btn ${isPanelOpen ? "active" : ""}`}
          onClick={onTogglePanel}
          title="Toggle Contextual Details Panel"
          aria-label="Toggle Context Panel"
        >
          <span>Details</span>
        </button>
      </div>
    </header>
  );
};
