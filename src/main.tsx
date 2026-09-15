import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { PlayerProvider } from "./lib/playerStore";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PlayerProvider>
      <App />
    </PlayerProvider>
  </React.StrictMode>,
);
