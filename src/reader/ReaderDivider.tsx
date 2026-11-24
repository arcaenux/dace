import {
  FC,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { clampSplitRatio, offsetSplitRatio } from "./readerLayout";

interface ReaderDividerProps {
  ratio: number;
  containerRef: RefObject<HTMLDivElement | null>;
  onRatioChange: (ratio: number) => void;
  disabled?: boolean;
}

interface DragListeners {
  pointerId: number;
  move: (event: PointerEvent) => void;
  up: (event: PointerEvent) => void;
  cancel: (event: PointerEvent) => void;
}

export const ReaderDivider: FC<ReaderDividerProps> = ({
  ratio,
  containerRef,
  onRatioChange,
  disabled = false,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const draggingRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  const pointerRef = useRef(0);
  const listenersRef = useRef<DragListeners | null>(null);
  const onRatioChangeRef = useRef(onRatioChange);
  onRatioChangeRef.current = onRatioChange;

  const detachListeners = useCallback(() => {
    const listeners = listenersRef.current;
    if (!listeners) return;
    window.removeEventListener("pointermove", listeners.move);
    window.removeEventListener("pointerup", listeners.up);
    window.removeEventListener("pointercancel", listeners.cancel);
    listenersRef.current = null;
  }, []);

  const commit = useCallback(() => {
    frameRef.current = null;
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    if (rect.width <= 0) return;
    onRatioChangeRef.current(clampSplitRatio((pointerRef.current - rect.left) / rect.width));
  }, [containerRef]);

  const stopDragging = useCallback(() => {
    const wasDragging = draggingRef.current;
    draggingRef.current = false;
    setIsDragging(false);
    document.body.classList.remove("reader-is-resizing");
    detachListeners();
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      if (wasDragging) commit();
    }
  }, [commit, detachListeners]);

  useEffect(() => {
    return () => {
      stopDragging();
    };
  }, [stopDragging]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    event.preventDefault();
    detachListeners();
    draggingRef.current = true;
    pointerRef.current = event.clientX;
    setIsDragging(true);
    document.body.classList.add("reader-is-resizing");
    event.currentTarget.setPointerCapture?.(event.pointerId);

    const move = (moveEvent: PointerEvent) => {
      if (!draggingRef.current || moveEvent.pointerId !== event.pointerId) return;
      moveEvent.preventDefault();
      pointerRef.current = moveEvent.clientX;
      if (frameRef.current === null) {
        frameRef.current = requestAnimationFrame(commit);
      }
    };

    const up = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== event.pointerId) return;
      stopDragging();
    };

    listenersRef.current = { pointerId: event.pointerId, move, up, cancel: up };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const containerWidth = containerRef.current?.getBoundingClientRect().width ?? 1200;
    const step = Math.min(80, containerWidth * 0.04);
    let next: number | null = null;
    if (event.key === "ArrowLeft") next = offsetSplitRatio(ratio, -step, containerWidth);
    if (event.key === "ArrowRight") next = offsetSplitRatio(ratio, step, containerWidth);
    if (event.key === "Home") next = 0.32;
    if (event.key === "End") next = 0.76;
    if (next !== null) {
      event.preventDefault();
      onRatioChange(next);
    }
  };

  if (disabled) return null;

  return (
    <div
      className={`reader-divider ${isDragging ? "is-dragging" : ""}`}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize document and writing workspace"
      aria-valuemin={32}
      aria-valuemax={76}
      aria-valuenow={Math.round(ratio * 100)}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
      onDoubleClick={() => onRatioChange(0.6)}
      title="Drag to resize · Arrow keys to nudge · Double-click to reset"
    >
      <span className="reader-divider-handle" aria-hidden="true" />
    </div>
  );
};
