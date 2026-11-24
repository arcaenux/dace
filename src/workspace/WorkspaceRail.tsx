import { CSSProperties, FC, RefObject, useMemo } from "react";
import { BookOpen, ChevronLeft, FileText, Home, Network, PanelRight, Settings2, SquareTerminal } from "lucide-react";
import { WorkspaceActivityId } from "../core/types";

interface WorkspaceRailProps {
  activeActivity: WorkspaceActivityId;
  isFocusSpace: boolean;
  onSelectActivity: (id: WorkspaceActivityId) => void;
  onTogglePanel: () => void;
  isPanelOpen: boolean;
  panelTriggerRef?: RefObject<HTMLButtonElement | null>;
  hidden?: boolean;
  compact?: boolean;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

interface OrbitNode {
  id: WorkspaceActivityId;
  label: string;
  code: string;
  icon: typeof Home;
  x: number;
  y: number;
}

/**
 * Geometric orbital navigation along a cubic Bezier curve:
 * P0 = (24, 80), P1 = (118, 200), P2 = (118, 440), P3 = (24, 560)
 * Peak at x = 94.5px, y = 320px.
 */
const navItems: OrbitNode[] = [
  { id: "workspace", label: "Workspace", code: "01", icon: Home, x: 45, y: 112 },
  { id: "knowledge-desk", label: "Knowledge Desk", code: "02", icon: BookOpen, x: 77, y: 190 },
  { id: "reader", label: "Research Reader", code: "03", icon: FileText, x: 93, y: 272 },
  { id: "knowledge-graph", label: "Knowledge Graph", code: "04", icon: Network, x: 93, y: 368 },
  { id: "terminal", label: "Terminal", code: "05", icon: SquareTerminal, x: 77, y: 450 },
  { id: "settings", label: "Settings", code: "06", icon: Settings2, x: 45, y: 528 },
];

export const WorkspaceRail: FC<WorkspaceRailProps> = ({
  activeActivity,
  isFocusSpace,
  onSelectActivity,
  onTogglePanel,
  isPanelOpen,
  panelTriggerRef,
  hidden = false,
  compact = false,
  isCollapsed = false,
  onToggleCollapse,
}) => {
  const activeNode = useMemo(
    () => navItems.find((item) => item.id === activeActivity) ?? navItems[0],
    [activeActivity]
  );

  if (isFocusSpace || hidden) return null;

  const haloStyle = {
    "--active-x": `${activeNode.x}px`,
    "--active-y": `${activeNode.y}px`,
  } as CSSProperties;

  return (
    <aside
      className={`workspace-rail ${isCollapsed ? "is-collapsed" : ""} ${compact ? "is-compact" : ""}`}
      aria-label="Primary navigation"
      aria-hidden={isCollapsed}
    >
      <div className="rail-brand" aria-label="DACE">
        <span className="rail-brand-mark" aria-hidden="true" />
        <span className="rail-brand-name sr-only">DACE</span>
      </div>

      {/* Curved sidebar silhouette and orbital track */}
      <svg className="rail-orbit" width="140" height="100%" aria-hidden="true">
        {/* 1. Curved sidebar surface fill matching the icon arrangement */}
        <path
          className="rail-curved-fill"
          d="M 0 0 L 48 0 C 52 70, 134 170, 134 320 C 134 470, 52 570, 48 640 L 48 3000 L 0 3000 Z"
        />

        {/* 2. Curved right boundary border */}
        <path
          className="rail-curved-border"
          d="M 48 0 C 52 70, 134 170, 134 320 C 134 470, 52 570, 48 640 L 48 3000"
        />

        {/* 3. Orbit dock track along the icon centers */}
        <path
          className="rail-orbit-arc"
          d="M 24 80 C 118 200, 118 440, 24 560"
        />

        {/* 4. Subtle inner guide line */}
        <path
          className="rail-orbit-guide"
          d="M 16 92 C 104 206, 104 434, 16 548"
        />

        {/* 5. Dock station indicators along the curve */}
        {navItems.map((item) => (
          <circle key={item.id} cx={item.x} cy={item.y} r="2.5" className="rail-orbit-dock" />
        ))}
      </svg>

      <div className="rail-active-halo" style={haloStyle} aria-hidden="true" />

      <nav className="rail-nav" aria-label="Workspaces">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeActivity === item.id;
          return (
            <button
              key={item.id}
              type="button"
              className={`rail-nav-item ${isActive ? "active" : ""}`}
              onClick={() => onSelectActivity(item.id)}
              aria-current={isActive ? "page" : undefined}
              aria-label={item.label}
              data-tooltip={item.label}
              tabIndex={isCollapsed ? -1 : 0}
              style={
                {
                  "--node-x": `${item.x}px`,
                  "--node-y": `${item.y}px`,
                } as CSSProperties
              }
            >
              <span className="rail-nav-icon">
                <Icon size={18} strokeWidth={1.55} aria-hidden="true" />
              </span>
              <span className="rail-nav-label">{item.code}</span>
            </button>
          );
        })}
      </nav>

      {/* Footer controls: Workspace details and Collapse rail */}
      <div className="rail-footer">
        <button
          ref={panelTriggerRef}
          type="button"
          className={`rail-details-btn ${isPanelOpen ? "active" : ""}`}
          onClick={onTogglePanel}
          aria-label="Toggle workspace details"
          aria-pressed={isPanelOpen}
          data-tooltip="Workspace details"
          data-dismiss-ignore
          tabIndex={isCollapsed ? -1 : 0}
        >
          <span className="rail-nav-icon">
            <PanelRight size={15} strokeWidth={1.55} aria-hidden="true" />
          </span>
        </button>

        {onToggleCollapse && (
          <button
            type="button"
            className="rail-collapse-btn"
            onClick={onToggleCollapse}
            aria-label="Collapse navigation"
            title="Collapse navigation (Ctrl+B)"
            tabIndex={isCollapsed ? -1 : 0}
          >
            <span className="rail-nav-icon">
              <ChevronLeft size={15} strokeWidth={1.55} aria-hidden="true" />
            </span>
          </button>
        )}
      </div>
    </aside>
  );
};
