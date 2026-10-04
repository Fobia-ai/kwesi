/**
 * Managing individual trained models after their run: listing them with
 * their size, deleting one (files + DB rows), and revealing one on disk.
 * Settings > Reset "Trained Models" is the all-at-once counterpart.
 */
import fs from "node:fs";
import path from "node:path";
import { shell } from "electron";
import * as repo from "../db/repositories.js";
import { pathContentBytes } from "../lib/fsSize.js";
import { forgetTrainedCheckpoint } from "./modelServer.js";

export interface ContinueInfo {
  resumable: boolean;
  reason?: string;
  // Hyperparameters a continued run must keep (model size, LoRA shape, RAVE
  // config) -- the form locks these to the source's values.
  locked: Record<string, string | number>;
  // RAVE counts steps across runs: the source's total so far.
  totalSteps?: number;
}

export interface TrainedModelInfo extends repo.TrainedModelRow {
  variant_name: string | null;
  disk_size_bytes: number | null;
  has_preview: boolean;
  continue_info: ContinueInfo;
}

/**
 * RAVE's resume material, kept beside its exported model: the training
 * checkpoint plus the run's config.gin, which `rave train --ckpt` looks for
 * next to the checkpoint. A folder per model, so several RAVE models saved
 * to one output folder don't share a config.gin.
 */
export function raveResumeDir(outputDir: string, variantName: string): string {
  return path.join(outputDir, `${variantName}.resume`);
}

export function raveResumeCheckpointPath(outputDir: string, variantName: string): string {
  return path.join(raveResumeDir(outputDir, variantName), "last.ckpt");
}

