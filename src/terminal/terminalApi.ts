import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { isTauriEnvironment } from "../focus/tauriWindow";

export interface TerminalShell {
  id: string;
  label: string;
  path: string;
  args: string[];
  isDefault: boolean;
}

export interface TerminalEnvironment {
  shells: TerminalShell[];
  defaultShellId: string;
  workingDirectory: string;
  platform: string;
}

export interface TerminalSessionInfo {
  sessionId: string;
  shellId: string;
  shellLabel: string;
  workingDirectory: string;
  cols: number;
  rows: number;
  startedAt: string;
}

export interface TerminalOutputEvent {
  sessionId: string;
  chunk: string;
}

export interface TerminalExitEvent {
  sessionId: string;
  code: number | null;
  signal: string | null;
  message: string;
}

function assertDesktop(): void {
  if (!isTauriEnvironment()) {
    throw new Error("Dace Terminal runs only in the desktop application.");
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export async function getTerminalEnvironment(): Promise<TerminalEnvironment> {
  assertDesktop();
  return invoke<TerminalEnvironment>("get_terminal_environment");
}

export async function listTerminalSessions(): Promise<TerminalSessionInfo[]> {
  assertDesktop();
  return invoke<TerminalSessionInfo[]>("list_terminal_sessions");
}

export async function spawnTerminalSession(options: {
  shellId?: string;
  workingDirectory?: string;
  cols?: number;
  rows?: number;
}): Promise<TerminalSessionInfo> {
  assertDesktop();
  return invoke<TerminalSessionInfo>("spawn_terminal_session", options);
}

export async function writeTerminalSession(
  sessionId: string,
  data: string | Uint8Array
): Promise<void> {
  assertDesktop();
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  if (bytes.length === 0) return;
  await invoke("write_terminal_session", { sessionId, data: bytesToBase64(bytes) });
}

export async function resizeTerminalSession(
  sessionId: string,
  cols: number,
  rows: number
): Promise<void> {
  assertDesktop();
  await invoke("resize_terminal_session", { sessionId, cols, rows });
}

export async function interruptTerminalSession(sessionId: string): Promise<void> {
  assertDesktop();
  await invoke("interrupt_terminal_session", { sessionId });
}

export async function closeTerminalSession(sessionId: string): Promise<void> {
  assertDesktop();
  await invoke("close_terminal_session", { sessionId });
}

export function listenTerminalOutput(
  handler: (event: TerminalOutputEvent) => void
): Promise<UnlistenFn> {
  return listen<TerminalOutputEvent>("dace://terminal-output", (event) => handler(event.payload));
}

export function listenTerminalExit(handler: (event: TerminalExitEvent) => void): Promise<UnlistenFn> {
  return listen<TerminalExitEvent>("dace://terminal-exit", (event) => handler(event.payload));
}

export { base64ToBytes };
