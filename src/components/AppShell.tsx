import { Outlet } from "react-router-dom";
import { IconRail } from "./ui/IconRail";
import { MiniPlayer } from "./audio/MiniPlayer";
import { BackdropScene } from "./BackdropScene";

export function AppShell() {
  return (
    <div className="relative flex h-full w-full overflow-hidden">
      <BackdropScene />
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
