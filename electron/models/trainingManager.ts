// Phase 10 Training Job Manager — a sibling to electron/models/modelServer.ts
// (see kwesi.docs/02-architecture.md "Training pipeline architecture"), but
// for long-running `rave preprocess` -> `rave train` -> `rave export` jobs
// rather than short-lived generation requests. RAVE is the training
// pipeline's pilot model (Phase 10) — every other catalog model's
// manifest.training.supported is false until Phase 11.
//
// Real finding: RAVE ships its own real CLI (the `rave` console-script
// entry point installed by the `acids-rave` pip package) rather than
// needing a hand-written train.py wrapper — this spawns that real CLI
// directly across all three phases, the same "run the vendor's own tooling"
// call Phase 8 made for ACE-Step's own REST server. See
// servers/rave/README.md's "Training venv" section for the real dependency
// archaeology (pytorch-lightning==1.9.0/scipy==1.10.0's exact pins forced a
// separate Python 3.11 venv, since neither has cp312 wheels).
import { BrowserWindow } from "electron";
import { ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import * as repo from "../db/repositories.js";
import { ensureDir, modelVariantDir, trainingRunDir, trainingVenvDir } from "../db/paths.js";
import { queryGpuVram } from "./gpuInfo.js";

const PROGRESS_CHANNEL = "kwesi:training:progress";

export type TrainingPhase = "preprocess" | "train" | "export";

export type TrainingProgressEvent =
  | { type: "status"; runId: string; status: string }
  | { type: "log"; runId: string; line: string }
  | {
      type: "progress";
      runId: string;
      phase: TrainingPhase;
      step?: number;
      maxSteps?: number;
      pct?: number;
      etaText?: string;
      rate?: number;
    }
  | { type: "completed"; runId: string; trainedModelId: string; checkpointPath: string }
  | { type: "failed"; runId: string; error: string }
  | { type: "cancelled"; runId: string };

function broadcast(event: TrainingProgressEvent) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(PROGRESS_CHANNEL, event);
  }
}

const activeProcesses = new Map<string, ChildProcess>();
const heartbeatIntervals = new Map<string, ReturnType<typeof setInterval>>();

export interface SubmitTrainingRunParams {
  modelId: string;
  baseCheckpointVariant: string | null;
  runName: string;
  datasetFiles: string[];
  allowedExtensions: string[];
  hyperparams: Record<string, unknown>;
  outputDir: string;
}

export interface SubmitTrainingResult {
  ok: boolean;
  reason?: string;
  trainingRun?: repo.TrainingRunRow;
}

// Only RAVE is real this phase — every other manifest declares
// training.supported: false, and DynamicGenerationForm/Training.tsx never
// let the renderer submit for them, but the main process re-checks here
// too rather than trusting the renderer blindly (same posture
// resolveMelodyAudioPath/resolveRaveInputAudioPath take in modelServer.ts).
const TRAINING_VENV_BY_MODEL: Record<string, string> = {
  rave: "rave-train",
};

function sanitizeSlug(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "run";
}

function deriveVariantName(runId: string, runName: string): string {
  return `trained-${sanitizeSlug(runName)}-${runId.slice(0, 8)}`;
}

