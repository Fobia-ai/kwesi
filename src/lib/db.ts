import { CATALOG } from "../data/catalog";

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
  output_kind: string | null;
  created_at: number;
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
    generations: GenerationRow[];
  }

  function load(): MockState {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw) as MockState;
    } catch {
      // ignore — fall through to empty state
    }
    return { workspaces: [], projects: [], generations: [] };
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

  // Mirrors electron/db/seedModels.ts closely enough to exercise the UI —
  // doesn't need to be identical verbatim.
  const MOCK_VARIANT_NAMES: Record<string, string[]> = {
    "ace-step-1.5": [
      "acestep-v15-base",
      "acestep-v15-sft",
      "acestep-v15-turbo",
      "acestep-v15-xl-base",
      "acestep-v15-xl-sft",
      "acestep-v15-xl-turbo",
      "acestep-5hz-lm-0.6b",
      "acestep-5hz-lm-4b",
    ],
    yue2: ["yue2-3b", "yue2-vae", "yue2-vae-legacy"],
    musicgen: ["small", "medium", "large", "melody", "style"],
    musecoco: ["default"],
    museformer: ["default"],
    rave: [],
  };

  const modelVariants: ModelVariantRow[] = Object.entries(MOCK_VARIANT_NAMES).flatMap(
    ([modelId, variantNames]) =>
      variantNames.map((variantName) => ({
        id: `${modelId}:${variantName}`,
        model_id: modelId,
        variant_name: variantName,
        install_status: "not_installed",
        install_path: null,
        disk_size_bytes: null,
      })),
  );

  return {
    async listModels() {
      return models;
    },
    async listModelVariants(modelId) {
      return modelVariants.filter((v) => v.model_id === modelId);
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
      state.generations = state.generations.filter((g) => !projectIds.includes(g.project_id));
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
      state.generations = state.generations.filter((g) => g.project_id !== id);
      save(state);
    },
    async listGenerations(projectId) {
      return load()
        .generations.filter((g) => g.project_id === projectId)
        .sort((a, b) => b.created_at - a.created_at);
    },
    async createPlaceholderGeneration(projectId, checkpointVariant) {
      const state = load();
      const row: GenerationRow = {
        id: crypto.randomUUID(),
        project_id: projectId,
        status: "done",
        output_kind: null,
        created_at: Date.now(),
        checkpoint_variant: checkpointVariant ?? null,
      };
      state.generations.push(row);
      save(state);
      return row;
    },
    async deleteGeneration(id) {
      const state = load();
      state.generations = state.generations.filter((g) => g.id !== id);
      save(state);
    },
  };
}

export const kwesiDb: KwesiDbApi = window.kwesi ? realDb(window.kwesi.db) : createMockDb();
