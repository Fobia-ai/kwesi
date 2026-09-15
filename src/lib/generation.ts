import type { GenerationRow } from "./db";
import { kwesiDb } from "./db";
import * as generationStore from "./generationStore";

export type ServerStatusValue = "stopped" | "starting" | "running" | "stopping";

export type GenerationProgressEvent =
  | { type: "server_status"; modelId: string; status: ServerStatusValue }
  | { type: "queued"; generationId: string; projectId: string }
  | { type: "running"; generationId: string; projectId: string; progressPct: number }
  | { type: "done"; generationId: string; projectId: string; outputFiles: string[]; durationMs: number }
  | { type: "failed"; generationId: string; projectId: string; error: string };

export interface SubmitResult {
  ok: boolean;
  reason?: string;
  generation?: GenerationRow;
}

export interface KwesiGenerationApi {
  submit(
    projectId: string,
    checkpointVariant: string | null,
    inputParams: Record<string, unknown>,
    outputKind: string,
  ): Promise<SubmitResult>;
  startServer(modelId: string): Promise<void>;
  stopServer(modelId: string): Promise<void>;
  serverStatus(modelId: string): Promise<ServerStatusValue>;
  onProgress(callback: (event: GenerationProgressEvent) => void): () => void;
}

function realGenerationApi(bridge: NonNullable<Window["kwesi"]>["generation"]): KwesiGenerationApi {
  return {
    submit: (projectId, checkpointVariant, inputParams, outputKind) =>
      bridge.submit(projectId, checkpointVariant, inputParams, outputKind),
    startServer: (modelId) => bridge.startServer(modelId),
    stopServer: (modelId) => bridge.stopServer(modelId),
    serverStatus: (modelId) => bridge.serverStatus(modelId) as Promise<ServerStatusValue>,
    onProgress: (callback) => bridge.onProgress(callback as (event: unknown) => void),
  };
}

const PROGRESS_STEPS = 5;
const FAILURE_RATE = 0.12;

/**
 * localStorage-backed mock of the Model Server Manager + generation queue,
 * used only in a plain browser preview (no Electron main process). Mirrors
 * electron/models/modelServer.ts's mocked queued -> running -> done/failed
 * walk closely enough to exercise the generation UI during development.
 */
function createMockGenerationApi(): KwesiGenerationApi {
  const listeners = new Set<(event: GenerationProgressEvent) => void>();
  const serverStatus = new Map<string, ServerStatusValue>();

  function emit(event: GenerationProgressEvent) {
    listeners.forEach((listener) => listener(event));
  }

  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function getServerStatus(modelId: string): ServerStatusValue {
    return serverStatus.get(modelId) ?? "stopped";
  }

  async function startServer(modelId: string): Promise<void> {
    const current = getServerStatus(modelId);
    if (current === "running" || current === "starting") return;
    serverStatus.set(modelId, "starting");
    emit({ type: "server_status", modelId, status: "starting" });
    await delay(400 + Math.random() * 300);
    serverStatus.set(modelId, "running");
    emit({ type: "server_status", modelId, status: "running" });
  }

  async function stopServer(modelId: string): Promise<void> {
    const current = getServerStatus(modelId);
    if (current === "stopped" || current === "stopping") return;
    serverStatus.set(modelId, "stopping");
    emit({ type: "server_status", modelId, status: "stopping" });
    await delay(200);
    serverStatus.set(modelId, "stopped");
    emit({ type: "server_status", modelId, status: "stopped" });
  }

  // No `getProject(id)` exists on kwesiDb's public surface, so this walks
  // workspaces -> projects the same way any consumer of that surface would.
  async function findProjectModelId(projectId: string): Promise<string | undefined> {
    const workspaces = await kwesiDb.listWorkspaces();
    for (const workspace of workspaces) {
      const projects = await kwesiDb.listProjects(workspace.id);
      if (projects.some((p) => p.id === projectId)) return workspace.model_id;
    }
    return undefined;
  }

  async function runJob(modelId: string, projectId: string, id: string, outputKind: string): Promise<void> {
    await startServer(modelId);
    generationStore.update(id, { status: "running" });
    emit({ type: "running", generationId: id, projectId, progressPct: 0 });

    for (let step = 1; step <= PROGRESS_STEPS; step += 1) {
      await delay(250 + Math.random() * 200);
      emit({ type: "running", generationId: id, projectId, progressPct: Math.round((step / PROGRESS_STEPS) * 100) });
    }

    if (Math.random() < FAILURE_RATE) {
      const error = "Simulated model server error (Phase 4 mock — no real inference yet).";
      generationStore.update(id, { status: "failed", error });
      emit({ type: "failed", generationId: id, projectId, error });
      return;
    }

    const outputFiles: string[] = [];
    if (outputKind === "audio" || outputKind === "audio+midi") outputFiles.push(`/mock/generations/${id}/output.wav`);
    if (outputKind === "midi" || outputKind === "audio+midi") outputFiles.push(`/mock/generations/${id}/output.mid`);
    const durationMs = PROGRESS_STEPS * 400;
    generationStore.update(id, { status: "done", output_files: JSON.stringify(outputFiles), duration_ms: durationMs });
    emit({ type: "done", generationId: id, projectId, outputFiles, durationMs });
  }

  return {
    async submit(projectId, checkpointVariant, inputParams, outputKind) {
      const modelId = await findProjectModelId(projectId);
      if (!modelId) return { ok: false, reason: "Project not found" };

      const id = crypto.randomUUID();
      const row: GenerationRow = {
        id,
        project_id: projectId,
        status: "queued",
        input_params: JSON.stringify(inputParams),
        output_kind: outputKind,
        output_files: "[]",
        created_at: Date.now(),
        duration_ms: null,
        error: null,
        checkpoint_variant: checkpointVariant,
      };
      generationStore.insert(row);
      emit({ type: "queued", generationId: id, projectId });
      void runJob(modelId, projectId, id, outputKind);
      return { ok: true, generation: row };
    },
    startServer,
    stopServer,
    async serverStatus(modelId) {
      return getServerStatus(modelId);
    },
    onProgress(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
  };
}

export const kwesiGeneration: KwesiGenerationApi = window.kwesi?.generation
  ? realGenerationApi(window.kwesi.generation)
  : createMockGenerationApi();
