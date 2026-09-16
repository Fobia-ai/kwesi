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
// unverified (see servers/museformer/README.md). Phase 8 adds
// `ace-step-1.5`, proven real (see servers/ace-step-1.5/README.md) but
// spawning ACE-Step's *own* REST API server rather than a hand-written
// wrapper — see the real-server-vs-wrapper writeup there. Phase 9 adds
// `rave`, proven real (see servers/rave/README.md) — a hand-written
// FastAPI wrapper following MusicGen's shape exactly, since every one of
// RAVE's nine pretrained checkpoints is a self-contained TorchScript
// export needing nothing but torch.jit.load(), not a bigger framework to
// wrap. `yue2` is still untouched and walks the Phase 4 mock path below;
// its real generation was proven standalone (servers/yue2/README.md) but
// deliberately not wired into modelServer.ts yet, so don't assume its
// model_id is in REAL_SERVER_PORTS just because a README exists for it.
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
  | { type: "failed"; generationId: string; projectId: string; error: string }
  | { type: "cancelled"; generationId: string; projectId: string };

// A generation "job" here is really just an HTTP request (or a short chain
// of them) against a long-lived, shared-per-model server process — there's
// no separate per-job subprocess the way training runs have one, and none
// of the vendored servers expose a real per-task cancel endpoint (checked
// directly against ACE-Step's own real API routes, the one model here with
// an actual async task/poll shape where a clean cancel would be plausible —
// no such route exists). So cancelling for real means two things together:
// aborting the in-flight fetch(es) for instant UI feedback, and killing the
// model's whole server process to actually stop whatever GPU work it
// already dispatched — the server restarts automatically the next time this
// model is used.
interface ActiveGenerationJob {
  modelId: string;
  controller: AbortController;
  cancelled: boolean;
}
const activeGenerationJobs = new Map<string, ActiveGenerationJob>();

function beginGenerationJob(generationId: string, modelId: string): AbortController {
  const controller = new AbortController();
  activeGenerationJobs.set(generationId, { modelId, controller, cancelled: false });
  return controller;
}

// Combines the job's shared cancel signal with a per-request timeout, so
// every fetch in a job is both user-cancellable and still bounded the same
// way it already was.
function withTimeout(controller: AbortController, timeoutMs: number): AbortSignal {
  return AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]);
}

// Shared catch-block body for every real job runner below: a cancelled job
// gets its own distinct status/event rather than being reported as a
// generic failure, matching trainingManager.ts's own real
// cancelled-vs-failed distinction for training runs.
function finishFailedOrCancelled(generationId: string, projectId: string, err: unknown): void {
  const cancelled = activeGenerationJobs.get(generationId)?.cancelled ?? false;
  if (cancelled) {
    repo.updateGenerationStatus(generationId, "cancelled", { error: "Cancelled by user." });
    broadcast({ type: "cancelled", generationId, projectId });
    return;
  }
  const error = err instanceof Error ? err.message : String(err);
  repo.updateGenerationStatus(generationId, "failed", { error });
  broadcast({ type: "failed", generationId, projectId, error });
}

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
const ACE_STEP_MODEL_ID = "ace-step-1.5";
const RAVE_MODEL_ID = "rave";
const REAL_SERVER_ENTRYPOINT = "server.py"; // same bare filename under servers/<model_id>/ for every real model *except* ace-step-1.5 (see spawnAceStepServer)