function uniqueDestPath(dir: string, baseName: string): string {
  let dest = path.join(dir, baseName);
  if (!fs.existsSync(dest)) return dest;
  const ext = path.extname(baseName);
  const stem = baseName.slice(0, baseName.length - ext.length);
  let i = 1;
  while (fs.existsSync(dest)) {
    dest = path.join(dir, `${stem}-${i}${ext}`);
    i += 1;
  }
  return dest;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function writeHeartbeat(heartbeatPath: string, data: Record<string, unknown>): void {
  try {
    fs.writeFileSync(heartbeatPath, JSON.stringify({ ...data, updatedAt: Date.now() }));
  } catch {
    // best-effort only, mirroring downloadQueue.ts's own posture on
    // non-critical bookkeeping writes
  }
}

/**
 * Parses one line of RAVE's real tqdm-based training progress bar, e.g.
 * `Epoch 0:  91%|█████████ | 20/22 [00:01<00:00, 13.68it/s, v_num=0]`
 * (confirmed against a real `rave train --progress True` run, not guessed).
 * `stepInEpoch`/`stepsPerEpoch` are PL's own per-epoch batch count, not the
 * `--max_steps` global step — this app has no cheap way to read PL's true
 * global_step short of parsing its TensorBoard event log, so `pct` is a
 * best-effort estimate (epoch * stepsPerEpoch + stepInEpoch, against the
 * max_steps this app itself requested) rather than an exact figure. Real
 * per-step loss values aren't in this line at all (RAVE's model.py doesn't
 * mark its `log_dict` calls `prog_bar=True`) — they only reach the
 * TensorBoard event file this run also writes, not this app's live IPC
 * progress. Documented honestly rather than faked.
 */
function parseTrainProgress(
  line: string,
  maxSteps: number | undefined,
): { step: number; maxSteps?: number; pct?: number; etaText?: string; rate?: number } | null {
  const m = line.match(/Epoch\s+(\d+):\s+\d+%\|[^|]*\|\s*(\d+)\/(\d+)\s*\[([\d:]+)<([\d:]+),\s*([\d.]+)it\/s/);
  if (!m) return null;
  const epoch = Number(m[1]);
  const stepInEpoch = Number(m[2]);
  const stepsPerEpoch = Number(m[3]);
  const etaText = m[5];
  const rate = Number(m[6]);
  const overallStep = epoch * stepsPerEpoch + stepInEpoch;
  const pct = maxSteps ? Math.min(99, Math.round((overallStep / maxSteps) * 100)) : undefined;
  return { step: overallStep, maxSteps, pct, etaText, rate };
}

interface RunPhaseOptions {
  maxSteps?: number;
}

function runPhase(
  runId: string,
  phase: TrainingPhase,
  command: string,
  args: string[],
  cwd: string,
  appendLog: (text: string) => void,
  heartbeatPath: string,
  opts: RunPhaseOptions = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"], detached: true });
    activeProcesses.set(runId, proc);
    repo.updateTrainingRunStatus(runId, phase === "preprocess" ? "preparing" : "running", { pid: proc.pid ?? null });
    writeHeartbeat(heartbeatPath, { pid: proc.pid, phase });

    const hb = setInterval(() => writeHeartbeat(heartbeatPath, { pid: proc.pid, phase }), 5000);
    heartbeatIntervals.set(runId, hb);

    let tail = "";
    let lastEmit = 0;

    function handleChunk(chunk: Buffer) {
      const text = chunk.toString();
      tail = (tail + text).slice(-8000);
      appendLog(text);
      if (phase !== "train") return;
      const now = Date.now();
      if (now - lastEmit < 400) return;
      const segments = text.split(/\r|\n/).filter((s) => s.trim().length > 0);
      const last = segments[segments.length - 1];
      if (!last) return;
      const parsed = parseTrainProgress(last, opts.maxSteps);
      if (parsed) {
        lastEmit = now;
        broadcast({ type: "progress", runId, phase, ...parsed });
      }
    }

    proc.stdout?.on("data", handleChunk);
    proc.stderr?.on("data", handleChunk);

    function cleanup() {
      clearInterval(hb);
      heartbeatIntervals.delete(runId);
      activeProcesses.delete(runId);
    }

    proc.on("error", (err) => {
      cleanup();
      reject(err);
    });
    proc.on("exit", (code) => {
      cleanup();
      if (code === 0) resolve();
      else reject(new Error(`${phase} exited with code ${code}. Last output:\n${tail.slice(-2000)}`));
    });
  });
}