function runHyperparams(runId: string): Record<string, unknown> {
  try {
    return JSON.parse(repo.getTrainingRunById(runId)?.hyperparams ?? "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Total RAVE steps behind a model, following the chain of runs it continued from. */
function raveTotalSteps(tm: repo.TrainedModelRow, depth = 0): number {
  const run = repo.getTrainingRunById(tm.training_run_id);
  const own = Number(runHyperparams(tm.training_run_id).max_steps) || 0;
  const source = run?.base_checkpoint_variant && depth < 50 ? findTrainedByVariant(tm.base_model_id, run.base_checkpoint_variant) : null;
  return own + (source ? raveTotalSteps(source, depth + 1) : 0);
}

function findTrainedByVariant(modelId: string, variantName: string): repo.TrainedModelRow | null {
  return repo.listTrainedModels(modelId).find((t) => variantName.endsWith(`-${t.training_run_id.slice(0, 8)}`)) ?? null;
}

/**
 * Whether a trained model can be trained further, and what the new run has
 * to keep. Derived from the source run's own settings, so models trained
 * before this existed work too -- except RAVE ones, which need the
 * training checkpoint that only newer runs keep.
 */
export function continueInfoFor(tm: repo.TrainedModelRow, variantName: string | null): ContinueInfo {
  const hp = runHyperparams(tm.training_run_id);
  switch (tm.base_model_id) {
    case "musicgen":
      return { resumable: true, locked: { base_variant: String(hp.base_variant ?? "small") } };
    case "ace-step-1.5":
      return {
        resumable: true,
        locked: {
          base_variant: String(hp.base_variant ?? "turbo"),
          rank: Number(hp.rank ?? 8),
          alpha: Number(hp.alpha ?? 16),
        },
      };
    case "musecoco":
      return { resumable: true, locked: {} };
    case "rave": {
      const resumeDir = variantName ? raveResumeDir(path.dirname(tm.checkpoint_path), variantName) : null;
      if (!resumeDir || !fs.existsSync(path.join(resumeDir, "last.ckpt")) || !fs.existsSync(path.join(resumeDir, "config.gin"))) {
        return { resumable: false, reason: "Trained before RAVE runs kept their training checkpoint.", locked: {} };
      }
      return { resumable: true, locked: { config: String(hp.config ?? "v2_small") }, totalSteps: raveTotalSteps(tm) };
    }
    default:
      return { resumable: false, reason: "This model can't be trained further.", locked: {} };
  }
}

/**
 * Everything a pipeline needs to continue from a trained model, resolved
 * from the DB by id (never from paths the renderer sends).
 */
export interface ContinueSource extends ContinueInfo {
  trainedModel: repo.TrainedModelRow;
  variantName: string;
  // The checkpoint the trainer resumes: MusicGen export folder, ACE-Step
  // adapter folder, MuseCoco .pt, or RAVE's .ckpt.
  resumePath: string;
}

export function resolveContinueSource(trainedModelId: string, modelId: string): ContinueSource {
  const tm = repo.getTrainedModelById(trainedModelId);
  if (!tm || tm.base_model_id !== modelId) throw new Error("The model to continue from no longer exists.");
  const variantName = repo.getVariantForTrainedModel(tm)?.variant_name;
  if (!variantName) throw new Error(`${tm.display_name} isn't registered as a checkpoint anymore.`);
  const info = continueInfoFor(tm, variantName);
  if (!info.resumable) throw new Error(info.reason ?? `${tm.display_name} can't be trained further.`);
  const resumePath =
    modelId === "rave" ? raveResumeCheckpointPath(path.dirname(tm.checkpoint_path), variantName) : tm.checkpoint_path;
  if (!fs.existsSync(resumePath)) throw new Error(`${tm.display_name}'s files are missing (${resumePath}).`);
  return { ...info, trainedModel: tm, variantName, resumePath };
}

/**
 * The preview clip made at the end of a run, beside the model in its output
 * folder. Every pipeline saves its model as <outputDir>/<variantName>[.ext],
 * so it's derivable from either side.
 */
export function trainedPreviewPath(outputDir: string, variantName: string): string {
  return path.join(outputDir, `${variantName}.preview.wav`);
}

function previewPathOf(tm: repo.TrainedModelRow, variantName: string | null): string | null {
  return variantName ? trainedPreviewPath(path.dirname(tm.checkpoint_path), variantName) : null;
}

export function listTrainedModelsWithSize(modelId?: string): TrainedModelInfo[] {
  return repo.listTrainedModels(modelId).map((tm) => {
    const variant = repo.getVariantForTrainedModel(tm);
    const preview = previewPathOf(tm, variant?.variant_name ?? null);
    return {
      ...tm,
      variant_name: variant?.variant_name ?? null,
      disk_size_bytes: variant?.disk_size_bytes ?? null,
      has_preview: preview !== null && fs.existsSync(preview),
      continue_info: continueInfoFor(tm, variant?.variant_name ?? null),
    };
  });
}

/** The preview's bytes, for the renderer to play (it can't read outside the workspaces folder). */
export async function readTrainedPreview(id: string): Promise<Uint8Array | null> {
  const tm = repo.getTrainedModelById(id);
  if (!tm) return null;
  const preview = previewPathOf(tm, repo.getVariantForTrainedModel(tm)?.variant_name ?? null);
  if (!preview || !fs.existsSync(preview)) return null;
  return new Uint8Array(await fs.promises.readFile(preview));
}

/**
 * Deletes exactly the files the run produced -- never the output folder a
 * user picked, which is only removed if deleting left it empty:
 * - the checkpoint itself (RAVE .ts / MuseCoco .pt file, or the MusicGen
 *   export / ACE-Step adapter folder the run created)
 * - its preview clip and RAVE training checkpoint
 * - the variant's own folder when it's separate (RAVE/MusicGen bridge their
 *   files into KWESI_MODELS_DIR/<model>/<variant>)
 */
export async function deleteTrainedModel(id: string): Promise<{ ok: boolean; reason?: string; freedBytes?: number }> {
  const tm = repo.getTrainedModelById(id);
  if (!tm) return { ok: false, reason: "That trained model no longer exists." };
  const variant = repo.getVariantForTrainedModel(tm);

  const targets = [tm.checkpoint_path];
  // Its preview clip and (RAVE) training checkpoint sit beside it as
  // <variantName>.<suffix>; variant names are unique per run.
  const outputDir = path.dirname(tm.checkpoint_path);
  const variantName = variant?.variant_name;
  if (variantName && fs.existsSync(outputDir)) {
    for (const entry of fs.readdirSync(outputDir)) {
      const full = path.join(outputDir, entry);
      if (entry.startsWith(`${variantName}.`) && !targets.includes(full)) targets.push(full);
    }
  }
  if (variant?.install_path && path.resolve(variant.install_path) !== path.resolve(tm.checkpoint_path)) {
    targets.push(variant.install_path);
  }

  let freedBytes = 0;
  for (const target of targets) {
    await forgetTrainedCheckpoint(tm.base_model_id, target);
    freedBytes += (await pathContentBytes(target)) ?? 0;
  }
  try {
    for (const target of targets) fs.rmSync(target, { recursive: true, force: true });
  } catch (err) {
    return { ok: false, reason: `Couldn't delete the files: ${err instanceof Error ? err.message : err}` };
  }
  try {
    fs.rmdirSync(path.dirname(tm.checkpoint_path)); // the run's output folder, only if now empty
  } catch {
    // not empty (the user's own folder, or other runs in it) -- leave it
  }

  repo.deleteTrainedModelRows(tm, variant?.id ?? null);
  return { ok: true, freedBytes };
}

export function revealTrainedModel(id: string): { ok: boolean } {
  const tm = repo.getTrainedModelById(id);
  if (!tm || !fs.existsSync(tm.checkpoint_path)) return { ok: false };
  shell.showItemInFolder(tm.checkpoint_path);
  return { ok: true };
}
