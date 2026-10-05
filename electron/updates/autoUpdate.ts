import { app } from "electron";
// electron-updater is CommonJS and exposes `autoUpdater` via a runtime
// `Object.defineProperty` getter (it lazily picks NsisUpdater/DebUpdater/
// AppImageUpdater/MacUpdater based on the current platform+package type) --
// cjs-module-lexer can't statically see that as a named export, so Node's
// ESM interop throws "Named export 'autoUpdater' not found" if imported as
// `import { autoUpdater } from "electron-updater"`. Import the default and
// destructure instead, which still resolves through the same getter.
import electronUpdater from "electron-updater";
import { writeCrashLog, buildCrashLogEntry } from "../logging/crashLog.js";
import {
  summarizeUpdateError,
  type AutoUpdatePreference,
  type UpdateDisabledReason,
  type UpdateStatus,
} from "./updateStatus.js";

export type { AutoUpdatePreference, UpdateStatus } from "./updateStatus.js";

/**
 * Checks GitHub Releases on github.com/Fobia-ai/kwesi (public; see
 * electron-builder.yml's `publish` block for the feed config baked into the
 * packaged app-update.yml) and drives the whole check -> download ->
 * restart-to-install flow, as a small state machine the renderer watches
 * over IPC (electron/ipc/updates.ts -> Settings > About and the rail's
 * "Update available" button).
 *
 * Nothing is downloaded without the user asking (autoDownload=false), and
 * nothing is installed until they click "Restart to update" -- except that
 * a downloaded update also installs on the next normal quit
 * (autoInstallOnAppQuit, electron-updater's default), which is what users
 * expect after seeing "ready to install".
 *
 * Off entirely (no network request at all) when:
 *  - running from source (`app.isPackaged` is false),
 *  - KWESI_MANAGED_PACKAGE=1 (a launcher owns install/update),
 *  - the user turned it off: the Settings > About switch, or, if that
 *    switch was never touched, KWESI_AUTO_UPDATE=false/0/no/off. On by
 *    default. See resolveAutoUpdatePreference in updateStatus.ts; the
 *    switch applies immediately via setAutoUpdateEnabled, no relaunch.
 *
 * Failures never throw or pop a dialog: they become an "error" status the
 * About panel shows, plus a line in the local crash log.
 */

// Long sessions still hear about a release without a relaunch.
const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

let status: UpdateStatus = { state: "idle" };
// Can never run in this process (dev run / managed package), whatever the
// user's preference says.
let hardOff: UpdateDisabledReason | null = null;
// The user's preference (Settings switch, else KWESI_AUTO_UPDATE).
let enabled = false;
let wired = false;
const listeners = new Set<(status: UpdateStatus) => void>();

function setStatus(next: UpdateStatus) {
  status = next;
  for (const listener of listeners) listener(next);
}

export function getUpdateStatus(): UpdateStatus {
  return status;
}

