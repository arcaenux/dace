import { FC } from "react";
import { HighlightType } from "./types.ts";

interface FloatingSelectionToolbarProps {
  position: { top: number; left: number };
  onHighlight: (type: HighlightType) => void;
  onAddNote: () => void;
  onConnectExcerpt: () => void;
  onClose: () => void;
}

export const FloatingSelectionToolbar: FC<FloatingSelectionToolbarProps> = ({
  position,
  onHighlight,
  onAddNote,
  onConnectExcerpt,
}) => {
  return (
    <div
      className="floating-selection-toolbar"
      style={{
        top: `${Math.max(10, position.top - 46)}px`,
        left: `${Math.max(10, position.left)}px`,
      }}
      onMouseDown={(e) => {
        // Prevent selection from clearing when clicking toolbar buttons
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <button
        className="toolbar-hl-btn"
        onClick={() => onHighlight("important")}
        title="Highlight: Important passage (Gold)"
      >
        <span className="hl-dot important" />
        <span>Important</span>
      </button>

      <button
        className="toolbar-hl-btn"
        onClick={() => onHighlight("question")}
        title="Highlight: Question / Open problem (Cyan)"
      >
        <span className="hl-dot question" />
        <span>Question</span>
      </button>

      <button
        className="toolbar-hl-btn"
        onClick={() => onHighlight("insight")}
        title="Highlight: Core Insight / Discovery (Emerald)"
      >
        <span className="hl-dot insight" />
        <span>Insight</span>
      </button>

      <button
        className="toolbar-hl-btn"
        onClick={() => onHighlight("definition")}
        title="Highlight: Term / Definition (Amethyst)"
      >
        <span className="hl-dot definition" />
        <span>Definition</span>
      </button>

      <div className="toolbar-divider" />

      <button
        className="toolbar-icon-btn"
        onClick={onAddNote}
        title="Attach personal annotation to this passage"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 20h9"></path>
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
        </svg>
        <span>Note</span>
      </button>

      <button
        className="toolbar-icon-btn"
        onClick={onConnectExcerpt}
        title="Capture quotation / Connect to Knowledge Desk"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
        </svg>
        <span>Connect</span>
      </button>
    </div>
  );
};
