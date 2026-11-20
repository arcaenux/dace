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

  // Keep one stable container across focus transitions. Swapping a fragment for
  // a wrapper remounts the active workspace (and therefore the PDF viewer),
  // which loses reader state and forces a fresh document load.
  return (
    <div
      className={isFocusSpace ? "focus-space-container" : "focus-space-shell"}
      style={{ width: "100%", height: "100%", position: "relative" }}
    >
      {isFocusSpace && (
        <div className="focus-ambient-trigger" aria-label="Focus Space Controls">
          <button
            className="focus-exit-btn"
            onClick={onOpenCommands}
            title="Open Command Palette (Ctrl+K)"
            data-dismiss-ignore
          >
            <span>Commands</span>
            <kbd>Ctrl+K</kbd>
          </button>
          <button
            className="focus-exit-btn"
            onClick={() => exitFocusSpace()}
            title="Exit Focus Space (F11 or Esc)"
            data-dismiss-ignore
          >
            <span>Exit Focus</span>
            <kbd>F11</kbd>
          </button>
        </div>
      )}

      {children}
    </div>
  );
};
