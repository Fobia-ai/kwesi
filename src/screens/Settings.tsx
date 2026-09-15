import { useEffect, useState } from "react";
import { CATALOG, LICENSE_LABEL } from "../data/catalog";
import { GitHubIcon } from "../components/ui/icons";
import { openExternal } from "../lib/kwesiBridge";
import { kwesiProfile } from "../lib/profile";
import { kwesiSecurity } from "../lib/security";
import { useAppLock } from "../components/security/AppLock";
import { PillButton } from "../components/ui/PillButton";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Modal } from "../components/ui/Modal";
import { GlassPanel } from "../components/ui/GlassPanel";
import { PageHeader } from "../components/ui/PageHeader";

const TABS = ["Profile", "General", "Generation", "Models in use", "Security", "About"] as const;
type Tab = (typeof TABS)[number];

function ProfileTab() {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    kwesiProfile.get().then((p) => {
      setDisplayName(p.displayName ?? "");
      setEmail(p.email ?? "");
    });
  }, []);

  async function handleSave() {
    setStatus("Saving…");
    await kwesiProfile.save(displayName.trim() || null, email.trim() || null);
    setStatus("Saved.");
    setTimeout(() => setStatus(null), 1500);
  }

  return (
    <div className="flex max-w-lg flex-col gap-4">
      <p className="text-xs text-ink-muted">Local profile only — no account, nothing sent anywhere.</p>
      <label className="flex flex-col gap-1.5 text-sm">
        Display name
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="kwesi-glass rounded-[10px] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/40"
          placeholder="Your name"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        Email <span className="text-ink-muted">(optional, stored locally)</span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="kwesi-glass rounded-[10px] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/40"
          placeholder="you@example.com"
        />
      </label>
      <div className="flex items-center gap-3">
        <PillButton className="!px-4 !py-1.5 text-xs" onClick={handleSave}>
          Save
        </PillButton>
        {status && <span className="text-xs text-ink-muted">{status}</span>}
      </div>
    </div>
  );
}

function SetPasscodeModal({ onClose, onSet }: { onClose: () => void; onSet: () => void }) {
  const [value, setValue] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    if (value !== confirm) {
      setError("Passcodes don't match.");
      return;
    }
    setSaving(true);
    setError(null);
    const result = await kwesiSecurity.setPasscode(value);
    setSaving(false);
    if (!result.ok) {
      setError(result.reason ?? "Could not set passcode.");
      return;
    }
    onSet();
  }

  return (
    <Modal title="Set a passcode" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-sm">
          New passcode
          <input
            autoFocus
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="kwesi-glass rounded-[10px] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/40"
            placeholder="At least 4 characters"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          Confirm passcode
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="kwesi-glass rounded-[10px] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/40"
          />
        </label>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="mt-2 flex justify-end gap-2">
          <PillButton variant="ghost" onClick={onClose}>
            Cancel
          </PillButton>
          <PillButton disabled={!value || !confirm || saving} onClick={handleSubmit}>
            Set passcode
          </PillButton>
        </div>
      </div>
    </Modal>
  );
}

