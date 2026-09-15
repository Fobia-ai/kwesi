// Phase 4 built this as a mock Model Server Manager (see the block comment
// that used to sit here, now split out below) — every model_id walked a
// timed queued -> running -> done/failed status loop with no real Python
// process. Phase 5 replaced that mock body for `modelId === "musicgen"`
// only: a real child_process spawns servers/musicgen/server.py in its own
// venv, is health-checked over HTTP, and a submitted generation becomes a
// real POST /generate call that writes a real WAV file. Phase 7 adds
// `musecoco` and `museformer` alongside it, each with its own venv/port and
// its own runReal<Model>Job — MuseCoco's real path is proven (see
// servers/musecoco/README.md); Museformer's is wired the same way but
// unverified (see servers/museformer/README.md). Every other model_id
// (ace-step-1.5, yue2, rave) is untouched and still walks the Phase 4 mock
// path below.
import { BrowserWindow } from "electron";
import { ChildProcess, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import * as repo from "../db/repositories.js";
import { generationDir, ensureDir, modelsRootDir, venvDir } from "../db/paths.js";

const PROGRESS_CHANNEL = "kwesi:generation:progress";

export type ServerStatusValue = "stopped" | "starting" | "running" | "stopping";

export type GenerationProgressEvent =
  | { type: "server_status"; modelId: string; status: ServerStatusValue }
  | { type: "queued"; generationId: string; projectId: string }
  | { type: "running"; generationId: string; projectId: string; progressPct: number }
  | { type: "done"; generationId: string; projectId: string; outputFiles: string[]; durationMs: number }
  | { type: "failed"; generationId: string; projectId: string; error: string };

export interface SubmitResult {
  ok: boolean;
  reason?: string;
  generation?: repo.GenerationRow;
}

const serverStatus = new Map<string, ServerStatusValue>();

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function broadcast(event: GenerationProgressEvent) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(PROGRESS_CHANNEL, event);
  }
}

export function getServerStatus(modelId: string): ServerStatusValue {
  return serverStatus.get(modelId) ?? "stopped";
}

// --- Phase 5: real MusicGen server lifecycle --------------------------------
// Mirrors src/data/manifests.ts's MUSICGEN.server block rather than importing
// it directly — electron/tsconfig.json's rootDir is scoped to electron/, so
// it can't compile a file under src/, same reason electron/db/seedModels.ts
// already duplicates-with-a-comment instead of importing
// src/data/modelVariants.ts. Keep these two in sync by hand if either changes.
const MUSICGEN_MODEL_ID = "musicgen";
const MUSECOCO_MODEL_ID = "musecoco";
const MUSEFORMER_MODEL_ID = "museformer";
const REAL_SERVER_ENTRYPOINT = "server.py"; // same bare filename under servers/<model_id>/ for every real model

// First port in each model's manifest portRange (src/data/manifests.ts) —
// mirrors that file rather than importing it, same reason MusicGen's port
// constant already does (electron/tsconfig.json's rootDir can't reach
// src/); keep these in sync by hand if either changes.
const REAL_SERVER_PORTS: Record<string, number> = {
  [MUSICGEN_MODEL_ID]: 17600,
  [MUSECOCO_MODEL_ID]: 17620,
  [MUSEFORMER_MODEL_ID]: 17630,
};

interface RealServerHandle {
  proc: ChildProcess;
  port: number;
}

const realServers = new Map<string, RealServerHandle>();
// Coalesces concurrent submissions that race to start the same real server —
// without this, two generations submitted back-to-back before the first
// health check resolves would each spawn their own subprocess.
const startingPromises = new Map<string, Promise<RealServerHandle>>();

function isRealServerModel(modelId: string): boolean {
  return modelId in REAL_SERVER_PORTS;
}

// dist-electron/models/modelServer.js -> dist-electron -> project root.
function projectRootDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, "..", "..");
}

function venvPythonPath(modelId: string): string {
  const dir = venvDir(modelId);
  return process.platform === "win32"
    ? path.join(dir, "Scripts", "python.exe")
    : path.join(dir, "bin", "python");
}

async function healthCheck(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForHealthy(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await healthCheck(port)) return true;
    await delay(500);
  }
  return false;
}