// First port in each model's manifest portRange (src/data/manifests.ts) —
// mirrors that file rather than importing it, same reason MusicGen's port
// constant already does (electron/tsconfig.json's rootDir can't reach
// src/); keep these in sync by hand if either changes.
//
// ACE-Step's own real REST server (see spawnAceStepServer) defaults to port
// 8001 by its own convention (ACESTEP_API_PORT/--port, verified current
// against the cloned repo's docs/en/API.md and start_api_server.sh, not a
// stale detail). Deliberately *not* used here: this app already gives every
// real model its own port slice from its own manifest range so a workspace
// switch or multiple installed real servers never collide, and there's no
// reason to special-case ACE-Step into the one model that instead competes
// for 8001 with any standalone ACE-Step install the user might also run on
// this machine. 17640 (the first port in the manifest's [17640, 17659]
// range) is passed to ACE-Step's own server explicitly via --port instead.
const REAL_SERVER_PORTS: Record<string, number> = {
  [MUSICGEN_MODEL_ID]: 17600,
  [MUSECOCO_MODEL_ID]: 17620,
  [MUSEFORMER_MODEL_ID]: 17630,
  [ACE_STEP_MODEL_ID]: 17640,
  [RAVE_MODEL_ID]: 17680,
};

// ACE-Step ships its own real REST API server (acestep.api_server, cloned
// into servers/ace-step-1.5/vendor/ — see servers/ace-step-1.5/README.md)
// rather than needing a hand-written FastAPI wrapper the way MusicGen/
// MuseCoco/Museformer do — its own server is genuinely more correct to run
// as-is than reimplementing a third wrapper around the bare model classes.
const ACE_STEP_VENDOR_DIRNAME = "vendor";
const DEFAULT_ACE_STEP_VARIANT = "acestep-v15-turbo";
// Real ACE-Step checkpoints_dir layout (acestep/model_downloader.py's
// MAIN_MODEL_COMPONENTS/VAE_REGISTRY, read directly from the cloned repo)
// expects "vae", "Qwen3-Embedding-0.6B", "acestep-5Hz-lm-1.7B", and each DiT
// checkpoint as *siblings* directly under one checkpoints_dir. This app's
// own installed layout (electron/db/seedModels.ts / scripts/download_models.py)
// nests the first three one level deeper, inside the "acestep-v15-turbo"
// variant folder, because that variant's real HF repo (ACE-Step/Ace-Step1.5)
// bundles them together. Rather than duplicate tens of GB reshuffling files
// on disk, a small symlink farm (ensureAceStepCheckpointsLayout) bridges the
// two layouts — same "symlink, not copy" precedent as
// servers/musecoco/README.md's checkpoint layout section.
const ACE_STEP_CHECKPOINTS_LINK_MAP: Record<string, string> = {
  "acestep-v15-turbo": "acestep-v15-turbo/acestep-v15-turbo",
  vae: "acestep-v15-turbo/vae",
  "Qwen3-Embedding-0.6B": "acestep-v15-turbo/Qwen3-Embedding-0.6B",
  "acestep-5Hz-lm-1.7B": "acestep-v15-turbo/acestep-5Hz-lm-1.7B",
  "acestep-v15-base": "acestep-v15-base",
  "acestep-v15-sft": "acestep-v15-sft",
  "acestep-v15-xl-base": "acestep-v15-xl-base",
  "acestep-v15-xl-sft": "acestep-v15-xl-sft",
  "acestep-v15-xl-turbo": "acestep-v15-xl-turbo",
  "acestep-5Hz-lm-0.6B": "acestep-5hz-lm-0.6b",
  "acestep-5Hz-lm-4B": "acestep-5hz-lm-4b",
};

interface RealServerHandle {
  proc: ChildProcess;
  port: number;
}

const realServers = new Map<string, RealServerHandle>();
// Which DiT checkpoint ACE-Step's server currently has loaded into slot 1 —
// null until the first successful spawn/switch. Its own server can hold
// exactly one model per slot at a time; switching requires a real
// POST /v1/init call (see ensureAceStepModelLoaded), not free.
let aceStepLoadedVariant: string | null = null;
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

