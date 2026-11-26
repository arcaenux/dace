import { FC, RefObject } from "react";
import { Command, Keyboard, Moon, Search, Sun } from "lucide-react";
import logoDarkUrl from "../assets/brand/logo.png";
import logoLightUrl from "../assets/brand/logo-light.png";
import { WorkspaceActivityId } from "../core/types.ts";
import type { ColorMode } from "../settings/types.ts";

interface WorkspaceTopBarProps {
  activeActivity: WorkspaceActivityId;
  isFocusSpace: boolean;
  hidden?: boolean;
  colorMode: ColorMode;
  onToggleColorMode: () => void;
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
  colorMode,
  onToggleColorMode,
  onOpenCommands,
  onOpenShortcuts,
  onSearch,
  commandsTriggerRef,
  shortcutsTriggerRef,
}) => {
  const logoSrc = colorMode === "light" ? logoLightUrl : logoDarkUrl;

  if (isFocusSpace || hidden) return null;

  return (
    <div className="workspace-topbar" role="banner">
      <div className="topbar-left" data-tauri-drag-region>
        <div className="topbar-brand">
          <div className="topbar-brand-line">
            <img src={logoSrc} alt="" className="topbar-brand-logo" width={24} height={24} aria-hidden="true" />
            <span className="topbar-brand-name">DACE</span>
            {activeActivity !== "workspace" && (
              <>
                <span className="topbar-breadcrumb-sep" aria-hidden="true">/</span>
                <span className="topbar-workspace-name">{activityNames[activeActivity] || "Workspace"}</span>
              </>
            )}
          </div>
          {activeActivity === "workspace" && (
            <span className="topbar-brand-descriptor">Research workspace</span>
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

        <button
          type="button"
          className="topbar-icon-btn topbar-icon-btn-quiet"
          onClick={onToggleColorMode}
          aria-label={colorMode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          title={`Switch to ${colorMode === "dark" ? "Light" : "Dark"} Mode (Ctrl+Shift+L)`}
          data-dismiss-ignore
          data-tauri-drag-region="false"
        >
          {colorMode === "dark" ? (
            <Sun size={14} strokeWidth={1.6} aria-hidden="true" />
          ) : (
            <Moon size={14} strokeWidth={1.6} aria-hidden="true" />
          )}
        </button>
      </div>
    </div>
  );
};
