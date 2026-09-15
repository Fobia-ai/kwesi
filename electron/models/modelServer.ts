// Phase 4 Model Server Manager. Per kwesi.docs/02-architecture.md
// "Process/sandboxing model", this is meant to start/health-check/stop a
// model's local Python subprocess server and relay its progress to the
// renderer. Phase 4's own exit criteria explicitly allows (and expects)
// "fake/mocked server responses (no real model inference required yet)" —
// this file is that mock: no Python process is spawned anywhere here. A
// "server" is just an in-memory status per model_id, and a "generation" is
// a timed status walk (queued -> running -> done, occasionally failed) that
// writes empty placeholder output files so the on-disk/output_files
// plumbing is exercised end to end. Real process spawning is Phase 5's job.
import { BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import * as repo from "../db/repositories.js";
import { generationDir, ensureDir } from "../db/paths.js";

const PROGRESS_CHANNEL = "kwesi:generation:progress";

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
  generation?: repo.GenerationRow;
}

const serverStatus = new Map<string, ServerStatusValue>();

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function broadcast(event: GenerationProgressEvent) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(PROGRESS_CHANNEL, event);
  }
}

export function getServerStatus(modelId: string): ServerStatusValue {
  return serverStatus.get(modelId) ?? "stopped";
}

export async function startServer(modelId: string): Promise<void> {
  const current = getServerStatus(modelId);
  if (current === "running" || current === "starting") return;
  serverStatus.set(modelId, "starting");
  broadcast({ type: "server_status", modelId, status: "starting" });
  await delay(500 + Math.random() * 400);
  serverStatus.set(modelId, "running");
  broadcast({ type: "server_status", modelId, status: "running" });
}

export async function stopServer(modelId: string): Promise<void> {
  const current = getServerStatus(modelId);
  if (current === "stopped" || current === "stopping") return;
  serverStatus.set(modelId, "stopping");
  broadcast({ type: "server_status", modelId, status: "stopping" });
  await delay(300);
  serverStatus.set(modelId, "stopped");
  broadcast({ type: "server_status", modelId, status: "stopped" });
}

export function submitGeneration(
  projectId: string,
  checkpointVariant: string | null,
  inputParams: Record<string, unknown>,
  outputKind: string,
): SubmitResult {
  const context = repo.getProjectContext(projectId);
  if (!context) return { ok: false, reason: "Project not found" };

  const generation = repo.createGeneration(projectId, checkpointVariant, inputParams, outputKind);
  broadcast({ type: "queued", generationId: generation.id, projectId });
  void runJob(context.workspaceId, context.modelId, generation);
  return { ok: true, generation };
}

const PROGRESS_STEPS = 5;
// Small, fixed chance of a simulated failure so the error-handling UI has
// something real to exercise, per the Phase 4 roadmap spec.
const FAILURE_RATE = 0.12;

async function runJob(
  workspaceId: string,
  modelId: string,
  generation: repo.GenerationRow,
): Promise<void> {
  await startServer(modelId);

  repo.updateGenerationStatus(generation.id, "running");
  broadcast({ type: "running", generationId: generation.id, projectId: generation.project_id, progressPct: 0 });

  for (let step = 1; step <= PROGRESS_STEPS; step += 1) {
    await delay(350 + Math.random() * 300);
    broadcast({
      type: "running",
      generationId: generation.id,
      projectId: generation.project_id,
      progressPct: Math.round((step / PROGRESS_STEPS) * 100),
    });
  }

  if (Math.random() < FAILURE_RATE) {
    const error = "Simulated model server error (Phase 4 mock — no real inference yet).";
    repo.updateGenerationStatus(generation.id, "failed", { error });
    broadcast({ type: "failed", generationId: generation.id, projectId: generation.project_id, error });
    return;
  }

  const dir = generationDir(workspaceId, generation.project_id, generation.id);
  ensureDir(dir);
  const outputFiles: string[] = [];
  if (generation.output_kind === "audio" || generation.output_kind === "audio+midi") {
    const file = path.join(dir, "output.wav");
    fs.writeFileSync(file, "");
    outputFiles.push(file);
  }
  if (generation.output_kind === "midi" || generation.output_kind === "audio+midi") {
    const file = path.join(dir, "output.mid");
    fs.writeFileSync(file, "");
    outputFiles.push(file);
  }

  const durationMs = PROGRESS_STEPS * 500;
  repo.updateGenerationStatus(generation.id, "done", { outputFiles, durationMs });
  broadcast({ type: "done", generationId: generation.id, projectId: generation.project_id, outputFiles, durationMs });
}