// <projectRoot>/servers/ace-step-1.5/vendor — the cloned ace-step/ACE-Step-1.5
// repo (see servers/ace-step-1.5/README.md for the exact clone command).
// Exported (Phase 11) so trainingManager.ts's ACE-Step LoRA training
// pipeline can point the real `train.py`'s `--checkpoint-dir` at the exact
// same bridged layout the inference server already builds/uses — training's
// own `_resolve_model_dir()` (acestep/training_v2/model_loader.py) expects
// the identical "vae/Qwen3-Embedding-0.6B/<variant> as siblings" shape this
// function produces, confirmed directly by reading that file rather than
// guessed. Read-only reuse of inference-side path logic, not a change to
// the inference server's own behavior.
export function aceStepVendorDir(): string {
  return path.join(projectRootDir(), "servers", ACE_STEP_MODEL_ID, ACE_STEP_VENDOR_DIRNAME);
}

/**
 * Builds (idempotently) the symlink farm bridging this app's installed
 * ACE-Step layout onto the sibling-directory layout ACE-Step's own code
 * expects — see ACE_STEP_CHECKPOINTS_LINK_MAP. Only links variants that are
 * actually installed on disk, so a partial install (e.g. XL checkpoints
 * never downloaded) doesn't break startup — ACE-Step's own server 404s a
 * specific model request instead, same as every other "not installed" case
 * in this app.
 *
 * Also symlinks `<vendorDir>/checkpoints` to this farm. This is load-
 * bearing, not cosmetic: `ACESTEP_CHECKPOINTS_DIR` is only read by
 * `acestep/model_downloader.py`'s own `get_checkpoints_dir()` — the actual
 * API-server startup path (`acestep/api/startup_model_init.py` and
 * `acestep_v15_pipeline.py`) hardcodes `checkpoint_dir =
 * os.path.join(project_root, "checkpoints")` and never calls
 * `get_checkpoints_dir()` at all, confirmed by reading the cloned repo
 * directly after a first real run silently ignored the env var and
 * re-downloaded the ~9.4GB main model bundle from Hugging Face into
 * `vendor/checkpoints/` instead of using the already-installed weights.
 * Symlinking `checkpoints` itself (rather than only relying on the env var)
 * makes the real code path find our farm regardless of that.
 */
