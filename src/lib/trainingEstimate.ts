/**
 * Rough training-time estimates for the Training form, from runs measured on
 * an RTX 3090 (see each model's README training section). They exist to
 * tell "seconds" from "minutes" from "hours", not to be precise: real time
 * depends on the GPU and on clip lengths.
 */

export interface EstimateContext {
  fileCount: number;
  // MuseCoco trains ~50x faster once its GPU kernel is built (and the GPU
  // has room) -- see electron/models/musecocoGpu.ts.
  museCocoOnGpu: boolean;
}

function num(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Seconds a run takes end to end, including setup and the preview clip. */
export function estimateTrainingSeconds(modelId: string, hp: Record<string, unknown>, ctx: EstimateContext): number | null {
  const files = Math.max(1, ctx.fileCount);
  switch (modelId) {
    case "rave": {
      // ~40 steps/s for v2_small at batch 4 (2000 steps in ~74s end to end);
      // the full v2 config is about half as fast.
      const perStep = (1 / 40) * (num(hp.batch_size, 4) / 4) * (hp.config === "v2" ? 2 : 1);
      return 30 + num(hp.max_steps, 60) * perStep;
    }
    case "musicgen": {
      // small: ~2s per clip per epoch plus ~50s per epoch for validation,
      // sample generation and the checkpoint; medium/large scale with size.
      const scale = hp.base_variant === "large" ? 11 : hp.base_variant === "medium" ? 5 : 1;
      return 60 * scale + num(hp.epochs, 1) * (2 * files + 50) * scale + 60;
    }
    case "ace-step-1.5": {
      // ~1s per clip per epoch at rank 8, a little more at high rank; XL bases are ~2x.
      const rankFactor = num(hp.rank, 8) >= 64 ? 1.3 : 1;
      const xl = typeof hp.base_variant === "string" && hp.base_variant.startsWith("xl") ? 2 : 1;
      return 30 + num(hp.epochs, 3) * files * rankFactor * xl + 40;
    }
    case "musecoco": {
      const updates = num(hp.max_updates, 10);
      return ctx.museCocoOnGpu ? 45 + updates + 75 : 200 + updates * 50;
    }
    default:
      return null;
  }
}

export function formatEstimate(seconds: number): string {
  if (seconds < 90) return `~${Math.max(10, Math.round(seconds / 10) * 10)} s`;
  const minutes = seconds / 60;
  if (minutes < 90) return `~${Math.round(minutes)} min`;
  const hours = minutes / 60;
  return `~${hours < 10 ? hours.toFixed(1).replace(/\.0$/, "") : Math.round(hours)} h`;
}
