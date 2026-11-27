import { invoke } from "@tauri-apps/api/core";
import { isTauriEnvironment } from "../focus/tauriWindow.ts";

export interface VaultInfo {
  /** The chosen vault folder; null when Dace uses its own data folder. */
  path: string | null;
  documentsDir: string;
  notesDir: string | null;
}

export interface VaultChangeResult {
  documentsCopied: number;
  notesWritten: number;
  previousDocumentsDir: string;
  restartRequired: boolean;
}

export async function getVaultInfo(): Promise<VaultInfo | null> {
  if (!isTauriEnvironment()) return null;
  return await invoke<VaultInfo>("get_vault_info");
}

export async function pickVaultFolder(current?: string | null): Promise<string | null> {
  if (!isTauriEnvironment()) return null;
  return await invoke<string | null>("pick_vault_folder", { current: current ?? null });
}

/** Pass null to go back to Dace's own data folder. */
export async function setVaultLocation(path: string | null): Promise<VaultChangeResult> {
  return await invoke<VaultChangeResult>("set_vault_location", { path });
}

export async function restartApp(): Promise<void> {
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}
