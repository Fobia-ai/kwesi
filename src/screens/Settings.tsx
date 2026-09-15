import { useState } from "react";
import { CATALOG, LICENSE_LABEL } from "../data/catalog";
import { GitHubIcon } from "../components/ui/icons";
import { openExternal } from "../lib/kwesiBridge";

const TABS = ["Profile", "General", "Generation", "Models in use", "Security", "About"] as const;
type Tab = (typeof TABS)[number];

export function SettingsScreen() {
  const [tab, setTab] = useState<Tab>("Profile");

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col">
      <h1 className="mb-4 text-xl font-semibold">Settings</h1>
      <div className="mb-6 flex gap-1 border-b border-ink/10">
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

      {tab === "Profile" && (
        <div className="kwesi-glass flex flex-col gap-4 rounded-card p-5">
          <p className="text-xs text-ink-muted">
            Local profile only — no account, nothing sent anywhere.
          </p>
          <label className="flex flex-col gap-1.5 text-sm">
            Display name
            <input
              className="kwesi-glass rounded-[10px] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/40"
              placeholder="Your name"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            Email <span className="text-ink-muted">(optional, stored locally)</span>
            <input
              type="email"
              className="kwesi-glass rounded-[10px] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/40"
              placeholder="you@example.com"
            />
          </label>
        </div>
      )}

      {tab === "Security" && (
        <div className="kwesi-glass flex flex-col gap-4 rounded-card p-5">
          <p className="text-xs text-ink-muted">
            Set a passcode to lock Kwesi on relaunch and after inactivity. Wired up in Phase 12 —
            see kwesi.docs/04-roadmap.md.
          </p>
          <label className="flex flex-col gap-1.5 text-sm">
            Passcode
            <input
              type="password"
              disabled
              className="kwesi-glass rounded-[10px] px-3 py-2 text-sm outline-none disabled:opacity-50"
              placeholder="••••••"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            Auto-lock after inactivity (minutes)
            <input
              type="number"
              disabled
              defaultValue={10}
              className="kwesi-glass w-24 rounded-[10px] px-3 py-2 text-sm outline-none disabled:opacity-50"
            />
          </label>
        </div>
      )}

      {tab === "About" && (
        <div className="flex flex-col gap-2.5">
          {CATALOG.map((entry) => (
            <div
              key={entry.modelId}
              className="kwesi-glass flex items-center gap-3 rounded-credit px-3.5 py-2.5"
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
  );
}
