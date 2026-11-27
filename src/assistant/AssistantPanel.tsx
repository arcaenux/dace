import { FC, KeyboardEvent, PointerEvent as ReactPointerEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ExternalLink, Globe, RotateCw, X } from "lucide-react";
import {
  ASSISTANT_SITES,
  assistantAvailable,
  currentAssistantUrl,
  hideAssistant,
  navigateAssistant,
  normalizeSiteUrl,
  reloadAssistant,
  setAssistantBounds,
  showAssistant,
  type PanelBounds,
} from "./assistantApi.ts";

interface AssistantPanelProps {
  open: boolean;
  /** Hide the native view while something must draw above it (a dialog). */
  suspended: boolean;
  onClose: () => void;
  onShowNotice: (message: string) => void;
}

const SITE_KEY = "dace.assistant.url";
const WIDTH_KEY = "dace.assistant.width";
const MIN_WIDTH = 340;

const readStored = (key: string, fallback: string) => {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};

/**
 * A docked side panel that keeps ChatGPT, Gemini or any site open next to
 * notes and papers, so passages can be copied across. The page itself is a
 * native child webview laid over the panel's body slot.
 */
export const AssistantPanel: FC<AssistantPanelProps> = ({ open, suspended, onClose, onShowNotice }) => {
  const [url, setUrl] = useState<string>(() => readStored(SITE_KEY, ASSISTANT_SITES[0].url));
  const [width, setWidth] = useState<number>(() => {
    const stored = Number.parseInt(readStored(WIDTH_KEY, "440"), 10);
    return Number.isFinite(stored) ? Math.max(MIN_WIDTH, stored) : 440;
  });
  const [customDraft, setCustomDraft] = useState<string | null>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const createdRef = useRef(false);
  const available = assistantAvailable();

  const bounds = useCallback((): PanelBounds | null => {
    const slot = slotRef.current;
    if (!slot) return null;
    const rect = slot.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return null;
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  }, []);

  // The native view draws above the page, so it steps aside whenever any
  // dialog is open anywhere in the app (palette, confirmations, restore…).
  const [dialogOpen, setDialogOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const check = () =>
      setDialogOpen(Boolean(document.querySelector('[aria-modal="true"], .overlay-backdrop')));
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [open]);

  const visible = open && !suspended && !dialogOpen;

  // Show/hide the native view with the panel; it keeps its page while hidden.
  useLayoutEffect(() => {
    if (!available) return;
    if (!visible) {
      void hideAssistant();
      return;
    }
    const frame = requestAnimationFrame(() => {
      const next = bounds();
      if (!next) return;
      showAssistant(url, next)
        .then(() => {
          createdRef.current = true;
        })
        .catch((err) => onShowNotice(String(err?.message ?? err)));
    });
    return () => cancelAnimationFrame(frame);
    // url changes are navigated separately so reopening keeps the conversation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, available, bounds, onShowNotice]);

  // Keep the native view glued to the slot as the window or panel resizes.
  useEffect(() => {
    if (!available || !visible) return;
    const slot = slotRef.current;
    if (!slot) return;
    let frame: number | null = null;
    const sync = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        const next = bounds();
        if (next) void setAssistantBounds(next);
      });
    };
    const observer = new ResizeObserver(sync);
    observer.observe(slot);
    window.addEventListener("resize", sync);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", sync);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [available, visible, bounds, width]);

  useEffect(() => {
    try {
      window.localStorage.setItem(WIDTH_KEY, String(Math.round(width)));
    } catch {
      // Storage unavailable: width just won't persist.
    }
  }, [width]);

  const goTo = async (next: string) => {
    setUrl(next);
    try {
      window.localStorage.setItem(SITE_KEY, next);
    } catch {
      // ignore
    }
    if (!available || !createdRef.current) return;
    try {
      await navigateAssistant(next);
    } catch (err: any) {
      onShowNotice(String(err?.message ?? err));
    }
  };

  const openExternally = async () => {
    const target = (await currentAssistantUrl().catch(() => null)) ?? url;
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(target);
    } catch {
      window.open(target, "_blank", "noopener");
    }
  };

  const submitCustom = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setCustomDraft(null);
      return;
    }
    if (event.key !== "Enter" || customDraft === null) return;
    const next = normalizeSiteUrl(customDraft);
    if (!next) {
      onShowNotice("Enter a web address such as scholar.google.com");
      return;
    }
    setCustomDraft(null);
    void goTo(next);
  };

  // Drag the left edge to resize.
  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const max = Math.max(MIN_WIDTH, window.innerWidth * 0.6);
    const move = (moveEvent: PointerEvent) => {
      setWidth(Math.min(max, Math.max(MIN_WIDTH, startWidth + (startX - moveEvent.clientX))));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("assistant-is-resizing");
    };
    document.body.classList.add("assistant-is-resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  if (!open) return null;

  const activeSite = ASSISTANT_SITES.find((site) => url.startsWith(site.url));

  return (
    <aside className="assistant-panel" style={{ width }} aria-label="Side browser">
      <div
        className="assistant-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize side panel"
        onPointerDown={startResize}
      />
      <header className="assistant-head">
        <div className="assistant-sites" role="tablist" aria-label="Sites">
          {ASSISTANT_SITES.map((site) => (
            <button
              key={site.id}
              type="button"
              role="tab"
              aria-selected={activeSite?.id === site.id}
              className={`assistant-site ${activeSite?.id === site.id ? "is-active" : ""}`}
              onClick={() => void goTo(site.url)}
            >
              {site.label}
            </button>
          ))}
          <button
            type="button"
            role="tab"
            aria-selected={!activeSite}
            className={`assistant-site ${!activeSite ? "is-active" : ""}`}
            onClick={() => setCustomDraft(activeSite ? "" : url)}
            title="Open another site"
          >
            <Globe size={12} strokeWidth={1.8} aria-hidden="true" />
            {activeSite ? "Other" : new URL(url).hostname.replace(/^www\./, "")}
          </button>
        </div>
        <div className="assistant-tools">
          <button type="button" className="assistant-icon" onClick={() => void reloadAssistant()} title="Reload" aria-label="Reload">
            <RotateCw size={13} strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button type="button" className="assistant-icon" onClick={() => void openExternally()} title="Open in your browser" aria-label="Open in your browser">
            <ExternalLink size={13} strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button type="button" className="assistant-icon" onClick={onClose} title="Close side panel (Ctrl+Shift+A)" aria-label="Close side panel">
            <X size={14} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
      </header>
      {customDraft !== null && (
        <div className="assistant-address">
          <input
            autoFocus
            value={customDraft}
            onChange={(event) => setCustomDraft(event.target.value)}
            onKeyDown={submitCustom}
            onBlur={() => setCustomDraft(null)}
            placeholder="Type a web address, e.g. scholar.google.com"
            aria-label="Web address"
          />
        </div>
      )}
      <div ref={slotRef} className="assistant-slot">
        {!available && (
          <div className="assistant-fallback">
            <p>The side browser runs in the desktop app.</p>
            <button type="button" onClick={() => void openExternally()}>
              Open {activeSite?.label ?? "site"} in a new tab
            </button>
          </div>
        )}
      </div>
    </aside>
  );
};
