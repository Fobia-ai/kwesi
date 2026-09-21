// Phase 10 Training Job Manager — a sibling to electron/models/modelServer.ts
// (see kwesi.docs/02-architecture.md "Training pipeline architecture"). RAVE
// (this file's original body, untouched below — see runRaveTrainingPipeline)
// was Phase 10's pilot: `rave preprocess` -> `rave train` -> `rave export`,
// a real vendor CLI run across three phases.
//
// Phase 11 generalizes the *manager* (job tracking, PID/heartbeat, progress
// parsing, interrupted-run handling, checkpoint registration) to three more
// real models, each with its own real training tooling shape rather than
// forcing RAVE's exact preprocess/train/export mold:
//   - ACE-Step 1.5: `train.py fixed --preprocess` -> `train.py fixed` (its
//     own real "Side-Step" LoRA CLI vendored inside ACE-Step-1.5 itself —
//     see servers/ace-step-1.5/README.md's "Training (Phase 11)" section).
//     Two phases, no export — the LoRA adapter directory *is* the final
//     checkpoint.
//   - MusicGen: a real three-phase shape that superficially matches RAVE's
//     (manifest -> dora train -> export) but for a structurally different
//     reason — audiocraft's own `dora run` produces a full XP checkpoint
//     (optimizer/EMA state included, gigabytes), and `audiocraft.utils.
//     export.export_lm` is a real, necessary step to shrink that into the
//     deployment-shaped `state_dict.bin` this app's own
//     servers/musicgen/server.py already knows how to load — see
//     servers/musicgen/README.md's "Training (Phase 11)" section.
//   - MuseCoco: a single `fairseq-train` phase (continuing from the
//     installed checkpoint via `--restore-file`), no separate export step —
//     fairseq's own checkpoint format is already what the vendored
//     inference code loads. See servers/musecoco/README.md.
//   - Museformer: still not wired for training. Inference itself is now
//     proven real end-to-end (GPU-only — attention_impl='blocksparse' has
//     no CPU backend, confirmed not speculative), but training would need
//     its own from-scratch integration effort; see servers/museformer/
//     README.md "Training" section.
import { BrowserWindow } from "electron";
import { ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import * as repo from "../db/repositories.js";
import { ensureDir, modelVariantDir, serversRootDir, trainingRunDir, trainingVenvDir } from "../db/paths.js";
import { queryGpuVram } from "./gpuInfo.js";
import { aceStepVendorDir, ensureAceStepCheckpointsLayout } from "./modelServer.js";

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
  // Phase 11: per-clip caption text, keyed by the dataset file's basename —
  // only populated (and only meaningful) for `training.inputKind ===
  // "audio_captioned"` models (ACE-Step 1.5, MusicGen). RAVE's audio_raw
  // dataset never sends this. See Training.tsx's DatasetDropZone caption
  // table for how the renderer builds this map.
  datasetCaptions?: Record<string, string>;
}

export interface SubmitTrainingResult {
  ok: boolean;
  reason?: string;
  trainingRun?: repo.TrainingRunRow;
}

// DynamicGenerationForm/Training.tsx never let the renderer submit a run for
// a model missing here, but the main process re-checks too rather than
// trusting the renderer blindly (same posture
// resolveMelodyAudioPath/resolveRaveInputAudioPath take in modelServer.ts).
// Phase 11 real finding for both ace-step-1.5 and musicgen: neither needed a
// *separate* training venv the way RAVE did — their real training tooling
// (ACE-Step's own vendored Side-Step CLI; audiocraft's own dora/hydra/
// flashy stack) is already fully satisfied by the same venv their inference
// server already uses, confirmed by directly importing training-only
// modules from each installed venv rather than assumed. musecoco's
// `fairseq-train` console script is likewise already in its Phase 7
// inference venv. Museformer stays unmapped — see the file-header comment.
const TRAINING_VENV_BY_MODEL: Record<string, string> = {
  rave: "rave-train",
  "ace-step-1.5": "ace-step-1.5",
  musicgen: "musicgen",
  musecoco: "musecoco",
};

