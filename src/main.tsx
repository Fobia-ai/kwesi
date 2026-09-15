import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { PlayerProvider } from "./lib/playerStore";
import { AppLock } from "./components/security/AppLock";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppLock>
      <PlayerProvider>
        <App />
      </PlayerProvider>
    </AppLock>
  </React.StrictMode>,
);
