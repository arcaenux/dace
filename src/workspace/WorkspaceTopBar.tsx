import { FC, RefObject } from "react";
import { Command, Keyboard, PanelLeft, Search } from "lucide-react";
import logoUrl from "../assets/brand/logo.png";
import { WorkspaceActivityId } from "../core/types.ts";

interface WorkspaceTopBarProps {
  activeActivity: WorkspaceActivityId;
  isFocusSpace: boolean;
  hidden?: boolean;
  onOpenCommands: () => void;
  onOpenShortcuts: () => void;
  onSearch: () => void;
  onToggleNav?: () => void;
  isNavCollapsed?: boolean;
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
  onToggleNav,
  isNavCollapsed = false,
  commandsTriggerRef,
  shortcutsTriggerRef,
}) => {
  if (isFocusSpace || hidden) return null;

  return (
    <div className="workspace-topbar" role="banner" data-tauri-drag-region>
      <div className="topbar-left" data-tauri-drag-region>
        <button
          type="button"
          className={`topbar-nav-toggle ${isNavCollapsed ? "is-collapsed" : ""}`}
          onClick={onToggleNav}
          aria-label={isNavCollapsed ? "Expand navigation (Ctrl+B)" : "Collapse navigation (Ctrl+B)"}
          title="Toggle navigation (Ctrl+B)"
          data-dismiss-ignore
        >
          <PanelLeft size={16} strokeWidth={1.6} aria-hidden="true" />
        </button>

        <div className="topbar-brand" data-tauri-drag-region>
          <div className="topbar-brand-line" data-tauri-drag-region>
            <img src={logoUrl} alt="" className="topbar-brand-logo" width={18} height={18} aria-hidden="true" />
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

      <div className="topbar-meta">
        <button
          type="button"
          className="topbar-icon-btn topbar-icon-btn-quiet"
          onClick={onSearch}
          aria-label="Search records"
          title="Search records (Ctrl+Shift+F)"
          data-dismiss-ignore
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
        >
          <Keyboard size={14} strokeWidth={1.6} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};
