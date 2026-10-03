/**
 * Disk-space check for a training run, before it starts. A run writes two
 * things: temporary work files under its run dir (KWESI_LOGS_DIR/training/
 * <runId>, pruned to log.txt when it ends) and the trained model it keeps in
 * the output folder. Running out of either fails late and messily, so the
 * form shows this up front and submitTrainingRun refuses a run that won't fit.
 *
 * Sizes are estimates from real runs on this app (see the README training
 * sections), scaled where a hyperparameter changes them.
 */
import fs from "node:fs";
import path from "node:path";
import { logsRootDir } from "../db/paths.js";
import { formatBytes, getFreeBytes } from "./diskSpace.js";
import { queryGpuVram } from "./gpuInfo.js";
import { musecocoCudaKernelBuilt } from "./musecocoGpu.js";

const GB = 1024 ** 3;
const MB = 1024 ** 2;
const MARGIN = 1.1;

// MuseCoco on the GPU trains with Adafactor (no Adam state) -- see
// runMuseCocoTrainingPipeline for the 16GB free-VRAM rule this mirrors.
const MUSECOCO_GPU_MIN_FREE_GB = 16;

export interface TrainingDiskParams {
  modelId: string;
  outputDir: string;
  hyperparams: Record<string, unknown>;
  datasetBytes: number;
}

export interface DiskLocation {
  path: string;
  freeBytes: number | null;
  neededBytes: number;
}

export interface TrainingDiskCheck {
  ok: boolean;
  sameDisk: boolean;
  work: DiskLocation;
  output: DiskLocation;
  message: string;
}

interface Estimate {
  workBytes: number;
  outputBytes: number;
  // MuseCoco's checkpoint is renamed from the work dir into the output
  // folder, so on one disk it only needs the space once.
  outputMovedFromWork: boolean;
}

async function estimate(params: TrainingDiskParams): Promise<Estimate> {
  const { modelId, hyperparams, datasetBytes } = params;
  switch (modelId) {
    case "musicgen": {
      // Measured for small: ~9.5GB dora XP dir (checkpoint.th with optimizer
      // + EMA state, samples) and an 840MB exported state_dict. Scales with
      // parameter count: small 300M, medium 1.5B, large 3.3B.
      const scale = hyperparams.base_variant === "large" ? 11 : hyperparams.base_variant === "medium" ? 5 : 1;
      return { workBytes: 9.5 * GB * scale + datasetBytes, outputBytes: 0.85 * GB * scale, outputMovedFromWork: false };
    }
    case "ace-step-1.5": {
      // Staged clips + preprocessed tensors (~60MB for 3 short clips), and an
      // ~11MB adapter at rank 8 that grows linearly with rank.
      const rank = Number(hyperparams.rank) > 0 ? Number(hyperparams.rank) : 8;
      return { workBytes: 0.5 * GB + datasetBytes * 3, outputBytes: Math.max(50 * MB, (rank / 8) * 12 * MB), outputMovedFromWork: false };
    }
    case "musecoco": {
      // A full fine-tune checkpoint: weights + Adam state on the CPU (14.5GB),
      // weights only with Adafactor on the GPU (4.9GB).
      const gpu = await queryGpuVram();
      const onGpu = musecocoCudaKernelBuilt() && gpu.available && gpu.freeVramGb >= MUSECOCO_GPU_MIN_FREE_GB;
      const size = (onGpu ? 4.9 : 14.6) * GB;
      return { workBytes: size, outputBytes: size, outputMovedFromWork: true };
    }
    default:
      // RAVE: ~276MB of preprocessed data + checkpoints for 1.5 minutes of
      // audio, and a ~31MB exported model.
      return { workBytes: 0.5 * GB + datasetBytes * 2, outputBytes: 100 * MB, outputMovedFromWork: false };
  }
}

function nearestExisting(dir: string): string {
  let probe = dir;
  while (!fs.existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
  return probe;
}

function deviceOf(dir: string): number | null {
  try {
    return fs.statSync(nearestExisting(dir)).dev;
  } catch {
    return null;
  }
}

export async function checkTrainingDisk(params: TrainingDiskParams): Promise<TrainingDiskCheck> {
  const est = await estimate(params);
  const workPath = path.join(logsRootDir(), "training");
  const outputPath = params.outputDir;
  const workDev = deviceOf(workPath);
  const sameDisk = workDev !== null && workDev === deviceOf(outputPath);

  const work: DiskLocation = { path: workPath, freeBytes: await getFreeBytes(workPath), neededBytes: est.workBytes * MARGIN };
  const output: DiskLocation = { path: outputPath, freeBytes: await getFreeBytes(outputPath), neededBytes: est.outputBytes * MARGIN };

  const short = (loc: DiskLocation, needed: number) => loc.freeBytes !== null && loc.freeBytes < needed;
  let ok: boolean;
  let message: string;
  if (sameDisk) {
    // Peak use on one disk: everything at once, except a moved checkpoint.
    const needed = est.outputMovedFromWork ? Math.max(work.neededBytes, output.neededBytes) : work.neededBytes + output.neededBytes;
    ok = !short(work, needed);
    message =
      work.freeBytes === null
        ? `Needs about ${formatBytes(needed)} of free space (couldn't check this disk).`
        : ok
          ? `Needs about ${formatBytes(needed)} of free space — ${formatBytes(work.freeBytes)} free.`
          : `Not enough disk space: this run needs about ${formatBytes(needed)}, but only ${formatBytes(work.freeBytes)} is free. Free up space or save to another disk.`;
  } else {
    const workShort = short(work, work.neededBytes);
    const outputShort = short(output, output.neededBytes);
    ok = !workShort && !outputShort;
    message = ok
      ? `Needs about ${formatBytes(work.neededBytes)} for temporary files and ${formatBytes(output.neededBytes)} for the trained model.`
      : [
          workShort &&
            `Temporary files need about ${formatBytes(work.neededBytes)} on the app's data disk, but only ${formatBytes(work.freeBytes ?? 0)} is free. Free up space there first.`,
          outputShort &&
            `The trained model needs about ${formatBytes(output.neededBytes)} where it's saved, but only ${formatBytes(output.freeBytes ?? 0)} is free. Choose another folder or free up space.`,
        ]
          .filter(Boolean)
          .join(" ");
  }
  return { ok, sameDisk, work, output, message };
}
