import { BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import * as repo from "../db/repositories.js";
import { modelVariantDir, ensureDir, removeDirIfExists } from "../db/paths.js";
import { listRepoFiles, resolveFileUrl, type HfFileInfo } from "./hfClient.js";
import { tryResolveGatewayFileUrl, KWESI_ACCESS_TOKEN } from "./gatewayClient.js";
import { checkDiskSpace } from "./diskSpace.js";
import { dirSizeBytes } from "../lib/fsSize.js";

const PROGRESS_CHANNEL = "kwesi:models:progress";

export type ModelsProgressEvent =
  | { type: "status"; variantId: string; modelId: string; variantName: string; status: string }
  | {
      type: "progress";
      variantId: string;
      modelId: string;
      variantName: string;
      bytesDownloaded: number;
      bytesTotal: number | null;
      currentFile: string;
    }
  | {
      type: "installed";
      variantId: string;
      modelId: string;
      variantName: string;
      installPath: string;
      diskSizeBytes: number;
    }
  | { type: "failed"; variantId: string; modelId: string; variantName: string; error: string }
  | { type: "cancelled"; variantId: string; modelId: string; variantName: string };

export interface InstallResult {
  ok: boolean;
  reason?: string;
}

interface JobBase {
  variantId: string;
  modelId: string;
  variantName: string;
  controller: AbortController;
}

// "huggingface" jobs list every file from the HF repo and can fall back to
// Fobia's gateway per-file; "manual" jobs (Museformer/RAVE) never had an HF
// repo to begin with, so they're always a single known file served only by
// the gateway -- see gateway_filename's comment in schema.ts.
type Job = (JobBase & { source: "huggingface"; repoId: string }) | (JobBase & { source: "manual"; gatewayFilename: string });

class KwesiAbort extends Error {}

const pending: Job[] = [];
let activeJob: Job | null = null;

function broadcast(event: ModelsProgressEvent) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(PROGRESS_CHANNEL, event);
  }
}

const NOT_INSTALLABLE_REASON =
  "This variant isn't installable from the app — see its note for the real download location.";

export function enqueueInstall(modelId: string, variantName: string): InstallResult {
  const variant = repo.getModelVariant(modelId, variantName);
  if (!variant) return { ok: false, reason: "Variant not found" };

  let job: Job;
  if (variant.source === "huggingface" && variant.repo_id) {
    job = {
      variantId: variant.id,
      modelId,
      variantName,
      source: "huggingface",
      repoId: variant.repo_id,
      controller: new AbortController(),
    };
  } else if (variant.source === "manual" && variant.gateway_filename) {
    // Same as huggingface's repo_id check, but for manual variants Fobia
    // has actually mirrored onto its gateway/R2 -- otherwise stays a pure
    // external-link pointer, same as before.
    job = {
      variantId: variant.id,
      modelId,
      variantName,
      source: "manual",
      gatewayFilename: variant.gateway_filename,
      controller: new AbortController(),
    };
  } else {
    return { ok: false, reason: NOT_INSTALLABLE_REASON };
  }

  if (variant.install_status === "installed") return { ok: false, reason: "Already installed" };
  if (variant.install_status === "queued" || variant.install_status === "downloading") {
    return { ok: false, reason: "Already in the install queue" };
  }

  repo.setVariantQueued(variant.id);
  broadcast({ type: "status", variantId: variant.id, modelId, variantName, status: "queued" });

  pending.push(job);
  void processQueue();
  return { ok: true };
}

export function retryInstall(modelId: string, variantName: string): InstallResult {
  return enqueueInstall(modelId, variantName);
}

export function cancelJob(variantId: string): boolean {
  const pendingIndex = pending.findIndex((j) => j.variantId === variantId);
  if (pendingIndex !== -1) {
    const [job] = pending.splice(pendingIndex, 1);
    repo.resetVariantToNotInstalled(job.variantId);
    broadcast({
      type: "cancelled",
      variantId: job.variantId,
      modelId: job.modelId,
      variantName: job.variantName,
    });
    return true;
  }
  if (activeJob && activeJob.variantId === variantId) {
    activeJob.controller.abort();
    return true;
  }
  return false;
}

/**
 * Settings > Reset "Models" category calls this before wiping
 * KWESI_MODELS_DIR out from under any in-flight download -- aborts the
 * active job's fetch (its own catch block in runDownload handles the
 * resulting cleanup/broadcast, same as a normal single cancel) and drops
 * everything still queued.
 */
export function cancelAllJobs(): void {
  while (pending.length > 0) {
    const job = pending.shift();
    if (!job) break;
    repo.resetVariantToNotInstalled(job.variantId);
    broadcast({ type: "cancelled", variantId: job.variantId, modelId: job.modelId, variantName: job.variantName });
  }
  activeJob?.controller.abort();
}

export function removeVariant(modelId: string, variantName: string): { ok: boolean; reason?: string } {
  const variant = repo.getModelVariant(modelId, variantName);
  if (!variant) return { ok: false, reason: "Variant not found" };
  const dir = variant.install_path ?? modelVariantDir(modelId, variantName);
  removeDirIfExists(dir);
  repo.resetVariantToNotInstalled(variant.id);
  return { ok: true };
}

