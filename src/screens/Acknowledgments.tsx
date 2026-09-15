import { useNavigate } from "react-router-dom";
import { CATALOG, LICENSE_LABEL } from "../data/catalog";
import { PillButton } from "../components/ui/PillButton";
import { GitHubIcon } from "../components/ui/icons";
import { openExternal } from "../lib/kwesiBridge";

// Small monogram placeholder until real org logo assets are sourced —
// see kwesi.docs/02-architecture.md "Acknowledgments screen — exact spec".
function LogoPlaceholder({ label }: { label: string }) {
  const initials = label
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-ink/[0.06] text-xs font-semibold text-ink-muted">
      {initials}
    </div>
  );
}

export function AcknowledgmentsScreen() {
  const navigate = useNavigate();

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-y-auto px-6 py-12">
      <div className="kwesi-backdrop" />
      <div className="relative z-10 flex w-full max-w-xl flex-col items-center">
        <h1 className="text-2xl font-semibold tracking-tight">Kwesi</h1>
        <p className="mt-2 max-w-sm text-center text-sm text-ink-muted">
          Built on the work of the open-source music research community.
          Every model below is credited to its original authors.
        </p>

        <div className="mt-8 flex w-full flex-col gap-2.5">
          {CATALOG.map((entry) => (
            <div
              key={entry.modelId}
              className="kwesi-glass flex items-center gap-3 rounded-credit px-3.5 py-2.5"
            >
              <LogoPlaceholder label={entry.org} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-ink">
                    {entry.displayName}
                  </span>
                  <span className="shrink-0 rounded-chip bg-ink/[0.06] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-muted">
                    {LICENSE_LABEL[entry.licenseTier]}
                  </span>
                </div>
                <p className="truncate text-xs text-ink-muted">
                  {entry.org} — {entry.description}
                </p>
              </div>
              <button
                type="button"
                onClick={() => openExternal(entry.repoUrl)}
                title={`Open ${entry.displayName} on GitHub`}
                aria-label={`Open ${entry.displayName} on GitHub`}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] text-ink-muted transition-colors duration-150 hover:bg-ink/[0.06] hover:text-ink"
              >
                <GitHubIcon />
              </button>
            </div>
          ))}
        </div>

        <PillButton className="mt-10 min-w-[220px]" onClick={() => navigate("/workspaces")}>
          Start Application
        </PillButton>
      </div>
    </div>
  );
}
