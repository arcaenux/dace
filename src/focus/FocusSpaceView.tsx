import { FC, ReactNode } from "react";
import { useFocusSpace } from "./FocusSpaceContext";

interface FocusSpaceViewProps {
  onOpenCommands: () => void;
  children: ReactNode;
}

export const FocusSpaceView: FC<FocusSpaceViewProps> = ({
  onOpenCommands,
  children,
}) => {
  const { isFocusSpace, exitFocusSpace } = useFocusSpace();

  if (!isFocusSpace) {
    return <>{children}</>;
  }

  return (
    <div className="focus-space-container" style={{ width: "100%", height: "100%", position: "relative" }}>
      {/* Subtle ambient controls, unobtrusive until hovered or focused */}
      <div className="focus-ambient-trigger" aria-label="Focus Space Controls">
        <button
          className="focus-exit-btn"
          onClick={onOpenCommands}
          title="Open Command Palette (Ctrl+K)"
        >
          <span>Commands</span>
          <kbd>Ctrl+K</kbd>
        </button>
        <button
          className="focus-exit-btn"
          onClick={() => exitFocusSpace()}
          title="Exit Focus Space (F11 or Esc)"
        >
          <span>Exit Focus</span>
          <kbd>F11</kbd>
        </button>
      </div>

      {/* The active workspace remains front and center */}
      {children}
    </div>
  );
};
