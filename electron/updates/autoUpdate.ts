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

/**
 * Phase 13: wires electron-updater to check GitHub Releases on
 * github.com/Fobia-ai/kwesi (see electron-builder.yml's `publish` block for
 * the feed config electron-updater reads at runtime).
 *
 * **Known, honest limitation: this repo is currently PRIVATE.**
 * electron-updater's default GitHub provider fetches `latest*.yml` from the
 * repo's Releases over a plain, unauthenticated HTTPS request -- that works
 * for a public repo, but GitHub 404s an anonymous request against a private
 * repo's release assets. There is no way to ship a *working*
 * private-repo auto-updater to end users without embedding a GitHub token
 * in the distributed binary, which would leak that token to every install
 * (never acceptable) -- so, until this repo is made public (or updates
 * move to a different feed with its own real auth story), a real update
 * check against this feed reliably fails. That failure is caught here and
 * only logged (to the local crash log and the console) -- it never surfaces
 * a dialog or blocks anything the user is doing. See
 * kwesi.docs/02-architecture.md's "Auto-update" section for the full
 * writeup.
 */
export function checkForUpdates(): void {
  // Doesn't make sense in a dev run (`electron .` from source) -- there's
  // no packaged app-update.yml for electron-updater to compare a "current
  // version" against, and it throws synchronously if asked to try. Checked
  // before touching `electronUpdater.autoUpdater` at all -- that getter
  // does real platform-detection work (constructs a Nsis/Mac/AppImage/Deb
  // updater instance) the moment it's read, which a dev run has no reason
  // to pay for.
  if (!app.isPackaged) return;

  // A managed launcher (Fobia) owns install/update for this package -- the
  // upstream feed also always fails today anyway (private repo, see the
  // doc comment above), so skip paying for the doomed request and the
  // resulting crash-log entry on every single launch under one.
  if (process.env.KWESI_MANAGED_PACKAGE === "1") return;

  const { autoUpdater } = electronUpdater;
  autoUpdater.autoDownload = false;

  // electron-updater's `checkForUpdates()` promise rejects AND emits this
  // same "error" event for the same failure -- logged once here (the
  // documented hook point, and the one that also catches errors from
  // anything else autoUpdater might do later, e.g. a future downloadUpdate()
  // call) rather than in both places, so one failed check doesn't write two
  // near-identical entries to the local crash log.
  autoUpdater.on("error", (error) => {
    console.error("[autoUpdate] update check failed", error);
    writeCrashLog(buildCrashLogEntry("main", "auto-update-error", error, { source: "autoUpdater" }));
  });

  try {
    // checkForUpdates() returns a Promise but has also been observed to
    // throw synchronously for a malformed feed config -- belt-and-suspenders
    // on both failure paths, since this must never take the app down. The
    // rejection itself is swallowed here (already handled by the "error"
    // listener above) -- this catch exists only so an unhandled-rejection
    // warning doesn't show up in its place.
    void autoUpdater.checkForUpdates().catch(() => {});
  } catch (error) {
    console.error("[autoUpdate] failed to start update check", error);
    writeCrashLog(buildCrashLogEntry("main", "auto-update-error", error, { source: "autoUpdater" }));
  }
}
