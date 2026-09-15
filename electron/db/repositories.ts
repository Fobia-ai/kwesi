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
  input_params: string;
  output_kind: string | null;
  output_files: string;
  created_at: number;
  duration_ms: number | null;
  error: string | null;
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

/**
 * Every model_variant row, regardless of source — used to reconcile install
 * state against disk at startup. "manual" only gates whether the app can
 * *initiate* a download for a variant (see electron/models/downloadQueue.ts);
 * it says nothing about whether the app should *recognize* content a human
 * placed there themselves, so this deliberately isn't filtered by source.
 */
export function listAllModelVariants(): ModelVariantRow[] {
  return getDatabase()
    .prepare("SELECT * FROM model_variant ORDER BY model_id, variant_name")
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
    .prepare("SELECT * FROM generation WHERE project_id = ? ORDER BY created_at DESC")
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
    input_params: "{}",
    output_kind: null,
    output_files: "[]",
    created_at: now,
    duration_ms: null,
    error: null,
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

// --- Phase 4: Generation job queue ------------------------------------------
// Additions only — the functions above this line are Phase 2/3 and untouched.

export function getProjectContext(
  projectId: string,
): { workspaceId: string; modelId: string } | undefined {
  return getDatabase()
    .prepare(
      `SELECT p.workspace_id AS workspaceId, w.model_id AS modelId
       FROM project p JOIN workspace w ON w.id = p.workspace_id
       WHERE p.id = ?`,
    )
    .get(projectId) as { workspaceId: string; modelId: string } | undefined;
}

export function createGeneration(
  projectId: string,
  checkpointVariant: string | null,
  inputParams: Record<string, unknown>,
  outputKind: string,
): GenerationRow {
  const db = getDatabase();
  const context = getProjectContext(projectId);
  if (!context) throw new Error(`Project ${projectId} not found`);

  const id = randomUUID();
  const now = Date.now();
  const inputParamsJson = JSON.stringify(inputParams);
  db.prepare(
    `INSERT INTO generation (id, project_id, status, input_params, output_kind, output_files, created_at, checkpoint_variant)
     VALUES (?, ?, 'queued', ?, ?, '[]', ?, ?)`,
  ).run(id, projectId, inputParamsJson, outputKind, now, checkpointVariant);

  ensureDir(generationDir(context.workspaceId, projectId, id));

  return {
    id,
    project_id: projectId,
    status: "queued",
    input_params: inputParamsJson,
    output_kind: outputKind,
    output_files: "[]",
    created_at: now,
    duration_ms: null,
    error: null,
    checkpoint_variant: checkpointVariant,
  };
}

export function getGenerationById(id: string): GenerationRow | undefined {
  return getDatabase().prepare("SELECT * FROM generation WHERE id = ?").get(id) as
    | GenerationRow
    | undefined;
}

export function updateGenerationStatus(
  id: string,
  status: string,
  patch: { outputFiles?: string[]; durationMs?: number; error?: string } = {},
): void {
  getDatabase()
    .prepare(
      `UPDATE generation SET status = ?, output_files = ?, duration_ms = ?, error = ? WHERE id = ?`,
    )
    .run(
      status,
      patch.outputFiles ? JSON.stringify(patch.outputFiles) : "[]",
      patch.durationMs ?? null,
      patch.error ?? null,
      id,
    );
}

// --- Phase 10: Training Job Manager ------------------------------------------
// training_run/trained_model tables already existed in schema.ts from the
// original Phase 0 design (see kwesi.docs/02-architecture.md's data model) —
// these are the first real read/write functions against them.

export interface TrainingRunRow {
  id: string;
  model_id: string;
  base_checkpoint_variant: string | null;
  run_name: string;
  status: string;
  dataset_manifest: string;
  hyperparams: string;
  output_dir: string | null;
  output_checkpoint_id: string | null;
  log_path: string | null;
  pid: number | null;
  started_at: number | null;
  completed_at: number | null;
  error: string | null;
}

export interface TrainedModelRow {
  id: string;
  base_model_id: string;
  training_run_id: string;
  display_name: string;
  checkpoint_path: string;
  created_at: number;
}

export function createTrainingRun(
  modelId: string,
  baseCheckpointVariant: string | null,
  runName: string,
  datasetManifest: unknown,
  hyperparams: Record<string, unknown>,
  outputDir: string,
): TrainingRunRow {
  const db = getDatabase();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO training_run
       (id, model_id, base_checkpoint_variant, run_name, status, dataset_manifest, hyperparams, output_dir)
     VALUES (?, ?, ?, ?, 'queued', ?, ?, ?)`,
  ).run(id, modelId, baseCheckpointVariant, runName, JSON.stringify(datasetManifest), JSON.stringify(hyperparams), outputDir);
  return getTrainingRunById(id) as TrainingRunRow;
}

export function listTrainingRuns(modelId?: string): TrainingRunRow[] {
  const db = getDatabase();
  if (modelId) {
    return db
      .prepare("SELECT * FROM training_run WHERE model_id = ? ORDER BY started_at DESC, rowid DESC")
      .all(modelId) as TrainingRunRow[];
  }
  return db.prepare("SELECT * FROM training_run ORDER BY started_at DESC, rowid DESC").all() as TrainingRunRow[];
}

export function getTrainingRunById(id: string): TrainingRunRow | undefined {
  return getDatabase().prepare("SELECT * FROM training_run WHERE id = ?").get(id) as TrainingRunRow | undefined;
}

/** Every run currently `queued`/`preparing`/`running` — used by the startup reconciliation sweep. */
export function listActiveTrainingRuns(): TrainingRunRow[] {
  return getDatabase()
    .prepare("SELECT * FROM training_run WHERE status IN ('queued', 'preparing', 'running')")
    .all() as TrainingRunRow[];
}

export function updateTrainingRunStatus(
  id: string,
  status: string,
  patch: {
    pid?: number | null;
    logPath?: string;
    outputCheckpointId?: string | null;
    startedAt?: number;
    completedAt?: number;
    error?: string | null;
  } = {},
): void {
  const db = getDatabase();
  const sets: string[] = ["status = ?"];
  const values: unknown[] = [status];
  if (patch.pid !== undefined) {
    sets.push("pid = ?");
    values.push(patch.pid);
  }
  if (patch.logPath !== undefined) {
    sets.push("log_path = ?");
    values.push(patch.logPath);
  }
  if (patch.outputCheckpointId !== undefined) {
    sets.push("output_checkpoint_id = ?");
    values.push(patch.outputCheckpointId);
  }
  if (patch.startedAt !== undefined) {
    sets.push("started_at = ?");
    values.push(patch.startedAt);
  }
  if (patch.completedAt !== undefined) {
    sets.push("completed_at = ?");
    values.push(patch.completedAt);
  }
  if (patch.error !== undefined) {
    sets.push("error = ?");
    values.push(patch.error);
  }
  values.push(id);
  db.prepare(`UPDATE training_run SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

export function createTrainedModel(
  baseModelId: string,
  trainingRunId: string,
  displayName: string,
  checkpointPath: string,
): TrainedModelRow {
  const db = getDatabase();
  const id = randomUUID();
  const createdAt = Date.now();
  db.prepare(
    `INSERT INTO trained_model (id, base_model_id, training_run_id, display_name, checkpoint_path, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, baseModelId, trainingRunId, displayName, checkpointPath, createdAt);
  return { id, base_model_id: baseModelId, training_run_id: trainingRunId, display_name: displayName, checkpoint_path: checkpointPath, created_at: createdAt };
}

export function listTrainedModels(modelId?: string): TrainedModelRow[] {
  const db = getDatabase();
  if (modelId) {
    return db
      .prepare("SELECT * FROM trained_model WHERE base_model_id = ? ORDER BY created_at DESC")
      .all(modelId) as TrainedModelRow[];
  }
  return db.prepare("SELECT * FROM trained_model ORDER BY created_at DESC").all() as TrainedModelRow[];
}

/**
 * Registers a completed training run's checkpoint as a real, selectable
 * generation checkpoint — inserts (or refreshes) a `model_variant` row with
 * `source = 'trained'`, `install_status = 'installed'` so it flows through
 * the exact same "installed variant" plumbing every stock catalog variant
 * already uses (Model Manager's listing, DynamicGenerationForm's
 * installed-variant check), rather than a parallel mechanism.
 */
export function upsertTrainedModelVariant(
  modelId: string,
  variantName: string,
  installPath: string,
  diskSizeBytes: number,
): void {
  const db = getDatabase();
  const existing = getModelVariant(modelId, variantName);
  if (existing) {
    setVariantInstalled(existing.id, installPath, diskSizeBytes);
    return;
  }
  db.prepare(
    `INSERT INTO model_variant (id, model_id, variant_name, install_status, install_path, disk_size_bytes, source)
     VALUES (?, ?, ?, 'installed', ?, ?, 'trained')`,
  ).run(randomUUID(), modelId, variantName, installPath, diskSizeBytes);
}

// --- Phase 12: Profile & Security -------------------------------------------

export interface ProfileRow {
  display_name: string | null;
  email: string | null;
  avatar_path: string | null;
}

export function getProfile(): ProfileRow {
  const row = getDatabase()
    .prepare("SELECT display_name, email, avatar_path FROM profile WHERE id = 1")
    .get() as ProfileRow | undefined;
  return row ?? { display_name: null, email: null, avatar_path: null };
}

export function saveProfile(displayName: string | null, email: string | null): void {
  getDatabase()
    .prepare(
      `INSERT INTO profile (id, display_name, email) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, email = excluded.email`,
    )
    .run(displayName, email);
}

export function getSetting(key: string): string | null {
  const row = getDatabase().prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  getDatabase()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, value);
}

export function deleteSetting(key: string): void {
  getDatabase().prepare("DELETE FROM settings WHERE key = ?").run(key);
}

// --- Artist profiles ---------------------------------------------------------

export interface ArtistProfileRow {
  id: string;
  name: string;
  bio: string | null;
  avatar_path: string | null;
  // Raw JSON text (an array of src/data/genres.ts strings) — parsed at the
  // renderer client layer (src/lib/artistProfiles.ts), same convention as
  // GenerationRow.input_params.
  genres: string;
  created_at: number;
  updated_at: number;
}

export function listArtistProfiles(): ArtistProfileRow[] {
  return getDatabase()
    .prepare("SELECT * FROM artist_profile ORDER BY name COLLATE NOCASE ASC")
    .all() as ArtistProfileRow[];
}

export function getArtistProfile(id: string): ArtistProfileRow | undefined {
  return getDatabase().prepare("SELECT * FROM artist_profile WHERE id = ?").get(id) as
    | ArtistProfileRow
    | undefined;
}

export function createArtistProfile(name: string, bio: string | null, genres: string[]): ArtistProfileRow {
  const id = randomUUID();
  const now = Date.now();
  const genresJson = JSON.stringify(genres);
  getDatabase()
    .prepare(
      "INSERT INTO artist_profile (id, name, bio, genres, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(id, name, bio, genresJson, now, now);
  return { id, name, bio, avatar_path: null, genres: genresJson, created_at: now, updated_at: now };
}

export function updateArtistProfile(id: string, name: string, bio: string | null, genres: string[]): void {
  getDatabase()
    .prepare("UPDATE artist_profile SET name = ?, bio = ?, genres = ?, updated_at = ? WHERE id = ?")
    .run(name, bio, JSON.stringify(genres), Date.now(), id);
}

export function setArtistProfileAvatarPath(id: string, avatarPath: string | null): void {
  getDatabase()
    .prepare("UPDATE artist_profile SET avatar_path = ?, updated_at = ? WHERE id = ?")
    .run(avatarPath, Date.now(), id);
}

export function deleteArtistProfile(id: string): void {
  getDatabase().prepare("DELETE FROM artist_profile WHERE id = ?").run(id);
}
