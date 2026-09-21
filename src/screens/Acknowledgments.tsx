import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CATALOG, LICENSE_LABEL } from "../data/catalog";
import { PillButton } from "../components/ui/PillButton";
import { OrgLogo } from "../components/ui/OrgLogo";
import { GitHubIcon } from "../components/ui/icons";
import { openExternal } from "../lib/kwesiBridge";
import { kwesiSettings } from "../lib/settings";
import kwesiLogoFull from "../assets/logo-full.png";

// Shows once, ever -- checked on mount against a persisted flag (see
// kwesiSettings.getAcknowledged/setAcknowledged); every later launch skips
// straight to /home.
export function AcknowledgmentsScreen() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    kwesiSettings.getAcknowledged().then((seen) => {
      if (seen) navigate("/home", { replace: true });
      else setChecking(false);
    });
  }, [navigate]);

  async function start() {
    await kwesiSettings.setAcknowledged();
    navigate("/home");
  }

  if (checking) return null;

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-y-auto px-6 py-12">
      <div className="kwesi-backdrop" />
      <div className="relative z-10 flex w-full max-w-3xl flex-col items-center">
        <img src={kwesiLogoFull} alt="Kwesi" className="h-12 w-auto" />
        <p className="mt-3 max-w-sm text-center text-sm text-ink-muted">
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

        <PillButton className="mt-10 min-w-[220px]" onClick={start}>
          Start Application
        </PillButton>
      </div>
    </div>
  );
}
