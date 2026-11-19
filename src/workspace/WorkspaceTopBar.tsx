import { FC, RefObject } from "react";
import { Command, Keyboard, Search } from "lucide-react";
import { WorkspaceActivityId } from "../core/types.ts";

interface WorkspaceTopBarProps {
  activeActivity: WorkspaceActivityId;
  isFocusSpace: boolean;
  hidden?: boolean;
  onOpenCommands: () => void;
  onOpenShortcuts: () => void;
  onSearch: () => void;
  commandsTriggerRef?: RefObject<HTMLButtonElement | null>;
  shortcutsTriggerRef?: RefObject<HTMLButtonElement | null>;
}

const activityNames: Record<WorkspaceActivityId, string> = {
  workspace: "Workspace",
  "knowledge-desk": "Knowledge Desk",
  reader: "Research Reader",
  "knowledge-graph": "Knowledge Graph",
  terminal: "Terminal",
  settings: "Settings",
};

export const WorkspaceTopBar: FC<WorkspaceTopBarProps> = ({
  activeActivity,
  isFocusSpace,
  hidden = false,
  onOpenCommands,
  onOpenShortcuts,
  onSearch,
  commandsTriggerRef,
  shortcutsTriggerRef,
}) => {
  if (isFocusSpace || hidden) return null;

  return (
    <div className="workspace-topbar" role="banner">
      <div className="topbar-brand">
        <div className="topbar-brand-line">
          <span className="topbar-brand-name">DACE</span>
          {activeActivity !== "workspace" && (
            <span className="topbar-workspace-name">{activityNames[activeActivity] || "Workspace"}</span>
          )}
        </div>
        <span className="topbar-brand-descriptor">A space for discovery.</span>
        <span className="topbar-brand-divider" aria-hidden="true" />
      </div>

      <div className="topbar-meta">
        <span className="topbar-version">v0.9</span>

        <button
          type="button"
          className="topbar-icon-btn"
          onClick={onSearch}
          aria-label="Search records"
          title="Search records"
          data-dismiss-ignore
        >
          <Search size={14} strokeWidth={1.6} aria-hidden="true" />
        </button>

        <button
          ref={commandsTriggerRef}
          type="button"
          className="topbar-icon-btn"
          onClick={onOpenCommands}
          aria-label="Open command palette"
          title="Search and command (Ctrl+K)"
          data-dismiss-ignore
        >
          <Command size={14} strokeWidth={1.6} aria-hidden="true" />
          <kbd>Ctrl K</kbd>
        </button>
        <button
          ref={shortcutsTriggerRef}
          type="button"
          className="topbar-icon-btn topbar-icon-btn-quiet"
          onClick={onOpenShortcuts}
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts (Ctrl+Shift+P)"
          data-dismiss-ignore
        >
          <Keyboard size={14} strokeWidth={1.6} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};
