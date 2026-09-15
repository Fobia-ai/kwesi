import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import pkg from "../../package.json";
import { CATALOG, LICENSE_LABEL } from "../data/catalog";
import {
  GitHubIcon,
  HeadphonesIcon,
  InfoIcon,
  LockIcon,
  ProfileIcon,
  SystemIcon,
} from "../components/ui/icons";
import { openExternal } from "../lib/kwesiBridge";
import { kwesiProfile } from "../lib/profile";
import { kwesiSecurity } from "../lib/security";
import { kwesiArtistProfiles, type ArtistProfile } from "../lib/artistProfiles";
import { kwesiHardware, type GpuVramInfo } from "../lib/hardware";
import { kwesiModels } from "../lib/models";
import { formatBytes } from "../lib/format";
import { GENRES } from "../data/genres";
import { LANGUAGES } from "../data/languages";
import { useAppLock } from "../components/security/AppLock";
import { PillButton } from "../components/ui/PillButton";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Modal } from "../components/ui/Modal";
import { GlassPanel } from "../components/ui/GlassPanel";
import { PageHeader } from "../components/ui/PageHeader";
import { AvatarImage } from "../components/ui/AvatarImage";
import { ChipMultiSelect } from "../components/ui/ChipMultiSelect";

const SECTIONS = [
  { tab: "Profile", blurb: "Your local display name and email." },
  { tab: "Artists", blurb: "Personas tracks are attributed to." },
  { tab: "System", blurb: "Hardware, storage, and where files live." },
  { tab: "Security", blurb: "Passcode and auto-lock." },
  { tab: "About", blurb: "The open-source models Kwesi builds on." },
] as const;

const TABS = SECTIONS.map((s) => s.tab);
type Tab = (typeof SECTIONS)[number]["tab"];

const TAB_ICONS: Record<Tab, ReactNode> = {
  Profile: <ProfileIcon width={17} height={17} />,
  Artists: <HeadphonesIcon width={17} height={17} />,
  System: <SystemIcon width={17} height={17} />,
  Security: <LockIcon width={17} height={17} />,
  About: <InfoIcon width={17} height={17} />,
};

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

// Same real-path-or-nothing pattern DynamicGenerationForm.tsx and
// Training.tsx each already have their own copy of — small enough (and
// specific enough per call site) that this app duplicates it rather than
// sharing one helper across three files.
function resolveUploadedFilePath(file: File | undefined): string {
  if (!file) return "";
  const realPath = window.kwesi?.getFilePathForUpload(file);
  return realPath && realPath.length > 0 ? realPath : "";
}

/**
 * Handles both create and edit. Avatar upload only appears in edit mode —
 * setAvatar needs a real profile id to attach the file to, and creating one
 * as a side effect of picking a file (before the user has even confirmed
 * the name) would leave an orphaned profile+avatar behind if they cancel.
 * Create is name+bio only; add a photo afterward via Edit.
 */
