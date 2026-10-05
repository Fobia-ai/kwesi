// Pure pieces of the auto-updater (no `electron` / `electron-updater`
// imports) so they're unit-testable -- see __tests__/updateStatus.test.ts.
// src/lib/kwesiBridge.ts mirrors UpdateStatus for the renderer.

/** Why the updater isn't running at all. */
export type UpdateDisabledReason =
  // `electron .` from source -- no packaged app-update.yml to compare against.
  | "dev"
  // KWESI_MANAGED_PACKAGE=1: a launcher (Fobia) owns install/update.
  | "managed"
  // KWESI_AUTO_UPDATE=false, and the Settings switch has never been used.
  | "env"
  // Turned off with the switch in Settings > About.
  | "setting"
  // Packaged, but not in a form electron-updater can replace in place (e.g.
  // the unpacked linux dir, or anything that isn't an AppImage/deb/nsis/mac zip).
  | "unsupported-install";

export type UpdateStatus =
  | { state: "disabled"; reason: UpdateDisabledReason }
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available"; version: string; releaseDate?: string }
  | { state: "not-available"; checkedAt: number }
  | {
      state: "downloading";
      version: string;
      percent: number;
      transferred: number;
      total: number;
      bytesPerSecond: number;
    }
  | { state: "downloaded"; version: string }
  // `version` is set when the failure was a download, so the UI can offer
  // to retry that download rather than starting over from a check.
  | { state: "error"; message: string; version?: string };

/** Whether auto-update is on, and what decided it. */
export interface AutoUpdatePreference {
  enabled: boolean;
  // "setting": the Settings > About switch (always wins once used);
  // "env": KWESI_AUTO_UPDATE; "default": neither, so on.
  source: "setting" | "env" | "default";
}

/**
 * The switch in Settings overrides the env var -- people who install from
 * the AppImage/dmg/exe have no practical way to set env vars, so the UI has
 * to be able to win. `saved` is the persisted setting ("true"/"false", or
 * null if the switch was never touched); `envRaw` is KWESI_AUTO_UPDATE.
 */
export function resolveAutoUpdatePreference(saved: string | null, envRaw: string | undefined): AutoUpdatePreference {
  if (saved === "true" || saved === "false") return { enabled: saved === "true", source: "setting" };
  if (envRaw != null && envRaw.trim() !== "") return { enabled: parseAutoUpdateFlag(envRaw), source: "env" };
  return { enabled: true, source: "default" };
}

const FALSY = new Set(["0", "false", "no", "off"]);

/**
 * KWESI_AUTO_UPDATE: on unless explicitly set to a falsy value
 * (0/false/no/off, any case). Unset or empty means on.
 */
export function parseAutoUpdateFlag(raw: string | undefined): boolean {
  if (raw == null) return true;
  const value = raw.trim().toLowerCase();
  if (value === "") return true;
  return !FALSY.has(value);
}

/**
 * electron-updater's errors carry the whole HTTP response (headers and
 * all) in `message` -- fine for the crash log, unreadable in a settings
 * panel. Keeps the first line, maps the common offline case to plain
 * words, and caps the length.
 */
export function summarizeUpdateError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "Unknown error");
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED/.test(raw)) {
    return "Couldn't reach GitHub. Check your internet connection and try again.";
  }
  // The release exists but was published without the updater's metadata
  // (latest-linux.yml / latest-mac.yml / latest.yml).
  const missingMetadata = raw.match(/Cannot find (latest[\w-]*\.yml) in the latest release artifacts/);
  if (missingMetadata) {
    return `The latest release on GitHub is missing its update file (${missingMetadata[1]}). Download it from the releases page instead.`;
  }
  // Only drafts/prereleases exist, so there's no "latest" release at all.
  if (/Unable to find latest version on GitHub/.test(raw)) {
    return "No published release was found on GitHub yet.";
  }
  const firstLine = raw.split("\n")[0].trim() || "Unknown error";
  return firstLine.length > 200 ? `${firstLine.slice(0, 197)}…` : firstLine;
}
