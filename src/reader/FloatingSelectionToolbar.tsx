import { FC, useRef } from "react";
import { BookOpen, Link2, PenLine, Quote } from "lucide-react";
import { HighlightType } from "./types.ts";
import { useDismissable } from "../core/useDismissable";

interface FloatingSelectionToolbarProps {
  position: { top: number; left: number };
  onHighlight: (type: HighlightType) => void;
  onAddNote: () => void;
  onAddToNotes: () => void;
  onExcerpt: () => void;
  onConnectExcerpt: () => void;
  onClose: () => void;
  preferredType?: HighlightType | null;
}

export const FloatingSelectionToolbar: FC<FloatingSelectionToolbarProps> = ({
  position,
  onHighlight,
  onAddNote,
  onAddToNotes,
  onExcerpt,
  onConnectExcerpt,
  onClose,
  preferredType = null,
}) => {
  const toolbarRef = useRef<HTMLDivElement>(null);
  useDismissable(true, onClose, toolbarRef, {
    group: "reader-popover",
    closeOnOutsideClick: true,
    restoreFocus: false,
    outsideClickGraceMs: 180,
  });

  const maxLeft = typeof window !== "undefined" ? Math.max(10, window.innerWidth - 460) : position.left;
  const clampedLeft = Math.max(10, Math.min(position.left, maxLeft));

  return (
    <div
      ref={toolbarRef}
      className="floating-selection-toolbar"
      style={{
        top: `${Math.max(10, position.top - 46)}px`,
        left: `${clampedLeft}px`,
      }}
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <button
        className={`toolbar-hl-btn ${preferredType === "important" ? "active" : ""}`}
        onClick={() => onHighlight("important")}
        title="Highlight: Important passage"
      >
        <span className="hl-dot important" />
        <span>Important</span>
      </button>
      <button
        className={`toolbar-hl-btn ${preferredType === "question" ? "active" : ""}`}
        onClick={() => onHighlight("question")}
        title="Highlight: Question / open problem"
      >
        <span className="hl-dot question" />
        <span>Question</span>
      </button>
      <button
        className={`toolbar-hl-btn ${preferredType === "insight" ? "active" : ""}`}
        onClick={() => onHighlight("insight")}
        title="Highlight: Core insight"
      >
        <span className="hl-dot insight" />
        <span>Insight</span>
      </button>
      <button
        className={`toolbar-hl-btn ${preferredType === "definition" ? "active" : ""}`}
        onClick={() => onHighlight("definition")}
        title="Highlight: Term / definition"
      >
        <span className="hl-dot definition" />
        <span>Definition</span>
      </button>

      <div className="toolbar-divider" />

      <button className="reader-selection-action" onClick={onAddToNotes} title="Add exact passage to notes">
        <BookOpen size={13} />
        <span>Add to notes</span>
      </button>
      <button className="reader-selection-action" onClick={onExcerpt} title="Create a source excerpt without changing the note">
        <Quote size={13} />
        <span>Excerpt</span>
      </button>
      <button className="reader-selection-action" onClick={onAddNote} title="Attach an annotation to this passage">
        <PenLine size={13} />
        <span>Annotate</span>
      </button>
      <button
        className="reader-selection-action"
        onClick={onConnectExcerpt}
        title="Capture quotation / connect to Knowledge Desk"
      >
        <Link2 size={13} />
        <span>Connect</span>
      </button>
    </div>
  );
};
