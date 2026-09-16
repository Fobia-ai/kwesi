import { useNavigate } from "react-router-dom";
import { CATALOG, LICENSE_LABEL } from "../data/catalog";
import { PillButton } from "../components/ui/PillButton";
import { OrgLogo } from "../components/ui/OrgLogo";
import { GitHubIcon } from "../components/ui/icons";
import { openExternal } from "../lib/kwesiBridge";

// TODO(view-once): this screen is meant to show only on first launch and
// never again — not implemented yet, deliberately. Still shown on every
// launch (the "/" route) until that's built; don't add the persistence
// logic without being asked.
export function AcknowledgmentsScreen() {
  const navigate = useNavigate();

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-y-auto px-6 py-12">
      <div className="kwesi-backdrop" />
      <div className="relative z-10 flex w-full max-w-3xl flex-col items-center">
        <h1 className="text-2xl font-semibold tracking-tight">Kwesi</h1>
        <p className="mt-2 max-w-sm text-center text-sm text-ink-muted">
          Built on the work of the open-source music research community.
          Every model below is credited to its original authors.
        </p>

        <div className="mt-8 grid w-full grid-cols-2 gap-3 sm:grid-cols-3">
          {CATALOG.map((entry) => (
            <div
              key={entry.modelId}
              className="kwesi-glass group relative flex flex-col items-center gap-2.5 rounded-card px-4 py-5 text-center"
            >
              <button
                type="button"
                onClick={() => openExternal(entry.repoUrl)}
                title={`Open ${entry.displayName} on GitHub`}
                aria-label={`Open ${entry.displayName} on GitHub`}
                className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full text-ink-muted opacity-0 transition-opacity duration-150 hover:bg-ink/[0.06] hover:text-ink group-hover:opacity-100"
              >
                <GitHubIcon width={15} height={15} />
              </button>

              <OrgLogo modelId={entry.modelId} org={entry.org} />

              <div className="min-w-0">
                <div className="flex items-center justify-center gap-1.5">
                  <span className="truncate text-sm font-medium text-ink">{entry.displayName}</span>
                </div>
                <span className="mt-1 inline-block rounded-chip bg-ink/[0.06] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-muted">
                  {LICENSE_LABEL[entry.licenseTier]}
                </span>
                <p className="mt-1.5 text-[11px] leading-snug text-ink-muted">{entry.description}</p>
              </div>
            </div>
          ))}
        </div>

        <PillButton className="mt-10 min-w-[220px]" onClick={() => navigate("/home")}>
          Start Application
        </PillButton>
      </div>
    </div>
  );
}
