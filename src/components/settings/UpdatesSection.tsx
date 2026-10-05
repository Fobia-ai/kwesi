import { useEffect, useState, type ReactNode } from "react";
import pkg from "../../../package.json";
import { Badge, type BadgeTone } from "../ui/Badge";
import { Callout } from "../ui/Callout";
import { PillButton } from "../ui/PillButton";
import { SegmentedControl } from "../ui/SegmentedControl";
import { openExternal } from "../../lib/kwesiBridge";
import { formatBytes } from "../../lib/format";
import {
  KWESI_RELEASES_URL,
  kwesiUpdates,
  useUpdateStatus,
  type AutoUpdatePreference,
  type UpdateStatus,
} from "../../lib/updates";

function statusBadge(status: UpdateStatus | null): { label: string; tone: BadgeTone; pulse?: boolean } {
  switch (status?.state) {
    case undefined:
    case "idle":
      return { label: "Not checked yet", tone: "neutral" };
    case "disabled":
      return { label: "Updates off", tone: "neutral" };
    case "checking":
      return { label: "Checking…", tone: "neutral", pulse: true };
    case "not-available":
      return { label: "Up to date", tone: "success" };
    case "available":
      return { label: `v${status.version} available`, tone: "accent" };
    case "downloading":
      return { label: "Downloading…", tone: "accent", pulse: true };
    case "downloaded":
      return { label: "Ready to install", tone: "success" };
    case "error":
      return { label: "Update failed", tone: "bad" };
  }
}

function disabledMessage(status: Extract<UpdateStatus, { state: "disabled" }>): ReactNode {
  switch (status.reason) {
    case "dev":
      return "Updates are only checked in the installed app, not when running from source.";
    case "managed":
      return "This copy of Kwesi is installed and kept up to date by the Fobia launcher.";
    case "env":
      return (
        <>
          Automatic updates are off because <code>KWESI_AUTO_UPDATE</code> is set to false. Switching them on
          above overrides that.
        </>
      );
    case "setting":
      return "Automatic updates are off. Kwesi won't contact GitHub until you switch them back on.";
    case "unsupported-install":
      return "This copy of Kwesi can't update itself in place. Download the latest version from GitHub instead.";
  }
}

/**
 * Settings > About's top section: the running version and the whole
 * check -> download -> restart flow (electron/updates/autoUpdate.ts drives
 * the actual state; this only renders it and forwards clicks).
 */
export function UpdatesSection() {
  const status = useUpdateStatus();
  const [busy, setBusy] = useState(false);
  const [preference, setPreference] = useState<AutoUpdatePreference | null>(null);
  const badge = statusBadge(status);

  useEffect(() => {
    kwesiUpdates.getPreference().then(setPreference);
  }, []);

  async function handleToggle(enabled: boolean) {
    if (preference?.enabled === enabled) return;
    await run(async () => {
      const result = await kwesiUpdates.setEnabled(enabled);
      setPreference(result.preference);
    });
  }

  // A dev run or a launcher-managed install can't self-update whatever the
  // switch says, so the switch would only mislead there.
  const showSwitch =
    preference !== null && !(status?.state === "disabled" && (status.reason === "dev" || status.reason === "managed"));

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  const releasesLink = (
    <PillButton variant="ghost" size="sm" onClick={() => openExternal(KWESI_RELEASES_URL)}>
      Releases on GitHub
    </PillButton>
  );

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4 border-b border-ink/[0.07] py-2.5">
        <div className="flex min-w-0 items-baseline gap-3">
          <span className="shrink-0 text-xs text-ink-muted">Version</span>
          <span className="text-sm font-medium">v{pkg.version}</span>
        </div>
        <Badge tone={badge.tone} pulse={badge.pulse}>
          {badge.label}
        </Badge>
      </div>

      {showSwitch && (
        <div className="flex items-start justify-between gap-4 border-b border-ink/[0.07] pb-3">
          <div className="min-w-0">
            <p className="text-sm">Automatic updates</p>
            <p className="text-xs text-ink-muted">
              {preference.source === "env"
                ? "Currently set by KWESI_AUTO_UPDATE. Choosing here overrides it."
                : "Check GitHub for new releases. Nothing downloads until you ask."}
            </p>
          </div>
          <SegmentedControl
            ariaLabel="Automatic updates"
            options={[
              { value: "on", label: "On" },
              { value: "off", label: "Off" },
            ]}
            value={preference.enabled ? "on" : "off"}
            onChange={(value) => void handleToggle(value === "on")}
          />
        </div>
      )}

      {status?.state === "disabled" && (
        <>
          <Callout tone="info">{disabledMessage(status)}</Callout>
          {status.reason === "unsupported-install" && <div>{releasesLink}</div>}
        </>
      )}

      {(status === null || status.state === "idle" || status.state === "checking" || status.state === "not-available") && (
        <>
          {status?.state === "not-available" ? (
            <Callout tone="success">
              You're on the latest version. Last checked{" "}
              {new Date(status.checkedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.
            </Callout>
          ) : (
            <p className="text-xs text-ink-muted">Kwesi checks GitHub for a new release each time it starts.</p>
          )}
          <div>
            <PillButton
              size="sm"
              variant="ghost"
              disabled={busy || status === null || status.state === "checking"}
              onClick={() => run(() => kwesiUpdates.check())}
            >
              {status?.state === "checking" ? "Checking…" : "Check for updates"}
            </PillButton>
          </div>
        </>
      )}

      {status?.state === "available" && (
        <>
          <Callout tone="info">Kwesi v{status.version} is available. You have v{pkg.version}.</Callout>
          <div className="flex items-center gap-2">
            <PillButton size="sm" disabled={busy} onClick={() => run(() => kwesiUpdates.download())}>
              Download v{status.version}
            </PillButton>
            {releasesLink}
          </div>
        </>
      )}

      {status?.state === "downloading" && (
        <div className="flex flex-col gap-1.5">
          <div
            className="h-1.5 overflow-hidden rounded-full bg-ink/[0.08]"
            role="progressbar"
            aria-label={`Downloading Kwesi v${status.version}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(status.percent)}
          >
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-300 ease-smooth"
              style={{ width: `${Math.max(2, status.percent)}%` }}
            />
          </div>
          <p className="text-xs text-ink-muted">
            Downloading v{status.version} — {Math.round(status.percent)}%
            {status.total > 0 && ` (${formatBytes(status.transferred)} of ${formatBytes(status.total)})`}
          </p>
        </div>
      )}

      {status?.state === "downloaded" && (
        <>
          <Callout tone="success">
            Kwesi v{status.version} is downloaded and ready. Restart to install it — or it installs the next time
            you quit.
          </Callout>
          <div className="flex items-center gap-3">
            <PillButton size="sm" disabled={busy} onClick={() => run(() => kwesiUpdates.install())}>
              Restart to update
            </PillButton>
            <span className="text-xs text-ink-muted">Restarting stops any running generation or training.</span>
          </div>
        </>
      )}

      {status?.state === "error" && (
        <>
          <Callout tone="error">{status.message}</Callout>
          <div className="flex items-center gap-2">
            <PillButton
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => run(() => (status.version ? kwesiUpdates.download() : kwesiUpdates.check()))}
            >
              Try again
            </PillButton>
            {releasesLink}
          </div>
        </>
      )}
    </section>
  );
}
