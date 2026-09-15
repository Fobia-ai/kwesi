import { BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import * as repo from "../db/repositories.js";
import { modelVariantDir, ensureDir, removeDirIfExists } from "../db/paths.js";
import { listRepoFiles, resolveFileUrl } from "./hfClient.js";
import { checkDiskSpace } from "./diskSpace.js";

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

interface Job {
  variantId: string;
  modelId: string;
  variantName: string;
  repoId: string;
  controller: AbortController;
}

class KwesiAbort extends Error {}

const pending: Job[] = [];
let activeJob: Job | null = null;

function broadcast(event: ModelsProgressEvent) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(PROGRESS_CHANNEL, event);
  }
}

export function enqueueInstall(modelId: string, variantName: string): InstallResult {
  const variant = repo.getModelVariant(modelId, variantName);
  if (!variant) return { ok: false, reason: "Variant not found" };
  if (variant.source !== "huggingface" || !variant.repo_id) {
    return {
      ok: false,
      reason: "This variant isn't installable from the app — see its note for the real download location.",
    };
  }
  if (variant.install_status === "installed") return { ok: false, reason: "Already installed" };
  if (variant.install_status === "queued" || variant.install_status === "downloading") {
    return { ok: false, reason: "Already in the install queue" };
  }

  repo.setVariantQueued(variant.id);
  broadcast({ type: "status", variantId: variant.id, modelId, variantName, status: "queued" });

  pending.push({
    variantId: variant.id,
    modelId,
    variantName,
    repoId: variant.repo_id,
    controller: new AbortController(),
  });
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

async function dirSizeBytes(dir: string): Promise<number> {
  let total = 0;
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await dirSizeBytes(full);
    } else {
      const stat = await fs.promises.stat(full);
      total += stat.size;
    }
  }
  return total;
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
    const files = await listRepoFiles(job.repoId);
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
        throw new Error(`Refusing unsafe file path from ${job.repoId}: ${file.rfilename}`);
      }
      await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
      repo.updateVariantProgress(job.variantId, bytesDownloaded, bytesTotal, file.rfilename);

      const res = await fetch(resolveFileUrl(job.repoId, file.rfilename), {
        signal: job.controller.signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(`Download failed (HTTP ${res.status}) for ${file.rfilename}`);
      }

      const writeStream = fs.createWriteStream(destPath);
      const reader = res.body.getReader();
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
