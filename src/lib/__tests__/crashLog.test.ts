import { describe, it, expect } from "vitest";
import { windowErrorToReport, rejectionToReport } from "../crashLog";

describe("windowErrorToReport", () => {
  it("prefers the event message and pulls the stack off a real Error", () => {
    const err = new Error("render blew up");
    const report = windowErrorToReport({
      message: "render blew up",
      error: err,
      filename: "App.tsx",
      lineno: 12,
      colno: 3,
    });
    expect(report.kind).toBe("window-error");
    expect(report.message).toBe("render blew up");
    expect(report.stack).toBe(err.stack);
    expect(report.extra).toEqual({ filename: "App.tsx", lineno: 12, colno: 3 });
  });

  it("falls back to the Error's own message when no event message is given", () => {
    const err = new Error("only the error has a message");
    const report = windowErrorToReport({ error: err });
    expect(report.message).toBe("only the error has a message");
  });

  it("falls back to a generic message when neither is present", () => {
    const report = windowErrorToReport({});
    expect(report.message).toBe("Uncaught error");
    expect(report.stack).toBeUndefined();
  });
});

describe("rejectionToReport", () => {
  it("extracts message and stack from a real Error rejection reason", () => {
    const err = new Error("promise rejected");
    const report = rejectionToReport(err);
    expect(report.kind).toBe("unhandledrejection");
    expect(report.message).toBe("promise rejected");
    expect(report.stack).toBe(err.stack);
  });

  it("stringifies a non-Error rejection reason", () => {
    const report = rejectionToReport("plain string reason");
    expect(report.message).toBe("plain string reason");
    expect(report.stack).toBeUndefined();
  });

  it("stringifies a rejected plain object without throwing", () => {
    const report = rejectionToReport({ code: 500 });
    expect(report.message).toBe(String({ code: 500 }));
  });
});
