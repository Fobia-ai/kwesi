import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getDatabase } from "./database.js";
import { workspaceDir, projectDir, generationDir, ensureDir, removeDirIfExists } from "./paths.js";

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

export interface QueueRow extends ModelVariantRow {
  model_display_name: string;
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

export function listModels(): ModelRow[] {
  return getDatabase().prepare("SELECT * FROM model ORDER BY display_name").all() as ModelRow[];
}

export function listModelVariants(modelId: string): ModelVariantRow[] {
  return getDatabase()
    .prepare("SELECT * FROM model_variant WHERE model_id = ? ORDER BY variant_name")
    .all(modelId) as ModelVariantRow[];
}

/** Every downloadable (non-manual) variant across all models — used to reconcile install state against disk at startup. */
export function listDownloadableVariants(): ModelVariantRow[] {
  return getDatabase()
    .prepare("SELECT * FROM model_variant WHERE source = 'huggingface' ORDER BY model_id, variant_name")
    .all() as ModelVariantRow[];
}

export function listWorkspaces(): WorkspaceRow[] {
  return getDatabase()
    .prepare(
      `SELECT w.id, w.name, w.model_id, m.display_name AS model_display_name, w.created_at
       FROM workspace w JOIN model m ON m.id = w.model_id
       ORDER BY w.created_at DESC`,
    )
    .all() as WorkspaceRow[];
}

export function createWorkspace(name: string, modelId: string): WorkspaceRow {
  const db = getDatabase();
  const id = randomUUID();
  const createdAt = Date.now();
  db.prepare("INSERT INTO workspace (id, name, model_id, created_at) VALUES (?, ?, ?, ?)").run(
    id,
    name,
    modelId,
    createdAt,
  );
  ensureDir(workspaceDir(id));
  const model = db.prepare("SELECT display_name FROM model WHERE id = ?").get(modelId) as
    | { display_name: string }
    | undefined;
  return {
    id,
    name,
    model_id: modelId,
    model_display_name: model?.display_name ?? modelId,
    created_at: createdAt,
  };
}

export function deleteWorkspace(id: string, deleteFiles: boolean): void {
  getDatabase().prepare("DELETE FROM workspace WHERE id = ?").run(id);
  if (deleteFiles) removeDirIfExists(workspaceDir(id));
}

export function listProjects(workspaceId: string): ProjectRow[] {
  return getDatabase()
    .prepare("SELECT * FROM project WHERE workspace_id = ? ORDER BY created_at DESC")
    .all(workspaceId) as ProjectRow[];
}

export function createProject(workspaceId: string, name: string): ProjectRow {
  const db = getDatabase();
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    "INSERT INTO project (id, workspace_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).run(id, workspaceId, name, now, now);
  ensureDir(projectDir(workspaceId, id));
  return { id, workspace_id: workspaceId, name, created_at: now, updated_at: now };
}

export function deleteProject(id: string, deleteFiles: boolean): void {
  const db = getDatabase();
  const project = db.prepare("SELECT workspace_id FROM project WHERE id = ?").get(id) as
    | { workspace_id: string }
    | undefined;
  db.prepare("DELETE FROM project WHERE id = ?").run(id);
  if (deleteFiles && project) removeDirIfExists(projectDir(project.workspace_id, id));
}

export function listGenerations(projectId: string): GenerationRow[] {
  return getDatabase()
    .prepare(
      "SELECT id, project_id, status, output_kind, created_at, checkpoint_variant FROM generation WHERE project_id = ? ORDER BY created_at DESC",
    )
    .all(projectId) as GenerationRow[];
}

/**
 * Phase 2 only creates an inert placeholder row + on-disk folder to prove
 * out the 3-level hierarchy and cascade-delete behavior. Real generation
 * (actually calling a model server) starts in Phase 4/5.
 */
export function createPlaceholderGeneration(
  projectId: string,
  checkpointVariant?: string,
): GenerationRow {
  const db = getDatabase();
  const project = db.prepare("SELECT workspace_id FROM project WHERE id = ?").get(projectId) as
    | { workspace_id: string }
    | undefined;
  if (!project) throw new Error(`Project ${projectId} not found`);

  const id = randomUUID();
  const now = Date.now();
  const variant = checkpointVariant ?? null;
  db.prepare(
    `INSERT INTO generation (id, project_id, status, input_params, output_kind, output_files, created_at, checkpoint_variant)
     VALUES (?, ?, 'done', '{}', NULL, '[]', ?, ?)`,
  ).run(id, projectId, now, variant);

  const dir = generationDir(project.workspace_id, projectId, id);
  ensureDir(dir);
  fs.writeFileSync(
    path.join(dir, "params.json"),
    JSON.stringify({ note: "placeholder generation — Phase 2 hierarchy test" }, null, 2),
  );

  return {
    id,
    project_id: projectId,
    status: "done",
    output_kind: null,
    created_at: now,
    checkpoint_variant: variant,
  };
}

export function deleteGeneration(id: string, deleteFiles: boolean): void {
  const db = getDatabase();
  const generation = db
    .prepare(
      `SELECT g.project_id, p.workspace_id FROM generation g
       JOIN project p ON p.id = g.project_id WHERE g.id = ?`,
    )
    .get(id) as { project_id: string; workspace_id: string } | undefined;
  db.prepare("DELETE FROM generation WHERE id = ?").run(id);
  if (deleteFiles && generation) {
    removeDirIfExists(generationDir(generation.workspace_id, generation.project_id, id));
  }
}

// --- Phase 3: Model Manager install lifecycle ------------------------------
// Additions only — the functions above this line are Phase 2 and untouched.

export function getModelVariant(modelId: string, variantName: string): ModelVariantRow | undefined {
  return getDatabase()
    .prepare("SELECT * FROM model_variant WHERE model_id = ? AND variant_name = ?")
    .get(modelId, variantName) as ModelVariantRow | undefined;
}

export function getModelVariantById(id: string): ModelVariantRow | undefined {
  return getDatabase().prepare("SELECT * FROM model_variant WHERE id = ?").get(id) as
    | ModelVariantRow
    | undefined;
}

/** Every model+variant currently queued, downloading, or failed — drives the Install Queue panel. */
export function listInstallQueue(): QueueRow[] {
  return getDatabase()
    .prepare(
      `SELECT v.*, m.display_name AS model_display_name
       FROM model_variant v JOIN model m ON m.id = v.model_id
       WHERE v.install_status IN ('queued', 'downloading', 'failed')
       ORDER BY v.variant_name`,
    )
    .all() as QueueRow[];
}

/** Workspaces bound to a model family — used to warn (not block) on variant removal. */
export function listWorkspacesUsingModel(modelId: string): { id: string; name: string }[] {
  return getDatabase()
    .prepare("SELECT id, name FROM workspace WHERE model_id = ? ORDER BY name")
    .all(modelId) as { id: string; name: string }[];
}

export function setVariantQueued(id: string): void {
  getDatabase()
    .prepare(
      `UPDATE model_variant SET install_status = 'queued', error = NULL,
       bytes_downloaded = NULL, bytes_total = NULL, current_file = NULL WHERE id = ?`,
    )
    .run(id);
}

export function setVariantDownloading(id: string): void {
  getDatabase()
    .prepare("UPDATE model_variant SET install_status = 'downloading', error = NULL WHERE id = ?")
    .run(id);
}

export function updateVariantProgress(
  id: string,
  bytesDownloaded: number,
  bytesTotal: number | null,
  currentFile: string,
): void {
  getDatabase()
    .prepare(
      "UPDATE model_variant SET bytes_downloaded = ?, bytes_total = ?, current_file = ? WHERE id = ?",
    )
    .run(bytesDownloaded, bytesTotal, currentFile, id);
}

export function setVariantInstalled(id: string, installPath: string, diskSizeBytes: number): void {
  getDatabase()
    .prepare(
      `UPDATE model_variant SET install_status = 'installed', install_path = ?, disk_size_bytes = ?,
       bytes_downloaded = NULL, bytes_total = NULL, current_file = NULL, error = NULL WHERE id = ?`,
    )
    .run(installPath, diskSizeBytes, id);
}

export function setVariantFailed(id: string, error: string): void {
  getDatabase()
    .prepare(
      `UPDATE model_variant SET install_status = 'failed', error = ?,
       bytes_downloaded = NULL, bytes_total = NULL, current_file = NULL WHERE id = ?`,
    )
    .run(error, id);
}

export function resetVariantToNotInstalled(id: string): void {
  getDatabase()
    .prepare(
      `UPDATE model_variant SET install_status = 'not_installed', install_path = NULL, disk_size_bytes = NULL,
       bytes_downloaded = NULL, bytes_total = NULL, current_file = NULL, error = NULL WHERE id = ?`,
    )
    .run(id);
}
