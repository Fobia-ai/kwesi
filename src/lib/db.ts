import { CATALOG } from "../data/catalog";
import { listForModel as listMockModelVariants } from "./modelVariantStore";
import * as generationStore from "./generationStore";

export interface ModelRow {
  id: string;
  display_name: string;
  license_tier: string;
  trainable: number;
  venv_path: string | null;
}

export interface ModelVariantRow {
  id: string;
  model_id: string;
  variant_name: string;
  install_status: string;
  install_path: string | null;
  disk_size_bytes: number | null;
  repo_id: string | null;
  source: string;
  manual_note: string | null;
  manual_url: string | null;
  bytes_downloaded: number | null;
  bytes_total: number | null;
  current_file: string | null;
  error: string | null;
}

export interface WorkspaceRow {
  id: string;
  name: string;
  model_id: string;
  model_display_name: string;
  created_at: number;
}

export interface ProjectRow {
  id: string;
  workspace_id: string;
  name: string;
  created_at: number;
  updated_at: number;
}

export interface GenerationRow {
  id: string;
  project_id: string;
  status: string;
  input_params: string;
  output_kind: string | null;
  output_files: string;
  created_at: number;
  duration_ms: number | null;
  error: string | null;
  checkpoint_variant: string | null;
}

export interface KwesiDbApi {
  listModels(): Promise<ModelRow[]>;
  listModelVariants(modelId: string): Promise<ModelVariantRow[]>;
  listWorkspaces(): Promise<WorkspaceRow[]>;
  createWorkspace(name: string, modelId: string): Promise<WorkspaceRow>;
  deleteWorkspace(id: string, deleteFiles: boolean): Promise<void>;
  listProjects(workspaceId: string): Promise<ProjectRow[]>;
  createProject(workspaceId: string, name: string): Promise<ProjectRow>;
  deleteProject(id: string, deleteFiles: boolean): Promise<void>;
  listGenerations(projectId: string): Promise<GenerationRow[]>;
  createPlaceholderGeneration(
    projectId: string,
    checkpointVariant?: string,
  ): Promise<GenerationRow>;
  deleteGeneration(id: string, deleteFiles: boolean): Promise<void>;
}

function realDb(bridge: NonNullable<Window["kwesi"]>["db"]): KwesiDbApi {
  return {
    listModels: () => bridge.listModels(),
    listModelVariants: (modelId) => bridge.listModelVariants(modelId),
    listWorkspaces: () => bridge.listWorkspaces(),
    createWorkspace: (name, modelId) => bridge.createWorkspace(name, modelId),
    deleteWorkspace: (id, deleteFiles) => bridge.deleteWorkspace(id, deleteFiles),
    listProjects: (workspaceId) => bridge.listProjects(workspaceId),
    createProject: (workspaceId, name) => bridge.createProject(workspaceId, name),
    deleteProject: (id, deleteFiles) => bridge.deleteProject(id, deleteFiles),
    listGenerations: (projectId) => bridge.listGenerations(projectId),
    createPlaceholderGeneration: (projectId, checkpointVariant) =>
      bridge.createPlaceholderGeneration(projectId, checkpointVariant),
    deleteGeneration: (id, deleteFiles) => bridge.deleteGeneration(id, deleteFiles),
  };
}

/**
 * localStorage-backed stand-in used only when running as a plain web page
 * during UI development (no Electron main process / SQLite available) —
 * see kwesi.docs "browser preview" verification notes. Mirrors
 * electron/db/repositories.ts behavior closely enough to exercise the UI.
 */
function createMockDb(): KwesiDbApi {
  const KEY = "kwesi-mock-db-v1";

  interface MockState {
    workspaces: WorkspaceRow[];
    projects: ProjectRow[];
  }

  function load(): MockState {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw) as MockState;
    } catch {
      // ignore — fall through to empty state
    }
    return { workspaces: [], projects: [] };
  }

  function save(state: MockState) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      // best-effort only; mock persistence is a dev convenience, not a guarantee
    }
  }

  const models: ModelRow[] = CATALOG.map((c) => ({
    id: c.modelId,
    display_name: c.displayName,
    license_tier: c.licenseTier,
    trainable: c.trainable ? 1 : 0,
    venv_path: null,
  }));

  return {
    async listModels() {
      return models;
    },
    async listModelVariants(modelId) {
      return listMockModelVariants(modelId);
    },
    async listWorkspaces() {
      return load().workspaces.sort((a, b) => b.created_at - a.created_at);
    },
    async createWorkspace(name, modelId) {
      const state = load();
      const model = models.find((m) => m.id === modelId);
      const row: WorkspaceRow = {
        id: crypto.randomUUID(),
        name,
        model_id: modelId,
        model_display_name: model?.display_name ?? modelId,
        created_at: Date.now(),
      };
      state.workspaces.push(row);
      save(state);
      return row;
    },
    async deleteWorkspace(id) {
      const state = load();
      const projectIds = state.projects.filter((p) => p.workspace_id === id).map((p) => p.id);
      state.workspaces = state.workspaces.filter((w) => w.id !== id);
      state.projects = state.projects.filter((p) => p.workspace_id !== id);
      generationStore.removeForProjects(projectIds);
      save(state);
    },
    async listProjects(workspaceId) {
      return load()
        .projects.filter((p) => p.workspace_id === workspaceId)
        .sort((a, b) => b.created_at - a.created_at);
    },
    async createProject(workspaceId, name) {
      const state = load();
      const now = Date.now();
      const row: ProjectRow = { id: crypto.randomUUID(), workspace_id: workspaceId, name, created_at: now, updated_at: now };
      state.projects.push(row);
      save(state);
      return row;
    },
    async deleteProject(id) {
      const state = load();
      state.projects = state.projects.filter((p) => p.id !== id);
      generationStore.removeForProjects([id]);
      save(state);
    },
    async listGenerations(projectId) {
      return generationStore.listForProject(projectId).sort((a, b) => b.created_at - a.created_at);
    },
    async createPlaceholderGeneration(projectId, checkpointVariant) {
      const row: GenerationRow = {
        id: crypto.randomUUID(),
        project_id: projectId,
        status: "done",
        input_params: "{}",
        output_kind: null,
        output_files: "[]",
        created_at: Date.now(),
        duration_ms: null,
        error: null,
        checkpoint_variant: checkpointVariant ?? null,
      };
      generationStore.insert(row);
      return row;
    },
    async deleteGeneration(id) {
      generationStore.remove(id);
    },
  };
}

export const kwesiDb: KwesiDbApi = window.kwesi ? realDb(window.kwesi.db) : createMockDb();
