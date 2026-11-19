import { RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  chromeStateForMode,
  clampSplitRatio,
  isReaderMode,
  loadReaderLayout,
  NARROW_READER_WIDTH,
  ReaderChromeState,
  ReaderMode,
  saveReaderLayout,
  splitRatioFromMode,
} from "./readerLayout";

interface AdaptiveReaderLayout {
  containerRef: RefObject<HTMLDivElement | null>;
  mode: ReaderMode;
  ratio: number;
  savedRatio: number;
  width: number;
  isNarrow: boolean;
  chrome: ReaderChromeState;
  setMode: (mode: ReaderMode) => void;
  setRatio: (ratio: number) => void;
  restoreNavigation: () => void;
  toggleHeader: () => void;
}

export function useAdaptiveReaderLayout(
  onChromeChange?: (chrome: ReaderChromeState) => void
): AdaptiveReaderLayout {
  const initial = useRef(loadReaderLayout());
  const [mode, setModeState] = useState<ReaderMode>(initial.current.mode);
  const [savedRatio, setSavedRatio] = useState<number>(initial.current.splitRatio);
  const [navCollapsed, setNavCollapsed] = useState<boolean>(initial.current.navCollapsed);
  const [headerCollapsed, setHeaderCollapsed] = useState<boolean>(initial.current.headerCollapsed);
  const [width, setWidth] = useState<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const saveTimerRef = useRef<number | null>(null);

  const ratio = splitRatioFromMode(mode, savedRatio);
  const chrome = useMemo(
    () => chromeStateForMode(mode, { navCollapsed, headerCollapsed }),
    [mode, navCollapsed, headerCollapsed]
  );
  const isNarrow = width > 0 && width < NARROW_READER_WIDTH;

  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? 0;
      setWidth((current) => (Math.abs(current - next) > 1 ? next : current));
    });
    observer.observe(element);
    setWidth(element.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    onChromeChange?.(chrome);
  }, [chrome, onChromeChange]);

  useEffect(() => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveReaderLayout({ mode, splitRatio: savedRatio, navCollapsed, headerCollapsed });
    }, 260);
    return () => {
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    };
  }, [mode, savedRatio, navCollapsed, headerCollapsed]);

  const setMode = useCallback((next: ReaderMode) => {
    if (!isReaderMode(next)) return;
    setModeState(next);
  }, []);

  const setRatio = useCallback((next: number) => {
    setSavedRatio(clampSplitRatio(next));
  }, []);

  const restoreNavigation = useCallback(() => {
    setNavCollapsed(false);
    setModeState((current) => (current === "reading" ? "research" : current));
  }, []);

  const toggleHeader = useCallback(() => {
    setHeaderCollapsed((current) => !current);
  }, []);

  useEffect(() => {
    const onModeEvent = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (isReaderMode(detail)) setMode(detail);
    };
    window.addEventListener("dace:reader-mode", onModeEvent);

    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      if (event.key === "1") {
        event.preventDefault();
        setMode("reading");
      } else if (event.key === "2") {
        event.preventDefault();
        setMode("research");
      } else if (event.key === "3") {
        event.preventDefault();
        setMode("writing");
      }
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("dace:reader-mode", onModeEvent);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [setMode]);

  return {
    containerRef,
    mode,
    ratio,
    savedRatio,
    width,
    isNarrow,
    chrome,
    setMode,
    setRatio,
    restoreNavigation,
    toggleHeader,
  };
}
