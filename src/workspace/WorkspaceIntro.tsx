import { FC } from "react";

interface WorkspaceIntroProps {
  onOpenCommands: () => void;
  onOpenShortcuts: () => void;
  onEnterFocus: () => void;
}

export const WorkspaceIntro: FC<WorkspaceIntroProps> = ({
  onOpenCommands,
  onOpenShortcuts,
  onEnterFocus,
}) => {
  return (
    <div className="intro-container">
      <div className="intro-header">
        <span className="intro-tagline">A space for discovery.</span>
        <h1 className="intro-heading">Welcome to Dace</h1>
        <p className="intro-description">
          A quiet digital environment designed for deep intellectual work — research,
          rigorous thinking, knowledge crystallization, and long-term learning.
        </p>
      </div>

      <div className="intro-guide">
        <div className="guide-row">
          <span className="guide-label">Search commands, activities & navigation</span>
          <div className="guide-keys" onClick={onOpenCommands} style={{ cursor: "pointer" }}>
            <kbd>Ctrl</kbd> + <kbd>K</kbd>
          </div>
        </div>

        <div className="guide-row">
          <span className="guide-label">View keyboard shortcuts & interface actions</span>
          <div className="guide-keys" onClick={onOpenShortcuts} style={{ cursor: "pointer" }}>
            <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>P</kbd>
          </div>
        </div>

        <div className="guide-row">
          <span className="guide-label">Toggle full-screen Focus Space</span>
          <div className="guide-keys" onClick={onEnterFocus} style={{ cursor: "pointer" }}>
            <kbd>F11</kbd>
          </div>
        </div>
      </div>

      <div className="intro-meta">
        <p>
          Controls remain hidden until summoned. Press <kbd style={{ padding: "1px 4px", background: "var(--bg-surface-elevated)", border: "1px solid var(--border-subtle)", borderRadius: "2px" }}>Ctrl+K</kbd> to access planned activities, or press <kbd style={{ padding: "1px 4px", background: "var(--bg-surface-elevated)", border: "1px solid var(--border-subtle)", borderRadius: "2px" }}>F11</kbd> to enter full distraction-free focus.
        </p>
      </div>
    </div>
  );
};
