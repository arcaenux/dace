import { isTauriEnvironment } from "../focus/tauriWindow.ts";

/**
 * Signed self-updates from GitHub Releases.
 *
 * The updater plugin verifies every download against the public key in
 * tauri.conf.json before installing, so a tampered package is rejected.
 * Outside Tauri (browser preview) every call is a no-op.
 */

export interface AvailableUpdate {
  version: string;
  currentVersion: string;
  notes: string | null;
  date: string | null;
}

export interface UpdateProgress {
  downloaded: number;
  total: number | null;
}

type PluginUpdate = Awaited<ReturnType<typeof import("@tauri-apps/plugin-updater").check>>;

let pending: NonNullable<PluginUpdate> | null = null;

export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  if (!isTauriEnvironment()) return null;
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check();
  pending = update ?? null;
  if (!update) return null;
  return {
    version: update.version,
    currentVersion: update.currentVersion,
    notes: update.body ?? null,
    date: update.date ?? null,
  };
}

/** Download, verify and install the update found by the last check, then restart. */
export async function installUpdateAndRestart(onProgress?: (progress: UpdateProgress) => void): Promise<void> {
  if (!pending) throw new Error("No update has been found yet. Check for updates first.");
  let downloaded = 0;
  let total: number | null = null;
  await pending.downloadAndInstall((event) => {
    if (event.event === "Started") {
      total = event.data.contentLength ?? null;
    } else if (event.event === "Progress") {
      downloaded += event.data.chunkLength;
    }
    onProgress?.({ downloaded, total });
  });
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}

/** Turn plugin errors into a sentence a person can act on. */
export function describeUpdateError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err ?? "");
  if (/pubkey|public key|signature/i.test(message)) {
    return "Updates aren't set up for this build yet (no signing key).";
  }
  if (/network|connect|dns|timed? ?out|request/i.test(message)) {
    return "Couldn't reach the update server. Check your connection and try again.";
  }
  if (/404|not found|release/i.test(message)) {
    return "No published release was found yet.";
  }
  return message || "The update check failed.";
}