function findLatestCheckpoint(runsDir: string): string {
  const runSubdirs = fs
    .readdirSync(runsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  if (runSubdirs.length === 0) throw new Error(`No run directory found under ${runsDir}`);
  // rave train names each run "<name>_<gin-hash>" and there's exactly one
  // per training_run row (runId is passed as --name), so the first (only)
  // match is correct — not picking "most recent" since a retried run gets
  // its own fresh trainingRunDir anyway.
  const runDir = path.join(runsDir, runSubdirs[0]);
  const ckptDir = path.join(runDir, "version_0", "checkpoints");
  if (!fs.existsSync(ckptDir)) throw new Error(`No checkpoints directory at ${ckptDir}`);
  const ckpts = fs.readdirSync(ckptDir).filter((f) => f.endsWith(".ckpt"));
  if (ckpts.length === 0) throw new Error(`Training produced no checkpoint file under ${ckptDir}`);

  // Prefer "best.ckpt" (validation_checkpoint) if present since it reflects
  // a real validated step; otherwise fall back to the highest-numbered
  // "epoch_N.ckpt" periodic save (rave.core.ModelCheckpoint's own naming,
  // see servers/rave/README.md) — always present since --save_every is
  // chosen to fit within --max_steps for every run this app submits.
  const best = ckpts.find((f) => f === "best.ckpt");
  if (best) return path.join(ckptDir, best);
  const numbered = ckpts
    .map((f) => ({ f, n: Number(f.match(/epoch_(\d+)/)?.[1] ?? -1) }))
    .filter((x) => x.n >= 0)
    .sort((a, b) => b.n - a.n);
  if (numbered.length > 0) return path.join(ckptDir, numbered[0].f);
  return path.join(ckptDir, ckpts[0]);
}

async function runTrainingPipeline(params: SubmitTrainingRunParams, runId: string): Promise<void> {
  const { modelId, datasetFiles, allowedExtensions, hyperparams, outputDir } = params;
  const workDir = trainingRunDir(runId);
  ensureDir(workDir);
  const rawDir = path.join(workDir, "raw");
  const preDir = path.join(workDir, "preprocessed");
  const runsDir = path.join(workDir, "runs");
  const exportDir = path.join(workDir, "export");
  const logPath = path.join(workDir, "log.txt");
  const heartbeatPath = path.join(workDir, "heartbeat.json");
  ensureDir(rawDir);

  const logStream = fs.createWriteStream(logPath, { flags: "a" });
  const appendLog = (text: string) => {
    logStream.write(text);
    for (const line of text.split(/\r|\n/)) {
      if (line.trim().length > 0) broadcast({ type: "log", runId, line });
    }
  };

  repo.updateTrainingRunStatus(runId, "preparing", { logPath, startedAt: Date.now() });
  broadcast({ type: "status", runId, status: "preparing" });

  try {
    const staged: string[] = [];
    for (const src of datasetFiles) {
      if (!path.isAbsolute(src) || !fs.existsSync(src)) {
        throw new Error(`Dataset file not found on disk: ${src}`);
      }
      const ext = path.extname(src).toLowerCase();
      if (allowedExtensions.length > 0 && !allowedExtensions.includes(ext)) {
        throw new Error(`"${path.basename(src)}" has an unsupported file type (${ext || "no extension"}) for this model's training dataset.`);
      }
      const dest = uniqueDestPath(rawDir, path.basename(src));
      fs.copyFileSync(src, dest);
      staged.push(dest);
    }
    if (staged.length === 0) throw new Error("No dataset files were provided to train on.");

    const venvName = TRAINING_VENV_BY_MODEL[modelId];
    if (!venvName) throw new Error(`Training isn't wired up for "${modelId}" yet.`);
    const raveBin = path.join(trainingVenvDir(venvName), "bin", "rave");
    if (!fs.existsSync(raveBin)) {
      throw new Error(
        `Training venv not found at ${trainingVenvDir(venvName)} (expected executable at ${raveBin}). See servers/rave/README.md to create it.`,
      );
    }

    // v1 simplification: mono, 44.1kHz, ~1.49s windows (65536 samples) —
    // fixed rather than exposed as hyperparameters, matching the
    // architecture doc's "couple of knobs that matter" framing for a pilot
    // run. See src/data/manifests.ts's RAVE.training comment.
    const channels = 1;
    const sampleRate = 44100;
    const numSignal = 65536;

    await runPhase(
      runId,
      "preprocess",
      raveBin,
      [
        "preprocess",
        "--input_path",
        rawDir,
        "--output_path",
        preDir,
        "--channels",
        String(channels),
        "--sampling_rate",
        String(sampleRate),
        "--num_signal",
        String(numSignal),
      ],
      workDir,
      appendLog,
      heartbeatPath,
    );

    if (!fs.existsSync(path.join(preDir, "data.mdb"))) {
      throw new Error(
        "Preprocessing produced an empty dataset — the provided audio files are likely too short for RAVE's analysis window. Add longer or more files.",
      );
    }

    repo.updateTrainingRunStatus(runId, "running");
    broadcast({ type: "status", runId, status: "running" });

    const gpu = await queryGpuVram();
    const gpuFlag = gpu.available ? "0" : "-1";
    const config = typeof hyperparams.config === "string" && hyperparams.config.length > 0 ? hyperparams.config : "v2_small";
    const maxSteps = clampInt(hyperparams.max_steps, 10, 2000, 60);
    const batchSize = clampInt(hyperparams.batch_size, 1, 32, 4);
    // Guarantees at least one periodic checkpoint lands within max_steps —
    // validation is deliberately skipped (--val_every effectively disabled)
    // since RAVE's export step doesn't depend on it having run (the
    // exported model's `fidelity`/`latent_pca` buffers default to zero and
    // export.py handles that without erroring — confirmed by running it —
    // it just yields a maximally-truncated, not-yet-refined latent space,
    // which is fine for a pipeline-proof checkpoint).
    const saveEvery = Math.max(1, Math.floor(maxSteps / 2));

    await runPhase(
      runId,
      "train",
      raveBin,
      [
        "train",
        "--name",
        runId,
        "--config",
        config,
        "--db_path",
        preDir,
        "--out_path",
        runsDir,
        "--max_steps",
        String(maxSteps),
        "--val_every",
        "999999",
        "--save_every",
        String(saveEvery),
        "--n_signal",
        String(numSignal),
        "--channels",
        String(channels),
        "--batch",
        String(batchSize),
        "--workers",
        "0",
        "--gpu",
        gpuFlag,
        "--progress",
        "True",
      ],
      workDir,
      appendLog,
      heartbeatPath,
      { maxSteps },
    );

    const checkpointPath = findLatestCheckpoint(runsDir);
    const variantName = deriveVariantName(runId, params.runName);
    ensureDir(exportDir);

    await runPhase(
      runId,
      "export",
      raveBin,
      ["export", "--run", checkpointPath, "--output", exportDir, "--name", variantName],
      workDir,
      appendLog,
      heartbeatPath,
    );

    const exportedTs = path.join(exportDir, `${variantName}.ts`);
    if (!fs.existsSync(exportedTs)) {
      throw new Error(`Export finished but the expected checkpoint file wasn't found at ${exportedTs}`);
    }

    ensureDir(outputDir);
    const finalCheckpointPath = path.join(outputDir, `${variantName}.ts`);
    fs.copyFileSync(exportedTs, finalCheckpointPath);

    // Bridges the user-facing output location into the exact layout
    // servers/rave/server.py's get_model() hardcodes
    // (KWESI_MODELS_DIR/rave/<variant>/<variant>.ts) — same "symlink, not
    // copy" precedent as modelServer.ts's ensureAceStepCheckpointsLayout,
    // just pointed the other direction: the real bytes live at the user's
    // chosen output_dir (a "Save As" location, matching how
    // KWESI_EXPORTS_DIR already behaves), and the app-managed models dir
    // gets a symlink to them so the unmodified Phase 9 inference server
    // finds them with zero server.py changes. Known trade-off, documented
    // in kwesi.docs/04-roadmap.md: if the user later moves/deletes the
    // output_dir file, this symlink breaks and inference for that trained
    // variant will fail until it's restored.
    const variantDir = modelVariantDir(modelId, variantName);
    ensureDir(variantDir);
    const bridgePath = path.join(variantDir, `${variantName}.ts`);
    if (!fs.existsSync(bridgePath)) {
      fs.symlinkSync(finalCheckpointPath, bridgePath);
    }

    const diskSizeBytes = fs.statSync(finalCheckpointPath).size;
    repo.upsertTrainedModelVariant(modelId, variantName, variantDir, diskSizeBytes);
    const trainedModel = repo.createTrainedModel(modelId, runId, params.runName, finalCheckpointPath);

    repo.updateTrainingRunStatus(runId, "completed", {
      outputCheckpointId: trainedModel.id,
      completedAt: Date.now(),
      pid: null,
    });
    broadcast({ type: "completed", runId, trainedModelId: trainedModel.id, checkpointPath: finalCheckpointPath });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    appendLog(`\nERROR: ${message}\n`);
    repo.updateTrainingRunStatus(runId, "failed", { error: message, completedAt: Date.now(), pid: null });
    broadcast({ type: "failed", runId, error: message });
  } finally {
    logStream.end();
    const interval = heartbeatIntervals.get(runId);
    if (interval) clearInterval(interval);
    heartbeatIntervals.delete(runId);
    activeProcesses.delete(runId);
  }
}

export function submitTrainingRun(params: SubmitTrainingRunParams): SubmitTrainingResult {
  if (!TRAINING_VENV_BY_MODEL[params.modelId]) {
    return { ok: false, reason: `Training isn't supported for "${params.modelId}" yet.` };
  }
  if (params.datasetFiles.length === 0) {
    return { ok: false, reason: "No dataset files were provided." };
  }
  if (!params.runName.trim()) {
    return { ok: false, reason: "A run name is required." };
  }

  const trainingRun = repo.createTrainingRun(
    params.modelId,
    params.baseCheckpointVariant,
    params.runName.trim(),
    { files: params.datasetFiles.map((f) => path.basename(f)), fileCount: params.datasetFiles.length },
    params.hyperparams,
    params.outputDir,
  );

  broadcast({ type: "status", runId: trainingRun.id, status: "queued" });
  void runTrainingPipeline(params, trainingRun.id);

  return { ok: true, trainingRun };
}

export function cancelTrainingRun(runId: string): boolean {
  const proc = activeProcesses.get(runId);
  if (!proc || !proc.pid) return false;
  try {
    process.kill(proc.pid, "SIGTERM");
  } catch {
    return false;
  }
  repo.updateTrainingRunStatus(runId, "cancelled", { completedAt: Date.now(), pid: null });
  broadcast({ type: "cancelled", runId });
  return true;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Startup reconciliation, mirroring resetInterruptedDownloads's exact
 * precedent in electron/db/database.ts: any training_run row left
 * queued/preparing/running has no live orchestration behind it anymore by
 * definition (that orchestration was an async function inside the previous
 * Electron process — restarting the app doesn't resume it, only the
 * subprocess a *live* session directly spawned could theoretically survive
 * a restart, and even then nothing would ever move it to the next phase or
 * register its result). So every such row is surfaced as `interrupted`
 * unconditionally — not left stuck showing "running" forever — with a
 * best-effort kill of any orphaned process still alive at the stored pid so
 * it doesn't keep burning GPU/CPU silently in the background.
 */
export function reconcileTrainingRunsOnStartup(): void {
  const active = repo.listActiveTrainingRuns();
  for (const run of active) {
    if (run.pid && isProcessAlive(run.pid)) {
      try {
        process.kill(run.pid, "SIGTERM");
      } catch {
        // best-effort only
      }
    }
    repo.updateTrainingRunStatus(run.id, "interrupted", {
      error: "Interrupted — the app closed before this training run finished.",
      completedAt: Date.now(),
      pid: null,
    });
    console.log(`[training] run ${run.id} (${run.run_name}) was left "${run.status}" at startup -> marked interrupted`);
  }
}
