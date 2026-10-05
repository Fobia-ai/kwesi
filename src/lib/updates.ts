import { useEffect, useState } from "react";
import type { AutoUpdatePreference, UpdateStatus } from "./kwesiBridge";

export type { AutoUpdatePreference, UpdateStatus, UpdateDisabledReason } from "./kwesiBridge";

// Must stay in electron/allowedExternalLinks.ts for openExternal to allow it.
export const KWESI_RELEASES_URL = "https://github.com/Fobia-ai/kwesi/releases";

export interface KwesiUpdatesApi {
  getStatus(): Promise<UpdateStatus>;
  check(): Promise<UpdateStatus>;
  download(): Promise<UpdateStatus>;
  /** Quits, installs and relaunches. False if nothing is downloaded yet. */
  install(): Promise<boolean>;
  /** The on/off switch: saved setting, else KWESI_AUTO_UPDATE, else on. */
  getPreference(): Promise<AutoUpdatePreference>;
  /** Saves the switch (overriding KWESI_AUTO_UPDATE) and applies it now. */
  setEnabled(enabled: boolean): Promise<{ preference: AutoUpdatePreference; status: UpdateStatus }>;
  onStatus(callback: (status: UpdateStatus) => void): () => void;
}

function realUpdatesApi(bridge: NonNullable<Window["kwesi"]>["updates"]): KwesiUpdatesApi {
  return {
    getStatus: () => bridge.getStatus(),
    check: () => bridge.check(),
    download: () => bridge.download(),
    install: () => bridge.install(),
    getPreference: () => bridge.getPreference(),
    setEnabled: (enabled) => bridge.setEnabled(enabled),
    onStatus: (callback) => bridge.onStatus(callback),
  };
}

/**
 * Browser-preview mock. Reports the updater as off (same as a real
 * `electron .` dev run) unless localStorage has `kwesi-mock-update=1`, in
 * which case it walks a fake release through check -> download -> ready so
 * the update UI can be exercised without a packaged build.
 */
function createMockUpdatesApi(): KwesiUpdatesApi {
  let simulate = false;
  try {
    simulate = localStorage.getItem("kwesi-mock-update") === "1";
  } catch {
    // Storage blocked: stay in the "off" mode.
  }
  const listeners = new Set<(status: UpdateStatus) => void>();
  let status: UpdateStatus = simulate ? { state: "idle" } : { state: "disabled", reason: "dev" };
  const set = (next: UpdateStatus) => {
    status = next;
    listeners.forEach((listener) => listener(next));
  };
  let preference: AutoUpdatePreference = { enabled: true, source: "default" };
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const version = "99.0.0";

  return {
    async getStatus() {
      return status;
    },
    async check() {
      if (status.state === "disabled") return status;
      set({ state: "checking" });
      await wait(600);
      set({ state: "available", version });
      return status;
    },
    async download() {
      if (status.state !== "available") return status;
      const total = 120_000_000;
      for (let percent = 0; percent <= 100; percent += 20) {
        set({ state: "downloading", version, percent, transferred: (total * percent) / 100, total, bytesPerSecond: 8_000_000 });
        await wait(300);
      }
      set({ state: "downloaded", version });
      return status;
    },
    async install() {
      return status.state === "downloaded";
    },
    async getPreference() {
      return preference;
    },
    async setEnabled(enabled) {
      preference = { enabled, source: "setting" };
      if (simulate) set(enabled ? { state: "idle" } : { state: "disabled", reason: "setting" });
      return { preference, status };
    },
    onStatus(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
  };
}

export const kwesiUpdates: KwesiUpdatesApi = window.kwesi?.updates
  ? realUpdatesApi(window.kwesi.updates)
  : createMockUpdatesApi();

/** The updater's live status: an initial snapshot, then every pushed change. */
export function useUpdateStatus(): UpdateStatus | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  useEffect(() => {
    // Ignore the snapshot once a pushed status (always newer) has arrived,
    // or after unmount.
    let snapshotStale = false;
    const unsubscribe = kwesiUpdates.onStatus((next) => {
      snapshotStale = true;
      setStatus(next);
    });
    kwesiUpdates.getStatus().then((snapshot) => {
      if (!snapshotStale) setStatus(snapshot);
    });
    return () => {
      snapshotStale = true;
      unsubscribe();
    };
  }, []);
  return status;
}
