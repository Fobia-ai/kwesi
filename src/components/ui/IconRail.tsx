import { NavLink } from "react-router-dom";
import type { ReactNode } from "react";
import { WorkspacesIcon, ModelsIcon, TrainingIcon, SettingsIcon } from "./icons";

interface RailItem {
  to: string;
  label: string;
  icon: ReactNode;
}

const ITEMS: RailItem[] = [
  { to: "/workspaces", label: "Workspaces", icon: <WorkspacesIcon /> },
  { to: "/models", label: "Model Manager", icon: <ModelsIcon /> },
  { to: "/training", label: "Training", icon: <TrainingIcon /> },
  { to: "/settings", label: "Settings", icon: <SettingsIcon /> },
];

export function IconRail() {
  return (
    <nav className="kwesi-glass relative z-10 mt-[var(--kwesi-header-h)] flex w-[76px] shrink-0 flex-col items-center gap-2 self-start rounded-panel py-5 shadow-glass-sm">
      <div className="mb-4 h-8 w-8 rounded-[9px] bg-accent" aria-hidden />
      {ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          title={item.label}
          className={({ isActive }) =>
            `flex h-11 w-11 items-center justify-center rounded-[14px] outline-none transition-all duration-200 ease-smooth focus-visible:ring-2 focus-visible:ring-accent/50 ${
              isActive
                ? "bg-accent text-accent-ink shadow-glass-sm"
                : "text-ink-muted hover:bg-ink/5 hover:text-ink"
            }`
          }
        >
          {item.icon}
        </NavLink>
      ))}
      <div className="mt-2 text-[10px] text-ink-muted/70">v0.1.0</div>
    </nav>
  );
}
