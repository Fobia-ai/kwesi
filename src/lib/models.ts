import { CATALOG } from "../data/catalog";
import type { ModelVariantRow } from "./db";
import { listAll, getById, update } from "./modelVariantStore";

export interface InstallResult {
  ok: boolean;
  reason?: string;
}

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

export type QueueRow = ModelVariantRow & { model_display_name: string };

export interface KwesiModelsApi {
  install(modelId: string, variantName: string): Promise<InstallResult>;
  retry(modelId: string, variantName: string): Promise<InstallResult>;
  cancel(variantId: string): Promise<boolean>;
  remove(modelId: string, variantName: string): Promise<{ ok: boolean; reason?: string }>;
  listQueue(): Promise<QueueRow[]>;
  workspacesUsingModel(modelId: string): Promise<{ id: string; name: string }[]>;
  diskFreeBytes(): Promise<number | null>;
  onProgress(callback: (event: ModelsProgressEvent) => void): () => void;
}

function realModelsApi(bridge: NonNullable<Window["kwesi"]>["models"]): KwesiModelsApi {
  return {
    install: (modelId, variantName) => bridge.install(modelId, variantName),
    retry: (modelId, variantName) => bridge.retry(modelId, variantName),
    cancel: (variantId) => bridge.cancel(variantId),
    remove: (modelId, variantName) => bridge.remove(modelId, variantName),
    listQueue: () => bridge.listQueue() as Promise<QueueRow[]>,
    workspacesUsingModel: (modelId) => bridge.workspacesUsingModel(modelId),
    diskFreeBytes: () => bridge.diskFreeBytes(),
    onProgress: (callback) => bridge.onProgress(callback as (event: unknown) => void),
  };
}

function modelDisplayName(modelId: string): string {
  return CATALOG.find((c) => c.modelId === modelId)?.displayName ?? modelId;
}

/**
 * localStorage-backed mock of the install queue/download mechanism, used
 * only in a plain browser preview (no Electron main process). Doesn't
 * simulate a real network download — a fake progress timer completes in a
 * couple of seconds, purely so the UI is exercisable during development.
 */
function createMockModelsApi(): KwesiModelsApi {
  const listeners = new Set<(event: ModelsProgressEvent) => void>();
  const timers = new Map<string, ReturnType<typeof setInterval>>();

  function emit(event: ModelsProgressEvent) {
    listeners.forEach((listener) => listener(event));
  }

  function stopTimer(variantId: string) {
    const timer = timers.get(variantId);
    if (timer) {
      clearInterval(timer);
      timers.delete(variantId);
    }
  }

  async function doInstall(modelId: string, variantName: string): Promise<InstallResult> {
    const id = `${modelId}:${variantName}`;
    const row = getById(id);
    if (!row) return { ok: false, reason: "Variant not found" };
    if (row.source !== "huggingface") {
      return {
        ok: false,
        reason: "This variant isn't installable from the app — see its note for the real download location.",
      };
    }
    if (row.install_status === "installed") return { ok: false, reason: "Already installed" };
    if (row.install_status === "queued" || row.install_status === "downloading") {
      return { ok: false, reason: "Already in the install queue" };
    }

    update(id, {
      install_status: "downloading",
      bytes_downloaded: 0,
      bytes_total: 100,
      current_file: "config.json",
      error: null,
    });
    emit({ type: "status", variantId: id, modelId, variantName, status: "downloading" });

    let pct = 0;
    const timer = setInterval(() => {
      pct += 20;
      const current = getById(id);
      if (!current || current.install_status !== "downloading") {
        stopTimer(id);
        return;
      }
      if (pct >= 100) {
        stopTimer(id);
        const installPath = `/mock/models/${modelId}/${variantName}`;
        const diskSizeBytes = 123_456_789;
        update(id, {
          install_status: "installed",
          install_path: installPath,
          disk_size_bytes: diskSizeBytes,
          bytes_downloaded: null,
          bytes_total: null,
          current_file: null,
        });
        emit({ type: "installed", variantId: id, modelId, variantName, installPath, diskSizeBytes });
        return;
      }
      update(id, { bytes_downloaded: pct, current_file: "model.safetensors" });
      emit({
        type: "progress",
        variantId: id,
        modelId,
        variantName,
        bytesDownloaded: pct,
        bytesTotal: 100,
        currentFile: "model.safetensors",
      });
    }, 400);
    timers.set(id, timer);

    return { ok: true };
  }

  return {
    install: doInstall,
    retry: doInstall,
    async cancel(variantId) {
      const row = getById(variantId);
      if (!row) return false;
      stopTimer(variantId);
      update(variantId, {
        install_status: "not_installed",
        bytes_downloaded: null,
        bytes_total: null,
        current_file: null,
        error: null,
      });
      emit({ type: "cancelled", variantId, modelId: row.model_id, variantName: row.variant_name });
      return true;
    },
    async remove(modelId, variantName) {
      const id = `${modelId}:${variantName}`;
      stopTimer(id);
      update(id, {
        install_status: "not_installed",
        install_path: null,
        disk_size_bytes: null,
        bytes_downloaded: null,
        bytes_total: null,
        current_file: null,
        error: null,
      });
      return { ok: true };
    },
    async listQueue() {
      return listAll()
        .filter((r) => r.install_status === "queued" || r.install_status === "downloading" || r.install_status === "failed")
        .map((r) => ({ ...r, model_display_name: modelDisplayName(r.model_id) }));
    },
    async workspacesUsingModel() {
      return [];
    },
    async diskFreeBytes() {
      return 250 * 1024 * 1024 * 1024;
    },
    onProgress(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
  };
}

export const kwesiModels: KwesiModelsApi = window.kwesi?.models
  ? realModelsApi(window.kwesi.models)
  : createMockModelsApi();