async function spawnRealServer(modelId: string): Promise<RealServerHandle> {
  const python = venvPythonPath(modelId);
  if (!fs.existsSync(python)) {
    throw new Error(
      `${modelId} venv not found at ${venvDir(modelId)} (expected interpreter at ${python}). ` +
        `See servers/${modelId}/README.md to create it.`,
    );
  }
  const entrypoint = path.join(projectRootDir(), "servers", modelId, REAL_SERVER_ENTRYPOINT);
  if (!fs.existsSync(entrypoint)) {
    throw new Error(`${modelId} server entrypoint not found at ${entrypoint}`);
  }

  const port = REAL_SERVER_PORTS[modelId];
  const proc = spawn(python, [entrypoint, "--port", String(port)], {
    env: { ...process.env, KWESI_MODELS_DIR: modelsRootDir() },
    stdio: ["ignore", "pipe", "pipe"],
  });

  proc.stdout?.on("data", (chunk) => console.log(`[${modelId}-server] ${chunk.toString().trimEnd()}`));
  proc.stderr?.on("data", (chunk) => console.error(`[${modelId}-server] ${chunk.toString().trimEnd()}`));
  proc.on("exit", (code) => {
    console.log(`[${modelId}-server] exited with code ${code}`);
    realServers.delete(modelId);
    serverStatus.set(modelId, "stopped");
    broadcast({ type: "server_status", modelId, status: "stopped" });
  });

  const healthy = await waitForHealthy(port, 60_000);
  if (!healthy) {
    proc.kill("SIGTERM");
    throw new Error(`${modelId} server did not become healthy on port ${port} within 60s`);
  }

  return { proc, port };
}

async function ensureRealServerRunning(modelId: string): Promise<RealServerHandle> {
  const existing = realServers.get(modelId);
  if (existing && (await healthCheck(existing.port))) return existing;
  if (existing) realServers.delete(modelId);

  const inFlight = startingPromises.get(modelId);
  if (inFlight) return inFlight;

  serverStatus.set(modelId, "starting");
  broadcast({ type: "server_status", modelId, status: "starting" });

  const promise = spawnRealServer(modelId)
    .then((handle) => {
      realServers.set(modelId, handle);
      serverStatus.set(modelId, "running");
      broadcast({ type: "server_status", modelId, status: "running" });
      return handle;
    })
    .catch((err) => {
      serverStatus.set(modelId, "stopped");
      broadcast({ type: "server_status", modelId, status: "stopped" });
      throw err;
    })
    .finally(() => {
      startingPromises.delete(modelId);
    });

  startingPromises.set(modelId, promise);
  return promise;
}

async function stopRealServer(modelId: string): Promise<void> {
  const existing = realServers.get(modelId);
  if (!existing) return;
  serverStatus.set(modelId, "stopping");
  broadcast({ type: "server_status", modelId, status: "stopping" });
  existing.proc.kill("SIGTERM");
  realServers.delete(modelId);
  // The process's own "exit" handler broadcasts the final "stopped" status.
}

/** Called from main.ts on app quit so no orphaned Python process is left running. */
export async function shutdownAllRealServers(): Promise<void> {
  await Promise.all([...realServers.keys()].map((modelId) => stopRealServer(modelId)));
}

// --- Public server lifecycle (mock for every model except musicgen) --------

export async function startServer(modelId: string): Promise<void> {
  if (isRealServerModel(modelId)) {
    await ensureRealServerRunning(modelId);
    return;
  }

  const current = getServerStatus(modelId);
  if (current === "running" || current === "starting") return;
  serverStatus.set(modelId, "starting");
  broadcast({ type: "server_status", modelId, status: "starting" });
  await delay(500 + Math.random() * 400);
  serverStatus.set(modelId, "running");
  broadcast({ type: "server_status", modelId, status: "running" });
}

export async function stopServer(modelId: string): Promise<void> {
  if (isRealServerModel(modelId)) {
    await stopRealServer(modelId);
    return;
  }

  const current = getServerStatus(modelId);
  if (current === "stopped" || current === "stopping") return;
  serverStatus.set(modelId, "stopping");
  broadcast({ type: "server_status", modelId, status: "stopping" });
  await delay(300);
  serverStatus.set(modelId, "stopped");
  broadcast({ type: "server_status", modelId, status: "stopped" });
}

