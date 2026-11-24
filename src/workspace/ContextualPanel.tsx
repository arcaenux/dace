import { FC, ReactNode, RefObject, useRef } from "react";
import { X } from "lucide-react";
import { useDismissable } from "../core/useDismissable";

interface ContextualPanelProps {
  isOpen: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  triggerRef?: RefObject<HTMLElement | null>;
}

export const ContextualPanel: FC<ContextualPanelProps> = ({
  isOpen,
  title,
  onClose,
  children,
  triggerRef,
}) => {
  const panelRef = useRef<HTMLElement>(null);
  useDismissable(isOpen, onClose, panelRef, {
    triggerRef,
    group: "workspace-overlay",
  });

  return (
    <aside
      ref={panelRef}
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
          tabIndex={isOpen ? 0 : -1}
        >
          <X size={15} strokeWidth={1.6} aria-hidden="true" />
        </button>
      </div>
      <div className="panel-content">{children}</div>
    </aside>
  );
};
