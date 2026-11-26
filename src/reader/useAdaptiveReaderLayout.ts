import { RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSettings } from "../settings/SettingsContext";
import type { AppSettings } from "../settings/types";
import {
  chromeStateForMode,
  clampSplitRatio,
  isReaderMode,
  NARROW_READER_WIDTH,
  ReaderChromeState,
  ReaderMode,
  splitRatioFromMode,
} from "./readerLayout";

type WorkspacePatch = Partial<AppSettings["workspace"]>;

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

const SAVE_DELAY = 220;

export function useAdaptiveReaderLayout(
  onChromeChange?: (chrome: ReaderChromeState) => void
): AdaptiveReaderLayout {
  const { settings, update } = useSettings();
  const [width, setWidth] = useState<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const saveTimerRef = useRef<number | null>(null);
  const pendingPatchRef = useRef<WorkspacePatch>({});
  const onChromeChangeRef = useRef(onChromeChange);
  onChromeChangeRef.current = onChromeChange;

  const [optimisticMode, setOptimisticMode] = useState<ReaderMode>(
    () => settings.workspace.readerDefaultMode
  );
  const [optimisticRatio, setOptimisticRatio] = useState<number>(
    () => settings.workspace.readerSplitRatio
  );

  useEffect(() => {
    setOptimisticMode(settings.workspace.readerDefaultMode);
  }, [settings.workspace.readerDefaultMode]);

  useEffect(() => {
    setOptimisticRatio(settings.workspace.readerSplitRatio);
  }, [settings.workspace.readerSplitRatio]);

  const mode = optimisticMode;
  const savedRatio = optimisticRatio;
  const navCollapsed = settings.workspace.readerNavCollapsed;
  const headerCollapsed = settings.workspace.readerHeaderCollapsed;

  const ratio = splitRatioFromMode(mode, savedRatio);
  const chrome = useMemo(
    () => chromeStateForMode(mode, { navCollapsed, headerCollapsed }),
    [mode, navCollapsed, headerCollapsed]
  );
  const isNarrow = width > 0 && width < NARROW_READER_WIDTH;

  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    let frame: number | null = null;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? 0;
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = null;
        setWidth((current) => (Math.abs(current - next) > 2 ? next : current));
      });
    });
    observer.observe(element);
    setWidth(element.getBoundingClientRect().width);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    onChromeChangeRef.current?.(chrome);
  }, [chrome]);

  const flushPending = useCallback(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const patch = pendingPatchRef.current;
    if (Object.keys(patch).length === 0) return;
    pendingPatchRef.current = {};
    void update((current) => ({
      ...current,
      workspace: { ...current.workspace, ...patch },
    }));
  }, [update]);

  const queuePatch = useCallback(
    (patch: WorkspacePatch) => {
      pendingPatchRef.current = { ...pendingPatchRef.current, ...patch };
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null;
        flushPending();
      }, SAVE_DELAY);
    },
    [flushPending]
  );

  useEffect(() => {
    return () => {
      flushPending();
    };
  }, [flushPending]);

  const setMode = useCallback(
    (next: ReaderMode) => {
      if (!isReaderMode(next)) return;
      setOptimisticMode(next);
      queuePatch({ readerDefaultMode: next });
    },
    [queuePatch]
  );

  const setRatio = useCallback(
    (next: number) => {
      const clamped = clampSplitRatio(next);
      setOptimisticRatio(clamped);
      queuePatch({ readerSplitRatio: clamped });
    },
    [queuePatch]
  );

  const restoreNavigation = useCallback(() => {
    queuePatch({ readerNavCollapsed: false });
  }, [queuePatch]);

  const toggleHeader = useCallback(() => {
    queuePatch({ readerHeaderCollapsed: !settings.workspace.readerHeaderCollapsed });
  }, [queuePatch, settings.workspace.readerHeaderCollapsed]);

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
