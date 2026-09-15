import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import { HomeIcon, WorkspacesIcon, ModelsIcon, TrainingIcon, SettingsIcon } from "./icons";
import { AvatarImage } from "./AvatarImage";
import { kwesiArtistProfiles, type ArtistProfile } from "../../lib/artistProfiles";

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
    </nav>
  );
}
