import type { TrainingRunRow, TrainedModelRow } from "./db";

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

export interface SubmitTrainingRunParams {
  modelId: string;
  baseCheckpointVariant: string | null;
  runName: string;
  datasetFiles: string[];
  allowedExtensions: string[];
  hyperparams: Record<string, unknown>;
  outputDir: string;
}

export interface KwesiTrainingApi {
  submit(params: SubmitTrainingRunParams): Promise<{ ok: boolean; reason?: string; trainingRun?: TrainingRunRow }>;
  list(modelId?: string): Promise<TrainingRunRow[]>;
  get(runId: string): Promise<TrainingRunRow | null>;
  cancel(runId: string): Promise<boolean>;
  listTrainedModels(modelId?: string): Promise<TrainedModelRow[]>;
  pickOutputDir(modelId: string, runName: string): Promise<{ ok: boolean; path?: string }>;
  defaultOutputDir(modelId: string, runName: string): Promise<string>;
  onProgress(callback: (event: TrainingProgressEvent) => void): () => void;
}

function realTrainingApi(bridge: NonNullable<Window["kwesi"]>["training"]): KwesiTrainingApi {
  return {
    submit: (params) => bridge.submit(params),
    list: (modelId) => bridge.list(modelId),
    get: (runId) => bridge.get(runId),
    cancel: (runId) => bridge.cancel(runId),
    listTrainedModels: (modelId) => bridge.listTrainedModels(modelId),
    pickOutputDir: (modelId, runName) => bridge.pickOutputDir(modelId, runName),
    defaultOutputDir: (modelId, runName) => bridge.defaultOutputDir(modelId, runName),
    onProgress: (callback) => bridge.onProgress(callback as (event: unknown) => void),
  };
}

/**
 * localStorage-backed mock used only in a plain browser preview (no
 * Electron main process / real RAVE venv available) — simulates a run
 * moving through preparing -> running -> completed over a few seconds with
 * fake step progress, purely so the Training screen's UI/state machine is
 * exercisable during UI development. Mirrors src/lib/models.ts's
 * createMockModelsApi in spirit.
 */
function createMockTrainingApi(): KwesiTrainingApi {
  const KEY = "kwesi-mock-training-v1";
  const listeners = new Set<(event: TrainingProgressEvent) => void>();

  function load(): TrainingRunRow[] {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw) as TrainingRunRow[];
    } catch {
      // ignore
    }
    return [];
  }

  function save(rows: TrainingRunRow[]) {
    try {
      localStorage.setItem(KEY, JSON.stringify(rows));
    } catch {
      // best-effort only
    }
  }

  function emit(event: TrainingProgressEvent) {
    listeners.forEach((l) => l(event));
  }

  function updateRun(runId: string, patch: Partial<TrainingRunRow>) {
    const rows = load();
    const next = rows.map((r) => (r.id === runId ? { ...r, ...patch } : r));
    save(next);
  }

  return {
    async submit(params) {
      const id = crypto.randomUUID();
      const row: TrainingRunRow = {
        id,
        model_id: params.modelId,
        base_checkpoint_variant: params.baseCheckpointVariant,
        run_name: params.runName,
        status: "queued",
        dataset_manifest: JSON.stringify({ fileCount: params.datasetFiles.length }),
        hyperparams: JSON.stringify(params.hyperparams),
        output_dir: params.outputDir,
        output_checkpoint_id: null,
        log_path: null,
        pid: null,
        started_at: Date.now(),
        completed_at: null,
        error: null,
      };
      const rows = load();
      rows.unshift(row);
      save(rows);
      emit({ type: "status", runId: id, status: "queued" });

      const maxSteps = Number(params.hyperparams.max_steps) || 60;
      setTimeout(() => {
        updateRun(id, { status: "preparing" });
        emit({ type: "status", runId: id, status: "preparing" });
        setTimeout(() => {
          updateRun(id, { status: "running" });
          emit({ type: "status", runId: id, status: "running" });
          let step = 0;
          const timer = setInterval(() => {
            step += Math.max(1, Math.round(maxSteps / 10));
            if (step >= maxSteps) {
              clearInterval(timer);
              emit({ type: "progress", runId: id, phase: "train", step: maxSteps, maxSteps, pct: 99 });
              setTimeout(() => {
                const trainedModelId = crypto.randomUUID();
                const checkpointPath = `${params.outputDir}/trained-${params.runName}.ts`;
                updateRun(id, { status: "completed", completed_at: Date.now(), output_checkpoint_id: trainedModelId });
                emit({ type: "completed", runId: id, trainedModelId, checkpointPath });
              }, 400);
              return;
            }
            emit({ type: "progress", runId: id, phase: "train", step, maxSteps, pct: Math.round((step / maxSteps) * 100) });
          }, 300);
        }, 500);
      }, 300);

      return { ok: true, trainingRun: row };
    },
    async list(modelId) {
      const rows = load();
      return modelId ? rows.filter((r) => r.model_id === modelId) : rows;
    },
    async get(runId) {
      return load().find((r) => r.id === runId) ?? null;
    },
    async cancel(runId) {
      updateRun(runId, { status: "cancelled", completed_at: Date.now() });
      emit({ type: "cancelled", runId });
      return true;
    },
    async listTrainedModels() {
      return [];
    },
    async pickOutputDir(modelId, runName) {
      return { ok: true, path: `/mock/trained-models/${modelId}/${runName}` };
    },
    async defaultOutputDir(modelId, runName) {
      return `/mock/trained-models/${modelId}/${runName}`;
    },
    onProgress(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
  };
}

export const kwesiTraining: KwesiTrainingApi = window.kwesi?.training
  ? realTrainingApi(window.kwesi.training)
  : createMockTrainingApi();