// Phase 11: per-model pipeline dispatch — each model's real training tooling
// has its own real phase shape (see file header), so the manager routes to
// a dedicated function per model rather than forcing every model through
// RAVE's exact preprocess/train/export three-phase body. What's actually
// shared (and reused by every one of these) is runPhase's process-spawn/
// heartbeat/log machinery below plus registerTrainedCheckpoint's completion
// bookkeeping — not the phase sequence itself.
type TrainingPipelineRunner = (params: SubmitTrainingRunParams, runId: string) => Promise<void>;

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
  // Phase 11 generalization, additive-only: every existing RAVE call site
  // omits both of these, so it keeps its exact original behavior (parse
  // only during the "train" phase, with RAVE's own tqdm regex). A non-RAVE
  // pipeline passes its own line parser (fairseq/dora/Side-Step each print
  // differently shaped progress lines) and which phase name(s) to try it
  // against.
  parseProgress?: typeof parseTrainProgress;
  progressPhases?: TrainingPhase[];
  env?: NodeJS.ProcessEnv;
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
    const proc = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
    });
    activeProcesses.set(runId, proc);
    repo.updateTrainingRunStatus(runId, phase === "preprocess" ? "preparing" : "running", { pid: proc.pid ?? null });
    writeHeartbeat(heartbeatPath, { pid: proc.pid, phase });

    const hb = setInterval(() => writeHeartbeat(heartbeatPath, { pid: proc.pid, phase }), 5000);
    heartbeatIntervals.set(runId, hb);

    let tail = "";
    let lastEmit = 0;
    const progressPhases = opts.progressPhases ?? ["train"];
    const parseProgress = opts.parseProgress ?? parseTrainProgress;

    function handleChunk(chunk: Buffer) {
      const text = chunk.toString();
      tail = (tail + text).slice(-8000);
      appendLog(text);
      if (!progressPhases.includes(phase)) return;
      const now = Date.now();
      if (now - lastEmit < 400) return;
      const segments = text.split(/\r|\n/).filter((s) => s.trim().length > 0);
      const last = segments[segments.length - 1];
      if (!last) return;
      const parsed = parseProgress(last, opts.maxSteps);
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

// --- Phase 11 shared helpers, used only by the three new pipelines below
// (ACE-Step/MusicGen/MuseCoco) — RAVE's own runTrainingPipeline (just below)
// is left with its original inline equivalents untouched, per the roadmap's
// explicit "don't touch RAVE's Phase 10 training path" constraint. ---

function stageDatasetFiles(datasetFiles: string[], allowedExtensions: string[], rawDir: string): string[] {
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
  return staged;
}

function copyDirRecursive(src: string, dest: string): void {
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirRecursive(s, d);
    else fs.copyFileSync(s, d);
  }
}

function dirSizeBytes(dir: string): number {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    total += entry.isDirectory() ? dirSizeBytes(p) : fs.statSync(p).size;
  }
  return total;
}

// Bridges a directory of real checkpoint files living at the user's chosen
// output_dir into KWESI_MODELS_DIR/<modelId>/<variantName>/ via symlinks —
// same "real bytes stay at the user's Save-As location, the app-managed
// models dir just points at them" precedent as RAVE's own bridge, just
// generalized to N files instead of exactly one .ts file.
function bridgeFilesIntoModelsRoot(modelId: string, variantName: string, sourceDir: string, filenames: string[]): string {
  const variantDir = modelVariantDir(modelId, variantName);
  ensureDir(variantDir);
  for (const name of filenames) {
    const bridgePath = path.join(variantDir, name);
    if (!fs.existsSync(bridgePath)) {
      fs.symlinkSync(path.join(sourceDir, name), bridgePath);
    }
  }
  return variantDir;
}

function openTrainingLog(workDir: string, runId: string): { logPath: string; appendLog: (text: string) => void; close: () => void } {
  const logPath = path.join(workDir, "log.txt");
  const logStream = fs.createWriteStream(logPath, { flags: "a" });
  const appendLog = (text: string) => {
    logStream.write(text);
    for (const line of text.split(/\r|\n/)) {
      if (line.trim().length > 0) broadcast({ type: "log", runId, line });
    }
  };
  return { logPath, appendLog, close: () => logStream.end() };
}

function failTrainingRun(runId: string, appendLog: (text: string) => void, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  appendLog(`\nERROR: ${message}\n`);
  repo.updateTrainingRunStatus(runId, "failed", { error: message, completedAt: Date.now(), pid: null });
  broadcast({ type: "failed", runId, error: message });
}

function cleanupTrainingRun(runId: string, close: () => void): void {
  close();
  const interval = heartbeatIntervals.get(runId);
  if (interval) clearInterval(interval);
  heartbeatIntervals.delete(runId);
  activeProcesses.delete(runId);
}

/**
 * Parses ACE-Step's own real Side-Step CLI training log lines, e.g.
 * `Epoch 1/3, Step 1, Loss: 0.3712` (confirmed against a real
 * `train.py fixed` run, not guessed — see servers/ace-step-1.5/README.md).
 * Side-Step logs per-epoch progress, not a global step/ETA the way RAVE's
 * tqdm bar does, so `pct` is derived from epoch/totalEpochs and `step` is
 * Side-Step's own running step counter (epochs * steps-per-epoch).
 */
function parseAceStepTrainProgress(
  line: string,
  maxSteps: number | undefined,
): { step: number; maxSteps?: number; pct?: number; etaText?: string; rate?: number } | null {
  const m = line.match(/Epoch\s+(\d+)\/(\d+),\s*Step\s+(\d+),\s*Loss:\s*([\d.]+)/);
  if (!m) return null;
  const epoch = Number(m[1]);
  const totalEpochs = Number(m[2]);
  const step = Number(m[3]);
  const pct = totalEpochs > 0 ? Math.min(99, Math.round((epoch / totalEpochs) * 100)) : undefined;
  return { step, maxSteps, pct };
}

/**
 * ACE-Step 1.5 LoRA training — its own real vendored "Side-Step" CLI
 * (`train.py fixed`, see servers/ace-step-1.5/README.md's "Training (Phase
 * 11)" section for the full dependency-archaeology writeup). Two real
 * phases (preprocess -> train), no export step: the LoRA adapter directory
 * `train.py` itself writes to `--output-dir/final` *is* the final
 * checkpoint, a standard PEFT adapter (`adapter_model.safetensors` +
 * `adapter_config.json`) — nothing else needs to build it.
 *
 * Real finding: ACE-Step's own `acestep/training/path_safety.py` enforces a
 * real path-injection guard (`safe_path()`) restricting every user-supplied
 * dataset/output path to resolve under the *spawned process's own cwd* at
 * import time — hit for real during Phase 11 verification, not guessed. So
 * every path handed to `train.py` here is relative to `cwd: workDir`,
 * mirroring the layout RAVE's own runPhase calls already use.
 */
