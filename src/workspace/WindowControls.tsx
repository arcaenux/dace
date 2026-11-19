import { FC, useCallback, useEffect, useState } from "react";
import { Copy, Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauriEnvironment } from "../focus/tauriWindow";

/**
 * Frameless-window chrome. The native title bar is disabled in tauri.conf.json;
 * these controls are painted directly on the Dace canvas. A sibling drag plane
 * keeps the window movable without turning any control into a drag handle.
 */
export const WindowControls: FC = () => {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (!isTauriEnvironment()) return;

    let cancelled = false;
    let unlisten: (() => void) | undefined;
    const appWindow = getCurrentWindow();

    (async () => {
      try {
        const maximized = await appWindow.isMaximized();
        if (!cancelled) setIsMaximized(maximized);
      } catch {
        // Window state is unavailable in a browser preview; leave the default icon.
      }

      try {
        unlisten = await appWindow.onResized(() => {
          void appWindow.isMaximized().then(
            (value) => {
              if (!cancelled) setIsMaximized(value);
            },
            () => undefined
          );
        });
      } catch {
        // Resize tracking is a nicety; the toggle still updates its own state.
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const toggleMaximize = useCallback(async () => {
    if (!isTauriEnvironment()) return;
    try {
      const appWindow = getCurrentWindow();
      await appWindow.toggleMaximize();
      setIsMaximized(await appWindow.isMaximized());
    } catch {
      // Browser preview: no native window to toggle.
    }
  }, []);

  const minimize = useCallback(async () => {
    if (!isTauriEnvironment()) return;
    try {
      await getCurrentWindow().minimize();
    } catch {
      // Browser preview: no native window to minimize.
    }
  }, []);

  const close = useCallback(async () => {
    if (!isTauriEnvironment()) return;
    try {
      // close() keeps Dace's save/close-request lifecycle intact.
      await getCurrentWindow().close();
    } catch {
      // Browser preview: no native window to close.
    }
  }, []);

  return (
    <>
      <div
        className="window-drag-region"
        data-tauri-drag-region
        onDoubleClick={() => void toggleMaximize()}
        aria-hidden="true"
      />

      <div className="window-controls" role="group" aria-label="Window controls">
        <button
          type="button"
          className="window-control"
          onClick={() => void minimize()}
          aria-label="Minimize window"
          title="Minimize"
          data-dismiss-ignore
        >
          <Minus size={15} strokeWidth={1.5} aria-hidden="true" />
        </button>

        <button
          type="button"
          className="window-control"
          onClick={() => void toggleMaximize()}
          aria-label={isMaximized ? "Restore window" : "Maximize window"}
          title={isMaximized ? "Restore" : "Maximize"}
          data-dismiss-ignore
        >
          {isMaximized ? (
            <Copy size={14} strokeWidth={1.5} aria-hidden="true" />
          ) : (
            <Square size={13} strokeWidth={1.5} aria-hidden="true" />
          )}
        </button>

        <button
          type="button"
          className="window-control window-control-close"
          onClick={() => void close()}
          aria-label="Close window"
          title="Close"
          data-dismiss-ignore
        >
          <X size={15} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </div>
    </>
  );
};