async function processQueue(): Promise<void> {
  if (activeJob) return;
  const job = pending.shift();
  if (!job) return;
  activeJob = job;
  try {
    await runDownload(job);
  } finally {
    activeJob = null;
    void processQueue();
  }
}

/**
 * Hugging Face is the primary source for its own variants -- free, no load
 * on Fobia's own infrastructure. Fobia's gateway only steps in as a
 * per-file fallback when a direct HF fetch fails (HF outage, rate limit,
 * etc), to keep normal usage off Fobia's bandwidth. "manual" variants never
 * had an HF repo, so the gateway is their only source.
 */
async function fetchModelFile(job: Job, filename: string): Promise<Response> {
  if (job.source === "manual") {
    const gatewayUrl = await tryResolveGatewayFileUrl(job.modelId, job.variantName, filename, job.controller.signal);
    if (!gatewayUrl) throw new Error(`Fobia's gateway didn't return a download URL for ${filename}`);
    const res = await fetch(gatewayUrl, { signal: job.controller.signal });
    if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status}) for ${filename}`);
    return res;
  }

  try {
    const res = await fetch(resolveFileUrl(job.repoId, filename), { signal: job.controller.signal });
    if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status}) for ${filename}`);
    return res;
  } catch (hfErr) {
    if (job.controller.signal.aborted) throw hfErr;
    const gatewayUrl = await tryResolveGatewayFileUrl(job.modelId, job.variantName, filename, job.controller.signal);
    if (!gatewayUrl) throw hfErr;
    const res = await fetch(gatewayUrl, { signal: job.controller.signal });
    if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status}) for ${filename}`);
    return res;
  }
}

async function runDownload(job: Job): Promise<void> {
  const dir = modelVariantDir(job.modelId, job.variantName);
  // v1 simplification: no true resumable range-request downloads — every
  // attempt (including retries) starts from a clean directory rather than
  // trying to reconcile partial files against Hugging Face's ETags/ranges.
  // Acceptable for now; a real resume would need per-file byte offsets
  // persisted across restarts, which is substantially more scope than a
  // first cut of the install queue needs.
  removeDirIfExists(dir);
  ensureDir(dir);

  repo.setVariantDownloading(job.variantId);
  broadcast({
    type: "status",
    variantId: job.variantId,
    modelId: job.modelId,
    variantName: job.variantName,
    status: "downloading",
  });

  try {
    const files: HfFileInfo[] =
      job.source === "huggingface"
        ? await listRepoFiles(job.repoId)
        : [{ rfilename: job.gatewayFilename, size: null }];
    const knownSizes = files.every((f) => f.size !== null);
    const bytesTotal = knownSizes ? files.reduce((sum, f) => sum + (f.size ?? 0), 0) : null;

    if (bytesTotal !== null) {
      const spaceCheck = await checkDiskSpace(dir, bytesTotal);
      if (!spaceCheck.ok) {
        throw new Error(spaceCheck.reason ?? "Not enough free disk space");
      }
    }

    let bytesDownloaded = 0;
    let lastEmit = 0;

    for (const file of files) {
      if (job.controller.signal.aborted) throw new KwesiAbort();

      const destPath = path.join(dir, ...file.rfilename.split("/"));
      const resolvedDir = path.resolve(dir) + path.sep;
      if (!path.resolve(destPath).startsWith(resolvedDir)) {
        throw new Error(`Refusing unsafe file path: ${file.rfilename}`);
      }
      await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
      repo.updateVariantProgress(job.variantId, bytesDownloaded, bytesTotal, file.rfilename);

      const res = await fetchModelFile(job, file.rfilename);

      const writeStream = fs.createWriteStream(destPath);
      // fetchModelFile already checked res.body is non-null before returning.
      const reader = res.body!.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          await new Promise<void>((resolve, reject) => {
            writeStream.write(value, (err) => (err ? reject(err) : resolve()));
          });
          bytesDownloaded += value.byteLength;

          const now = Date.now();
          if (now - lastEmit > 200) {
            lastEmit = now;
            repo.updateVariantProgress(job.variantId, bytesDownloaded, bytesTotal, file.rfilename);
            broadcast({
              type: "progress",
              variantId: job.variantId,
              modelId: job.modelId,
              variantName: job.variantName,
              bytesDownloaded,
              bytesTotal,
              currentFile: file.rfilename,
            });
          }
        }
      } finally {
        await new Promise<void>((resolve, reject) => {
          writeStream.end((err?: Error | null) => (err ? reject(err) : resolve()));
        });
      }
    }

    const diskSizeBytes = await dirSizeBytes(dir);
    repo.setVariantInstalled(job.variantId, dir, diskSizeBytes);
    broadcast({
      type: "installed",
      variantId: job.variantId,
      modelId: job.modelId,
      variantName: job.variantName,
      installPath: dir,
      diskSizeBytes,
    });
  } catch (err) {
    if (err instanceof KwesiAbort || job.controller.signal.aborted) {
      removeDirIfExists(dir);
      repo.resetVariantToNotInstalled(job.variantId);
      broadcast({
        type: "cancelled",
        variantId: job.variantId,
        modelId: job.modelId,
        variantName: job.variantName,
      });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    removeDirIfExists(dir);
    repo.setVariantFailed(job.variantId, message);
    broadcast({
      type: "failed",
      variantId: job.variantId,
      modelId: job.modelId,
      variantName: job.variantName,
      error: message,
    });
  }
}
