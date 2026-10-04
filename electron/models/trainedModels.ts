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

export interface TrainedModelInfo extends repo.TrainedModelRow {
  variant_name: string | null;
  disk_size_bytes: number | null;
  has_preview: boolean;
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
 * - its preview clip
 * - the variant's own folder when it's separate (RAVE/MusicGen bridge their
 *   files into KWESI_MODELS_DIR/<model>/<variant>)
 */
export async function deleteTrainedModel(id: string): Promise<{ ok: boolean; reason?: string; freedBytes?: number }> {
  const tm = repo.getTrainedModelById(id);
  if (!tm) return { ok: false, reason: "That trained model no longer exists." };
  const variant = repo.getVariantForTrainedModel(tm);

  const targets = [tm.checkpoint_path];
  const preview = previewPathOf(tm, variant?.variant_name ?? null);
  if (preview) targets.push(preview);
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