export function onUpdateStatus(listener: (status: UpdateStatus) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function versionOfCurrentUpdate(): string | undefined {
  return "version" in status ? status.version : undefined;
}

// Wires electron-updater's events into `status`, once, the first time the
// updater is actually on. Reading `electronUpdater.autoUpdater` constructs a
// platform-specific updater instance, which an off run has no reason to pay
// for.
function wireAutoUpdater() {
  if (wired) return;
  wired = true;

  const { autoUpdater } = electronUpdater;
  autoUpdater.autoDownload = false;

  // Events can still arrive after the user switched updates off (e.g. a
  // download already in flight) -- they mustn't flip the status back.
  autoUpdater.on("checking-for-update", () => {
    if (enabled) setStatus({ state: "checking" });
  });
  autoUpdater.on("update-available", (info) => {
    if (enabled) setStatus({ state: "available", version: info.version, releaseDate: info.releaseDate });
  });
  autoUpdater.on("update-not-available", () => {
    if (enabled) setStatus({ state: "not-available", checkedAt: Date.now() });
  });
  autoUpdater.on("download-progress", (progress) => {
    if (!enabled) return;
    setStatus({
      state: "downloading",
      version: versionOfCurrentUpdate() ?? "",
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond,
    });
  });
  autoUpdater.on("update-downloaded", (info) => {
    if (enabled) setStatus({ state: "downloaded", version: info.version });
  });

  // electron-updater's promises reject AND emit this same "error" event
  // for the same failure -- handled once here (the one hook that also sees
  // download failures), and the promise rejections are swallowed below.
  autoUpdater.on("error", (error) => {
    console.error("[autoUpdate] update failed", error);
    writeCrashLog(buildCrashLogEntry("main", "auto-update-error", error, { source: "autoUpdater" }));
    if (!enabled) return;
    // A failed download keeps the version so the UI can offer a retry.
    const version = status.state === "downloading" ? status.version : undefined;
    setStatus({ state: "error", message: summarizeUpdateError(error), version });
  });

  setInterval(() => {
    if (status.state === "idle" || status.state === "not-available" || status.state === "error") {
      void checkForUpdates();
    }
  }, RECHECK_INTERVAL_MS).unref();
}

/**
 * Sets the starting state. Call once at startup, before any window can ask
 * for the status; the launch check itself is a separate checkForUpdates()
 * once the window is up.
 */
export function initAutoUpdater(preference: AutoUpdatePreference): void {
  if (!app.isPackaged) hardOff = "dev";
  else if (process.env.KWESI_MANAGED_PACKAGE === "1") hardOff = "managed";
  applyPreference(preference);
}

function applyPreference(preference: AutoUpdatePreference) {
  enabled = preference.enabled;
  if (hardOff) {
    status = { state: "disabled", reason: hardOff };
    return;
  }
  if (!enabled) {
    // A downloaded update would otherwise still install on the next quit.
    if (wired) electronUpdater.autoUpdater.autoInstallOnAppQuit = false;
    setStatus({ state: "disabled", reason: preference.source === "setting" ? "setting" : "env" });
    return;
  }
  wireAutoUpdater();
  electronUpdater.autoUpdater.autoInstallOnAppQuit = true;
  if (status.state === "disabled") setStatus({ state: "idle" });
}

/**
 * The Settings > About switch: applies immediately. Turning it on also runs
 * a check right away, so the user sees a result without relaunching.
 */
export function setAutoUpdateEnabled(preference: AutoUpdatePreference): UpdateStatus {
  applyPreference(preference);
  if (enabled && !hardOff) void checkForUpdates();
  return status;
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  if (status.state === "disabled") return status;
  // Mid-download or already downloaded: a fresh check would only reset
  // the UI back to "available" for the same release.
  if (status.state === "downloading" || status.state === "downloaded") return status;

  const { autoUpdater } = electronUpdater;
  setStatus({ state: "checking" });
  try {
    const result = await autoUpdater.checkForUpdates();
    // null (with no events emitted) means electron-updater decided this
    // install can't be updated in place -- e.g. a packaged Linux build not
    // running as an AppImage or from the .deb.
    if (result === null) setStatus({ state: "disabled", reason: "unsupported-install" });
  } catch (error) {
    // Normally already turned into an "error" status by the listener above;
    // this covers a synchronous throw (malformed feed config) that never
    // reaches it.
    if (status.state === "checking") {
      writeCrashLog(buildCrashLogEntry("main", "auto-update-error", error, { source: "autoUpdater" }));
      setStatus({ state: "error", message: summarizeUpdateError(error) });
    }
  }
  return status;
}

export async function downloadUpdate(): Promise<UpdateStatus> {
  const version = versionOfCurrentUpdate();
  // Only from "available", or retrying a download that failed.
  if (!(status.state === "available" || (status.state === "error" && version))) return status;

  const { autoUpdater } = electronUpdater;
  setStatus({ state: "downloading", version: version ?? "", percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 });
  try {
    await autoUpdater.downloadUpdate();
  } catch {
    // Reported through the "error" listener.
  }
  return status;
}

/** Quits and runs the installer. Returns false if nothing is downloaded yet. */
export function installUpdate(): boolean {
  if (status.state !== "downloaded") return false;
  // isSilent=false: let the Windows installer show its progress;
  // isForceRunAfter=true: relaunch Kwesi when it's done.
  // Deferred a tick so the IPC reply reaches the renderer before the
  // windows start closing.
  setImmediate(() => electronUpdater.autoUpdater.quitAndInstall(false, true));
  return true;
}
