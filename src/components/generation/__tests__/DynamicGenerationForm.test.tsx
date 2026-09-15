import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { DynamicGenerationForm } from "../DynamicGenerationForm";
import { getManifest, type ModelManifest } from "../../../data/manifests";

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

  it("disables Generate until the required prompt field is filled in", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderForm(["small"], onSubmit);

    const generateButton = screen.getByRole("button", { name: "Generate" });
    expect(generateButton).toBeDisabled();

    await user.type(screen.getByPlaceholderText(/Upbeat lo-fi hip hop/), "A calm piano piece");
    expect(generateButton).not.toBeDisabled();

    await user.click(generateButton);
    expect(onSubmit).toHaveBeenCalledWith("small", expect.objectContaining({ prompt: "A calm piano piece" }));
  });
});
