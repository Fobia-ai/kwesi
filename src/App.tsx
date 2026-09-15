import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { AcknowledgmentsScreen } from "./screens/Acknowledgments";
import { AppShell } from "./components/AppShell";
import { HomeScreen } from "./screens/Home";
import { WorkspacesScreen } from "./screens/Workspaces";
import { WorkspaceDetailScreen } from "./screens/WorkspaceDetail";
import { ModelManagerScreen } from "./screens/ModelManager";
import { TrainingScreen } from "./screens/Training";
import { SettingsScreen } from "./screens/Settings";

export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<AcknowledgmentsScreen />} />
        <Route element={<AppShell />}>
          <Route path="/home" element={<HomeScreen />} />
          <Route path="/workspaces" element={<WorkspacesScreen />} />
          <Route path="/workspaces/:workspaceId" element={<WorkspaceDetailScreen />} />
          <Route path="/models" element={<ModelManagerScreen />} />
          <Route path="/training" element={<TrainingScreen />} />
          <Route path="/settings" element={<SettingsScreen />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}
