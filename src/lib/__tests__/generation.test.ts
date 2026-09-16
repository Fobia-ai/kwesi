import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Exercises the browser-preview mock's cancel() path with fake timers,
 * rather than racing the real setTimeout-based delays it uses — manual
 * testing against the live mock hit exactly this race (the ~1.5s mock job
 * finished before a real click-through could land a Stop click), which is
 * the actual reason this is a deterministic timer-controlled test instead
 * of a real-time one.
 */
describe("kwesiGeneration mock (cancel)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function importFresh() {
    vi.resetModules();
    const { kwesiDb } = await import("../db");
    const { kwesiGeneration } = await import("../generation");
    return { kwesiDb, kwesiGeneration };
  }

  it("cancel() on an active job reports 'cancelled', not 'done' or 'failed'", async () => {
    const { kwesiDb, kwesiGeneration } = await importFresh();
    const workspace = await kwesiDb.createWorkspace("Test Workspace", "musicgen");
    const project = await kwesiDb.createProject(workspace.id, "Test Project");

    const events: { type: string }[] = [];
    kwesiGeneration.onProgress((e) => events.push(e));

    const result = await kwesiGeneration.submit(project.id, "small", { prompt: "test" }, "audio");
    expect(result.ok).toBe(true);
    const generationId = result.generation!.id;

    // Let the mock job actually start running (past "queued") before
    // cancelling, so this exercises the real "stop something in flight"
    // path rather than a job that hasn't started yet.
    await vi.advanceTimersByTimeAsync(50);

    const cancelled = await kwesiGeneration.cancel(generationId);
    expect(cancelled).toBe(true);

    // Run the mock's remaining internal timers to completion — if
    // cancellation didn't actually stop the job, it would carry on to
    // emit "done"/"failed" here instead.
    await vi.advanceTimersByTimeAsync(10_000);

    const generations = await kwesiDb.listGenerations(project.id);
    expect(generations.find((g) => g.id === generationId)?.status).toBe("cancelled");

    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain("cancelled");
    expect(eventTypes).not.toContain("done");
    expect(eventTypes).not.toContain("failed");
  });

  it("cancel() on a generation that already finished returns false and does nothing", async () => {
    const { kwesiDb, kwesiGeneration } = await importFresh();
    const workspace = await kwesiDb.createWorkspace("Test Workspace", "musicgen");
    const project = await kwesiDb.createProject(workspace.id, "Test Project");

    const result = await kwesiGeneration.submit(project.id, "small", { prompt: "test" }, "audio");
    const generationId = result.generation!.id;

    // Run the whole mock job to completion first.
    await vi.advanceTimersByTimeAsync(10_000);

    const cancelled = await kwesiGeneration.cancel(generationId);
    expect(cancelled).toBe(false);

    const generations = await kwesiDb.listGenerations(project.id);
    // Whatever the real outcome was (the mock has a random failure
    // chance), cancel() must not have overwritten it with "cancelled".
    expect(generations.find((g) => g.id === generationId)?.status).not.toBe("cancelled");
  });
});
