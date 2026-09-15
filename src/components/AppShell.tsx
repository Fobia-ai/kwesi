import { Outlet } from "react-router-dom";
import { IconRail } from "./ui/IconRail";
import { BackdropScene } from "./BackdropScene";

export function AppShell() {
  return (
    <div className="relative h-full w-full overflow-hidden">
      <BackdropScene />
      {/* Capped and centred so on a wide display the app floats in the
          middle of the backdrop rather than stretching edge to edge. */}
      <div className="relative z-10 mx-auto flex h-full w-full max-w-[1440px] gap-5 px-7 py-6">
        <IconRail />
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
