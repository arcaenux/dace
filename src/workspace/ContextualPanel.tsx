import { FC, ReactNode } from "react";

interface ContextualPanelProps {
  isOpen: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export const ContextualPanel: FC<ContextualPanelProps> = ({
  isOpen,
  title,
  onClose,
  children,
}) => {
  return (
    <aside
      className={`contextual-panel ${isOpen ? "open" : ""}`}
      aria-hidden={!isOpen}
      aria-label={title}
    >
      <div className="panel-header">
        <h2 className="panel-title">{title}</h2>
        <button
          className="panel-close-btn"
          onClick={onClose}
          aria-label="Close contextual panel"
          title="Dismiss panel (Esc)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
      <div className="panel-content">{children}</div>
    </aside>
  );
};