export function ensureAceStepCheckpointsLayout(vendorDir: string): string {
  const modelRoot = path.join(modelsRootDir(), ACE_STEP_MODEL_ID);
  const checkpointsDir = path.join(modelRoot, ".server-checkpoints");
  ensureDir(checkpointsDir);
  for (const [linkName, relativeTarget] of Object.entries(ACE_STEP_CHECKPOINTS_LINK_MAP)) {
    const targetPath = path.join(modelRoot, relativeTarget);
    const linkPath = path.join(checkpointsDir, linkName);
    if (!fs.existsSync(targetPath) || fs.existsSync(linkPath)) continue;
    try {
      fs.symlinkSync(targetPath, linkPath, "dir");
    } catch (err) {
      console.warn(`[ace-step-1.5] failed to symlink ${linkPath} -> ${targetPath}: ${err instanceof Error ? err.message : err}`);
    }
  }

  const vendorCheckpointsLink = path.join(vendorDir, "checkpoints");
  if (!fs.existsSync(vendorCheckpointsLink)) {
    try {
      fs.symlinkSync(checkpointsDir, vendorCheckpointsLink, "dir");
    } catch (err) {
      console.warn(
        `[ace-step-1.5] failed to symlink ${vendorCheckpointsLink} -> ${checkpointsDir}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  return checkpointsDir;
}

function wireRealServerProcess(modelId: string, proc: ChildProcess): void {
  proc.stdout?.on("data", (chunk) => console.log(`[${modelId}-server] ${chunk.toString().trimEnd()}`));
  proc.stderr?.on("data", (chunk) => console.error(`[${modelId}-server] ${chunk.toString().trimEnd()}`));
  proc.on("exit", (code) => {
    console.log(`[${modelId}-server] exited with code ${code}`);
    realServers.delete(modelId);
    if (modelId === ACE_STEP_MODEL_ID) aceStepLoadedVariant = null;
    serverStatus.set(modelId, "stopped");
    broadcast({ type: "server_status", modelId, status: "stopped" });
  });
}

/**
 * ACE-Step's own server (acestep.api_server) is spawned directly — a
 * different shape from spawnRealServer's generic servers/<model_id>/server.py
 * convention, since there's no hand-written wrapper here at all (see the
 * comment above ACE_STEP_VENDOR_DIRNAME). Still participates in the same
 * health-check/lifecycle bookkeeping as every other real server.
 */
async function spawnAceStepServer(python: string): Promise<RealServerHandle> {
  const vendorDir = aceStepVendorDir();
  const entrypoint = path.join(vendorDir, "acestep", "api_server.py");
  if (!fs.existsSync(entrypoint)) {
    throw new Error(
      `ace-step-1.5 server entrypoint not found at ${entrypoint} — see servers/ace-step-1.5/README.md to clone the vendored ACE-Step-1.5 repo.`,
    );
  }

  const checkpointsDir = ensureAceStepCheckpointsLayout(vendorDir);
  const port = REAL_SERVER_PORTS[ACE_STEP_MODEL_ID];

  const proc = spawn(python, [entrypoint, "--port", String(port), "--host", "127.0.0.1"], {
    cwd: vendorDir,
    env: {
      ...process.env,
      ACESTEP_CHECKPOINTS_DIR: checkpointsDir,
      ACESTEP_CONFIG_PATH: DEFAULT_ACE_STEP_VARIANT,
      // DiT-only mode: the 5Hz LM ("thinking"/metadata auto-fill) is a real,
      // optional feature of ACE-Step's own API that this app's manifest
      // doesn't expose a control for yet — every generation request already
      // supplies prompt/duration/bpm/key/time-signature explicitly, so
      // disabling LLM init keeps first-integration startup fast and avoids
      // pulling the vLLM backend into the dependency surface for a feature
      // nothing calls. A later phase could wire up `thinking`/`use_format`
      // as real manifest inputs and flip this back to "auto".
      ACESTEP_INIT_LLM: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  wireRealServerProcess(ACE_STEP_MODEL_ID, proc);

  // Loading the DiT + VAE + text encoder onto the GPU genuinely takes
  // longer than the other real servers' 60s health-check budget the first
  // time a checkpoint is loaded — see servers/ace-step-1.5/README.md.
  const healthy = await waitForHealthy(port, 5 * 60_000);
  if (!healthy) {
    proc.kill("SIGTERM");
    throw new Error(`ace-step-1.5 server did not become healthy on port ${port} within 5 minutes`);
  }

  aceStepLoadedVariant = DEFAULT_ACE_STEP_VARIANT;
  return { proc, port };
}

async function spawnRealServer(modelId: string): Promise<RealServerHandle> {
  const python = venvPythonPath(modelId);
  if (!fs.existsSync(python)) {
    throw new Error(
      `${modelId} venv not found at ${venvDir(modelId)} (expected interpreter at ${python}). ` +
        `See servers/${modelId}/README.md to create it.`,
    );
  }

  if (modelId === ACE_STEP_MODEL_ID) {
    return spawnAceStepServer(python);
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

// --- Public server lifecycle (mock for every model not in REAL_SERVER_PORTS) --

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

/**
 * User-triggered stop for a real, currently queued/running generation.
 * Returns false if this generation isn't actually active (already
 * finished, or never a real job in the first place — e.g. a mocked
 * model), in which case the caller has nothing to do.
 */
export async function cancelGeneration(generationId: string): Promise<boolean> {
  const job = activeGenerationJobs.get(generationId);
  if (!job) return false;
  job.cancelled = true;
  job.controller.abort(new Error("Cancelled by user"));
  if (isRealServerModel(job.modelId)) await stopRealServer(job.modelId);
  return true;
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
  if (modelId === ACE_STEP_MODEL_ID) {
    await runRealAceStepJob(workspaceId, generation);
    return;
  }
  if (modelId === RAVE_MODEL_ID) {
    await runRealRaveJob(workspaceId, generation);
    return;
  }
  await runMockJob(workspaceId, modelId, generation);
}

// --- Phase 5: real MusicGen generation ---------------------------------------

/**
 * DynamicGenerationForm's audio_upload handler now captures a real absolute
 * path via Electron 32's webUtils.getPathForFile (Phase 9 — previously it
 * only ever stored the picked file's *name*, a known gap since Phase 4/5).
 * This still checks that input_params.melody_audio is a real, existing
 * absolute path rather than trusting it blindly — the browser-preview mock
 * (no window.kwesi) still only ever produces a bare name, and a renderer is
 * untrusted input in general — dropping it with a log line if not, rather
 * than sending a bogus path to the server. The real-inference server itself
 * (servers/musicgen/server.py) does support melody conditioning given a
 * real path.
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
  const controller = beginGenerationJob(generationId, MUSICGEN_MODEL_ID);

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
      signal: withTimeout(controller, 5 * 60 * 1000),
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
    finishFailedOrCancelled(generationId, projectId, err);
  } finally {
    activeGenerationJobs.delete(generationId);
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
  const controller = beginGenerationJob(generationId, modelId);

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
      signal: withTimeout(controller, 30 * 60 * 1000),
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
    finishFailedOrCancelled(generationId, projectId, err);
  } finally {
    activeGenerationJobs.delete(generationId);
  }
}

async function runRealMuseCocoJob(workspaceId: string, generation: repo.GenerationRow): Promise<void> {
  await runRealMidiJob(MUSECOCO_MODEL_ID, workspaceId, generation);
}

async function runRealMuseformerJob(workspaceId: string, generation: repo.GenerationRow): Promise<void> {
  await runRealMidiJob(MUSEFORMER_MODEL_ID, workspaceId, generation);
}

// --- Phase 8: real ACE-Step 1.5 generation -----------------------------------
// ACE-Step's own server is an async task queue (POST /release_task -> poll
// POST /query_result -> GET /v1/audio to download), a materially different
// shape from MusicGen/MuseCoco's single blocking POST /generate — see
// docs/en/API.md in the vendored repo (servers/ace-step-1.5/vendor/) for the
// full real contract this was transcribed from.

/**
 * Mirrors resolveMelodyAudioPath's reasoning exactly (see its comment) — same
 * real-path check, same reason it's needed even now that the upload path is
 * fixed (the browser-preview mock still only ever has a bare name).
 */
function resolveAceStepReferenceAudioPath(inputParams: Record<string, unknown>): string | undefined {
  const value = inputParams.reference_audio;
  if (typeof value !== "string" || value.length === 0) return undefined;
  if (path.isAbsolute(value) && fs.existsSync(value)) return value;
  console.warn(`[ace-step-1.5-server] reference_audio "${value}" is not a real file path on disk — ignoring it`);
  return undefined;
}

/**
 * The real ACE-Step API has no dedicated genre/instrument-tag parameters —
 * only a single free-text `prompt` (caption). The manifest's genre_tags/
 * instrument_tags fields (DynamicGenerationForm renders "tags" inputs as a
 * plain comma-separated text field) are folded into the caption text sent
 * to the real server rather than dropped, since ACE-Step's own caption
 * format is natural-language music description and these read naturally as
 * part of it.
 */
function buildAceStepPrompt(inputParams: Record<string, unknown>): string {
  const prompt = typeof inputParams.prompt === "string" ? inputParams.prompt : "";
  const genreTags = typeof inputParams.genre_tags === "string" ? inputParams.genre_tags.trim() : "";
  const instrumentTags = typeof inputParams.instrument_tags === "string" ? inputParams.instrument_tags.trim() : "";
  const parts = [prompt];
  if (genreTags) parts.push(`Genre: ${genreTags}`);
  if (instrumentTags) parts.push(`Instruments/timbre: ${instrumentTags}`);
  return parts.filter((p) => p.length > 0).join(". ");
}

/**
 * ACE-Step's server holds one DiT checkpoint per "slot" (this app only ever
 * uses slot 1) and only switches on a real POST /v1/init call — not free,
 * so this is skipped whenever the requested variant is already loaded
 * (true on every generation after the first for a given workspace).
 */
async function ensureAceStepModelLoaded(port: number, variant: string): Promise<void> {
  if (aceStepLoadedVariant === variant) return;
  const res = await fetch(`http://127.0.0.1:${port}/v1/init`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(5 * 60 * 1000),
    body: JSON.stringify({ model: variant, slot: 1 }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`ace-step-1.5 /v1/init returned ${res.status} switching to "${variant}": ${text}`);
  }
  aceStepLoadedVariant = variant;
}

interface AceStepReleaseTaskResponse {
  data?: { task_id?: string };
  error?: string | null;
}

interface AceStepQueryResultItem {
  task_id: string;
  status: number; // 0 = queued/running, 1 = succeeded, 2 = failed
  result?: string; // JSON-stringified array, see API.md section 5.3
}

interface AceStepQueryResultResponse {
  data?: AceStepQueryResultItem[];
  error?: string | null;
}

async function runRealAceStepJob(workspaceId: string, generation: repo.GenerationRow): Promise<void> {
  const generationId = generation.id;
  const projectId = generation.project_id;
  const controller = beginGenerationJob(generationId, ACE_STEP_MODEL_ID);

  try {
    const { port } = await ensureRealServerRunning(ACE_STEP_MODEL_ID);
    const variant = generation.checkpoint_variant ?? DEFAULT_ACE_STEP_VARIANT;
    await ensureAceStepModelLoaded(port, variant);

    repo.updateGenerationStatus(generationId, "running");
    broadcast({ type: "running", generationId, projectId, progressPct: 0 });

    const inputParams = JSON.parse(generation.input_params) as Record<string, unknown>;
    const durationSec = typeof inputParams.duration_sec === "number" ? inputParams.duration_sec : 120;
    const bpm = typeof inputParams.bpm === "number" ? inputParams.bpm : undefined;
    const keyScale = typeof inputParams.key_signature === "string" && inputParams.key_signature ? inputParams.key_signature : undefined;
    const timeSignature =
      typeof inputParams.time_signature === "string" && inputParams.time_signature ? inputParams.time_signature : undefined;
    const batchCount =
      typeof inputParams.batch_count === "number" ? Math.min(8, Math.max(1, Math.round(inputParams.batch_count))) : 1;
    const lyrics = typeof inputParams.lyrics === "string" ? inputParams.lyrics : "";
    const vocalLanguage =
      typeof inputParams.vocal_language === "string" && inputParams.vocal_language ? inputParams.vocal_language : "en";
    const referenceAudioPath = resolveAceStepReferenceAudioPath(inputParams);

    const dir = generationDir(workspaceId, projectId, generationId);
    ensureDir(dir);
    const outputPath = path.join(dir, "output.wav");

    const releaseRes = await fetch(`http://127.0.0.1:${port}/release_task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: withTimeout(controller, 30_000),
      body: JSON.stringify({
        prompt: buildAceStepPrompt(inputParams),
        lyrics,
        vocal_language: vocalLanguage,
        audio_duration: durationSec,
        bpm,
        key_scale: keyScale,
        time_signature: timeSignature,
        batch_size: batchCount,
        model: variant,
        reference_audio_path: referenceAudioPath,
        // audio_format defaults to mp3 on ACE-Step's own server (see
        // docs/en/API.md section 4.2) — this app's manifest declares wav
        // output (matching every other real model's own.wav convention and
        // audio.ts's mimeTypeFor), so it's requested explicitly rather than
        // relying on the real default.
        audio_format: "wav",
        // The 5Hz LM is disabled process-wide (see spawnAceStepServer) —
        // these all default true on ACE-Step's own API and would otherwise
        // try to invoke an LM that was never initialized.
        thinking: false,
        use_cot_caption: false,
        use_cot_language: false,
        use_format: false,
        sample_mode: false,
      }),
    });
    if (!releaseRes.ok) {
      const text = await releaseRes.text().catch(() => releaseRes.statusText);
      throw new Error(`ace-step-1.5 /release_task returned ${releaseRes.status}: ${text}`);
    }
    const releaseBody = (await releaseRes.json()) as AceStepReleaseTaskResponse;
    const taskId = releaseBody.data?.task_id;
    if (!taskId) {
      throw new Error(`ace-step-1.5 /release_task did not return a task_id: ${JSON.stringify(releaseBody)}`);
    }

    const startedAt = Date.now();
    // Real inference can legitimately run for several minutes at longer
    // durations/batch sizes with the LLM disabled — budget generously, same
    // spirit as servers/musecoco/README.md's 30-minute CPU budget.
    const pollBudgetMs = 20 * 60 * 1000;
    const pollDeadline = startedAt + pollBudgetMs;
    let resultFileUrl: string | null = null;

    while (Date.now() < pollDeadline) {
      if (controller.signal.aborted) break;
      await delay(2000);
      if (controller.signal.aborted) break;
      const queryRes = await fetch(`http://127.0.0.1:${port}/query_result`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: withTimeout(controller, 10_000),
        body: JSON.stringify({ task_id_list: [taskId] }),
      }).catch(() => null);
      if (!queryRes || !queryRes.ok) continue;

      const queryBody = (await queryRes.json()) as AceStepQueryResultResponse;
      const item = queryBody.data?.find((r) => r.task_id === taskId);
      if (!item) continue;

      broadcast({
        type: "running",
        generationId,
        projectId,
        progressPct: Math.min(90, Math.round(((Date.now() - startedAt) / pollBudgetMs) * 100)),
      });

      if (item.status === 1) {
        const parsed = JSON.parse(item.result ?? "[]") as Array<{ file?: string }>;
        const first = parsed.find((r) => typeof r.file === "string" && r.file.length > 0);
        if (!first?.file) throw new Error(`ace-step-1.5 task ${taskId} succeeded but returned no audio file`);
        resultFileUrl = first.file;
        break;
      }
      if (item.status === 2) {
        throw new Error(`ace-step-1.5 task ${taskId} failed (see the server's own log for the real cause)`);
      }
    }

    if (!resultFileUrl) {
      throw new Error(`ace-step-1.5 task ${taskId} did not complete within the ${pollBudgetMs / 60_000}-minute poll budget`);
    }

    const audioRes = await fetch(`http://127.0.0.1:${port}${resultFileUrl}`, { signal: withTimeout(controller, 60_000) });
    if (!audioRes.ok) throw new Error(`ace-step-1.5 failed to download generated audio: ${audioRes.status}`);
    const audioBuf = Buffer.from(await audioRes.arrayBuffer());
    fs.writeFileSync(outputPath, audioBuf);

    const durationMs = Date.now() - startedAt;
    repo.updateGenerationStatus(generationId, "done", { outputFiles: [outputPath], durationMs });
    broadcast({ type: "done", generationId, projectId, outputFiles: [outputPath], durationMs });
  } catch (err) {
    finishFailedOrCancelled(generationId, projectId, err);
  } finally {
    activeGenerationJobs.delete(generationId);
  }
}