async function runAceStepTrainingPipeline(params: SubmitTrainingRunParams, runId: string): Promise<void> {
  const { modelId, datasetFiles, allowedExtensions, hyperparams, outputDir, datasetCaptions } = params;
  const workDir = trainingRunDir(runId);
  ensureDir(workDir);
  const rawDir = path.join(workDir, "raw");
  const tensorDir = path.join(workDir, "tensors");
  const loraOutDir = path.join(workDir, "lora_out");
  const heartbeatPath = path.join(workDir, "heartbeat.json");
  ensureDir(rawDir);

  const { logPath, appendLog, close } = openTrainingLog(workDir, runId);
  repo.updateTrainingRunStatus(runId, "preparing", { logPath, startedAt: Date.now() });
  broadcast({ type: "status", runId, status: "preparing" });

  try {
    const staged = stageDatasetFiles(datasetFiles, allowedExtensions, rawDir);

    // ACE-Step's own real "Side-Step" CLI (train.py) reads captions/lyrics
    // from a dataset JSON (acestep/training_v2/preprocess_discovery.py's
    // load_sample_metadata) — real finding: it does NOT read the
    // .lyrics.txt/.caption.txt sidecar-file convention
    // docs/en/LoRA_Training_Tutorial.md describes; that convention is only
    // read by the separate, older Gradio-UI dataset-scan path
    // (acestep/training/dataset_builder_modules/scan.py), confirmed by
    // grepping both real code paths directly rather than assumed. Missing
    // captions fall back to the real tool's own default: filename-derived
    // caption, "[Instrumental]" lyrics, is_instrumental=true.
    const samples = staged.map((filePath) => {
      const base = path.basename(filePath);
      const caption = datasetCaptions?.[base]?.trim();
      return caption && caption.length > 0
        ? { filename: base, audio_path: base, caption, lyrics: "[Instrumental]", is_instrumental: true }
        : { filename: base, audio_path: base };
    });
    const datasetJsonPath = path.join(rawDir, "dataset.json");
    fs.writeFileSync(
      datasetJsonPath,
      JSON.stringify({ metadata: { tag_position: "prepend", genre_ratio: 0, custom_tag: "" }, samples }, null, 2),
    );

    const venvName = TRAINING_VENV_BY_MODEL[modelId];
    const python = path.join(trainingVenvDir(venvName), "bin", "python");
    if (!fs.existsSync(python)) {
      throw new Error(`ACE-Step 1.5 venv not found at ${trainingVenvDir(venvName)}. See servers/ace-step-1.5/README.md.`);
    }
    const vendorDir = aceStepVendorDir();
    const trainScript = path.join(vendorDir, "train.py");
    if (!fs.existsSync(trainScript)) {
      throw new Error(`ACE-Step training CLI not found at ${trainScript} — see servers/ace-step-1.5/README.md to clone the vendored repo.`);
    }
    // Reuses the exact same bridged checkpoint layout the inference server
    // builds (vae/Qwen3-Embedding-0.6B/<variant> as siblings) — training's
    // own _resolve_model_dir() expects the identical shape, confirmed by
    // reading acestep/training_v2/model_loader.py directly.
    const checkpointsDir = ensureAceStepCheckpointsLayout(vendorDir);

    const baseVariant = typeof hyperparams.base_variant === "string" ? hyperparams.base_variant : "turbo";
    const rank = clampInt(hyperparams.rank, 1, 256, 8);
    const alpha = clampInt(hyperparams.alpha, 1, 512, 16);
    const epochs = clampInt(hyperparams.epochs, 1, 500, 3);
    const learningRateRaw = Number(hyperparams.learning_rate);
    const learningRate = Number.isFinite(learningRateRaw) && learningRateRaw > 0 ? learningRateRaw : 0.0001;

    await runPhase(
      runId,
      "preprocess",
      python,
      [
        trainScript,
        "--plain",
        "--yes",
        "fixed",
        "--checkpoint-dir",
        checkpointsDir,
        "--model-variant",
        baseVariant,
        "--preprocess",
        "--dataset-json",
        path.relative(workDir, datasetJsonPath),
        "--tensor-output",
        path.relative(workDir, tensorDir),
        "--max-duration",
        "240",
      ],
      workDir,
      appendLog,
      heartbeatPath,
    );

    if (!fs.existsSync(tensorDir) || fs.readdirSync(tensorDir).filter((f) => f.endsWith(".pt")).length === 0) {
      throw new Error(
        "Preprocessing produced no tensor files — check that the dataset audio files are valid and readable.",
      );
    }

    repo.updateTrainingRunStatus(runId, "running");
    broadcast({ type: "status", runId, status: "running" });

    await runPhase(
      runId,
      "train",
      python,
      [
        trainScript,
        "--plain",
        "--yes",
        "fixed",
        "--checkpoint-dir",
        checkpointsDir,
        "--model-variant",
        baseVariant,
        "--dataset-dir",
        path.relative(workDir, tensorDir),
        "--output-dir",
        path.relative(workDir, loraOutDir),
        "--rank",
        String(rank),
        "--alpha",
        String(alpha),
        "--epochs",
        String(epochs),
        "--batch-size",
        "1",
        "--gradient-accumulation",
        "1",
        "--save-every",
        String(epochs),
        "--log-every",
        "1",
        "--num-workers",
        "0",
        "--lr",
        String(learningRate),
      ],
      workDir,
      appendLog,
      heartbeatPath,
      { maxSteps: epochs, progressPhases: ["train"], parseProgress: parseAceStepTrainProgress },
    );

    const finalAdapterDir = path.join(loraOutDir, "final");
    const adapterFile = path.join(finalAdapterDir, "adapter_model.safetensors");
    if (!fs.existsSync(adapterFile)) {
      throw new Error(`Training finished but no LoRA adapter was found at ${adapterFile}`);
    }

    const variantName = deriveVariantName(runId, params.runName);
    const finalOutputDir = path.join(outputDir, variantName);
    copyDirRecursive(finalAdapterDir, finalOutputDir);

    // Real, honest scope call (see file header): a LoRA adapter isn't a
    // swappable base checkpoint the way RAVE's exported .ts or MusicGen's
    // exported state_dict.bin are — it only becomes usable through ACE-
    // Step's own real POST /v1/lora/load + /v1/lora/toggle endpoints against
    // an already-loaded base model (verified for real in this phase — see
    // the README), which this app's generation screen doesn't yet expose a
    // control for. So this registers a `trained_model` row (real, visible
    // in Model Manager's "My Trained Models") but deliberately skips
    // upsertTrainedModelVariant — unlike RAVE/MusicGen, this checkpoint
    // isn't selectable from the generation screen's checkpoint picker yet.
    const trainedModel = repo.createTrainedModel(modelId, runId, params.runName, finalOutputDir);
    repo.updateTrainingRunStatus(runId, "completed", { outputCheckpointId: trainedModel.id, completedAt: Date.now(), pid: null });
    broadcast({ type: "completed", runId, trainedModelId: trainedModel.id, checkpointPath: finalOutputDir });
  } catch (err) {
    failTrainingRun(runId, appendLog, err);
  } finally {
    cleanupTrainingRun(runId, close);
  }
}

