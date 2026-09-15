import { Outlet } from "react-router-dom";
import { IconRail } from "./ui/IconRail";
import { MiniPlayer } from "./audio/MiniPlayer";

export function AppShell() {
  return (
    <div className="relative flex h-full w-full overflow-hidden">
      <div className="kwesi-backdrop" />
      <IconRail />
      <div className="relative z-10 flex min-w-0 flex-1 flex-col overflow-hidden">
        <main className="flex-1 overflow-y-auto p-8">
          <Outlet />
        </main>
        <MiniPlayer />
      </div>
    </div>
  );
}