export function submitGeneration(
  projectId: string,
  checkpointVariant: string | null,
  inputParams: Record<string, unknown>,
  outputKind: string,
): SubmitResult {
  const context = repo.getProjectContext(projectId);
  if (!context) return { ok: false, reason: "Project not found" };

  const generation = repo.createGeneration(projectId, checkpointVariant, inputParams, outputKind);
  broadcast({ type: "queued", generationId: generation.id, projectId });
  void runJob(context.workspaceId, context.modelId, generation);
  return { ok: true, generation };
}

async function runJob(
  workspaceId: string,
  modelId: string,
  generation: repo.GenerationRow,
): Promise<void> {
  if (modelId === MUSICGEN_MODEL_ID) {
    await runRealMusicGenJob(workspaceId, generation);
    return;
  }
  if (modelId === MUSECOCO_MODEL_ID) {
    await runRealMuseCocoJob(workspaceId, generation);
    return;
  }
  if (modelId === MUSEFORMER_MODEL_ID) {
    await runRealMuseformerJob(workspaceId, generation);
    return;
  }
  await runMockJob(workspaceId, modelId, generation);
}

// --- Phase 5: real MusicGen generation ---------------------------------------

/**
 * The Phase 4 form only ever stores an uploaded file's *name*
 * (DynamicGenerationForm's audio_upload handler is `onChange(file.name)`,
 * not a real path or file transfer — that plumbing was never built). So a
 * melody reference is only usable here if input_params.melody_audio happens
 * to already be a real absolute path that exists on disk; otherwise it's
 * dropped with a log line rather than sent to the server as a bogus path.
 * The real-inference server itself (servers/musicgen/server.py) does support
 * melody conditioning given a real path — this gap is purely on the
 * renderer's upload-capture side, a pre-existing Phase 4 simplification, not
 * something Phase 5 introduced.
 */
function resolveMelodyAudioPath(inputParams: Record<string, unknown>): string | undefined {
  const value = inputParams.melody_audio;
  if (typeof value !== "string" || value.length === 0) return undefined;
  if (path.isAbsolute(value) && fs.existsSync(value)) return value;
  console.warn(`[musicgen-server] melody_audio "${value}" is not a real file path on disk — ignoring it`);
  return undefined;
}

async function runRealMusicGenJob(workspaceId: string, generation: repo.GenerationRow): Promise<void> {
  const generationId = generation.id;
  const projectId = generation.project_id;

  try {
    const { port } = await ensureRealServerRunning(MUSICGEN_MODEL_ID);

    repo.updateGenerationStatus(generationId, "running");
    broadcast({ type: "running", generationId, projectId, progressPct: 0 });

    const inputParams = JSON.parse(generation.input_params) as Record<string, unknown>;
    const prompt = typeof inputParams.prompt === "string" ? inputParams.prompt : "";
    const durationSec = typeof inputParams.duration_sec === "number" ? inputParams.duration_sec : 8;
    const melodyAudioPath = resolveMelodyAudioPath(inputParams);

    const dir = generationDir(workspaceId, projectId, generationId);
    ensureDir(dir);
    const outputPath = path.join(dir, "output.wav");

    const res = await fetch(`http://127.0.0.1:${port}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // A real generation call can legitimately take a while for a long
      // duration_sec, but must not hang forever if the Python process dies
      // mid-request without cleanly closing the connection.
      signal: AbortSignal.timeout(5 * 60 * 1000),
      body: JSON.stringify({
        variant: generation.checkpoint_variant ?? "small",
        prompt,
        duration_sec: durationSec,
        melody_audio_path: melodyAudioPath,
        output_path: outputPath,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`MusicGen server returned ${res.status}: ${text}`);
    }

    const data = (await res.json()) as { output_path: string; duration_ms: number };
    repo.updateGenerationStatus(generationId, "done", {
      outputFiles: [data.output_path],
      durationMs: data.duration_ms,
    });
    broadcast({ type: "done", generationId, projectId, outputFiles: [data.output_path], durationMs: data.duration_ms });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    repo.updateGenerationStatus(generationId, "failed", { error });
    broadcast({ type: "failed", generationId, projectId, error });
  }
}

// --- Phase 7 real MuseCoco / Museformer generation ---------------------------
// Both servers speak the same request shape: { input_params, output_path,
// min_generated_tokens?, max_generated_tokens? } -> { output_path, ... },
// since both are symbolic/MIDI models with the same "structured attributes
// in, .mid out" contract — unlike MusicGen's prompt/duration/melody shape.
// See servers/musecoco/README.md and servers/museformer/README.md for what's
// proven-real vs. unverified per model.

async function runRealMidiJob(
  modelId: string,
  workspaceId: string,
  generation: repo.GenerationRow,
): Promise<void> {
  const generationId = generation.id;
  const projectId = generation.project_id;

  try {
    const { port } = await ensureRealServerRunning(modelId);

    repo.updateGenerationStatus(generationId, "running");
    broadcast({ type: "running", generationId, projectId, progressPct: 0 });

    const inputParams = JSON.parse(generation.input_params) as Record<string, unknown>;
    const dir = generationDir(workspaceId, projectId, generationId);
    ensureDir(dir);
    const outputPath = path.join(dir, "output.mid");

    const res = await fetch(`http://127.0.0.1:${port}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Real CPU generation for these models is slow (minutes, not
      // seconds) — see servers/musecoco/README.md's measured timing — so
      // this needs a much longer budget than MusicGen's audio call.
      signal: AbortSignal.timeout(30 * 60 * 1000),
      body: JSON.stringify({ input_params: inputParams, output_path: outputPath }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`${modelId} server returned ${res.status}: ${text}`);
    }

    const data = (await res.json()) as { output_path: string; duration_ms: number };
    repo.updateGenerationStatus(generationId, "done", {
      outputFiles: [data.output_path],
      durationMs: data.duration_ms,
    });
    broadcast({ type: "done", generationId, projectId, outputFiles: [data.output_path], durationMs: data.duration_ms });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    repo.updateGenerationStatus(generationId, "failed", { error });
    broadcast({ type: "failed", generationId, projectId, error });
  }
}