function SecurityTab() {
  const { refreshLockSettings } = useAppLock();
  const [hasPasscode, setHasPasscode] = useState(false);
  const [idleMinutes, setIdleMinutes] = useState(10);
  const [showSetModal, setShowSetModal] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [idleSaveStatus, setIdleSaveStatus] = useState<string | null>(null);

  async function refresh() {
    const [passcodeSet, minutes] = await Promise.all([
      kwesiSecurity.hasPasscode(),
      kwesiSecurity.getIdleTimeoutMinutes(),
    ]);
    setHasPasscode(passcodeSet);
    setIdleMinutes(minutes);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleRemove() {
    await kwesiSecurity.removePasscode();
    setConfirmingRemove(false);
    await refresh();
    refreshLockSettings();
  }

  async function handleIdleChange(minutes: number) {
    setIdleMinutes(minutes);
    await kwesiSecurity.setIdleTimeoutMinutes(minutes);
    refreshLockSettings();
    setIdleSaveStatus("Saved.");
    setTimeout(() => setIdleSaveStatus(null), 1200);
  }

  return (
    <div className="flex max-w-lg flex-col gap-4">
      <p className="text-xs text-ink-muted">
        Set a passcode to lock Kwesi on relaunch and after inactivity. This is a local UI gate,
        not encryption of your workspace data.
      </p>

      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm">Passcode</p>
          <p className="text-xs text-ink-muted">{hasPasscode ? "A passcode is set." : "No passcode set."}</p>
        </div>
        {hasPasscode ? (
          <div className="flex gap-2">
            <PillButton variant="ghost" className="!px-3 !py-1.5 text-xs" onClick={() => setShowSetModal(true)}>
              Change
            </PillButton>
            <PillButton variant="ghost" className="!px-3 !py-1.5 text-xs" onClick={() => setConfirmingRemove(true)}>
              Remove
            </PillButton>
          </div>
        ) : (
          <PillButton className="!px-3 !py-1.5 text-xs" onClick={() => setShowSetModal(true)}>
            Set passcode
          </PillButton>
        )}
      </div>

      <label className="flex flex-col gap-1.5 text-sm">
        Auto-lock after inactivity (minutes)
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            disabled={!hasPasscode}
            value={idleMinutes}
            onChange={(e) => handleIdleChange(Math.max(0, Number(e.target.value) || 0))}
            className="kwesi-glass w-24 rounded-[10px] px-3 py-2 text-sm outline-none disabled:opacity-50"
          />
          {idleSaveStatus && <span className="text-xs text-ink-muted">{idleSaveStatus}</span>}
        </div>
        <span className="text-xs text-ink-muted">0 disables idle-lock (relaunch-only).</span>
      </label>

      {showSetModal && (
        <SetPasscodeModal
          onClose={() => setShowSetModal(false)}
          onSet={async () => {
            setShowSetModal(false);
            await refresh();
            refreshLockSettings();
          }}
        />
      )}

      {confirmingRemove && (
        <ConfirmDialog
          title="Remove your passcode?"
          description="Kwesi will no longer lock on relaunch or after inactivity."
          confirmLabel="Remove"
          onCancel={() => setConfirmingRemove(false)}
          onConfirm={handleRemove}
        />
      )}
    </div>
  );
}

export function SettingsScreen() {
  const [tab, setTab] = useState<Tab>("Profile");

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Settings" />
      <GlassPanel radius="panel" className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 gap-1 border-b border-ink/10 px-4">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`relative px-3 py-2 text-sm transition-colors duration-150 ${
              tab === t ? "text-ink" : "text-ink-muted hover:text-ink"
            }`}
          >
            {t}
            {tab === t && <span className="absolute inset-x-2 -bottom-px h-px bg-accent" />}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
      {tab === "Profile" && <ProfileTab />}
      {tab === "Security" && <SecurityTab />}

      {tab === "About" && (
        <div className="-m-5 flex flex-col">
          {CATALOG.map((entry) => (
            <div
              key={entry.modelId}
              className="flex items-center gap-3 border-b border-ink/10 px-5 py-3 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{entry.displayName}</span>
                  <span className="shrink-0 rounded-chip bg-ink/[0.06] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-muted">
                    {LICENSE_LABEL[entry.licenseTier]}
                  </span>
                </div>
                <p className="truncate text-xs text-ink-muted">{entry.org}</p>
              </div>
              <button
                type="button"
                onClick={() => openExternal(entry.repoUrl)}
                aria-label={`Open ${entry.displayName} on GitHub`}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] text-ink-muted hover:bg-ink/[0.06] hover:text-ink"
              >
                <GitHubIcon />
              </button>
            </div>
          ))}
        </div>
      )}

      {(tab === "General" || tab === "Generation" || tab === "Models in use") && (
        <p className="text-sm text-ink-muted">Coming in a later phase — see kwesi.docs/04-roadmap.md.</p>
      )}
      </div>
      </GlassPanel>
    </div>
  );
}
