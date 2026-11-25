import { FC, ReactNode } from "react";
import { Command, LogOut, PanelLeft } from "lucide-react";
import { useFocusSpace } from "./FocusSpaceContext";

interface FocusSpaceViewProps {
  onOpenCommands: () => void;
  onToggleRail: () => void;
  isRailOpen: boolean;
  children: ReactNode;
}

export const FocusSpaceView: FC<FocusSpaceViewProps> = ({
  onOpenCommands,
  onToggleRail,
  isRailOpen,
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
            onClick={onToggleRail}
            title={`${isRailOpen ? "Hide" : "Show"} curved sidebar (Ctrl+B)`}
            aria-label={`${isRailOpen ? "Hide" : "Show"} curved sidebar (Ctrl+B)`}
            aria-pressed={isRailOpen}
            data-dismiss-ignore
          >
            <PanelLeft size={14} aria-hidden="true" />
          </button>
          <button
            className="focus-exit-btn"
            onClick={onOpenCommands}
            title="Open Command Palette (Ctrl+K)"
            aria-label="Open Command Palette (Ctrl+K)"
            data-dismiss-ignore
          >
            <Command size={14} aria-hidden="true" />
          </button>
          <button
            className="focus-exit-btn"
            onClick={() => exitFocusSpace()}
            title="Exit Focus Space (F11 or Esc)"
            aria-label="Exit Focus Space (F11 or Esc)"
            data-dismiss-ignore
          >
            <LogOut size={14} aria-hidden="true" />
          </button>
        </div>
      )}

      {children}
    </div>
  );
};
