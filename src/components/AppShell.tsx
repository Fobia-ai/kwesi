import { Outlet } from "react-router-dom";
import { IconRail } from "./ui/IconRail";

export function AppShell() {
  return (
    <div className="relative flex h-full w-full overflow-hidden">
      <div className="kwesi-backdrop" />
      <IconRail />
      <main className="relative z-10 flex-1 overflow-y-auto p-8">
        <Outlet />
      </main>
    </div>
  );
}
