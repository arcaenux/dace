import { invoke } from "@tauri-apps/api/core";
import { isTauriEnvironment } from "../focus/tauriWindow.ts";

export interface PanelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AssistantSite {
  id: string;
  label: string;
  url: string;
}

export const ASSISTANT_SITES: AssistantSite[] = [
  { id: "chatgpt", label: "ChatGPT", url: "https://chatgpt.com/" },
  { id: "gemini", label: "Gemini", url: "https://gemini.google.com/" },
  { id: "claude", label: "Claude", url: "https://claude.ai/" },
  { id: "perplexity", label: "Perplexity", url: "https://www.perplexity.ai/" },
];

/** Turn what someone typed ("scholar.google.com") into a full web address. */
export function normalizeSiteUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.hostname.includes(".") && url.hostname !== "localhost") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export const assistantAvailable = (): boolean => isTauriEnvironment();

export async function showAssistant(url: string, bounds: PanelBounds): Promise<void> {
  if (!isTauriEnvironment()) return;
  await invoke("assistant_show", { url, bounds });
}

export async function navigateAssistant(url: string): Promise<void> {
  if (!isTauriEnvironment()) return;
  await invoke("assistant_navigate", { url });
}

export async function setAssistantBounds(bounds: PanelBounds): Promise<void> {
  if (!isTauriEnvironment()) return;
  await invoke("assistant_set_bounds", { bounds });
}

export async function hideAssistant(): Promise<void> {
  if (!isTauriEnvironment()) return;
  await invoke("assistant_hide");
}

export async function reloadAssistant(): Promise<void> {
  if (!isTauriEnvironment()) return;
  await invoke("assistant_reload");
}

export async function currentAssistantUrl(): Promise<string | null> {
  if (!isTauriEnvironment()) return null;
  return await invoke<string | null>("assistant_current_url");
}
