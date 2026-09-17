import { describe, it, expect } from "vitest";
import { buildExportPlan } from "../exportPackage";
import type { GenerationRow } from "../db";

// The browser-preview mock kwesiAudio (src/lib/audio.ts) is what's active
// under jsdom too (no window.kwesi) -- it serves real, deterministic bytes
// keyed off the path's extension (a real SMF for .mid, real ABC text for
// .abc, a real WAV for anything else), so these tests exercise the actual
// read -> convert -> package pipeline rather than mocking it away.

function readZipEntryNames(zip: Uint8Array): string[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const names: string[] = [];
  let offset = 0;
  while (offset < zip.length) {
    if (view.getUint32(offset, true) !== 0x04034b50) break;
    const compressedSize = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    names.push(new TextDecoder().decode(zip.slice(nameStart, nameStart + nameLength)));
    offset = nameStart + nameLength + extraLength + compressedSize;
  }
  return names;
}

function baseGeneration(overrides: Partial<GenerationRow>): GenerationRow {
  return {
    id: "g1",
    project_id: "p1",
    status: "done",
    input_params: "{}",
    output_kind: "audio",
    output_files: "[]",
    created_at: Date.now(),
    duration_ms: 1000,
    error: null,
    checkpoint_variant: "v1",
    ...overrides,
  };
}

describe("buildExportPlan", () => {
  it("keeps a plain single-file download for audio-only output with no lyrics or params", async () => {
    const generation = baseGeneration({
      output_files: JSON.stringify(["/mock/g1/output.wav"]),
      input_params: "{}",
    });
    const plan = await buildExportPlan({ generation, title: "My Track", lyrics: undefined });
    expect(plan).toEqual({ kind: "single", filePath: "/mock/g1/output.wav", suggestedName: "My Track.wav" });
  });

  it("packages audio + lyrics + metadata into a zip when lyrics exist", async () => {
    const generation = baseGeneration({
      output_files: JSON.stringify(["/mock/g1/output.wav"]),
      input_params: JSON.stringify({ tags: "pop, indie" }),
    });
    const plan = await buildExportPlan({ generation, title: "My Track", lyrics: "la la la" });
    expect(plan.kind).toBe("zip");
    if (plan.kind !== "zip") throw new Error("expected zip");
    const names = readZipEntryNames(plan.bytes);
    expect(names).toContain("audio.wav");
    expect(names).toContain("lyrics.txt");
    expect(names).toContain("metadata.json");
    expect(plan.suggestedName).toBe("My Track.zip");
  });

  it("packages a MIDI-only output with a converted ABC text sidecar and a note-dump", async () => {
    const generation = baseGeneration({
      output_kind: "midi",
      output_files: JSON.stringify(["/mock/g1/output.mid"]),
      input_params: "{}",
    });
    const plan = await buildExportPlan({ generation, title: "Midi Track", lyrics: undefined });
    expect(plan.kind).toBe("zip");
    if (plan.kind !== "zip") throw new Error("expected zip");
    const names = readZipEntryNames(plan.bytes);
    expect(names).toContain("notation.mid");
    expect(names).toContain("notation.abc");
    expect(names).toContain("notation.txt");
    expect(names).toContain("metadata.json");
  });

  it("packages an audio+ABC output with a genuinely derived MIDI counterpart", async () => {
    const generation = baseGeneration({
      output_kind: "audio+midi",
      output_files: JSON.stringify(["/mock/g1/output.wav", "/mock/g1/score.abc"]),
      input_params: JSON.stringify({ style_genre: "lofi" }),
    });
    const plan = await buildExportPlan({ generation, title: "Yue Track", lyrics: "verse one" });
    expect(plan.kind).toBe("zip");
    if (plan.kind !== "zip") throw new Error("expected zip");
    const names = readZipEntryNames(plan.bytes);
    expect(names).toContain("audio.wav");
    expect(names).toContain("notation.abc");
    expect(names).toContain("notation.mid"); // derived via abcToMidiBytes, not just an image
    expect(names).toContain("notation.txt");
    expect(names).toContain("lyrics.txt");
    expect(names).toContain("metadata.json");
  });

  it("returns kind \"none\" when there's no real output file at all", async () => {
    const generation = baseGeneration({ status: "running", output_files: "[]" });
    const plan = await buildExportPlan({ generation, title: "Not done", lyrics: undefined });
    expect(plan.kind).toBe("none");
  });
});
