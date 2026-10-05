import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AutoUpdatePreference, UpdateStatus } from "../../../lib/updates";

let current: UpdateStatus = { state: "idle" };
let preference: AutoUpdatePreference = { enabled: true, source: "default" };
const api = {
  getStatus: vi.fn(async () => current),
  check: vi.fn(async () => current),
  download: vi.fn(async () => current),
  install: vi.fn(async () => true),
  getPreference: vi.fn(async () => preference),
  setEnabled: vi.fn(async (enabled: boolean) => {
    preference = { enabled, source: "setting" as const };
    current = enabled ? { state: "idle" } : { state: "disabled", reason: "setting" };
    return { preference, status: current };
  }),
  onStatus: vi.fn(() => () => {}),
};

vi.mock("../../../lib/updates", () => ({
  KWESI_RELEASES_URL: "https://github.com/Fobia-ai/kwesi/releases",
  kwesiUpdates: api,
  useUpdateStatus: () => current,
}));

const { UpdatesSection } = await import("../UpdatesSection");

describe("UpdatesSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    preference = { enabled: true, source: "default" };
  });

  it("offers a check when nothing has been checked yet", async () => {
    current = { state: "idle" };
    render(<UpdatesSection />);
    await userEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(api.check).toHaveBeenCalledOnce();
  });

  it("offers a download when a release is available", async () => {
    current = { state: "available", version: "9.9.9" };
    render(<UpdatesSection />);
    expect(screen.getByText(/Kwesi v9\.9\.9 is available/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Download v9.9.9" }));
    expect(api.download).toHaveBeenCalledOnce();
  });

  it("shows download progress", () => {
    current = { state: "downloading", version: "9.9.9", percent: 42.4, transferred: 1, total: 2, bytesPerSecond: 1 };
    render(<UpdatesSection />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "42");
  });

  it("restarts to install once downloaded", async () => {
    current = { state: "downloaded", version: "9.9.9" };
    render(<UpdatesSection />);
    await userEvent.click(screen.getByRole("button", { name: "Restart to update" }));
    expect(api.install).toHaveBeenCalledOnce();
  });

  it("explains KWESI_AUTO_UPDATE turned it off, and lets the switch override it", async () => {
    current = { state: "disabled", reason: "env" };
    preference = { enabled: false, source: "env" };
    render(<UpdatesSection />);
    expect(screen.getByText("KWESI_AUTO_UPDATE")).toBeInTheDocument();
    expect(await screen.findByText(/Choosing here overrides it/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check for updates" })).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Off" })).toHaveAttribute("aria-checked", "true");

    await userEvent.click(screen.getByRole("radio", { name: "On" }));
    expect(api.setEnabled).toHaveBeenCalledWith(true);
    expect(screen.getByRole("radio", { name: "On" })).toHaveAttribute("aria-checked", "true");
  });

  it("turns updates off from the switch", async () => {
    current = { state: "idle" };
    render(<UpdatesSection />);
    await userEvent.click(await screen.findByRole("radio", { name: "Off" }));
    expect(api.setEnabled).toHaveBeenCalledWith(false);
  });

  it("hides the switch for a launcher-managed install", async () => {
    current = { state: "disabled", reason: "managed" };
    render(<UpdatesSection />);
    await screen.findByText(/Fobia launcher/);
    expect(screen.queryByRole("radio", { name: "On" })).not.toBeInTheDocument();
  });

  it("retries the download, not a fresh check, after a failed download", async () => {
    current = { state: "error", message: "boom", version: "9.9.9" };
    render(<UpdatesSection />);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(api.download).toHaveBeenCalledOnce();
    expect(api.check).not.toHaveBeenCalled();
  });
});
