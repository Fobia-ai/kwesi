import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { PlayerProvider } from "./lib/playerStore";
import { AppLock } from "./components/security/AppLock";
import { installRendererCrashLogging } from "./lib/crashLog";
import { installAudioRenderListener } from "./lib/audioRenderListener";
import "./index.css";

// Phase 13: armed before the first render so a crash during initial mount
// is still caught -- see src/lib/crashLog.ts.
installRendererCrashLogging();
// Real Web Audio (Tone.js + OfflineAudioContext) only exists here in the
// renderer, not in the main process -- see src/lib/audioRenderListener.ts.
installAudioRenderListener();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppLock>
      <PlayerProvider>
        <App />
      </PlayerProvider>
    </AppLock>
  </React.StrictMode>,
);
