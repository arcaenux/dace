import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";

/**
 * Checks whether the current runtime environment is running inside Tauri.
 */
export function isTauriEnvironment(): boolean {
  return typeof window !== "undefined" && ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);
}

/**
 * Sets the OS-level native window fullscreen state.
 * Uses Tauri's native window API / Rust command if inside Tauri,
 * with graceful HTML5 fullscreen fallback for web testing,
 * and robust failure handling that never crashes the caller.
 */
export async function setNativeFullscreen(fullscreen: boolean): Promise<boolean> {
  // Strategy 1: Try Tauri Native API if running inside Tauri
  if (isTauriEnvironment()) {
    try {
      // First attempt: invoke the native Rust command registered in lib.rs
      await invoke("set_fullscreen", { fullscreen });
      return true;
    } catch (rustErr) {
      // Second attempt: try Tauri Window API directly
      try {
        const appWindow = getCurrentWindow();
        await appWindow.setFullscreen(fullscreen);
        return true;
      } catch (windowErr) {
        console.warn(
          "[Dace] Native window fullscreen could not be applied via Tauri API:",
          rustErr,
          windowErr
        );
      }
    }
  }

  // Strategy 2: Web / Browser DOM Fullscreen API fallback (for dev preview / web testing)
  if (typeof document !== "undefined") {
    try {
      if (fullscreen) {
        if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen();
          return true;
        }
      } else {
        if (document.fullscreenElement && document.exitFullscreen) {
          await document.exitFullscreen();
          return true;
        }
      }
    } catch (domErr) {
      console.warn("[Dace] DOM requestFullscreen/exitFullscreen failed:", domErr);
    }
  }

  return false;
}

/**
 * Reads the current native window fullscreen state.
 */
export async function isNativeFullscreen(): Promise<boolean> {
  if (isTauriEnvironment()) {
    try {
      return await invoke<boolean>("is_fullscreen");
    } catch {
      try {
        const appWindow = getCurrentWindow();
        return await appWindow.isFullscreen();
      } catch {
        // Fallback to DOM check
      }
    }
  }

  if (typeof document !== "undefined") {
    return Boolean(document.fullscreenElement);
  }

  return false;
}

/**
 * Closes the application window safely.
 */
export async function closeNativeWindow(): Promise<void> {
  if (isTauriEnvironment()) {
    try {
      await invoke("destroy_window");
      return;
    } catch {
      try {
        const appWindow = getCurrentWindow();
        await appWindow.destroy();
        return;
      } catch (err) {
        console.error("[Dace] Failed to destroy window via Tauri API:", err);
      }
    }
  }

  if (typeof window !== "undefined") {
    window.close();
  }
}
