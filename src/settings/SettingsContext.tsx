import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getAppInfo, getAppSettings, getStorageInfo, resetAppSettings, updateAppSettings } from "./settingsApi";
import { normalizeSettings } from "./settingsSchema";
import type { AppInfo, AppSettings, StorageInfo } from "./types";

export type SettingsUpdater = (current: AppSettings) => AppSettings;

interface SettingsContextValue {
  settings: AppSettings;
  storageInfo: StorageInfo | null;
  appInfo: AppInfo | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  savedAt: string | null;
  update: (updater: SettingsUpdater) => Promise<void>;
  reset: () => Promise<void>;
  refreshInfo: () => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

function errorMessage(error: unknown): string {
  return typeof error === "string"
    ? error
    : error instanceof Error
      ? error.message
      : "Settings operation failed.";
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(() => normalizeSettings(null));
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const settingsRef = useRef(settings);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const refreshInfo = useCallback(async () => {
    try {
      const [storage, info] = await Promise.all([getStorageInfo(), getAppInfo()]);
      setStorageInfo(storage);
      setAppInfo(info);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await getAppSettings();
        if (!cancelled) {
          settingsRef.current = loaded;
          setSettings(loaded);
        }
        await refreshInfo();
      } catch (err) {
        if (!cancelled) setError(errorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshInfo]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.density = settings.appearance.density;
    root.dataset.reducedMotion = String(settings.appearance.reducedMotion);
    root.dataset.sidebarCollapsed = String(settings.appearance.sidebarCollapsed);
    root.style.setProperty("--dace-text-scale", String(settings.appearance.textScale));
  }, [
    settings.appearance.density,
    settings.appearance.reducedMotion,
    settings.appearance.sidebarCollapsed,
    settings.appearance.textScale,
  ]);

  const persist = useCallback(async (next: AppSettings) => {
    setSaving(true);
    try {
      const saved = normalizeSettings(await updateAppSettings(next));
      settingsRef.current = saved;
      setSettings(saved);
      setSavedAt(new Date().toISOString());
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }, []);

  const update = useCallback(
    async (updater: SettingsUpdater) => {
      const next = normalizeSettings(updater(settingsRef.current));
      settingsRef.current = next;
      setSettings(next);
      await persist(next);
    },
    [persist]
  );

  const reset = useCallback(async () => {
    await persist(normalizeSettings(await resetAppSettings()));
    await refreshInfo();
  }, [persist, refreshInfo]);

  const value = useMemo<SettingsContextValue>(
    () => ({
      settings,
      storageInfo,
      appInfo,
      loading,
      saving,
      error,
      savedAt,
      update,
      reset,
      refreshInfo,
    }),
    [settings, storageInfo, appInfo, loading, saving, error, savedAt, update, reset, refreshInfo]
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) throw new Error("useSettings must be used inside SettingsProvider");
  return context;
}