function ArtistProfileFormModal({
  profile,
  onClose,
  onSaved,
}: {
  profile: ArtistProfile | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(profile?.name ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [genres, setGenres] = useState<string[]>(profile?.genres ?? []);
  const [languages, setLanguages] = useState<string[]>(profile?.languages ?? []);
  const [avatarPath, setAvatarPath] = useState(profile?.avatarPath ?? null);
  const [saving, setSaving] = useState(false);

  function toggleGenre(genre: string) {
    setGenres((prev) => (prev.includes(genre) ? prev.filter((g) => g !== genre) : [...prev, genre]));
  }

  function toggleLanguage(code: string) {
    setLanguages((prev) => (prev.includes(code) ? prev.filter((l) => l !== code) : [...prev, code]));
  }
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  async function handlePickAvatar(file: File | undefined) {
    if (!profile) return;
    const sourcePath = resolveUploadedFilePath(file);
    if (!sourcePath) {
      setAvatarError("Couldn't resolve a real path for that file.");
      return;
    }
    setAvatarBusy(true);
    setAvatarError(null);
    const result = await kwesiArtistProfiles.setAvatar(profile.id, sourcePath);
    setAvatarBusy(false);
    if (!result.ok) {
      setAvatarError(result.reason ?? "Couldn't set that image.");
      return;
    }
    setAvatarPath(result.avatarPath ?? null);
    onSaved();
  }

  async function handleRemoveAvatar() {
    if (!profile) return;
    setAvatarBusy(true);
    await kwesiArtistProfiles.removeAvatar(profile.id);
    setAvatarBusy(false);
    setAvatarPath(null);
    onSaved();
  }

  async function handleSave() {
    if (!name.trim() || genres.length === 0) return;
    setSaving(true);
    try {
      if (profile) {
        await kwesiArtistProfiles.update(profile.id, name.trim(), bio.trim() || null, genres, languages);
      } else {
        await kwesiArtistProfiles.create(name.trim(), bio.trim() || null, genres, languages);
      }
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={profile ? "Edit artist profile" : "New artist profile"} onClose={onClose}>
      <div className="flex flex-col gap-4">
        {profile && (
          <div className="flex items-center gap-3">
            <AvatarImage avatarPath={avatarPath} name={name || "?"} size={56} />
            <div className="flex flex-col gap-1">
              <div className="flex gap-2">
                <label className="cursor-pointer text-xs text-accent hover:underline">
                  {avatarPath ? "Change photo" : "Add photo"}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="hidden"
                    disabled={avatarBusy}
                    onChange={(e) => {
                      void handlePickAvatar(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </label>
                {avatarPath && (
                  <button
                    type="button"
                    disabled={avatarBusy}
                    onClick={handleRemoveAvatar}
                    className="text-xs text-ink-muted hover:text-red-600"
                  >
                    Remove
                  </button>
                )}
              </div>
              {avatarError && <p className="text-xs text-red-600">{avatarError}</p>}
            </div>
          </div>
        )}

        <label className="flex flex-col gap-1.5 text-sm">
          Name
          <span className="text-red-500"> *</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Midnight Muse"
            className="kwesi-glass rounded-[10px] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/40"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          Bio <span className="text-ink-muted">(optional)</span>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={3}
            placeholder="A short description of this artist persona"
            className="kwesi-glass rounded-[10px] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/40"
          />
        </label>
        <div className="flex flex-col gap-1.5 text-sm">
          <span>
            Genres
            <span className="text-red-500"> *</span>
          </span>
          <p className="text-xs text-ink-muted">
            What this artist makes — offered back as choices whenever you generate as them.
          </p>
          <ChipMultiSelect options={GENRES} selected={genres} onToggle={toggleGenre} />
        </div>
        <div className="flex flex-col gap-1.5 text-sm">
          <span>
            Languages <span className="text-ink-muted">(optional)</span>
          </span>
          <p className="text-xs text-ink-muted">
            Only relevant for models with a real language concept — pre-fills their language field when
            you generate as this artist.
          </p>
          <ChipMultiSelect
            options={LANGUAGES.map((l) => ({ value: l.code, label: l.name }))}
            selected={languages}
            onToggle={toggleLanguage}
          />
        </div>

        <div className="mt-2 flex justify-end gap-2">
          <PillButton variant="ghost" onClick={onClose}>
            Cancel
          </PillButton>
          <PillButton disabled={!name.trim() || genres.length === 0 || saving} onClick={handleSave}>
            {profile ? "Save" : "Create"}
          </PillButton>
        </div>
      </div>
    </Modal>
  );
}

function ArtistsTab() {
  const [profiles, setProfiles] = useState<ArtistProfile[] | null>(null);
  const [showForm, setShowForm] = useState<"new" | ArtistProfile | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ArtistProfile | null>(null);

  async function refresh() {
    setProfiles(await kwesiArtistProfiles.list());
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleDelete() {
    if (!pendingDelete) return;
    await kwesiArtistProfiles.delete(pendingDelete.id);
    setPendingDelete(null);
    refresh();
  }

  return (
    <div className="flex max-w-lg flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-ink-muted">
          Personas generations can be attributed to — pick one when creating a generation.
        </p>
        <PillButton className="!px-3 !py-1.5 text-xs" onClick={() => setShowForm("new")}>
          + New Profile
        </PillButton>
      </div>

      {profiles === null ? null : profiles.length === 0 ? (
        <p className="rounded-[10px] bg-ink/[0.04] px-3 py-2.5 text-xs text-ink-muted">
          No artist profiles yet — create one to start attributing generations to it.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {profiles.map((profile) => (
            <li
              key={profile.id}
              className="flex items-center gap-3 rounded-[10px] bg-ink/[0.03] px-3 py-2.5"
            >
              <AvatarImage avatarPath={profile.avatarPath} name={profile.name} size={36} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{profile.name}</p>
                {profile.bio && <p className="truncate text-xs text-ink-muted">{profile.bio}</p>}
                {(profile.genres.length > 0 || profile.languages.length > 0) && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {profile.genres.map((genre) => (
                      <span
                        key={genre}
                        className="rounded-chip bg-ink/[0.06] px-1.5 py-0.5 text-[10px] text-ink-muted"
                      >
                        {genre}
                      </span>
                    ))}
                    {profile.languages.map((code) => (
                      <span
                        key={code}
                        className="rounded-chip bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent"
                      >
                        {LANGUAGES.find((l) => l.code === code)?.name ?? code}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <PillButton variant="ghost" className="!px-3 !py-1 text-xs" onClick={() => setShowForm(profile)}>
                  Edit
                </PillButton>
                <button
                  onClick={() => setPendingDelete(profile)}
                  className="rounded-[8px] px-2 py-1 text-xs text-ink-muted transition-colors duration-150 hover:bg-red-500/10 hover:text-red-600"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {showForm && (
        <ArtistProfileFormModal
          profile={showForm === "new" ? null : showForm}
          onClose={() => setShowForm(null)}
          onSaved={refresh}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={`Delete "${pendingDelete.name}"?`}
          description="Generations already attributed to this profile will show it as removed rather than being deleted themselves."
          confirmLabel="Delete"
          onCancel={() => setPendingDelete(null)}
          onConfirm={handleDelete}
        />
      )}
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

const ENV_LABELS: Record<string, string> = {
  KWESI_HOME: "App data",
  KWESI_MODELS_DIR: "Models",
  KWESI_WORKSPACES_DIR: "Workspaces",
  KWESI_EXPORTS_DIR: "Saved copies",
  KWESI_TRAINED_MODELS_DIR: "Trained models",
  KWESI_LOGS_DIR: "Logs",
};

function SystemRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-ink/[0.07] py-2.5 last:border-b-0">
      <span className="shrink-0 text-xs text-ink-muted">{label}</span>
      <span className="min-w-0 truncate text-right text-sm" title={value}>
        {value}
      </span>
    </div>
  );
}

// What this machine has to work with — the GPU (moved here from the
// workspace header), free space where models install, and where the app
// keeps everything on disk.
function SystemTab() {
  const [gpu, setGpu] = useState<GpuVramInfo | null>(null);
  const [freeBytes, setFreeBytes] = useState<number | null | undefined>(undefined);
  const [env, setEnv] = useState<Record<string, string | number> | null>(null);

  useEffect(() => {
    kwesiHardware.gpuVram().then(setGpu);
    kwesiModels.diskFreeBytes().then(setFreeBytes);
    if (window.kwesi) window.kwesi.getEnv().then(setEnv);
  }, []);

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <section>
        <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-muted">Hardware</p>
        {gpu === null ? (
          <p className="text-xs text-ink-muted">Checking…</p>
        ) : !gpu.available ? (
          <p className="text-sm">No NVIDIA GPU detected — models with a CPU fallback will still run, slowly.</p>
        ) : (
          <div>
            <SystemRow label="GPU" value={gpu.gpuName ?? "NVIDIA GPU"} />
            <SystemRow label="VRAM" value={`${gpu.freeVramGb.toFixed(1)} GB free of ${gpu.totalVramGb.toFixed(1)} GB`} />
          </div>
        )}
      </section>
      <section>
        <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-muted">Storage</p>
        <SystemRow
          label="Free space for models"
          value={freeBytes === undefined ? "Checking…" : freeBytes === null ? "Unknown" : formatBytes(freeBytes)}
        />
        {env &&
          Object.entries(ENV_LABELS).map(([key, label]) =>
            typeof env[key] === "string" ? <SystemRow key={key} label={label} value={String(env[key])} /> : null,
          )}
        {!window.kwesi && <SystemRow label="Paths" value="Not available in the browser preview" />}
      </section>
      <section>
        <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-muted">App</p>
        <SystemRow label="Kwesi" value={`v${pkg.version}`} />
      </section>
    </div>
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
  const location = useLocation();
  // Deep-linkable (the sidebar's artist avatars open /settings?tab=Artists).
  const requested = new URLSearchParams(location.search).get("tab");
  const [tab, setTab] = useState<Tab>(TABS.includes(requested as Tab) ? (requested as Tab) : "Profile");

  useEffect(() => {
    if (TABS.includes(requested as Tab)) setTab(requested as Tab);
  }, [requested]);

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Settings" />
      <GlassPanel radius="panel" className="flex min-h-0 flex-1 overflow-hidden">
        {/* A vertical nav rather than a row of tabs: the labels stay
            readable at full length, and adding a section doesn't squeeze
            the others. */}
        <nav className="flex w-56 shrink-0 flex-col gap-1 border-r border-ink/10 p-3">
          {SECTIONS.map(({ tab: t }) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              aria-current={tab === t ? "page" : undefined}
              className={`flex items-center gap-2.5 rounded-[12px] px-3 py-2.5 text-left text-sm transition-colors duration-150 ${
                tab === t ? "bg-ink/[0.09] text-ink" : "text-ink-muted hover:bg-ink/[0.05] hover:text-ink"
              }`}
            >
              <span className={tab === t ? "text-accent" : ""}>{TAB_ICONS[t]}</span>
              {t}
            </button>
          ))}
        </nav>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="shrink-0 border-b border-ink/10 px-6 py-4">
            <h2 className="text-lg font-semibold tracking-tight">{tab}</h2>
            <p className="text-xs text-ink-muted">{SECTIONS.find((s) => s.tab === tab)?.blurb}</p>
          </div>
          <div className="kwesi-scroll-inset min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {tab === "Profile" && <ProfileTab />}
            {tab === "Artists" && <ArtistsTab />}
            {tab === "System" && <SystemTab />}
            {tab === "Security" && <SecurityTab />}
            {tab === "About" && (
              <div className="flex max-w-2xl flex-col">
                {CATALOG.map((entry) => (
                  <div
                    key={entry.modelId}
                    className="flex items-center gap-3 border-b border-ink/[0.07] py-3 last:border-b-0"
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
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors duration-150 hover:bg-ink/[0.06] hover:text-ink"
                    >
                      <GitHubIcon />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </GlassPanel>
    </div>
  );
}
