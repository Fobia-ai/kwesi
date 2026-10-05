import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import { HomeIcon, WorkspacesIcon, ModelsIcon, TrainingIcon, SettingsIcon, DownloadIcon } from "./icons";
import { AvatarImage } from "./AvatarImage";
import { kwesiArtistProfiles, type ArtistProfile } from "../../lib/artistProfiles";
import { useUpdateStatus } from "../../lib/updates";

interface RailItem {
  to: string;
  label: string;
  icon: ReactNode;
}

const ITEMS: RailItem[] = [
  { to: "/home", label: "Home", icon: <HomeIcon /> },
  { to: "/workspaces", label: "Workspaces", icon: <WorkspacesIcon /> },
  { to: "/models", label: "Model Manager", icon: <ModelsIcon /> },
  { to: "/training", label: "Training", icon: <TrainingIcon /> },
  { to: "/settings", label: "Settings", icon: <SettingsIcon /> },
];

/**
 * The quiet "there's an update" affordance at the foot of the rail: only
 * rendered once a newer release is known (available, downloading or ready
 * to install), and just opens Settings > About, where the actual
 * download / restart buttons live.
 */
function UpdateRailButton() {
  const navigate = useNavigate();
  const status = useUpdateStatus();
  if (!status || (status.state !== "available" && status.state !== "downloading" && status.state !== "downloaded")) {
    return null;
  }
  const label =
    status.state === "available"
      ? `Update available (v${status.version})`
      : status.state === "downloading"
        ? `Downloading update (v${status.version}) — ${Math.round(status.percent)}%`
        : `Update ready — restart to install v${status.version}`;
  return (
    <>
      <div className="my-2 h-px w-7 bg-ink/10" aria-hidden />
      <button
        type="button"
        title={label}
        aria-label={label}
        onClick={() => navigate("/settings?tab=About")}
        className="relative flex w-12 flex-col items-center gap-0.5 rounded-[14px] py-1.5 text-accent outline-none transition-colors duration-200 ease-smooth hover:bg-accent/10 focus-visible:ring-2 focus-visible:ring-accent/50"
      >
        <DownloadIcon width={18} height={18} />
        <span className="max-w-full truncate text-[10px] font-medium leading-tight">v{status.version}</span>
        <span
          className={`absolute right-1.5 top-1 h-1.5 w-1.5 rounded-full bg-accent ${status.state === "downloading" ? "animate-pulse" : ""}`}
          aria-hidden
        />
      </button>
    </>
  );
}

/**
 * The floating capsule on the left: the main tabs on top, then the artist
 * profiles stacked below as round avatars — the whole thing centred
 * vertically against the viewport rather than pinned to the top.
 */
export function IconRail() {
  const navigate = useNavigate();
  const location = useLocation();
  const [artists, setArtists] = useState<ArtistProfile[]>([]);

  // Re-read on every navigation: profiles are edited in Settings, and this
  // is the cheapest way to pick that up without threading a store through.
  useEffect(() => {
    let cancelled = false;
    kwesiArtistProfiles.list().then((list) => {
      if (!cancelled) setArtists(list);
    });
    return () => {
      cancelled = true;
    };
  }, [location.pathname, location.search]);

  return (
    <nav className="kwesi-glass relative z-10 flex w-[68px] shrink-0 flex-col items-center gap-1.5 self-center rounded-chip py-4 shadow-glass-sm">
      {ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          title={item.label}
          aria-label={item.label}
          className={({ isActive }) =>
            `flex h-11 w-11 items-center justify-center rounded-full outline-none transition-all duration-200 ease-smooth focus-visible:ring-2 focus-visible:ring-accent/50 ${
              isActive
                ? "bg-accent text-accent-ink shadow-glass-sm"
                : "text-ink-muted hover:bg-ink/5 hover:text-ink"
            }`
          }
        >
          {item.icon}
        </NavLink>
      ))}

      {artists.length > 0 && (
        <>
          <div className="my-2 h-px w-7 bg-ink/10" aria-hidden />
          <ul className="flex flex-col items-center gap-2">
            {artists.map((artist) => (
              <li key={artist.id}>
                <button
                  type="button"
                  title={artist.name}
                  aria-label={artist.name}
                  onClick={() => navigate("/settings?tab=Artists")}
                  className="rounded-full outline-none ring-offset-2 ring-offset-transparent transition-transform duration-200 ease-smooth hover:scale-105 focus-visible:ring-2 focus-visible:ring-accent/50"
                >
                  <AvatarImage avatarPath={artist.avatarPath} name={artist.name} size={34} className="ring-1 ring-ink/10" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <UpdateRailButton />
    </nav>
  );
}
