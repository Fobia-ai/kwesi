import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { DynamicGenerationForm } from "../DynamicGenerationForm";
import { getManifest, type ModelManifest } from "../../../data/manifests";
import { kwesiHardware } from "../../../lib/hardware";

vi.mock("../../../lib/hardware", () => ({
  kwesiHardware: { gpuVram: vi.fn() },
}));

function renderForm(installedVariantNames: string[], onSubmit = vi.fn()) {
  const manifest = getManifest("musicgen")!;
  render(
    <MemoryRouter>
      <DynamicGenerationForm
        manifest={manifest}
        installedVariantNames={installedVariantNames}
        onSubmit={onSubmit}
      />
    </MemoryRouter>,
  );
  return { manifest, onSubmit };
}

describe("DynamicGenerationForm", () => {
  beforeEach(() => {
    vi.mocked(kwesiHardware.gpuVram).mockReset();
    vi.mocked(kwesiHardware.gpuVram).mockResolvedValue({
      available: true,
      totalVramGb: 24,
      freeVramGb: 24,
      gpuName: "Mock GPU",
    });
  });

  it("shows an install prompt when no variant of the model is installed", () => {
    renderForm([]);
    expect(screen.getByText(/No installed checkpoint for MusicGen/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Model Manager" })).toBeInTheDocument();
  });

  it("shows a 'no trained model' message for a model with zero checkpoint variants", () => {
    // Synthetic fixture rather than a real catalog manifest on purpose: this
    // asserts the component's behavior for the empty-variants case in
    // general, not any specific model's current data (RAVE had zero
    // variants when this test was first written, then gained 9 real
    // installed ones once a human dropped its pretrained .ts files in place
    // — pinning this test to RAVE specifically would have broken on that
    // legitimate data change instead of testing what it's meant to).
    const emptyVariantManifest: ModelManifest = {
      ...getManifest("musicgen")!,
      modelId: "no-variants-fixture",
      checkpointVariants: [],
    };
    render(
      <MemoryRouter>
        <DynamicGenerationForm manifest={emptyVariantManifest} installedVariantNames={[]} onSubmit={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/No trained model available yet/)).toBeInTheDocument();
  });

  it("only shows the melody reference field once the melody variant is selected", async () => {
    const user = userEvent.setup();
    renderForm(["small", "melody"]);

    expect(screen.queryByText("Melody reference (optional)")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Checkpoint variant"), "melody");

    expect(screen.getByText("Melody reference (optional)")).toBeInTheDocument();
  });

  it("hides the melody field again after switching away from the melody variant", async () => {
    const user = userEvent.setup();
    renderForm(["small", "melody"]);

    const variantSelect = screen.getByLabelText("Checkpoint variant");
    await user.selectOptions(variantSelect, "melody");
    expect(screen.getByText("Melody reference (optional)")).toBeInTheDocument();

    await user.selectOptions(variantSelect, "small");
    expect(screen.queryByText("Melody reference (optional)")).not.toBeInTheDocument();
  });

  it("disables Generate until the required prompt and music name fields are filled in", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderForm(["small"], onSubmit);

    const generateButton = screen.getByRole("button", { name: "Generate" });
    expect(generateButton).toBeDisabled();

    await user.type(screen.getByPlaceholderText(/Upbeat lo-fi hip hop/), "A calm piano piece");
    expect(generateButton).toBeDisabled();

    await user.type(screen.getByPlaceholderText(/Midnight Drive/), "My Song");
    expect(generateButton).not.toBeDisabled();

    await user.click(generateButton);
    expect(onSubmit).toHaveBeenCalledWith(
      "small",
      expect.objectContaining({ prompt: "A calm piano piece", music_name: "My Song" }),
    );
  });

  it("shows a hardware warning (but still allows Generate) when free VRAM is below the model's minimum", async () => {
    vi.mocked(kwesiHardware.gpuVram).mockResolvedValue({
      available: true,
      totalVramGb: 8,
      freeVramGb: 1,
      gpuName: "Mock Low-VRAM GPU",
    });
    const user = userEvent.setup();
    renderForm(["small"]);
    await user.type(screen.getByPlaceholderText(/Upbeat lo-fi hip hop/), "A calm piano piece");
    await user.type(screen.getByPlaceholderText(/Midnight Drive/), "My Song");

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent(/Hardware warning/);
    expect(screen.getByRole("button", { name: "Generate" })).not.toBeDisabled();
  });

  it("blocks Generate when no GPU is detected and the model has no CPU fallback", async () => {
    // MusicGen's real manifest has cpuFallback: false — the one case a
    // generation is guaranteed to fail outright, per evaluateHardwareGate's
    // own reasoning in DynamicGenerationForm.tsx.
    vi.mocked(kwesiHardware.gpuVram).mockResolvedValue({ available: false, totalVramGb: 0, freeVramGb: 0 });
    const user = userEvent.setup();
    renderForm(["small"]);

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent(/Hardware requirement not met/);

    await user.type(screen.getByPlaceholderText(/Upbeat lo-fi hip hop/), "A calm piano piece");
    expect(screen.getByRole("button", { name: "Generate" })).toBeDisabled();
  });

  it("shows no hardware banner when the GPU comfortably meets the requirement", async () => {
    renderForm(["small"]);
    await waitFor(() => expect(kwesiHardware.gpuVram).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
