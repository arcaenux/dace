import { useCallback, useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useSettings } from "../settings/SettingsContext";
import { terminalFontStack } from "../settings/fonts";
import {
  base64ToBytes,
  closeTerminalSession,
  getTerminalEnvironment,
  interruptTerminalSession,
  listenTerminalExit,
  listenTerminalOutput,
  listTerminalSessions,
  resizeTerminalSession,
  spawnTerminalSession,
  writeTerminalSession,
  type TerminalEnvironment,
  type TerminalSessionInfo,
} from "./terminalApi";

interface SessionView extends TerminalSessionInfo {
  ended: boolean;
  exitMessage?: string;
}

interface TerminalViewProps {
  onNotice?: (message: string) => void;
}

function errorMessage(error: unknown): string {
  return typeof error === "string"
    ? error
    : error instanceof Error
      ? error.message
      : "Terminal operation failed.";
}

export function TerminalView({ onNotice }: TerminalViewProps) {
  const { settings } = useSettings();
  const [environment, setEnvironment] = useState<TerminalEnvironment | null>(null);
  const [sessions, setSessions] = useState<SessionView[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResult, setSearchResult] = useState<string | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [shellChoice, setShellChoice] = useState("");

  const terminalsRef = useRef(new Map<string, Terminal>());
  const fitsRef = useRef(new Map<string, FitAddon>());
  const containersRef = useRef(new Map<string, HTMLDivElement>());
  const pendingRef = useRef(new Map<string, Uint8Array[]>());
  const activeIdRef = useRef<string | null>(null);
  const environmentRef = useRef<TerminalEnvironment | null>(null);
  const endedIdsRef = useRef<Set<string>>(new Set());
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    endedIdsRef.current = new Set(sessions.filter((s) => s.ended).map((s) => s.sessionId));
  }, [sessions]);

  useEffect(() => {
    const family = terminalFontStack(settings.appearance.appFont);
    for (const [sessionId, terminal] of terminalsRef.current) {
      terminal.options.fontFamily = family;
      try {
        fitsRef.current.get(sessionId)?.fit();
      } catch {
        // Hidden terminals are fitted again when their container becomes visible.
      }
    }
  }, [settings.appearance.appFont]);

  const report = useCallback(
    (message: string) => {
      setError(message);
      onNotice?.(message);
    },
    [onNotice]
  );

  const createTerminal = useCallback(
    (sessionId: string) => {
      if (terminalsRef.current.has(sessionId)) return;
      const terminal = new Terminal({
        allowTransparency: false,
        convertEol: false,
        cursorBlink: true,
        cursorStyle: "bar",
        fontFamily: terminalFontStack(settings.appearance.appFont),
        fontSize: 13,
        lineHeight: 1.35,
        scrollback: 5000,
        theme: {
          background: "#0B0F17",
          foreground: "#E2E8F2",
          cursor: "#5AA6FF",
          cursorAccent: "#0B0F17",
          selectionBackground: "rgba(25, 123, 250, 0.24)",
          black: "#0B0F17",
          red: "#FF6B6B",
          green: "#4ADE80",
          yellow: "#FBBF24",
          blue: "#5AA6FF",
          magenta: "#A78BFA",
          cyan: "#5CE1E6",
          white: "#E2E8F2",
          brightBlack: "#64748B",
          brightRed: "#FF8787",
          brightGreen: "#86EFAC",
          brightYellow: "#FDE68A",
          brightBlue: "#93C5FD",
          brightMagenta: "#C4B5FD",
          brightCyan: "#A5F3FC",
          brightWhite: "#FFFFFF",
        },
      });
      const fit = new FitAddon();
      terminal.loadAddon(fit);

      const container = containersRef.current.get(sessionId);
      if (container) {
        terminal.open(container);
        requestAnimationFrame(() => {
          try {
            fit.fit();
          } catch {
            // The container may still be hidden during workspace transitions.
          }
        });
      }

      terminal.onData((data) => {
        if (endedIdsRef.current.has(sessionId)) return;
        void writeTerminalSession(sessionId, data).catch((err) => report(errorMessage(err)));
      });
      terminal.onResize(({ cols, rows }) => {
        setSessions((current) =>
          current.map((s) => (s.sessionId === sessionId ? { ...s, cols, rows } : s))
        );
        void resizeTerminalSession(sessionId, cols, rows).catch(() => {
          // Exit events race with resize; the session state is authoritative.
        });
      });

      terminalsRef.current.set(sessionId, terminal);
      fitsRef.current.set(sessionId, fit);

      const pending = pendingRef.current.get(sessionId) ?? [];
      for (const bytes of pending) terminal.write(bytes);
      pendingRef.current.delete(sessionId);
    },
    [report, settings.appearance.appFont]
  );

  const attachContainer = useCallback(
    (sessionId: string, node: HTMLDivElement | null) => {
      if (node) {
        containersRef.current.set(sessionId, node);
        createTerminal(sessionId);
      } else {
        containersRef.current.delete(sessionId);
      }
    },
    [createTerminal]
  );

  const addSession = useCallback((info: TerminalSessionInfo) => {
    setSessions((current) => [
      ...current.filter((session) => session.sessionId !== info.sessionId),
      { ...info, ended: false },
    ]);
    setActiveId(info.sessionId);
  }, []);

  const spawnSession = useCallback(
    async (shellId?: string) => {
      setBusy(true);
      try {
        const environment = environmentRef.current ?? (await getTerminalEnvironment());
        environmentRef.current = environment;
        setEnvironment(environment);
        setShellChoice((current) =>
          current && environment.shells.some((shell) => shell.id === current)
            ? current
            : environment.defaultShellId
        );
        if (environment.shells.length === 0) {
          throw new Error("No local shell could be discovered on this system.");
        }
        const activeTerminal = activeIdRef.current
          ? terminalsRef.current.get(activeIdRef.current)
          : undefined;
        const info = await spawnTerminalSession({
          shellId: shellId ?? environment.defaultShellId,
          cols: activeTerminal?.cols ?? 80,
          rows: activeTerminal?.rows ?? 24,
        });
        addSession(info);
        setError(null);
      } catch (err) {
        report(errorMessage(err));
      } finally {
        setBusy(false);
      }
    },
    [addSession, report]
  );

  const closeSession = useCallback(
    async (sessionId: string) => {
      try {
        await closeTerminalSession(sessionId);
      } catch {
        // A session that already exited is safe to remove locally.
      }
      terminalsRef.current.get(sessionId)?.dispose();
      terminalsRef.current.delete(sessionId);
      fitsRef.current.delete(sessionId);
      containersRef.current.delete(sessionId);
      pendingRef.current.delete(sessionId);
      setSessions((current) => {
        const remaining = current.filter((session) => session.sessionId !== sessionId);
        setActiveId((active) => (active === sessionId ? (remaining[0]?.sessionId ?? null) : active));
        return remaining;
      });
    },
    []
  );

  useEffect(() => {
    let cancelled = false;
    const unlisteners: Array<() => void> = [];

    void (async () => {
      const [outputListener, exitListener] = await Promise.all([
        listenTerminalOutput((payload) => {
          const bytes = base64ToBytes(payload.chunk);
          const terminal = terminalsRef.current.get(payload.sessionId);
          if (terminal) {
            terminal.write(bytes);
            return;
          }
          const queue = pendingRef.current.get(payload.sessionId) ?? [];
          queue.push(bytes);
          if (queue.length > 256) queue.shift();
          pendingRef.current.set(payload.sessionId, queue);
        }),
        listenTerminalExit((payload) => {
          const terminal = terminalsRef.current.get(payload.sessionId);
          terminal?.write(`\r\n\x1b[38;5;208m[${payload.message}]\x1b[0m\r\n`);
          setSessions((current) =>
            current.map((session) =>
              session.sessionId === payload.sessionId
                ? { ...session, ended: true, exitMessage: payload.message }
                : session
            )
          );
        }),
      ]);
      if (cancelled) {
        outputListener();
        exitListener();
        return;
      }
      unlisteners.push(outputListener, exitListener);

      try {
        const [detectedEnvironment, existing] = await Promise.all([
          getTerminalEnvironment(),
          listTerminalSessions(),
        ]);
        if (cancelled) return;
        environmentRef.current = detectedEnvironment;
        setEnvironment(detectedEnvironment);
        setShellChoice((current) =>
          current && detectedEnvironment.shells.some((shell) => shell.id === current)
            ? current
            : detectedEnvironment.defaultShellId
        );
        if (existing.length > 0) {
          setSessions(existing.map((session) => ({ ...session, ended: false })));
          setActiveId(existing[0].sessionId);
        } else {
          const info = await spawnTerminalSession({
            shellId: detectedEnvironment.defaultShellId,
            cols: 80,
            rows: 24,
          });
          if (!cancelled) {
            addSession(info);
          } else {
            await closeTerminalSession(info.sessionId);
          }
        }
        setError(null);
      } catch (err) {
        if (!cancelled) report(errorMessage(err));
      }
    })();

    return () => {
      cancelled = true;
      unlisteners.forEach((unlisten) => unlisten());
      terminalsRef.current.forEach((terminal) => terminal.dispose());
      terminalsRef.current.clear();
      fitsRef.current.clear();
      containersRef.current.clear();
      pendingRef.current.clear();
    };
  }, [addSession, report]);

  useEffect(() => {
    activeIdRef.current = activeId;
    if (!activeId) return;
    const terminal = terminalsRef.current.get(activeId);
    const fit = fitsRef.current.get(activeId);
    const container = containersRef.current.get(activeId);
    if (!terminal || !fit || !container) return;

    const fitNow = () => {
      try {
        fit.fit();
      } catch {
        // Ignore transient zero-size measurements.
      }
    };
    fitNow();
    const frame = requestAnimationFrame(() => {
      fitNow();
      terminal.focus();
    });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fitNow);
    observer?.observe(container);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [activeId, sessions.length]);

  useEffect(() => {
    const handleKeys = (event: KeyboardEvent) => {
      const sessionId = activeIdRef.current;
      if (!sessionId || !event.ctrlKey || !event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA") &&
        !target.classList.contains("xterm-helper-textarea")
      ) {
        return;
      }
      const terminal = terminalsRef.current.get(sessionId);
      if (!terminal) return;
      const key = event.key.toLowerCase();
      if (key === "c") {
        const selection = terminal.getSelection();
        if (!selection) return;
        event.preventDefault();
        void navigator.clipboard?.writeText(selection);
      } else if (key === "v") {
        if (endedIdsRef.current.has(sessionId)) return;
        event.preventDefault();
        void navigator.clipboard
          ?.readText()
          .then((text) => (text ? writeTerminalSession(sessionId, text) : undefined))
          .catch(() => undefined);
      }
    };
    window.addEventListener("keydown", handleKeys);
    return () => window.removeEventListener("keydown", handleKeys);
  }, []);

  const activeSession = sessions.find((session) => session.sessionId === activeId) ?? null;

  const focusActiveTerminal = useCallback(() => {
    const sessionId = activeIdRef.current;
    if (!sessionId) return;
    const terminal = terminalsRef.current.get(sessionId);
    if (!terminal) return;
    terminal.focus();
  }, []);

  const handleSearch = () => {
    const terminal = activeId ? terminalsRef.current.get(activeId) : undefined;
    const query = searchQuery.trim().toLowerCase();
    if (!terminal || !query) return;
    const buffer = terminal.buffer.active;
    for (let line = buffer.length - 1; line >= 0; line -= 1) {
      const text = buffer.getLine(line)?.translateToString(true) ?? "";
      if (text.toLowerCase().includes(query)) {
        terminal.scrollToLine(line);
        setSearchResult(`Match at line ${line + 1}`);
        return;
      }
    }
    setSearchResult("No match in scrollback");
  };

  return (
    <div className="terminal-view">
      <header className="terminal-header">
        <div className="terminal-tabs" role="tablist" aria-label="Terminal sessions">
          {sessions.map((session, index) => (
            <button
              key={session.sessionId}
              type="button"
              role="tab"
              aria-selected={session.sessionId === activeId}
              className={`terminal-tab ${session.sessionId === activeId ? "is-active" : ""} ${
                session.ended ? "is-ended" : ""
              }`}
              onClick={() => setActiveId(session.sessionId)}
            >
              <span>{session.shellLabel}</span>
              <small>{session.ended ? "exited" : `session ${index + 1}`}</small>
            </button>
          ))}
        </div>
        <div className="terminal-actions">
          <select
            aria-label="Shell for new session"
            value={shellChoice}
            onChange={(event) => setShellChoice(event.target.value)}
            disabled={busy || !environment}
          >
            {environment?.shells.map((shell) => (
              <option key={shell.id} value={shell.id}>
                {shell.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void spawnSession(shellChoice || environment?.defaultShellId)}
            disabled={busy || !environment}
          >
            New session
          </button>
          <button
            type="button"
            onClick={() => activeId && void interruptTerminalSession(activeId).catch((err) => report(errorMessage(err)))}
            disabled={!activeSession || activeSession.ended}
          >
            Interrupt
          </button>
          <button
            type="button"
            onClick={() => terminalsRef.current.get(activeId ?? "")?.clear()}
            disabled={!activeSession}
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => activeId && void closeSession(activeId)}
            disabled={!activeSession}
          >
            Close
          </button>
        </div>
      </header>

      <div className="terminal-context">
        <span className="terminal-cwd" title={activeSession?.workingDirectory ?? ""}>
          {activeSession?.workingDirectory ?? "—"}
        </span>
        <span className="terminal-status-pill">
          {activeSession ? (activeSession.ended ? activeSession.exitMessage ?? "exited" : "running") : "idle"}
        </span>
        {isSearchOpen || searchQuery || searchResult ? (
          <div className="terminal-search">
            <input
              ref={searchInputRef}
              type="search"
              value={searchQuery}
              placeholder="Find in scrollback"
              aria-label="Find in terminal scrollback"
              onChange={(event) => {
                setSearchQuery(event.target.value);
                setSearchResult(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") handleSearch();
                if (event.key === "Escape") {
                  setSearchQuery("");
                  setSearchResult(null);
                  setIsSearchOpen(false);
                }
              }}
            />
            <button type="button" onClick={handleSearch} disabled={!activeSession}>
              Find
            </button>
            <button
              type="button"
              onClick={() => {
                setSearchQuery("");
                setSearchResult(null);
                setIsSearchOpen(false);
              }}
              aria-label="Close scrollback search"
              title="Close search"
            >
              ×
            </button>
            {searchResult && <small>{searchResult}</small>}
          </div>
        ) : (
          <button
            type="button"
            className="terminal-search-toggle"
            onClick={() => {
              setIsSearchOpen(true);
              requestAnimationFrame(() => searchInputRef.current?.focus());
            }}
            disabled={!activeSession}
          >
            Find
          </button>
        )}
      </div>

      {error && (
        <div className="terminal-error" role="alert">
          {error}
        </div>
      )}

      <div className="terminal-surfaces">
        {sessions.length === 0 && (
          <div className="terminal-empty">
            <p>No terminal session is running.</p>
            <button
              type="button"
              onClick={() => void spawnSession(shellChoice || environment?.defaultShellId)}
              disabled={busy || !environment}
            >
              Start a local shell
            </button>
          </div>
        )}
        {sessions.map((session) => (
          <div
            key={session.sessionId}
            className={`terminal-surface ${session.sessionId === activeId ? "is-active" : ""}`}
            onMouseDown={() => {
              setActiveId(session.sessionId);
              terminalsRef.current.get(session.sessionId)?.focus();
            }}
          >
            <div
              className="terminal-mount"
              ref={(node) => attachContainer(session.sessionId, node)}
            />
          </div>
        ))}
      </div>

      <footer className="terminal-footer">
        <span className="terminal-footer-hints">Ctrl+Shift+C copy · Ctrl+Shift+V paste · Ctrl+C interrupt</span>
        <button type="button" onClick={focusActiveTerminal} disabled={!activeSession || activeSession.ended}>
          Focus terminal input
        </button>
        <span>{activeSession ? `${activeSession.cols}×${activeSession.rows}` : "—"}</span>
      </footer>
    </div>
  );
}
