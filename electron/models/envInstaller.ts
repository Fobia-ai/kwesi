// Real, cross-platform install/check pipeline for each model's Python
// environment (KWESI_VENVS_DIR/<model_id>) -- the automated counterpart to
// what every servers/<model_id>/README.md currently documents as a
// by-hand, developer-only setup. Standardized on `uv` (already the pattern
// ace-step-1.5's own README uses) rather than plain venv/pip specifically
// because `uv venv --python <version>` fetches and manages that exact
// Python build itself when it isn't already on the machine -- the real
// answer to "deterministic, cross-platform" for models pinned to Python
// versions (3.8 for musecoco) end users are unlikely to have installed on
// their own system Python in 2026, without this app bundling a Python
// distribution of its own.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { modelsRootDir, serversRootDir, venvDir } from "../db/paths.js";
import { ensureAceStepCheckpointsLayout } from "./modelServer.js";

export interface EnvProgress {
  modelId: string;
  line: string;
}

export interface EnvStatus {
  modelId: string;
  venvExists: boolean;
  pythonVersion: string | null;
  torchAvailable: boolean;
  cudaAvailable: boolean | null; // null when torch itself isn't importable
  installable: boolean;
}

export interface EnvInstallResult {
  ok: boolean;
  reason?: string;
}

function venvPythonPath(modelId: string): string {
  const dir = venvDir(modelId);
  return process.platform === "win32" ? path.join(dir, "Scripts", "python.exe") : path.join(dir, "bin", "python");
}

function serverDir(modelId: string): string {
  return path.join(serversRootDir(), modelId);
}

function vendorDir(modelId: string): string {
  return path.join(serverDir(modelId), "vendor");
}

export type OnOutput = (line: string) => void;

/** Runs one command to completion, streaming combined stdout/stderr line-by-line. Rejects with a real, readable error on a non-zero exit. */
// CSI sequences (colours, cursor moves) plus the rarer OSC form.
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_RE = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g;

export function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; onOutput?: OnOutput } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let buffered = "";
    const onChunk = (chunk: Buffer) => {
      // uv/pip colour their output even when piped; the setup dialogs and
      // Settings > Environment showed it as raw "[36m…" escape codes.
      buffered += chunk.toString().replace(ANSI_ESCAPE_RE, "");
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop() ?? "";
      for (const line of lines) if (line.length > 0) options.onOutput?.(line);
    };
    proc.stdout?.on("data", onChunk);
    proc.stderr?.on("data", onChunk);

    proc.on("error", (err) => reject(new Error(`${command} failed to start: ${err.message}`)));
    proc.on("exit", (code) => {
      if (buffered.length > 0) options.onOutput?.(buffered);
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

async function commandVersion(command: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    let out = "";
    const proc = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    proc.stdout?.on("data", (c) => (out += c.toString()));
    proc.stderr?.on("data", (c) => (out += c.toString()));
    proc.on("error", () => resolve(null));
    proc.on("exit", (code) => resolve(code === 0 ? out.trim() : null));
  });
}

export async function checkUvAvailable(): Promise<{ available: boolean; version: string | null }> {
  const version = await commandVersion("uv", ["--version"]);
  return { available: version !== null, version };
}

export async function checkGitAvailable(): Promise<{ available: boolean; version: string | null }> {
  const version = await commandVersion("git", ["--version"]);
  return { available: version !== null, version };
}

/**
 * Best-effort, read-only inspection of one model's venv -- never mutates
 * anything. `torchAvailable`/`cudaAvailable` come from actually importing
 * torch *inside that venv's own interpreter*, not a guess from install
 * status, since a venv can exist but be broken/partial.
 */
