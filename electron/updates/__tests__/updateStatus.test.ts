import { describe, it, expect } from "vitest";
import { parseAutoUpdateFlag, resolveAutoUpdatePreference, summarizeUpdateError } from "../updateStatus";

describe("parseAutoUpdateFlag", () => {
  it("is on when unset or empty", () => {
    expect(parseAutoUpdateFlag(undefined)).toBe(true);
    expect(parseAutoUpdateFlag("")).toBe(true);
    expect(parseAutoUpdateFlag("  ")).toBe(true);
  });

  it("is on for truthy values", () => {
    for (const value of ["true", "1", "yes", "on", "TRUE"]) expect(parseAutoUpdateFlag(value)).toBe(true);
  });

  it("is off for false/0/no/off, any case or padding", () => {
    for (const value of ["false", "0", "no", "off", "FALSE", " Off "]) expect(parseAutoUpdateFlag(value)).toBe(false);
  });
});

describe("summarizeUpdateError", () => {
  it("keeps only the first line of electron-updater's multi-line HTTP errors", () => {
    const error = new Error('Cannot download "https://example.com/Kwesi-1.0.0.AppImage", status 500\n"method: GET url: ..."\nHeaders: {...}');
    expect(summarizeUpdateError(error)).toBe('Cannot download "https://example.com/Kwesi-1.0.0.AppImage", status 500');
  });

  it("explains a published release that's missing its latest*.yml", () => {
    const error = new Error(
      "Cannot find latest-linux.yml in the latest release artifacts (https://github.com/x/y/releases/download/v0.2.0/latest-linux.yml): HttpError: 404 \nHeaders: {...}",
    );
    expect(summarizeUpdateError(error)).toMatch(/missing its update file \(latest-linux\.yml\)/);
  });

  it("explains a repo with no published release (only drafts)", () => {
    const error = new Error("Unable to find latest version on GitHub (https://github.com/x/y/releases/latest), please ensure a production release exists: HttpError: 406\n...");
    expect(summarizeUpdateError(error)).toBe("No published release was found on GitHub yet.");
  });

  it("maps network failures to a plain sentence", () => {
    expect(summarizeUpdateError(new Error("getaddrinfo ENOTFOUND github.com"))).toMatch(/Couldn't reach GitHub/);
    expect(summarizeUpdateError(new Error("net::ERR_INTERNET_DISCONNECTED"))).toMatch(/Couldn't reach GitHub/);
  });

  it("caps very long messages", () => {
    const summary = summarizeUpdateError(new Error("x".repeat(500)));
    expect(summary.length).toBe(198);
    expect(summary.endsWith("…")).toBe(true);
  });

  it("handles non-Error values", () => {
    expect(summarizeUpdateError("boom")).toBe("boom");
    expect(summarizeUpdateError(undefined)).toBe("Unknown error");
  });
});

describe("resolveAutoUpdatePreference", () => {
  it("defaults to on when neither the switch nor the env var is set", () => {
    expect(resolveAutoUpdatePreference(null, undefined)).toEqual({ enabled: true, source: "default" });
    expect(resolveAutoUpdatePreference(null, "")).toEqual({ enabled: true, source: "default" });
  });

  it("uses KWESI_AUTO_UPDATE when the switch was never used", () => {
    expect(resolveAutoUpdatePreference(null, "false")).toEqual({ enabled: false, source: "env" });
    expect(resolveAutoUpdatePreference(null, "true")).toEqual({ enabled: true, source: "env" });
  });

  it("lets the Settings switch override the env var either way", () => {
    expect(resolveAutoUpdatePreference("true", "false")).toEqual({ enabled: true, source: "setting" });
    expect(resolveAutoUpdatePreference("false", "true")).toEqual({ enabled: false, source: "setting" });
    expect(resolveAutoUpdatePreference("false", undefined)).toEqual({ enabled: false, source: "setting" });
  });

  it("ignores a malformed saved value", () => {
    expect(resolveAutoUpdatePreference("maybe", "false")).toEqual({ enabled: false, source: "env" });
  });
});
