import path from "node:path";
import fs from "node:fs";

let workspacesRoot = "";
let modelsRoot = "";
let venvsRoot = "";
let serversRoot = "";
let logsRoot = "";
let trainedModelsRoot = "";
let artistAvatarsRoot = "";
let exportsRoot = "";

export function initPaths(kwesiWorkspacesDir: string) {
  workspacesRoot = kwesiWorkspacesDir;
}

export function initModelsPaths(kwesiModelsDir: string) {
  modelsRoot = kwesiModelsDir;
}

export function initVenvsPaths(kwesiVenvsDir: string) {
  venvsRoot = kwesiVenvsDir;
}

// Where a model's vendored source (git-cloned on demand, e.g. ace-step-1.5's vendor/) lives.
// Every model-server/training-manager path that used to derive this from the *compiled
// module's own file location* (two directories up from dist-electron/models/*.js) now reads
// it from here instead - that trick only worked in a dev checkout, where the compiled files
// really do sit two levels under the repo root; in a packaged build those files load from
// inside app.asar, so "two levels up" landed inside the archive itself, and `git clone`
// failed outright trying to create directories inside what the OS sees as a single file, not
// a folder. See kwesiEnv.ts's KWESI_SERVERS_DIR comment for the full story.
export function initServersPaths(kwesiServersDir: string) {
  serversRoot = kwesiServersDir;
}

// Phase 10: the Training Job Manager needs somewhere to keep each run's log
// tail, PID/heartbeat file, staged dataset copy, and intermediate
// preprocessed/checkpoint working files — reuses the already-configurable
// KWESI_LOGS_DIR/KWESI_CACHE_DIR rather than inventing a new KWESI_* env
// var, per 02-architecture.md's "every directory... env var" principle
// (these are subfolders of dirs that are already independently overridable).
export function initLogsPaths(kwesiLogsDir: string) {
  logsRoot = kwesiLogsDir;
}

export function initTrainedModelsPaths(kwesiTrainedModelsDirEnv: string) {
  trainedModelsRoot = kwesiTrainedModelsDirEnv;
}

export function initArtistAvatarsPaths(kwesiArtistAvatarsDirEnv: string) {
  artistAvatarsRoot = kwesiArtistAvatarsDirEnv;
  ensureDir(artistAvatarsRoot);
}

// Same value already passed directly to registerAudioIpcHandlers (the
// default location its save dialog opens to) -- also kept here, alongside
// every other root dir, so electron/reset.ts can wipe it without a separate
// plumbing convention just for that one screen.
export function initExportsPaths(kwesiExportsDir: string) {
  exportsRoot = kwesiExportsDir;
}

export function modelsRootDir(): string {
  return modelsRoot;
}

export function workspacesRootDir(): string {
  return workspacesRoot;
}

export function venvsRootDir(): string {
  return venvsRoot;
}

export function serversRootDir(): string {
  return serversRoot;
}

export function logsRootDir(): string {
  return logsRoot;
}

export function artistAvatarsRootDir(): string {
  return artistAvatarsRoot;
}

export function trainedModelsRootDir(): string {
  return trainedModelsRoot;
}

export function exportsRootDir(): string {
  return exportsRoot;
}

export function artistAvatarPath(profileId: string, ext: string): string {
  return path.join(artistAvatarsRoot, `${profileId}${ext}`);
}

export function venvDir(modelId: string): string {
  return path.join(venvsRoot, modelId);
}

// A model's *training* venv is deliberately separate from its generation
// venv (see servers/rave/README.md's "training vs. inference venv" section)
// — training.server.venv in the manifest names the bare dirname under
// KWESI_VENVS_DIR directly (e.g. "rave-train"), joined the same way
// venvDir() joins a generation venv's bare model id.
export function trainingVenvDir(venvName: string): string {
  return path.join(venvsRoot, venvName);
}

export function modelVariantDir(modelId: string, variantName: string): string {
  return path.join(modelsRoot, modelId, variantName);
}

// One working directory per training run: staged dataset, preprocessed
// LMDB, RAVE's own --out_path run folder, a captured log file, and the
// PID/heartbeat file trainingManager.ts's reconciliation sweep reads on
// startup (see resetInterruptedDownloads in db/database.ts for the
// precedent this pattern mirrors).
export function trainingRunDir(runId: string): string {
  return path.join(logsRoot, "training", runId);
}

/**
 * Default (always user-overridable) output location for a training run's
 * checkpoint — $KWESI_TRAINED_MODELS_DIR/<model_id>/<run_name>, exactly the
 * pattern kwesi.docs/02-architecture.md's "Training pipeline architecture"
 * spells out, same "seeds where the picker opens, doesn't lock it" posture
 * KWESI_EXPORTS_DIR already has for Export/Download.
 */
export function kwesiTrainedModelsDir(modelId: string, runName: string): string {
  return path.join(trainedModelsRoot, modelId, runName);
}

export function workspaceDir(workspaceId: string): string {
  return path.join(workspacesRoot, workspaceId);
}

export function projectDir(workspaceId: string, projectId: string): string {
  return path.join(workspaceDir(workspaceId), projectId);
}

export function generationDir(workspaceId: string, projectId: string, generationId: string): string {
  return path.join(projectDir(workspaceId, projectId), generationId);
}

export function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

export function removeDirIfExists(dir: string) {
  fs.rmSync(dir, { recursive: true, force: true });
}
