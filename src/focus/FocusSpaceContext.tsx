import { createContext, useContext, useState, useEffect, useCallback, FC, ReactNode } from "react";
import { setNativeFullscreen, isNativeFullscreen } from "./tauriWindow";

interface FocusSpaceContextType {
  isFocusSpace: boolean;
  enterFocusSpace: () => Promise<void>;
  exitFocusSpace: () => Promise<void>;
  toggleFocusSpace: () => Promise<void>;
  fullscreenError: string | null;
  clearFullscreenError: () => void;
}

const FocusSpaceContext = createContext<FocusSpaceContextType | null>(null);

export const FocusSpaceProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [isFocusSpace, setIsFocusSpace] = useState<boolean>(false);
  const [fullscreenError, setFullscreenError] = useState<string | null>(null);

  const enterFocusSpace = useCallback(async () => {
    try {
      setFullscreenError(null);
      setIsFocusSpace(true);
      await setNativeFullscreen(true);
    } catch (err) {
      console.error("[FocusSpace] Failed to enter fullscreen:", err);
      setFullscreenError(err instanceof Error ? err.message : "Failed to enter OS fullscreen mode");
      // Keep internal Focus Space active in UI even if native OS fullscreen encountered an error
    }
  }, []);

  const exitFocusSpace = useCallback(async () => {
    try {
      setFullscreenError(null);
      setIsFocusSpace(false);
      await setNativeFullscreen(false);
    } catch (err) {
      console.error("[FocusSpace] Failed to exit fullscreen:", err);
    }
  }, []);

  const toggleFocusSpace = useCallback(async () => {
    if (isFocusSpace) {
      await exitFocusSpace();
    } else {
      await enterFocusSpace();
    }
  }, [isFocusSpace, enterFocusSpace, exitFocusSpace]);

  const clearFullscreenError = useCallback(() => {
    setFullscreenError(null);
  }, []);

  // Sync state if OS triggers fullscreen change (e.g. user pressed OS shortcut or browser fullscreen event)
  useEffect(() => {
    const handleFullscreenChange = async () => {
      const active = await isNativeFullscreen();
      // If OS exited fullscreen but internal state is still true, harmonize
      if (!active && isFocusSpace) {
        setIsFocusSpace(false);
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, [isFocusSpace]);

  return (
    <FocusSpaceContext.Provider
      value={{
        isFocusSpace,
        enterFocusSpace,
        exitFocusSpace,
        toggleFocusSpace,
        fullscreenError,
        clearFullscreenError,
      }}
    >
      {children}
    </FocusSpaceContext.Provider>
  );
};

export function useFocusSpace(): FocusSpaceContextType {
  const context = useContext(FocusSpaceContext);
  if (!context) {
    throw new Error("useFocusSpace must be used within a FocusSpaceProvider");
  }
  return context;
}