/**
 * Parses audiocraft/dora/flashy's own real training log line, e.g.
 * `Train Summary | Epoch 1 | lr=3.75E-04 | grad_norm=1.681E+01 | ce=0.176 |
 * ppl=1.193 | duration=7.884` (confirmed against a real `dora run` — see
 * servers/musicgen/README.md). audiocraft counts epochs, not global steps —
 * `step` here is the epoch number, `maxSteps` is optim.epochs.
 */
function parseMusicGenTrainProgress(
  line: string,
  maxSteps: number | undefined,
): { step: number; maxSteps?: number; pct?: number; etaText?: string; rate?: number } | null {
  const m = line.match(/Train Summary \| Epoch (\d+) \|/);
  if (!m) return null;
  const epoch = Number(m[1]);
  const pct = maxSteps ? Math.min(99, Math.round((epoch / maxSteps) * 100)) : undefined;
  return { step: epoch, maxSteps, pct };
}

const MUSICGEN_XP_LOG_RE = /All XP logs are stored in (\S+)/;

/**
 * MusicGen fine-tuning — Meta AudioCraft's own real `dora`/`hydra`-based
 * training CLI (`audiocraft.train`, run via the `dora` console script; see
 * servers/musicgen/README.md's "Training (Phase 11)" section for the full
 * dependency-archaeology writeup, including two real bugs hit and fixed:
 * pip-installed audiocraft ships no Hydra `config/` tree at all (vendored
 * separately, see below), and `dora run` — not `python -m audiocraft.train`
 * directly — is required or a real GlobalHydra double-init bug is hit.
 *
 * Three real phases, for a genuinely different reason than RAVE's: (1)
 * `audiocraft.data.audio_dataset` builds the real dataset manifest audiocraft
 * itself needs (a `data.jsonl` of audio paths); (2) `dora run` trains and
 * produces a real but huge (~9GB) XP checkpoint carrying full optimizer/EMA
 * state, not a deployment artifact; (3) `audiocraft.utils.export.export_lm`
 * (a real, necessary step per the vendored repo's own
 * docs/MUSICGEN.md "Importing / Exporting models" section) shrinks that down
 * to the `state_dict.bin` shape this app's own servers/musicgen/server.py
 * already knows how to load via `MusicGen.get_pretrained()`.
 */
