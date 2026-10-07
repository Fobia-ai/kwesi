import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ResourceCard, type ResourceCheck } from "../ResourceCard";

const check: ResourceCheck = {
  resources: {
    gpu: { available: true, kind: "nvidia", name: "Test GPU", totalVramGb: 24, usedVramGb: 4, freeVramGb: 20, utilizationPct: 0 },
    ram: { totalGb: 64, freeGb: 40 },
    loadedModelIds: [],
    loadedModelDevices: {},
    devicePreference: "auto",
  },
  serverStatus: "stopped",
  requiredVramGb: 6,
  verdict: { level: "ok", headline: "Your GPU can handle this", detail: "It needs about 6 GB, and 20 GB is free.", device: "nvidia" },
};

describe("ResourceCard", () => {
  it("shows the verdict, both meters and the model status before generating", () => {
    render(<ResourceCard check={check} />);
    expect(screen.getByText("Your GPU can handle this")).toBeInTheDocument();
    expect(screen.getByText("4 GB of 24 GB used · needs 6 GB")).toBeInTheDocument();
    expect(screen.getByText("24 GB of 64 GB used")).toBeInTheDocument();
    expect(screen.getByText(/Not loaded yet/)).toBeInTheDocument();
    expect(screen.getByText("NVIDIA GPU")).toBeInTheDocument();
  });

  it("shows one shared memory meter on Apple silicon", () => {
    render(
      <ResourceCard
        check={{
          ...check,
          resources: {
            ...check.resources!,
            gpu: { available: true, kind: "apple", name: "Apple GPU (Metal)", totalVramGb: 32, usedVramGb: 12, freeVramGb: 20, utilizationPct: null },
          },
          verdict: { level: "ok", headline: "Your Mac's GPU can handle this", device: "apple" },
        }}
      />,
    );
    expect(screen.getByText("Memory")).toBeInTheDocument();
    expect(screen.getByText("shared with the GPU")).toBeInTheDocument();
    expect(screen.queryByText("System memory")).not.toBeInTheDocument();
    expect(screen.getByText("Apple GPU")).toBeInTheDocument();
  });

  it("drops the needed share when the track will run on the CPU", () => {
    render(<ResourceCard check={{ ...check, verdict: { level: "ok", headline: "Runs on your CPU", device: "cpu" } }} />);
    expect(screen.getByText("4 GB of 24 GB used")).toBeInTheDocument();
    expect(screen.getByText("CPU")).toBeInTheDocument();
  });

  it("raises a problem as an alert with its explanation", () => {
    render(
      <ResourceCard
        check={{ ...check, verdict: { level: "warn", headline: "Not enough free GPU memory right now", detail: "Only 3 GB is free." } }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Not enough free GPU memory right now");
    expect(screen.getByText("Only 3 GB is free.")).toBeInTheDocument();
  });

  it("says so when there is no GPU", () => {
    render(
      <ResourceCard
        check={{ ...check, resources: { ...check.resources!, gpu: { available: false, kind: "none", totalVramGb: 0, usedVramGb: 0, freeVramGb: 0, utilizationPct: null } } }}
      />,
    );
    expect(screen.getByText("No GPU detected")).toBeInTheDocument();
  });

  it("follows the model through loading while a track is queued", () => {
    const onCancel = vi.fn();
    const { rerender } = render(<ResourceCard check={{ ...check, serverStatus: "starting" }} phase="queued" progress={{ pct: 0, onCancel }} />);
    expect(screen.getByText("Loading into memory…")).toBeInTheDocument();

    rerender(<ResourceCard check={{ ...check, serverStatus: "running" }} phase="running" progress={{ pct: 42, onCancel }} />);
    expect(screen.getByText("Loaded — generating now")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "42");
  });

  it("stops the track from the card", async () => {
    const onCancel = vi.fn();
    render(<ResourceCard check={check} phase="queued" progress={{ pct: 0, onCancel }} />);
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
