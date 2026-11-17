import { FC } from "react";
import { BookOpen, FileText, Home, Network, PanelRight } from "lucide-react";
import { WorkspaceActivityId } from "../core/types";

interface WorkspaceRailProps {
  activeActivity: WorkspaceActivityId;
  isFocusSpace: boolean;
  onSelectActivity: (id: WorkspaceActivityId) => void;
  onTogglePanel: () => void;
  isPanelOpen: boolean;
}

const navItems: {
  id: WorkspaceActivityId;
  label: string;
  code: string;
  icon: typeof Home;
}[] = [
  { id: "workspace", label: "Workspace", code: "WS", icon: Home },
  { id: "knowledge-desk", label: "Knowledge Desk", code: "KD", icon: BookOpen },
  { id: "reader", label: "Reader", code: "RD", icon: FileText },
  { id: "knowledge-graph", label: "Graph", code: "KG", icon: Network },
];

export const WorkspaceRail: FC<WorkspaceRailProps> = ({
  activeActivity,
  isFocusSpace,
  onSelectActivity,
  onTogglePanel,
  isPanelOpen,
}) => {
  if (isFocusSpace) return null;

  return (
    <aside className="workspace-rail" aria-label="Primary navigation">
      <div className="rail-brand">
        <div className="rail-brand-mark" aria-hidden="true" />
        <div className="rail-brand-text">
          <span className="rail-brand-name">DACE</span>
          <span className="rail-brand-tag">DISCOVERY</span>
        </div>
      </div>

      <div className="rail-divider" aria-hidden="true" />

      <nav className="rail-nav">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              className={`rail-nav-item ${activeActivity === item.id ? "active" : ""}`}
              onClick={() => onSelectActivity(item.id)}
              aria-current={activeActivity === item.id ? "page" : undefined}
              title={item.label}
            >
              <span className="rail-nav-icon"><Icon size={17} strokeWidth={1.6} aria-hidden="true" /></span>
              <span className="rail-nav-label">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="rail-spacer" />

      <button
        type="button"
        className={`rail-details-btn ${isPanelOpen ? "active" : ""}`}
        onClick={onTogglePanel}
        aria-label="Toggle context panel"
      >
        <span className="rail-nav-icon"><PanelRight size={17} strokeWidth={1.6} aria-hidden="true" /></span>
        <span className="rail-nav-label">Details</span>
      </button>
    </aside>
  );
};
