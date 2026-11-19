import { CSSProperties, FC, RefObject, useMemo } from "react";
import { BookOpen, FileText, Home, Network, PanelRight, Settings2 } from "lucide-react";
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
}

interface OrbitNode {
  id: WorkspaceActivityId;
  label: string;
  code: string;
  icon: typeof Home;
  /** Percentage of viewport width/height; sampled from the reference arc. */
  x: number;
  y: number;
}

const navItems: OrbitNode[] = [
  { id: "workspace", label: "Workspace", code: "01", icon: Home, x: 5.4, y: 23 },
  { id: "knowledge-desk", label: "Knowledge Desk", code: "02", icon: BookOpen, x: 7.5, y: 31.6 },
  { id: "reader", label: "Research Reader", code: "03", icon: FileText, x: 8.8, y: 39.8 },
  { id: "knowledge-graph", label: "Knowledge Graph", code: "04", icon: Network, x: 9, y: 48.9 },
];

const DETAILS_NODE = { x: 8.5, y: 57.5 };

export const WorkspaceRail: FC<WorkspaceRailProps> = ({
  activeActivity,
  isFocusSpace,
  onSelectActivity,
  onTogglePanel,
  isPanelOpen,
  panelTriggerRef,
  hidden = false,
  compact = false,
}) => {
  const activeNode = useMemo(
    () => navItems.find((item) => item.id === activeActivity) ?? navItems[0],
    [activeActivity]
  );

  if (isFocusSpace || hidden) return null;

  const haloStyle = {
    "--active-x": `${activeNode.x}vw`,
    "--active-y": `${activeNode.y}vh`,
  } as CSSProperties;

  return (
    <aside className={`workspace-rail ${compact ? "is-compact" : ""}`} aria-label="Primary navigation">
      <div className="rail-brand" aria-label="DACE">
        <span className="rail-brand-mark" aria-hidden="true" />
        <span className="rail-brand-name sr-only">DACE</span>
      </div>

      <div className="rail-active-halo" style={haloStyle} aria-hidden="true" />

      <svg className="rail-orbit" viewBox="0 0 190 941" preserveAspectRatio="none" aria-hidden="true">
        <path d="M 14 92 C 88 122 132 170 132 216 C 130 262 134 284 144 297 C 156 324 160 352 160 375 C 164 414 166 442 164 460 C 162 500 154 524 152 541 C 150 578 158 612 172 646" />
        <path
          className="rail-orbit-guide"
          d="M 8 110 C 78 142 118 188 118 232 C 118 276 124 298 134 313 C 146 340 150 368 150 391 C 154 430 156 458 154 476 C 152 516 144 540 142 557"
        />
        <circle cx="132" cy="216" r="2" />
        <circle cx="144" cy="297" r="2" />
        <circle cx="160" cy="375" r="2" />
        <circle cx="164" cy="460" r="2" />
        <circle cx="152" cy="541" r="2" />
      </svg>

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
              style={
                {
                  "--node-x": item.x,
                  "--node-y": item.y,
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

      <button
        ref={panelTriggerRef}
        type="button"
        className={`rail-details-btn ${isPanelOpen ? "active" : ""}`}
        onClick={onTogglePanel}
        aria-label="Toggle context panel"
        aria-pressed={isPanelOpen}
        data-tooltip="Workspace details"
        data-dismiss-ignore
        style={
          {
            "--node-x": DETAILS_NODE.x,
            "--node-y": DETAILS_NODE.y,
          } as CSSProperties
        }
      >
        <span className="rail-nav-icon">
          <PanelRight size={16} strokeWidth={1.55} aria-hidden="true" />
        </span>
      </button>

      <div className="rail-tail" aria-hidden="true">
        <Settings2 size={13} strokeWidth={1.5} />
      </div>
    </aside>
  );
};