// Read-only inspection of one venv at `python`. Shared by the inference-venv
// and training-venv status checks -- a training venv is a real venv at a
// different location (see TRAINING_VENV_BY_MODEL), inspected the exact same
// way.
async function inspectVenv(python: string, modelId: string, installable: boolean): Promise<EnvStatus> {
  const venvExists = fs.existsSync(python);
  if (!venvExists) {
    return { modelId, venvExists: false, pythonVersion: null, torchAvailable: false, cudaAvailable: null, installable };
  }

  const pythonVersion = await commandVersion(python, ["--version"]);

  const torchCheck = await new Promise<{ available: boolean; cuda: boolean } | null>((resolve) => {
    let out = "";
    const proc = spawn(python, ["-c", "import torch,json;print(json.dumps({'cuda':bool(torch.cuda.is_available())}))"], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    proc.stdout?.on("data", (c) => (out += c.toString()));
    proc.on("error", () => resolve(null));
    proc.on("exit", (code) => {
      if (code !== 0) {
        resolve({ available: false, cuda: false });
        return;
      }
      try {
        const parsed = JSON.parse(out.trim()) as { cuda: boolean };
        resolve({ available: true, cuda: parsed.cuda });
      } catch {
        resolve({ available: false, cuda: false });
      }
    });
  });

  return {
    modelId,
    venvExists: true,
    pythonVersion,
    torchAvailable: torchCheck?.available ?? false,
    cudaAvailable: torchCheck?.available ? torchCheck.cuda : null,
    installable,
  };
}

export async function checkEnvironmentStatus(modelId: string): Promise<EnvStatus> {
  return inspectVenv(venvPythonPath(modelId), modelId, isInstallableModel(modelId));
}

async function ensureGitClone(url: string, dest: string, onOutput: OnOutput, commit?: string): Promise<void> {
  if (fs.existsSync(dest)) {
    onOutput(`${dest} already exists, skipping clone`);
    return;
  }
  if (!commit) {
    await runCommand("git", ["clone", "--depth", "1", url, dest], { onOutput });
    return;
  }
  // Shallow fetch of one exact commit (GitHub serves any reachable SHA), so
  // every install gets the same code this app was verified against rather
  // than whatever upstream HEAD is that day.
  await runCommand("git", ["init", "--quiet", dest], { onOutput });
  await runCommand("git", ["-C", dest, "remote", "add", "origin", url], { onOutput });
  await runCommand("git", ["-C", dest, "fetch", "--depth", "1", "origin", commit], { onOutput });
  await runCommand("git", ["-C", dest, "checkout", "--quiet", "--detach", "FETCH_HEAD"], { onOutput });
}

// ACE-Step-1.5 is pinned: its CLI moves fast (an unpinned HEAD started
// requiring --dataset-dir/--output-dir on `train.py fixed --preprocess`).
// This is the commit inference, LoRA training, and LoRA generation were all
// verified against end-to-end. Bump deliberately, after re-verifying.
const ACE_STEP_COMMIT = "ca1e85fe9430179831e6bc6be790c332190a3866";

function uvVenv(modelId: string, pythonVersion: string, onOutput: OnOutput): Promise<void> {
  return runCommand("uv", ["venv", "--python", pythonVersion, venvDir(modelId)], { onOutput });
}

function uvPipInstall(modelId: string, args: string[], onOutput: OnOutput): Promise<void> {
  return runCommand("uv", ["pip", "install", "--python", venvPythonPath(modelId), ...args], { onOutput });
}

async function installRave(onOutput: OnOutput): Promise<void> {
  await uvVenv("rave", "3.12", onOutput);
  await uvPipInstall("rave", ["-r", path.join(serverDir("rave"), "requirements.txt")], onOutput);
}

async function installMusicgen(onOutput: OnOutput): Promise<void> {
  await uvVenv("musicgen", "3.12", onOutput);
  await uvPipInstall("musicgen", ["-r", path.join(serverDir("musicgen"), "requirements.txt")], onOutput);
  // Load-bearing --no-deps: audiocraft 1.3.0's own declared pins have no
  // Python 3.12 wheels -- see servers/musicgen/README.md.
  await uvPipInstall("musicgen", ["--no-deps", "audiocraft==1.3.0"], onOutput);
}

async function installYue2(onOutput: OnOutput): Promise<void> {
  await ensureGitClone("https://github.com/multimodal-art-projection/YuE", vendorDir("yue2"), onOutput);
  await uvVenv("yue2", "3.12", onOutput);
  await uvPipInstall("yue2", [vendorDir("yue2")], onOutput);
  await uvPipInstall("yue2", ["-r", path.join(serverDir("yue2"), "requirements.txt")], onOutput);
}

async function installMusecoco(onOutput: OnOutput): Promise<void> {
  const dest = vendorDir("musecoco");
  if (!fs.existsSync(dest)) {
    // Sparse-checkout: the real muzic repo has other models/tools in it,
    // and a full clone pulls ~140MB of history for one subfolder -- see
    // servers/musecoco/README.md's own "rebuild vendor/ from scratch".
    const tmpDir = path.join(serversRootDir(), ".tmp-muzic-clone");
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    await runCommand(
      "git",
      ["clone", "--depth", "1", "--filter=blob:none", "--sparse", "https://github.com/microsoft/muzic", tmpDir],
      { onOutput },
    );
    await runCommand("git", ["sparse-checkout", "set", "musecoco"], { cwd: tmpDir, onOutput });
    fs.mkdirSync(dest, { recursive: true });
    fs.cpSync(path.join(tmpDir, "musecoco"), dest, { recursive: true });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } else {
    onOutput(`${dest} already exists, skipping clone`);
  }

  await uvVenv("musecoco", "3.8", onOutput);
  // requirements.txt now includes torch==1.11.0 and --extra-index-url for
  // PyTorch's cu113 wheels, so one install is enough. The separate torch
  // install step that used --index-url was brittle: it hid PyPI from uv,
  // and it didn't give pytorch-fast-transformers (builds from source) the
  // torch/numpy build environment it needs in one pass.
  await uvPipInstall("musecoco", ["-r", path.join(serverDir("musecoco"), "requirements.txt")], onOutput);

  // Symlink (not copy) the checkpoint into the vendored layout the code
  // expects -- created even if the weight file doesn't exist yet (Model
  // Manager installs weights separately); server.py itself 404s with a
  // clear message at request time if the target is still missing.
  const checkpointDir = path.join(dest, "2-attribute2music_model", "checkpoints", "linear_mask-1billion");
  fs.mkdirSync(checkpointDir, { recursive: true });
  const linkPath = path.join(checkpointDir, "checkpoint_2_280000.pt");
  const targetPath = path.join(modelsRootDir(), "musecoco", "default", "attribute2music.pt");
  if (!fs.existsSync(linkPath)) {
    try {
      fs.symlinkSync(targetPath, linkPath);
      onOutput(`symlinked ${linkPath} -> ${targetPath}`);
    } catch (err) {
      onOutput(`warning: couldn't symlink checkpoint (${err instanceof Error ? err.message : err})`);
    }
  }
}

async function installMuseformer(onOutput: OnOutput): Promise<void> {
  const dest = vendorDir("museformer");
  if (!fs.existsSync(dest)) {
    // Sparse-checkout, same pattern and reasoning as installMusecoco's --
    // both are subfolders of the same microsoft/muzic monorepo.
    const tmpDir = path.join(serversRootDir(), ".tmp-muzic-clone-museformer");
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    await runCommand(
      "git",
      ["clone", "--depth", "1", "--filter=blob:none", "--sparse", "https://github.com/microsoft/muzic", tmpDir],
      { onOutput },
    );
    await runCommand("git", ["sparse-checkout", "set", "museformer"], { cwd: tmpDir, onOutput });
    fs.mkdirSync(dest, { recursive: true });
    fs.cpSync(path.join(tmpDir, "museformer"), dest, { recursive: true });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } else {
    onOutput(`${dest} already exists, skipping clone`);
  }

  // Python 3.8 to match the vendored repo's own pin (see
  // servers/museformer/README.md "Status" for the real, GPU-verified
  // install/inference story this recipe is based on).
  await uvVenv("museformer", "3.8", onOutput);
  await uvPipInstall("museformer", ["-r", path.join(serverDir("museformer"), "requirements.txt")], onOutput);
}

async function installAceStep(onOutput: OnOutput): Promise<void> {
  const dest = vendorDir("ace-step-1.5");
  await ensureGitClone("https://github.com/ace-step/ACE-Step-1.5", dest, onOutput, ACE_STEP_COMMIT);
  // Uses the vendored repo's own uv.lock as-is (see servers/ace-step-1.5/
  // README.md) rather than a hand-built requirements.txt -- only the venv
  // location is redirected, via UV_PROJECT_ENVIRONMENT, to this app's own
  // convention so venvPythonPath(modelId) keeps working unmodified.
  await runCommand("uv", ["sync"], {
    cwd: dest,
    env: { ...process.env, UV_PROJECT_ENVIRONMENT: venvDir("ace-step-1.5") },
    onOutput,
  });
  // Real symlink farm bridging this app's installed checkpoint layout onto
  // what ACE-Step's own code expects -- already implemented and used by
  // the real server-spawn path (modelServer.ts), reused as-is here so
  // install-time and runtime never drift into two different bridging
  // implementations.
  ensureAceStepCheckpointsLayout(dest);
}

export type InstallableModelId = "rave" | "musicgen" | "yue2" | "musecoco" | "ace-step-1.5" | "museformer";

const INSTALLERS: Record<InstallableModelId, (onOutput: OnOutput) => Promise<void>> = {
  rave: installRave,
  musicgen: installMusicgen,
  yue2: installYue2,
  musecoco: installMusecoco,
  "ace-step-1.5": installAceStep,
  museformer: installMuseformer,
};

export function isInstallableModel(modelId: string): modelId is InstallableModelId {
  return modelId in INSTALLERS;
}

export async function installEnvironment(modelId: string, onOutput: OnOutput): Promise<EnvInstallResult> {
  if (!isInstallableModel(modelId)) {
    return { ok: false, reason: `No install recipe for "${modelId}".` };
  }

  const uv = await checkUvAvailable();
  if (!uv.available) {
    return {
      ok: false,
      reason: "uv isn't installed. Install it from https://docs.astral.sh/uv/getting-started/installation/, then try again.",
    };
  }
  const git = await checkGitAvailable();
  if (!git.available) {
    return { ok: false, reason: "git isn't installed. Install it from your OS's package manager, then try again." };
  }

  try {
    await INSTALLERS[modelId](onOutput);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

// --- Training environments -------------------------------------------------
// Which venv each model TRAINS in. Three train in their own already-
// installable inference venv (their training tooling is satisfied by it --
// see trainingManager.ts's Phase 11 finding); RAVE alone needs a separate
// `rave-train` venv (the real acids-rave package + GPU torch, a materially
// different dependency surface -- see servers/rave/README.md). Kept here (and
// re-exported) rather than duplicated, so trainingManager.ts and this
// installer can't drift out of sync.
export const TRAINING_VENV_BY_MODEL: Record<string, string> = {
  rave: "rave-train",
  "ace-step-1.5": "ace-step-1.5",
  musicgen: "musicgen",
  musecoco: "musecoco",
};

export function isTrainableModel(modelId: string): boolean {
  return modelId in TRAINING_VENV_BY_MODEL;
}

// Status of the venv a model TRAINS in (not necessarily its inference venv).
export async function checkTrainingEnvironmentStatus(modelId: string): Promise<EnvStatus> {
  const venvName = TRAINING_VENV_BY_MODEL[modelId];
  if (!venvName) {
    return { modelId, venvExists: false, pythonVersion: null, torchAvailable: false, cudaAvailable: null, installable: false };
  }
  return inspectVenv(venvPythonPath(venvName), modelId, true);
}

// RAVE's separate training venv -- exact recipe from servers/rave/README.md's
// "Training venv" section: Python 3.11 (acids-rave's pinned scipy==1.10.0 has
// no cp312 wheel), torch/torchaudio first, then acids-rave with setuptools<81
// (load-bearing -- pytorch_lightning still imports pkg_resources, dropped by
// setuptools>=81).
async function installRaveTrain(onOutput: OnOutput): Promise<void> {
  await uvVenv("rave-train", "3.11", onOutput);
  await uvPipInstall("rave-train", ["torch==2.4.1", "torchaudio==2.4.1"], onOutput);
  await uvPipInstall("rave-train", ["pytorch_lightning==1.9.0", "setuptools<81", "acids-rave==2.3.1"], onOutput);
}

export async function installTrainingEnvironment(modelId: string, onOutput: OnOutput): Promise<EnvInstallResult> {
  const venvName = TRAINING_VENV_BY_MODEL[modelId];
  if (!venvName) return { ok: false, reason: `"${modelId}" has no training environment.` };

  const uv = await checkUvAvailable();
  if (!uv.available) {
    return {
      ok: false,
      reason: "uv isn't installed. Install it from https://docs.astral.sh/uv/getting-started/installation/, then try again.",
    };
  }

  // RAVE's training venv is its own thing; every other trainable model trains
  // in its already-installable inference venv, so just reuse that installer.
  if (venvName === "rave-train") {
    try {
      await installRaveTrain(onOutput);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }
  return installEnvironment(modelId, onOutput);
}