// --- Phase 9: real RAVE generation -------------------------------------------
// servers/rave/server.py mirrors MusicGen's shape exactly (single blocking
// POST /generate, same in-process checkpoint cache) — RAVE's own inference
// surface is genuinely that simple once torch.jit.load() replaces the whole
// "load model code + load checkpoint" split every other model needs. See
// servers/rave/README.md for what's real vs. assumed (the sample-rate
// assumption in particular).

/**
 * Unlike MusicGen's melody reference or ACE-Step's reference audio, RAVE's
 * input_audio is not optional — it's the model's entire input, there's
 * nothing to generate without it. So this fails the generation outright
 * with a clear message rather than silently dropping the field and calling
 * a server that has no meaningful request to make, mirroring the same
 * real-absolute-path check resolveMelodyAudioPath uses (see its comment).
 */
function resolveRaveInputAudioPath(inputParams: Record<string, unknown>): string {
  const value = inputParams.input_audio;
  if (typeof value === "string" && value.length > 0 && path.isAbsolute(value) && fs.existsSync(value)) {
    return value;
  }
  throw new Error(
    typeof value === "string" && value.length > 0
      ? `input_audio "${value}" is not a real file path on disk — re-select the audio file and try again.`
      : "No input audio file was provided — RAVE needs a real audio file to transform.",
  );
}

