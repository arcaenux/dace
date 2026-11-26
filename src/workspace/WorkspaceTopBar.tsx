import { FC, RefObject } from "react";
import { Command, Keyboard, Search } from "lucide-react";
import logoUrl from "../assets/brand/logo.png";
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
      <div className="topbar-left" data-tauri-drag-region>
        <div className="topbar-brand">
          <div className="topbar-brand-line">
            <img src={logoUrl} alt="" className="topbar-brand-logo" width={24} height={24} aria-hidden="true" />
            <span className="topbar-brand-name">DACE</span>
            {activeActivity !== "workspace" && (
              <>
                <span className="topbar-breadcrumb-sep" aria-hidden="true">/</span>
                <span className="topbar-workspace-name">{activityNames[activeActivity] || "Workspace"}</span>
              </>
            )}
          </div>
          {activeActivity === "workspace" && (
            <span className="topbar-brand-descriptor">A space for discovery.</span>
          )}
        </div>
      </div>

      <div className="topbar-meta" data-tauri-drag-region="false">
        <button
          type="button"
          className="topbar-icon-btn topbar-icon-btn-quiet"
          onClick={onSearch}
          aria-label="Search records"
          title="Search records (Ctrl+Shift+F)"
          data-dismiss-ignore
          data-tauri-drag-region="false"
        >
          <Search size={14} strokeWidth={1.6} aria-hidden="true" />
        </button>

        <button
          ref={commandsTriggerRef}
          type="button"
          className="topbar-icon-btn topbar-command-pill"
          onClick={onOpenCommands}
          aria-label="Open command palette"
          title="Search and command (Ctrl+K)"
          data-dismiss-ignore
          data-tauri-drag-region="false"
        >
          <Command size={13} strokeWidth={1.6} aria-hidden="true" />
          <span>Commands</span>
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
          data-tauri-drag-region="false"
        >
          <Keyboard size={14} strokeWidth={1.6} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};