async function runRealMuseCocoJob(workspaceId: string, generation: repo.GenerationRow): Promise<void> {
  await runRealMidiJob(MUSECOCO_MODEL_ID, workspaceId, generation);
}

async function runRealMuseformerJob(workspaceId: string, generation: repo.GenerationRow): Promise<void> {
  await runRealMidiJob(MUSEFORMER_MODEL_ID, workspaceId, generation);
}

// --- Phase 4 mock generation (every model except musicgen) -------------------

const PROGRESS_STEPS = 5;
// Small, fixed chance of a simulated failure so the error-handling UI has
// something real to exercise, per the Phase 4 roadmap spec.
const FAILURE_RATE = 0.12;

async function runMockJob(
  workspaceId: string,
  modelId: string,
  generation: repo.GenerationRow,
): Promise<void> {
  await startServer(modelId);

  repo.updateGenerationStatus(generation.id, "running");
  broadcast({ type: "running", generationId: generation.id, projectId: generation.project_id, progressPct: 0 });

  for (let step = 1; step <= PROGRESS_STEPS; step += 1) {
    await delay(350 + Math.random() * 300);
    broadcast({
      type: "running",
      generationId: generation.id,
      projectId: generation.project_id,
      progressPct: Math.round((step / PROGRESS_STEPS) * 100),
    });
  }

  if (Math.random() < FAILURE_RATE) {
    const error = "Simulated model server error (Phase 4 mock — no real inference yet).";
    repo.updateGenerationStatus(generation.id, "failed", { error });
    broadcast({ type: "failed", generationId: generation.id, projectId: generation.project_id, error });
    return;
  }

  const dir = generationDir(workspaceId, generation.project_id, generation.id);
  ensureDir(dir);
  const outputFiles: string[] = [];
  if (generation.output_kind === "audio" || generation.output_kind === "audio+midi") {
    const file = path.join(dir, "output.wav");
    fs.writeFileSync(file, "");
    outputFiles.push(file);
  }
  if (generation.output_kind === "midi" || generation.output_kind === "audio+midi") {
    const file = path.join(dir, "output.mid");
    fs.writeFileSync(file, "");
    outputFiles.push(file);
  }

  const durationMs = PROGRESS_STEPS * 500;
  repo.updateGenerationStatus(generation.id, "done", { outputFiles, durationMs });
  broadcast({ type: "done", generationId: generation.id, projectId: generation.project_id, outputFiles, durationMs });
}