async function runRealRaveJob(workspaceId: string, generation: repo.GenerationRow): Promise<void> {
  const generationId = generation.id;
  const projectId = generation.project_id;
  const controller = beginGenerationJob(generationId, RAVE_MODEL_ID);

  try {
    const inputParams = JSON.parse(generation.input_params) as Record<string, unknown>;
    const inputAudioPath = resolveRaveInputAudioPath(inputParams);

    const { port } = await ensureRealServerRunning(RAVE_MODEL_ID);

    repo.updateGenerationStatus(generationId, "running");
    broadcast({ type: "running", generationId, projectId, progressPct: 0 });

    const dir = generationDir(workspaceId, projectId, generationId);
    ensureDir(dir);
    const outputPath = path.join(dir, "output.wav");

    const res = await fetch(`http://127.0.0.1:${port}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // RAVE inference is fast even on CPU (a few hundred ms for a few
      // seconds of audio in standalone testing — see servers/rave/README.md)
      // but a long input file legitimately takes longer; same generous
      // budget as MusicGen's call rather than a tight one.
      signal: withTimeout(controller, 5 * 60 * 1000),
      body: JSON.stringify({
        variant: generation.checkpoint_variant,
        input_audio_path: inputAudioPath,
        output_path: outputPath,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`rave server returned ${res.status}: ${text}`);
    }

    const data = (await res.json()) as { output_path: string; duration_ms: number };
    repo.updateGenerationStatus(generationId, "done", {
      outputFiles: [data.output_path],
      durationMs: data.duration_ms,
    });
    broadcast({ type: "done", generationId, projectId, outputFiles: [data.output_path], durationMs: data.duration_ms });
  } catch (err) {
    finishFailedOrCancelled(generationId, projectId, err);
  } finally {
    activeGenerationJobs.delete(generationId);
  }
}

// --- Phase 4 mock generation (yue2 only, as of Phase 9) ----------------------

const PROGRESS_STEPS = 5;
// Small, fixed chance of a simulated failure so the error-handling UI has
// something real to exercise, per the Phase 4 roadmap spec.
const FAILURE_RATE = 0.12;

async function runMockJob(
  workspaceId: string,
  modelId: string,
  generation: repo.GenerationRow,
): Promise<void> {
  const generationId = generation.id;
  const projectId = generation.project_id;
  const controller = beginGenerationJob(generationId, modelId);

  await startServer(modelId);

  repo.updateGenerationStatus(generationId, "running");
  broadcast({ type: "running", generationId, projectId, progressPct: 0 });

  for (let step = 1; step <= PROGRESS_STEPS; step += 1) {
    await delay(350 + Math.random() * 300);
    if (controller.signal.aborted) {
      repo.updateGenerationStatus(generationId, "cancelled", { error: "Cancelled by user." });
      broadcast({ type: "cancelled", generationId, projectId });
      activeGenerationJobs.delete(generationId);
      return;
    }
    broadcast({
      type: "running",
      generationId,
      projectId,
      progressPct: Math.round((step / PROGRESS_STEPS) * 100),
    });
  }
  activeGenerationJobs.delete(generationId);

  if (Math.random() < FAILURE_RATE) {
    const error = "Simulated model server error (Phase 4 mock — no real inference yet).";
    repo.updateGenerationStatus(generationId, "failed", { error });
    broadcast({ type: "failed", generationId, projectId, error });
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
