import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { PlayerProvider } from "./lib/playerStore";
import { AppLock } from "./components/security/AppLock";
import { installRendererCrashLogging } from "./lib/crashLog";
import "./index.css";

// Phase 13: armed before the first render so a crash during initial mount
// is still caught -- see src/lib/crashLog.ts.
installRendererCrashLogging();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppLock>
      <PlayerProvider>
        <App />
      </PlayerProvider>
    </AppLock>
  </React.StrictMode>,
);
