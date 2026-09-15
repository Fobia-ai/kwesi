import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { DynamicGenerationForm } from "../DynamicGenerationForm";
import { getManifest, type ModelManifest } from "../../../data/manifests";
import { kwesiHardware } from "../../../lib/hardware";
import type { ArtistProfile } from "../../../lib/artistProfiles";

vi.mock("../../../lib/hardware", () => ({
  kwesiHardware: { gpuVram: vi.fn() },
}));

const MOCK_PROFILES: ArtistProfile[] = [
  {
    id: "artist-1",
    name: "Test Artist",
    bio: null,
    avatarPath: null,
    genres: ["Pop", "Electronic"],
    languages: [],
    createdAt: 0,
    updatedAt: 0,
  },
];

function renderForm(
  installedVariantNames: string[],
  onSubmit = vi.fn(),
  artistProfiles = MOCK_PROFILES,
  modelId = "musicgen",
) {
  const manifest = getManifest(modelId)!;
  render(
    <MemoryRouter>
      <DynamicGenerationForm
        manifest={manifest}
        installedVariantNames={installedVariantNames}
        artistProfiles={artistProfiles}
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
        <DynamicGenerationForm
          manifest={emptyVariantManifest}
          installedVariantNames={[]}
          artistProfiles={MOCK_PROFILES}
          onSubmit={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText(/No trained model available yet/)).toBeInTheDocument();
  });

  it("shows a prompt to create an artist profile when none exist yet", () => {
    renderForm(["small"], vi.fn(), []);
    expect(screen.getByText(/No artist profiles yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create one in Settings" })).toBeInTheDocument();
  });

  it("includes the selected artist profile in submitted values", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const profiles: ArtistProfile[] = [
      { id: "artist-1", name: "Alpha", bio: null, avatarPath: null, genres: ["Pop"], languages: [], createdAt: 0, updatedAt: 0 },
      { id: "artist-2", name: "Beta", bio: null, avatarPath: null, genres: ["Rock"], languages: [], createdAt: 0, updatedAt: 0 },
    ];
    renderForm(["small"], onSubmit, profiles);

    await user.type(screen.getByPlaceholderText(/Upbeat lo-fi hip hop/), "A calm piano piece");
    await user.type(screen.getByPlaceholderText(/Midnight Drive/), "My Song");
    await user.selectOptions(screen.getByLabelText(/Artist profile/), "artist-2");
    await user.click(screen.getByRole("button", { name: "Generate" }));

    expect(onSubmit).toHaveBeenCalledWith("small", expect.objectContaining({ artist_profile_id: "artist-2" }));
  });

  it("defaults the genre picker to all of the selected artist's genres", () => {
    renderForm(["small"]);
    expect(screen.getByRole("button", { name: "Pop", pressed: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Electronic", pressed: true })).toBeInTheDocument();
  });

  it("toggles a genre off and includes only the remaining ones on submit", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderForm(["small"], onSubmit);

    await user.click(screen.getByRole("button", { name: "Pop" }));
    expect(screen.getByRole("button", { name: "Pop", pressed: false })).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText(/Upbeat lo-fi hip hop/), "A calm piano piece");
    await user.type(screen.getByPlaceholderText(/Midnight Drive/), "My Song");
    await user.click(screen.getByRole("button", { name: "Generate" }));

    expect(onSubmit).toHaveBeenCalledWith("small", expect.objectContaining({ artist_genres: ["Electronic"] }));
  });

  it("re-seeds the genre picker to the new artist's genres after switching artists", async () => {
    const user = userEvent.setup();
    const profiles: ArtistProfile[] = [
      { id: "artist-1", name: "Alpha", bio: null, avatarPath: null, genres: ["Pop"], languages: [], createdAt: 0, updatedAt: 0 },
      { id: "artist-2", name: "Beta", bio: null, avatarPath: null, genres: ["Metal"], languages: [], createdAt: 0, updatedAt: 0 },
    ];
    renderForm(["small"], vi.fn(), profiles);

    expect(screen.getByRole("button", { name: "Pop" })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/Artist profile/), "artist-2");

    expect(screen.queryByRole("button", { name: "Pop" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Metal", pressed: true })).toBeInTheDocument();
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

  describe("model genre field", () => {
    // MuseCoco has two genre-shaped pickers on screen at once: the generic
    // "Genres for this track" (artist-catalog strings) and MuseCoco's own
    // fixed-vocabulary field — both can contain a button named "Electronic",
    // so these tests scope queries to MuseCoco's own <fieldset> (accessible
    // name "Genre", its <legend>) rather than querying the whole screen.
    function museCocoGenreGroup() {
      return within(screen.getByRole("group", { name: "Genre" }));
    }

    it("pre-checks MuseCoco's genre options that map from the artist's genres", () => {
      renderForm(["default"], vi.fn(), MOCK_PROFILES, "musecoco");
      // MOCK_PROFILES' artist has ["Pop", "Electronic"] -- "Pop / Rock" maps
      // from "Pop", "Electronic" maps from "Electronic"; "New Age" has no
      // app-genre equivalent and should stay unchecked.
      const group = museCocoGenreGroup();
      expect(group.getByRole("button", { name: "Pop / Rock", pressed: true })).toBeInTheDocument();
      expect(group.getByRole("button", { name: "Electronic", pressed: true })).toBeInTheDocument();
      expect(group.getByRole("button", { name: "New Age", pressed: false })).toBeInTheDocument();
    });

    it("lets the user add a MuseCoco-only genre with no app-genre equivalent and submits the real server tokens", async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      renderForm(["default"], onSubmit, MOCK_PROFILES, "musecoco");

      await user.click(museCocoGenreGroup().getByRole("button", { name: "New Age" }));
      await user.type(screen.getByPlaceholderText(/Midnight Drive/), "My Song");
      await user.click(screen.getByRole("button", { name: "Generate" }));

      expect(onSubmit).toHaveBeenCalledWith(
        "default",
        expect.objectContaining({ genre: expect.arrayContaining(["pop_rock", "electronic", "new_age"]) }),
      );
    });

    it("pre-fills ACE-Step's free-text genre tags from the artist's genres", () => {
      renderForm(["acestep-v15-base"], vi.fn(), MOCK_PROFILES, "ace-step-1.5");
      expect(screen.getByLabelText(/Genre tags/)).toHaveValue("Pop, Electronic");
    });

    it("doesn't clobber a manually-edited genre field just from re-rendering", async () => {
      const user = userEvent.setup();
      renderForm(["acestep-v15-base"], vi.fn(), MOCK_PROFILES, "ace-step-1.5");

      const genreInput = screen.getByLabelText(/Genre tags/);
      await user.clear(genreInput);
      await user.type(genreInput, "Custom genre text");

      expect(genreInput).toHaveValue("Custom genre text");
    });
  });

  describe("model language field", () => {
    it("pre-fills ACE-Step's vocal_language select from the artist's primary language", () => {
      const profiles: ArtistProfile[] = [
        {
          id: "artist-1",
          name: "Alpha",
          bio: null,
          avatarPath: null,
          genres: [],
          languages: ["es", "fr"],
          createdAt: 0,
          updatedAt: 0,
        },
      ];
      renderForm(["acestep-v15-base"], vi.fn(), profiles, "ace-step-1.5");
      // Primary (first) language only -- "es", not "fr".
      expect(screen.getByLabelText(/Vocal language/)).toHaveValue("es");
    });

    it("leaves ACE-Step's vocal_language at its manifest default when the artist has no language set", () => {
      renderForm(["acestep-v15-base"], vi.fn(), MOCK_PROFILES, "ace-step-1.5");
      expect(screen.getByLabelText(/Vocal language/)).toHaveValue("en");
    });

    it("pre-fills YuE2's free-text language hint from the artist's primary language, by name", () => {
      const profiles: ArtistProfile[] = [
        {
          id: "artist-1",
          name: "Alpha",
          bio: null,
          avatarPath: null,
          genres: [],
          languages: ["ja"],
          createdAt: 0,
          updatedAt: 0,
        },
      ];
      renderForm(["yue2-3b"], vi.fn(), profiles, "yue2");
      expect(screen.getByLabelText(/Vocal language/)).toHaveValue("Japanese");
    });

    it("doesn't block submission when the artist has no language set", async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      renderForm(["yue2-3b"], onSubmit, MOCK_PROFILES, "yue2");

      await user.type(screen.getByLabelText(/Lyrics/), "Some real lyrics");
      await user.type(screen.getByPlaceholderText(/Midnight Drive/), "My Song");
      await user.click(screen.getByRole("button", { name: "Generate" }));

      expect(onSubmit).toHaveBeenCalledWith("yue2-3b", expect.objectContaining({ vocal_language: "" }));
    });

    it("re-seeds the language field after switching to an artist with a different language", async () => {
      const user = userEvent.setup();
      const profiles: ArtistProfile[] = [
        {
          id: "artist-1",
          name: "Alpha",
          bio: null,
          avatarPath: null,
          genres: [],
          languages: ["es"],
          createdAt: 0,
          updatedAt: 0,
        },
        {
          id: "artist-2",
          name: "Beta",
          bio: null,
          avatarPath: null,
          genres: [],
          languages: ["ja"],
          createdAt: 0,
          updatedAt: 0,
        },
      ];
      renderForm(["acestep-v15-base"], vi.fn(), profiles, "ace-step-1.5");

      expect(screen.getByLabelText(/Vocal language/)).toHaveValue("es");

      await user.selectOptions(screen.getByLabelText(/Artist profile/), "artist-2");

      expect(screen.getByLabelText(/Vocal language/)).toHaveValue("ja");
    });
  });

  describe("submit normalization", () => {
    it("sends a cleared optional number field as null, not the empty string", async () => {
      // Real regression: servers/musecoco/server.py's tempo_bucket()/
      // bar_bucket() do an unguarded int(x)/numeric compare and throw a
      // 500 on the literal string "" -- a cleared-but-optional number
      // field must become null before it reaches any server.
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      renderForm(["default"], onSubmit, MOCK_PROFILES, "musecoco");

      const tempoInput = screen.getByLabelText(/Tempo \(BPM\)/);
      await user.clear(tempoInput);
      await user.type(screen.getByPlaceholderText(/Midnight Drive/), "My Song");
      await user.click(screen.getByRole("button", { name: "Generate" }));

      expect(onSubmit).toHaveBeenCalledWith("default", expect.objectContaining({ tempo_bpm: null }));
    });
  });
});