async function runMusicGenTrainingPipeline(params: SubmitTrainingRunParams, runId: string): Promise<void> {
  const { modelId, datasetFiles, allowedExtensions, hyperparams, outputDir, datasetCaptions } = params;
  const workDir = trainingRunDir(runId);
  ensureDir(workDir);
  const rawDir = path.join(workDir, "raw");
  const egsDir = path.join(workDir, "egs");
  const doraDir = path.join(workDir, "dora");
  const heartbeatPath = path.join(workDir, "heartbeat.json");
  ensureDir(rawDir);
  ensureDir(egsDir);

  const { logPath, appendLog, close } = openTrainingLog(workDir, runId);
  repo.updateTrainingRunStatus(runId, "preparing", { logPath, startedAt: Date.now() });
  broadcast({ type: "status", runId, status: "preparing" });

  try {
    const staged = stageDatasetFiles(datasetFiles, allowedExtensions, rawDir);

    // MusicGen's own MusicDataset (audiocraft/data/music_dataset.py) reads
    // per-clip captions from a same-named .json sidecar — a real, required
    // dataset shape (audio + text caption per clip), meaningfully different
    // from RAVE's audio-only dataset. Missing captions fall back to a
    // filename-derived description rather than blocking the run, matching
    // this app's "steer, don't hard-block" posture elsewhere.
    for (const filePath of staged) {
      const base = path.basename(filePath);
      const stem = base.slice(0, base.length - path.extname(base).length);
      const caption = datasetCaptions?.[base]?.trim() || stem.replace(/[_-]+/g, " ");
      const sidecar = {
        key: null,
        artist: null,
        sample_rate: null,
        file_extension: path.extname(base).slice(1),
        description: caption,
        keywords: [],
        duration: null,
        bpm: null,
        genre: null,
        title: stem,
        name: stem,
        instrument: null,
        moods: [],
      };
      fs.writeFileSync(path.join(rawDir, `${stem}.json`), JSON.stringify(sidecar));
    }

    const venvName = TRAINING_VENV_BY_MODEL[modelId];
    const venvDir = trainingVenvDir(venvName);
    const python = path.join(venvDir, "bin", "python");
    const dora = path.join(venvDir, "bin", "dora");
    if (!fs.existsSync(python) || !fs.existsSync(dora)) {
      throw new Error(`MusicGen venv not found at ${venvDir} (expected dora console script). See servers/musicgen/README.md.`);
    }

    // Real finding: the pip-installed `audiocraft` package ships no Hydra
    // config/ tree at all (only under github.com/facebookresearch/audiocraft,
    // outside the package's own site-packages install) — vendored once into
    // servers/musicgen/vendor/config/ (gitignored, documented reproduction
    // command in the README) and bridged here via a symlink alongside the
    // installed `audiocraft` package, since `audiocraft/train.py`'s own
    // `@hydra_main(config_path='../config', ...)` resolves relative to its
    // own file location. Idempotent — only created once per venv.
    const vendorConfigDir = path.join(serversRootDir(), "musicgen", "vendor", "config");
    if (!fs.existsSync(vendorConfigDir)) {
      throw new Error(`MusicGen training config not vendored at ${vendorConfigDir} — see servers/musicgen/README.md.`);
    }
    const sitePackagesConfigLink = path.join(venvDir, "lib", pythonLibDirName(venvDir), "site-packages", "config");
    if (!fs.existsSync(sitePackagesConfigLink)) {
      try {
        fs.symlinkSync(vendorConfigDir, sitePackagesConfigLink, "dir");
      } catch (err) {
        throw new Error(
          `Could not bridge MusicGen's training config into ${sitePackagesConfigLink}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    const manifestPath = path.join(egsDir, "data.jsonl");
    await runPhase(
      runId,
      "preprocess",
      python,
      ["-m", "audiocraft.data.audio_dataset", rawDir, manifestPath],
      workDir,
      appendLog,
      heartbeatPath,
    );
    if (!fs.existsSync(manifestPath) || fs.statSync(manifestPath).size === 0) {
      throw new Error("Manifest generation produced no entries — check the dataset audio files are valid.");
    }

    // A per-run dset config, written directly into the vendored config tree
    // (config/dset/audio/<runId>.yaml) — Hydra's config_path is fixed to
    // that directory, so a per-run dset override has nowhere else to live.
    // Generated data, not vendored code; harmless alongside the real files.
    const dsetName = `kwesi_run_${runId.replace(/[^a-zA-Z0-9]/g, "")}`;
    const dsetYamlPath = path.join(vendorConfigDir, "dset", "audio", `${dsetName}.yaml`);
    ensureDir(path.dirname(dsetYamlPath));
    fs.writeFileSync(
      dsetYamlPath,
      [
        "# @package __global__",
        "datasource:",
        "  max_sample_rate: 32000",
        "  max_channels: 2",
        `  train: ${egsDir}`,
        `  valid: ${egsDir}`,
        `  evaluate: ${egsDir}`,
        `  generate: ${egsDir}`,
        "",
      ].join("\n"),
    );

    repo.updateTrainingRunStatus(runId, "running");
    broadcast({ type: "status", runId, status: "running" });

    const baseVariant = typeof hyperparams.base_variant === "string" ? hyperparams.base_variant : "small";
    const epochs = clampInt(hyperparams.epochs, 1, 20, 1);
    const learningRateRaw = Number(hyperparams.learning_rate);
    const batchSize = clampInt(hyperparams.batch_size, 1, 8, 1);

    let xpDir: string | null = null;
    const captureXpDir = (text: string) => {
      if (xpDir) return;
      const m = text.match(MUSICGEN_XP_LOG_RE);
      if (m) xpDir = m[1];
    };
    const appendLogAndCapture = (text: string) => {
      captureXpDir(text);
      appendLog(text);
    };

    await runPhase(
      runId,
      "train",
      dora,
      [
        "-P",
        "audiocraft",
        "run",
        "solver=musicgen/musicgen_base_32khz",
        `model/lm/model_scale=${baseVariant}`,
        // Real finding: this app's already-installed MusicGen checkpoints
        // (downloaded by Model Manager) are audiocraft's *exported/
        // deployment* format — export.export_lm/export_pretrained_
        // compression_model's own output shape, confirmed by reading
        // audiocraft/solvers/compression.py directly after hitting a real
        // `'exported' not in state` assertion. continue_from/
        // compression_model_checkpoint need the raw *XP* format instead, so
        // this fetches it fresh via audiocraft's own `//pretrained/` alias
        // (downloads into the shared Hugging Face cache on first use per
        // model scale — a real, one-time network dependency distinct from
        // this app's own already-downloaded weights).
        `continue_from=//pretrained/facebook/musicgen-${baseVariant}`,
        "compression_model_checkpoint=//pretrained/facebook/encodec_32khz",
        "conditioner=text2music",
        `dset=audio/${dsetName}`,
        `dataset.batch_size=${batchSize}`,
        "dataset.num_workers=0",
        `optim.epochs=${epochs}`,
        `dataset.train.num_samples=${staged.length}`,
        `dataset.valid.num_samples=${Math.max(1, Math.min(2, staged.length))}`,
        "dataset.generate.num_samples=1",
        // Real finding: prompted-sample generation asserts prompt_duration <
        // gen_duration, and both derive from dataset.generate.segment_duration
        // — for this app's short pipeline-proof clips that assertion can
        // fail, so prompted samples are skipped; unprompted (caption-only)
        // samples still run and prove real end-to-end generation.
        "generate.lm.prompted_samples=false",
        "logging.log_updates=1",
        ...(Number.isFinite(learningRateRaw) && learningRateRaw > 0 ? [`optim.lr=${learningRateRaw}`] : []),
      ],
      workDir,
      appendLogAndCapture,
      heartbeatPath,
      { maxSteps: epochs, progressPhases: ["train"], parseProgress: parseMusicGenTrainProgress, env: { AUDIOCRAFT_DORA_DIR: doraDir } },
    );

    if (!xpDir) throw new Error("Could not determine the dora XP directory from training output.");
    const checkpointPath = path.join(xpDir, "checkpoint.th");
    if (!fs.existsSync(checkpointPath)) throw new Error(`Training finished but no checkpoint was found at ${checkpointPath}`);

    repo.updateTrainingRunStatus(runId, "running");
    const exportDir = path.join(workDir, "export");
    ensureDir(exportDir);
    const exportScriptPath = path.join(workDir, "export.py");
    // Real finding: torch 2.6 changed torch.load's weights_only default to
    // True, which breaks audiocraft's own export.py (it torch.load()s a
    // package containing an OmegaConf DictConfig) — this is our own
    // just-written, fully-trusted checkpoint, so weights_only=False here is
    // safe and correct, not a security relaxation on untrusted input.
    fs.writeFileSync(
      exportScriptPath,
      [
        "import torch",
        "_orig_load = torch.load",
        "def _patched_load(*a, **kw):",
        "    kw.setdefault('weights_only', False)",
        "    return _orig_load(*a, **kw)",
        "torch.load = _patched_load",
        "from audiocraft.utils import export",
        `export.export_lm(${JSON.stringify(checkpointPath)}, ${JSON.stringify(path.join(exportDir, "state_dict.bin"))})`,
        `export.export_pretrained_compression_model("facebook/encodec_32khz", ${JSON.stringify(path.join(exportDir, "compression_state_dict.bin"))})`,
        "print('export complete')",
      ].join("\n"),
    );
    await runPhase(runId, "export", python, [exportScriptPath], workDir, appendLog, heartbeatPath);

    const exportedStateDict = path.join(exportDir, "state_dict.bin");
    if (!fs.existsSync(exportedStateDict)) throw new Error(`Export finished but no state_dict.bin was found at ${exportedStateDict}`);

    const variantName = deriveVariantName(runId, params.runName);
    const finalOutputDir = path.join(outputDir, variantName);
    copyDirRecursive(exportDir, finalOutputDir);

    const variantDir = bridgeFilesIntoModelsRoot(modelId, variantName, finalOutputDir, ["state_dict.bin", "compression_state_dict.bin"]);
    const diskSizeBytes = dirSizeBytes(finalOutputDir);
    repo.upsertTrainedModelVariant(modelId, variantName, variantDir, diskSizeBytes);
    const trainedModel = repo.createTrainedModel(modelId, runId, params.runName, finalOutputDir);
    repo.updateTrainingRunStatus(runId, "completed", { outputCheckpointId: trainedModel.id, completedAt: Date.now(), pid: null });
    broadcast({ type: "completed", runId, trainedModelId: trainedModel.id, checkpointPath: finalOutputDir });
  } catch (err) {
    failTrainingRun(runId, appendLog, err);
  } finally {
    cleanupTrainingRun(runId, close);
  }
}

/**
 * Parses fairseq's own real training log line, e.g.
 * `epoch 001:      1 / 4 loss=8.427, ppl=343.98, wps=12.3, ...` (fairseq's
 * simple log format, `--log-format simple`) — confirmed against a real
 * `fairseq-train` run continuing from MuseCoco's installed checkpoint (see
 * servers/musecoco/README.md).
 */
function parseMuseCocoTrainProgress(
  line: string,
  maxSteps: number | undefined,
): { step: number; maxSteps?: number; pct?: number; etaText?: string; rate?: number } | null {
  const m = line.match(/epoch\s+(\d+):\s*(\d+)\s*\/\s*(\d+)\s*loss=([\d.]+)/);
  if (!m) return null;
  const step = Number(m[2]);
  const totalSteps = Number(m[3]);
  const pct = totalSteps > 0 ? Math.min(99, Math.round((step / totalSteps) * 100)) : undefined;
  return { step, maxSteps, pct };
}

/**
 * MuseCoco full fine-tune — the real vendored `fairseq-train` console
 * script (`servers/musecoco/vendor/2-attribute2music_model`'s own real
 * `linear_mask` fairseq user-dir task/arch, the same code Phase 7's
 * inference already loads), continuing from the installed checkpoint via
 * `--restore-file` + `--reset-optimizer --reset-dataloader
 * --reset-lr-scheduler --reset-meters` (a real fine-tune, not resuming the
 * original XP's own optimizer state/step count). One real phase — unlike
 * RAVE/ACE-Step/MusicGen, fairseq's own checkpoint format needs no preprocess
 * or export step: it's already what the vendored inference server loads.
 *
 * Real, honestly-documented limitation: the vendored `2-attribute2music_
 * dataprepare/` MIDI->attribute-sequence extraction pipeline is real and
 * exists (confirmed by reading it), but is not wired into this pipeline —
 * this phase's `--dataset-dir` input is a pre-binarized fairseq `data-bin`
 * directory (dict.txt + .bin/.idx files, the same real shape the vendored
 * repo's own example dataset already ships), not raw MIDI files, since
 * building the full extraction pipeline's own dependency surface was judged
 * out of this phase's time budget given MuseCoco's own explicit lower
 * priority in the roadmap. See servers/musecoco/README.md for the exact gap
 * and what a future phase would need to close it.
 */
async function runMuseCocoTrainingPipeline(params: SubmitTrainingRunParams, runId: string): Promise<void> {
  const { modelId, datasetFiles, hyperparams, outputDir } = params;
  const workDir = trainingRunDir(runId);
  ensureDir(workDir);
  const heartbeatPath = path.join(workDir, "heartbeat.json");

  const { logPath, appendLog, close } = openTrainingLog(workDir, runId);
  repo.updateTrainingRunStatus(runId, "preparing", { logPath, startedAt: Date.now() });
  broadcast({ type: "status", runId, status: "preparing" });

  try {
    // The dataset "files" here are a single fairseq data-bin directory
    // picked via the same native folder dialog Training.tsx's dataset
    // drop-zone already has for files (see that screen's MuseCoco-specific
    // branch) — datasetFiles[0] is that directory's path, not an audio/MIDI
    // file, per this pipeline's documented scope cut above.
    const dataBinDir = datasetFiles[0];
    if (!dataBinDir || !fs.existsSync(path.join(dataBinDir, "dict.txt"))) {
      throw new Error(`Expected a fairseq data-bin directory (with dict.txt) at ${dataBinDir}`);
    }
    const commandPath = path.dirname(dataBinDir);

    const venvName = TRAINING_VENV_BY_MODEL[modelId];
    const venvDir = trainingVenvDir(venvName);
    const fairseqTrain = path.join(venvDir, "bin", "fairseq-train");
    if (!fs.existsSync(fairseqTrain)) {
      throw new Error(`MuseCoco venv not found at ${venvDir} (expected fairseq-train). See servers/musecoco/README.md.`);
    }
    const vendorModelDir = path.join(serversRootDir(), "musecoco", "vendor", "2-attribute2music_model");
    const restoreFrom = path.join(vendorModelDir, "checkpoints", "linear_mask-1billion", "checkpoint_2_280000.pt");
    if (!fs.existsSync(restoreFrom)) {
      throw new Error(`MuseCoco base checkpoint not found at ${restoreFrom}. See servers/musecoco/README.md.`);
    }

    repo.updateTrainingRunStatus(runId, "running");
    broadcast({ type: "status", runId, status: "running" });

    const maxUpdates = clampInt(hyperparams.max_updates, 1, 2000, 10);
    const learningRateRaw = Number(hyperparams.learning_rate);
    const learningRate = Number.isFinite(learningRateRaw) && learningRateRaw > 0 ? learningRateRaw : 1e-6;
    const saveDir = path.join(workDir, "checkpoints");

    await runPhase(
      runId,
      "train",
      fairseqTrain,
      [
        dataBinDir,
        "--user-dir",
        "linear_mask",
        "--task",
        "language_modeling_control",
        "--arch",
        "linear_transformer_lm_1billion",
        "--command_path",
        commandPath,
        "--truncated_length",
        "2560",
        "--command_mask_prob",
        "-1",
        "--sample-break-mode",
        "eos",
        "--tokens-per-sample",
        "10000000",
        "--max-tokens",
        "10000000",
        "--batch-size",
        "1",
        "--batch-size-valid",
        "1",
        "--update-freq",
        "1",
        "--optimizer",
        "adam",
        "--adam-betas",
        "(0.9, 0.98)",
        "--adam-eps",
        "1e-9",
        "--weight-decay",
        "0.01",
        "--lr",
        String(learningRate),
        "--lr-scheduler",
        "fixed",
        "--log-format",
        "simple",
        "--log-interval",
        "1",
        "--num-workers",
        "0",
        "--max-update",
        String(maxUpdates),
        "--validate-interval",
        "100000000",
        "--save-interval-updates",
        String(maxUpdates),
        "--save-dir",
        saveDir,
        "--no-epoch-checkpoints",
        "--restore-file",
        restoreFrom,
        "--reset-optimizer",
        "--reset-dataloader",
        "--reset-lr-scheduler",
        "--reset-meters",
        "--cpu",
      ],
      vendorModelDir,
      appendLog,
      heartbeatPath,
      { maxSteps: maxUpdates, progressPhases: ["train"], parseProgress: parseMuseCocoTrainProgress, env: { MKL_THREADING_LAYER: "GNU" } },
    );

    const checkpointFile = fs.existsSync(path.join(saveDir, "checkpoint_last.pt"))
      ? path.join(saveDir, "checkpoint_last.pt")
      : path.join(saveDir, `checkpoint_1_${maxUpdates}.pt`);
    if (!fs.existsSync(checkpointFile)) {
      throw new Error(`Training finished but no checkpoint was found under ${saveDir}`);
    }

    const variantName = deriveVariantName(runId, params.runName);
    const finalOutputPath = path.join(outputDir, `${variantName}.pt`);
    ensureDir(outputDir);
    fs.copyFileSync(checkpointFile, finalOutputPath);

    // Real, honest scope call, same posture as ACE-Step's LoRA: this
    // fine-tuned checkpoint is a real fairseq training checkpoint (full
    // model + optimizer state, loadable by fairseq's own checkpoint_utils),
    // but servers/musecoco/server.py's inference path hardcodes the
    // installed checkpoint's path/name rather than accepting a variant
    // parameter — wiring a trained MuseCoco checkpoint back into the
    // generation screen's checkpoint picker is real, follow-up work, not
    // done here. Registers a `trained_model` row only.
    const trainedModel = repo.createTrainedModel(modelId, runId, params.runName, finalOutputPath);
    repo.updateTrainingRunStatus(runId, "completed", { outputCheckpointId: trainedModel.id, completedAt: Date.now(), pid: null });
    broadcast({ type: "completed", runId, trainedModelId: trainedModel.id, checkpointPath: finalOutputPath });
  } catch (err) {
    failTrainingRun(runId, appendLog, err);
  } finally {
    cleanupTrainingRun(runId, close);
  }
}

const PIPELINE_RUNNERS: Record<string, TrainingPipelineRunner> = {
  rave: runTrainingPipeline,
  "ace-step-1.5": runAceStepTrainingPipeline,
  musicgen: runMusicGenTrainingPipeline,
  musecoco: runMuseCocoTrainingPipeline,
};

function pythonLibDirName(venvDir: string): string {
  const libDir = path.join(venvDir, "lib");
  const entries = fs.existsSync(libDir) ? fs.readdirSync(libDir) : [];
  const pyDir = entries.find((e) => /^python3\.\d+$/.test(e));
  if (!pyDir) throw new Error(`Could not find a python3.x directory under ${libDir}`);
  return pyDir;
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
  const pipeline = PIPELINE_RUNNERS[params.modelId];
  void pipeline(params, trainingRun.id);

  return { ok: true, trainingRun };
}

// A training subprocess is exactly the kind of long CUDA/C-extension call
// that often doesn't act on SIGTERM until that call returns, which can be
// minutes away -- escalate to SIGKILL rather than waiting indefinitely.
const TRAINING_SHUTDOWN_GRACE_MS = 8_000;

/**
 * Real bug this fixes: this used to send SIGTERM and immediately mark the
 * run "cancelled" in the DB regardless of whether the process had actually
 * died -- so a cancelled run's real CPU/GPU work (and whatever VRAM it
 * held) kept running completely untouched, and the app had no way left to
 * know about it since its own bookkeeping already considered the run gone.
 * Now waits for the real "exit" event before reporting cancelled, escalating
 * to SIGKILL if the process hasn't responded to SIGTERM within a grace
 * period. Also signals the whole process group (negative pid), not just the
 * spawned leader -- runPhase spawns with `detached: true`, so a worker
 * process it forked (e.g. a dataloader) would otherwise survive as an
 * orphan holding resources this app no longer tracks at all.
 */
export async function cancelTrainingRun(runId: string): Promise<boolean> {
  const proc = activeProcesses.get(runId);
  if (!proc || !proc.pid) return false;

  const exited = new Promise<void>((resolve) => proc.once("exit", () => resolve()));

  try {
    process.kill(-proc.pid, "SIGTERM");
  } catch {
    return false;
  }

  const exitedInTime = await Promise.race([
    exited.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), TRAINING_SHUTDOWN_GRACE_MS)),
  ]);

  if (!exitedInTime) {
    console.warn(`[training ${runId}] didn't exit ${TRAINING_SHUTDOWN_GRACE_MS}ms after SIGTERM -- sending SIGKILL`);
    try {
      process.kill(-proc.pid, "SIGKILL");
    } catch {
      // already gone
    }
    await exited;
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
