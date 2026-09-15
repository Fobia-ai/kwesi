import { describe, it, expect } from "vitest";
import { formatCrashLogLine, normalizeError, buildCrashLogEntry } from "../crashLog";

describe("formatCrashLogLine", () => {
  it("serializes an entry as a single JSON line terminated with \\n", () => {
    const line = formatCrashLogLine({
      timestamp: "2026-09-15T00:00:00.000Z",
      process: "main",
      kind: "uncaughtException",
      message: "boom",
    });
    expect(line.endsWith("\n")).toBe(true);
    expect(line.match(/\n/g)?.length).toBe(1);
    expect(JSON.parse(line.trim())).toEqual({
      timestamp: "2026-09-15T00:00:00.000Z",
      process: "main",
      kind: "uncaughtException",
      message: "boom",
    });
  });
});

describe("normalizeError", () => {
  it("extracts message and stack from a real Error", () => {
    const err = new Error("real error");
    const { message, stack } = normalizeError(err);
    expect(message).toBe("real error");
    expect(stack).toContain("real error");
  });

  it("handles a plain string thrown/rejected value", () => {
    expect(normalizeError("just a string")).toEqual({ message: "just a string" });
  });

  it("handles undefined and null without throwing", () => {
    expect(normalizeError(undefined)).toEqual({ message: "undefined" });
    expect(normalizeError(null)).toEqual({ message: "null" });
  });

  it("stringifies a plain object", () => {
    expect(normalizeError({ code: "EFATAL" })).toEqual({ message: '{"code":"EFATAL"}' });
  });

  it("falls back to String() for a value JSON.stringify can't handle", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(normalizeError(circular).message).toBe(String(circular));
  });
});

describe("buildCrashLogEntry", () => {
  it("builds a complete entry with an ISO timestamp and normalized error fields", () => {
    const entry = buildCrashLogEntry("renderer", "window-error", new Error("ui broke"), {
      filename: "App.tsx",
    });
    expect(entry.process).toBe("renderer");
    expect(entry.kind).toBe("window-error");
    expect(entry.message).toBe("ui broke");
    expect(entry.stack).toContain("ui broke");
    expect(entry.extra).toEqual({ filename: "App.tsx" });
    expect(() => new Date(entry.timestamp).toISOString()).not.toThrow();
    expect(new Date(entry.timestamp).toISOString()).toBe(entry.timestamp);
  });
});
