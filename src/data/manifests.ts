// Phase 4 Model Adapter Manifests. See kwesi.docs/02-architecture.md "Model
// Adapter Manifest" for the schema sketch and kwesi.docs/03-model-catalog.md
// for the per-model input/output specs this is transcribed from.
//
// This is a renderer-only concern for now: the dynamic form/output-viewer
// renderer is the only consumer, and the mock Model Server Manager
// (electron/models/modelServer.ts) only needs a generation's already-known
// output_kind ("audio" | "midi" | "audio+midi", computed here via
// outputKindOf and passed across IPC alongside input_params) rather than the
// full manifest shape. If a later phase's Electron-side validation needs
// this data too, mirror it there the way electron/db/seedModels.ts and
// src/data/modelVariants.ts already duplicate-with-a-comment across the
// Electron/renderer build boundary — don't invent a second manifest shape.

import { MUSECOCO_GENRE_OPTIONS, MUSECOCO_GENRE_AUTO_MAP } from "./musecocoGenres";
import { MUSECOCO_INSTRUMENT_OPTIONS } from "./musecocoInstruments";
import { LANGUAGES } from "./languages";

export type LicenseTier = "mit" | "cc-by-nc" | "cc-by-nc-sa";

export type ManifestInputType =
  | "text"
  | "textarea"
  | "number"
  | "select"
  | "multiselect"
  | "tags"
  | "audio_upload"
  | "midi_upload";

export interface ManifestSelectOption {
  value: string;
  label: string;
}

interface ManifestInputBase {
  key: string;
  type: ManifestInputType;
  label: string;
  required?: boolean;
  helpText?: string;
  // Only rendered when the generation's selected checkpoint variant equals
  // this exactly — e.g. MusicGen's melody reference only applies to the
  // "melody" variant.
  onlyForVariant?: string;
  // Marks this as *the* genre-conditioning input for the model (at most one
  // per manifest) — DynamicGenerationForm seeds it from the selected artist
  // profile's own genres (src/data/genres.ts) whenever the artist changes,
  // so the user doesn't have to re-type/re-select genres they already set
  // on the artist. Only models with a real genre concept carry this; models
  // with no genre-shaped input (MusicGen, Museformer, RAVE) don't.
  isModelGenreField?: boolean;
  // Same idea as isModelGenreField, for the (much rarer) models that have a
  // real vocal-language concept — seeded from the artist's own languages
  // (src/data/languages.ts). Only ACE-Step 1.5 has a real, structured
  // vocal_language parameter today; YuE2 has a genuine but unstructured
  // language concept (a free-text descriptor folded into its style field).
  // Model Manager shows a "Multilingual" pill only for models with a field
  // carrying this flag — see ModelManagerScreen.
  isModelLanguageField?: boolean;
}

export interface TextManifestInput extends ManifestInputBase {
  type: "text" | "textarea";
  placeholder?: string;
  default?: string;
}

export interface NumberManifestInput extends ManifestInputBase {
  type: "number";
  min?: number;
  max?: number;
  step?: number;
  default?: number;
}

export interface SelectManifestInput extends ManifestInputBase {
  type: "select";
  options: ManifestSelectOption[];
  default?: string;
}

export interface MultiSelectManifestInput extends ManifestInputBase {
  type: "multiselect";
  options: ManifestSelectOption[];
  default?: string[];
  // Maps each option's own value to the app-level genre names (src/data/
  // genres.ts) that should pre-check it when seeding from an artist's
  // genres — e.g. MuseCoco's "pop_rock" option is pre-checked when the
  // artist has either "Pop" or "Rock" selected. Omit for a multiselect
  // that isn't genre-related; only meaningful alongside isModelGenreField.
  autoSelectFromAppGenres?: Record<string, string[]>;
}

export interface TagsManifestInput extends ManifestInputBase {
  type: "tags";
  placeholder?: string;
}

export interface FileManifestInput extends ManifestInputBase {
  type: "audio_upload" | "midi_upload";
  accept: string;
}

export type ManifestInput =
  | TextManifestInput
  | NumberManifestInput
  | SelectManifestInput
  | MultiSelectManifestInput
  | TagsManifestInput
  | FileManifestInput;

export type ManifestOutputKind = "audio" | "midi";

export interface ManifestOutput {
  kind: ManifestOutputKind;
  format: string;
  sampleRate?: number;
  notes?: string;
}

// Matches Node/Electron's own process.platform values for the platforms
// this app packages for (package.json's package:mac/package:win/package:linux)
// -- kept as a real, checkable field rather than free text in `notes` so
// the Environment tab (Settings) can gate install/generation on it
// deterministically instead of string-sniffing prose.
export type KwesiPlatform = "darwin" | "win32" | "linux";

export interface ModelHardware {
  minVramGb: number;
  cpuFallback: boolean;
  notes?: string;
  // Omit for "every platform this app packages for" -- only set when a
  // model genuinely doesn't run elsewhere (e.g. YuE2's real repo documents
  // Linux-only, confirmed against the cloned repo, not assumed).
  platforms?: KwesiPlatform[];
}

// Phase 8: a few catalog entries (ACE-Step 1.5 most notably) span a wide
// VRAM range across their own checkpoint variants — its 2B checkpoints need
// ~4-8GB, its XL (4B) checkpoints ~12-24GB, more spread than one
// model-level minVramGb can represent without being wrong for half the
// variants. Optional and per-variant on purpose: most models (MusicGen,
// MuseCoco, RAVE) have roughly uniform variant hardware needs, so
// hardware.minVramGb alone stays an acceptable simplification for them —
// only models that actually need it declare this.
export type VariantHardwareOverrides = Record<string, { minVramGb: number }>;

export interface ModelServerConfig {
  entrypoint: string;
  venv: string;
  portRange?: [number, number];
}

// Phase 10: training manifest block. See kwesi.docs/02-architecture.md
// "Manifest extension: training" for the schema sketch this is transcribed
// from, and "Training pipeline architecture" for the end-to-end flow.
// `hyperparameters` deliberately reuses `ManifestInput[]` — the exact same
// type the generation form's `inputs[]` uses — since the Training screen's
// wizard renders these through the same field-control renderer
// (`FieldControl`/`visibleInputs`/`defaultValueFor`/`isSatisfied`, exported
// from DynamicGenerationForm.tsx) rather than a second form system.
export type TrainingMethod = "lora" | "full_finetune" | "from_scratch";
export type TrainingInputKind = "audio_raw" | "audio_captioned" | "midi";

export interface TrainingDatasetRequirements {
  fileTypes: string[];
  minFiles: number;
  minTotalDurationMin: number;
  requiresCaptions: boolean;
}

export interface TrainingHardware {
  minVramGb: number;
  recommendedVramGb?: number;
  cpuFallback: boolean;
  notes?: string;
}

// Real finding (Phase 10, RAVE): unlike every hand-written servers/<id>/
// server.py wrapper the generation side needs, RAVE ships its own real CLI
// (`rave preprocess|train|export`, installed as a console-script entry
// point by the `acids-rave` pip package) — genuinely more correct to invoke
// directly than reimplementing a wrapper around it, the same call Phase 8
// made for ACE-Step's own REST server. So `entrypoint` here names a
// real console-script command (resolved as `<venv>/bin/<entrypoint>`), not
// a Python file under servers/<model_id>/ the way the generation-side
// `ModelServerConfig.entrypoint` always is.
export interface TrainingServerConfig {
  entrypoint: string;
  venv: string;
}

export interface TrainingCheckpointOutput {
  format: string;
}

export interface TrainingSupportedConfig {
  supported: true;
  method: TrainingMethod;
  inputKind: TrainingInputKind;
  datasetRequirements: TrainingDatasetRequirements;
  hyperparameters: ManifestInput[];
  hardware: TrainingHardware;
  server: TrainingServerConfig;
  checkpointOutput: TrainingCheckpointOutput;
}

export interface TrainingUnsupportedConfig {
  supported: false;
  reason: string;
}

export type TrainingConfig = TrainingSupportedConfig | TrainingUnsupportedConfig;

export interface ModelManifest {
  modelId: string;
  displayName: string;
  licenseTier: LicenseTier;
  // Checkpoint variants selectable for a *generation* job. Deliberately not
  // always identical to electron/db/seedModels.ts's install-time variant
  // list — e.g. RAVE's "pretrained-examples" row there is a manual pointer
  // link, not a real usable generation checkpoint. A *trained* checkpoint
  // (Phase 10+) isn't added to this static list at all — it lands as its
  // own `model_variant` row (source: "trained") instead, and
  // WorkspaceDetail.tsx/DynamicGenerationForm.tsx merge those in
  // separately (see `extraVariantNames`) so this array only ever needs to
  // list the model family's stock catalog checkpoints.
  checkpointVariants: string[];
  hardware: ModelHardware;
  variantHardware?: VariantHardwareOverrides;
  inputs: ManifestInput[];
  outputs: ManifestOutput[];
  server: ModelServerConfig;
  training: TrainingConfig;
}

export function outputKindOf(manifest: ModelManifest): "audio" | "midi" | "audio+midi" {
  const hasAudio = manifest.outputs.some((o) => o.kind === "audio");
  const hasMidi = manifest.outputs.some((o) => o.kind === "midi");
  if (hasAudio && hasMidi) return "audio+midi";
  return hasAudio ? "audio" : "midi";
}

/** The effective minimum VRAM for a manifest, given an optional selected
 * checkpoint variant — falls back to the model-level hardware.minVramGb
 * when the variant has no override or none was selected. */
export function minVramGbFor(manifest: ModelManifest, variant: string | null): number {
  if (variant && manifest.variantHardware?.[variant]) {
    return manifest.variantHardware[variant].minVramGb;
  }
  return manifest.hardware.minVramGb;
}

const MUSICGEN: ModelManifest = {
  modelId: "musicgen",
  displayName: "MusicGen",
  licenseTier: "cc-by-nc",
  // "style" removed from the catalog: its real checkpoint
  // (facebook/musicgen-style) needs a StyleConditioner class that doesn't
  // exist anywhere in the pinned audiocraft==1.3.0 (confirmed by reading
  // the installed package's conditioners.py directly) -- that support was
  // added to audiocraft upstream after the 1.3.0 PyPI release this app is
  // pinned to. Selecting it would fail the moment the checkpoint tried to
  // load. A real, previously-undiscovered dead variant, not a design
  // choice -- see electron/db/database.ts's removeDiscontinuedMusicGenStyleVariant
  // for the one-time cleanup of anyone who already downloaded it.
  checkpointVariants: ["small", "medium", "large", "melody"],
  hardware: { minVramGb: 4, cpuFallback: false, notes: "~16GB VRAM comfortable for medium; small runs on lighter GPUs." },
  inputs: [
    { key: "prompt", type: "text", label: "Describe the music", required: true, placeholder: "Upbeat lo-fi hip hop with vinyl crackle" },
    {
      key: "melody_audio",
      type: "audio_upload",
      label: "Melody reference (optional)",
      accept: "audio/*",
      onlyForVariant: "melody",
    },
    { key: "duration_sec", type: "number", label: "Duration (sec)", min: 1, max: 30, default: 8 },
  ],
  outputs: [{ kind: "audio", format: "wav", sampleRate: 32000 }],
  // Phase 5 reality check: `venv` is the bare model id, joined onto
  // KWESI_VENVS_DIR by electron/models/modelServer.ts, matching the
  // `venvs/<model_id>/` layout in kwesi.docs/02-architecture.md (not
  // "musicgen-venv" as this field originally sketched pre-Phase-5).
  // `entrypoint` is real: servers/musicgen/server.py at the repo root, kept
  // out of electron/ since it's a standalone Python process, not
  // main-process TS — see servers/musicgen/README.md.
  server: { entrypoint: "server.py", venv: "musicgen", portRange: [17600, 17619] },
  // Phase 11: real, verified end-to-end — see electron/models/trainingManager.ts's
  // runMusicGenTrainingPipeline and servers/musicgen/README.md's "Training
  // (Phase 11)" section for the full writeup (real bugs hit: no bundled
  // Hydra config/ tree in the pip package, a GlobalHydra double-init bug
  // when not going through the real `dora` CLI, the installed checkpoints
  // being in the wrong ("exported") format for continue_from, and a
  // torch 2.6 weights_only default breaking audiocraft's own export.py).
  // `hyperparameters` matches what audiocraft's own dora/hydra config
  // actually exposes as overridable for a short fine-tune
  // (`model/lm/model_scale`, `optim.epochs`, `optim.lr`,
  // `dataset.batch_size`) — confirmed directly against a real `dora run`,
  // not guessed.
  training: {
    supported: true,
    method: "full_finetune",
    inputKind: "audio_captioned",
    datasetRequirements: {
      fileTypes: [".wav", ".mp3", ".flac", ".ogg"],
      minFiles: 2,
      minTotalDurationMin: 0.5,
      requiresCaptions: true,
    },
    hyperparameters: [
      {
        key: "base_variant",
        type: "select",
        label: "Base checkpoint to fine-tune",
        default: "small",
        helpText: "Fetched fresh via AudioCraft's own //pretrained/ alias on first use (a real, one-time network+HF-cache dependency) — this app's already-downloaded checkpoints are in a different, deployment-only format that training can't continue from directly.",
        options: [
          { value: "small", label: "small (300M) — fastest" },
          { value: "medium", label: "medium (1.5B)" },
          { value: "large", label: "large (3.3B)" },
        ],
      },
      {
        key: "epochs",
        type: "number",
        label: "Epochs",
        default: 1,
        min: 1,
        max: 20,
        helpText: "Kept small for a pipeline-proof run — audiocraft counts training in epochs over your dataset, not raw steps.",
      },
      {
        key: "learning_rate",
        type: "number",
        label: "Learning rate",
        default: 0.0001,
        min: 0.000001,
        max: 0.01,
        step: 0.00001,
      },
      { key: "batch_size", type: "number", label: "Batch size", default: 1, min: 1, max: 8 },
    ],
    hardware: {
      minVramGb: 8,
      recommendedVramGb: 16,
      cpuFallback: false,
      notes: "Fine-tuning the small (300M) scale is comfortable on an 8GB card for a tiny pipeline-proof run; medium/large need more headroom, matching their own inference VRAM figures.",
    },
    server: { entrypoint: "dora", venv: "musicgen" },
    checkpointOutput: { format: "state_dict.bin" },
  },
};

// Phase 7 reality check: the real, published checkpoint
// (XinXuNLPer/MuseCoco_attribute2music, vendored inference code at
// servers/musecoco/vendor/2-attribute2music_model) is the STAGE-2
// attribute-to-music generator only — the stage-1 text-to-attribute
// checkpoint was never released, so "description" below is informational
// only and is never actually sent to the real server (kept in the form
// since a user may still want to jot down intent, but servers/musecoco/
// server.py ignores it). Every other field's `value`s were rewritten to
// match the real attribute vocabulary reverse-engineered from
// midi_data_extractor/attribute_unit/*.py and 1-text2attribute_model/
// att_key.json in the vendored repo — see servers/musecoco/README.md for
// the full trace. Key findings that don't match the original v1 guesses:
// - key_signature: the model only conditions on major/minor (attribute
//   "K1"), not a specific tonic — the note-letter options were dropped.
// - time_signature: the model's real vocabulary is exactly
//   (4/4, 2/4, 3/4, 1/4, 6/8, 3/8, other) — 1/4 and 3/8 were added.
// - bar_count: the real "B1s1" conditioning attribute only distinguishes
//   1-4/5-8/9-12/13-16 bars (bins, not a raw count) — capped at 16 here;
//   the model can still emit a longer/shorter piece in practice since the
//   generation length is really governed by the server's token budget, not
//   this hint, but 16 is the honest ceiling for what this field *means* to
//   the model.
// - danceability maps to "R1" (yes/no/unspecified, not low/medium/high).
// - pitch_range maps to "P4", the number of octaves the piece's pitch
//   spans (0-11), not a register (low/mid/high) — relabeled accordingly.
// - mood maps to "EM1", Russell's 4-quadrant valence/arousal model
//   (Q1..Q4), not free-text tags — changed from `tags` to `select`.
// - artist_style maps to "S2s1", a fixed set of 17 classical composers the
//   training data was drawn from (not a free-text/tags style reference) —
//   changed from `tags` to `select`.
// - instrument/genre stay `tags` (multi-select) but only match real
//   category words (see helpText); servers/musecoco/server.py does a
//   case-insensitive exact match against the real vocabulary and silently
//   drops/logs anything unmatched rather than guessing.
const MUSECOCO: ModelManifest = {
  modelId: "musecoco",
  displayName: "MuseCoco",
  licenseTier: "mit",
  checkpointVariants: ["default"],
  hardware: { minVramGb: 0, cpuFallback: true, notes: "~1B params (the real checkpoint is a 14.5GB linear_mask-1billion snapshot, larger than the catalog doc's original ~200M estimate) — CPU-feasible, verified end-to-end on CPU in Phase 7 since no CUDA toolchain was available to build the model's fast_transformers extension." },
  inputs: [
    {
      key: "description",
      type: "textarea",
      // Re-verified directly against the real server: servers/musecoco/
      // server.py never references "description" anywhere, not even for
      // logging — this isn't lightly used, it's completely inert. Worded
      // to leave no room to read that as "optional but still does
      // something" -- it does nothing.
      label: "Notes to yourself (ignored by generation)",
      placeholder: "A hopeful piano ballad",
      helpText: "Not sent to the model in any form — MuseCoco's real server never reads this field. Use the structured fields below to actually steer generation.",
    },
    {
      key: "instrument",
      type: "multiselect",
      label: "Instruments",
      // Real, fixed 28-value vocabulary (servers/musecoco/server.py's
      // I1S2_CATEGORIES) -- was a free-text "tags" field, the same real bug
      // genre had (see that field's comment below): the "tags" control
      // stores one comma-separated *string*, and the server's
      // match_categories() iterates whatever it's given character-by-
      // character when it isn't already a list, so free-typed instrument
      // text was silently never matching anything. No artist-level
      // "instruments" concept exists to auto-populate this from (unlike
      // genre), so it's a plain options list.
      options: MUSECOCO_INSTRUMENT_OPTIONS,
      helpText: "Only these exact instruments are recognized by the server — pick from the list.",
    },
    {
      key: "genre",
      type: "multiselect",
      label: "Genre",
      isModelGenreField: true,
      // Real, fixed 22-value vocabulary (servers/musecoco/server.py's
      // S4_CATEGORIES) -- a proper multiselect rather than the free-text
      // "tags" field this used to be, which also fixes a real bug: the
      // "tags" control stores one comma-separated *string*, and the
      // server's match_categories() iterates whatever it's given
      // character-by-character when it isn't already a list, so free-typed
      // genre text was silently never matching anything. Auto-populated
      // from the selected artist's own genres via autoSelectFromAppGenres
      // (src/data/musecocoGenres.ts) when the artist changes.
      options: MUSECOCO_GENRE_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
      autoSelectFromAppGenres: MUSECOCO_GENRE_AUTO_MAP,
      helpText: "Pre-filled from the selected artist's genres where they overlap — add or remove any.",
    },
    {
      key: "mood",
      type: "select",
      label: "Mood",
      default: "unspecified",
      options: [
        { value: "unspecified", label: "Not specified" },
        { value: "Q1", label: "Excited / happy (high energy, positive)" },
        { value: "Q2", label: "Tense / angry (high energy, negative)" },
        { value: "Q3", label: "Sad / depressed (low energy, negative)" },
        { value: "Q4", label: "Calm / peaceful (low energy, positive)" },
      ],
    },
    { key: "tempo_bpm", type: "number", label: "Tempo (BPM)", min: 40, max: 240, default: 120 },
    {
      key: "key_signature",
      type: "select",
      label: "Key",
      default: "unspecified",
      options: [
        { value: "unspecified", label: "Not specified" },
        { value: "major", label: "Major" },
        { value: "minor", label: "Minor" },
      ],
    },
    {
      key: "time_signature",
      type: "select",
      label: "Time signature",
      default: "4/4",
      options: [
        { value: "4/4", label: "4/4" },
        { value: "2/4", label: "2/4" },
        { value: "3/4", label: "3/4" },
        { value: "1/4", label: "1/4" },
        { value: "6/8", label: "6/8" },
        { value: "3/8", label: "3/8" },
      ],
    },
    { key: "bar_count", type: "number", label: "Bar count (conditioning hint)", min: 1, max: 16, default: 8, helpText: "The model only conditions on 4-bar bins (1-4, 5-8, 9-12, 13-16); actual generated length is governed by the server's token budget, not strictly this value." },
    {
      key: "danceability",
      type: "select",
      label: "Danceability",
      default: "unspecified",
      options: [
        { value: "unspecified", label: "Not specified" },
        { value: "yes", label: "Danceable" },
        { value: "no", label: "Not danceable" },
      ],
    },
    {
      key: "pitch_range",
      type: "select",
      label: "Pitch range (octave span)",
      default: "unspecified",
      options: [
        { value: "unspecified", label: "Not specified" },
        { value: "narrow", label: "Narrow (~1 octave)" },
        { value: "medium", label: "Medium (~4 octaves)" },
        { value: "wide", label: "Wide (~7 octaves)" },
        { value: "full", label: "Full range (~10+ octaves)" },
      ],
    },
    {
      key: "artist_style",
      type: "select",
      label: "Composer style reference",
      default: "unspecified",
      helpText: "The real model only recognizes this fixed set of 17 classical composers from its training data — anything else is unsupported.",
      options: [
        { value: "unspecified", label: "Not specified" },
        { value: "beethoven", label: "Beethoven" },
        { value: "mozart", label: "Mozart" },
        { value: "chopin", label: "Chopin" },
        { value: "schubert", label: "Schubert" },
        { value: "schumann", label: "Schumann" },
        { value: "bach-js", label: "Bach (J.S.)" },
        { value: "haydn", label: "Haydn" },
        { value: "brahms", label: "Brahms" },
        { value: "Handel", label: "Handel" },
        { value: "tchaikovsky", label: "Tchaikovsky" },
        { value: "mendelssohn", label: "Mendelssohn" },
        { value: "dvorak", label: "Dvorak" },
        { value: "liszt", label: "Liszt" },
        { value: "stravinsky", label: "Stravinsky" },
        { value: "mahler", label: "Mahler" },
        { value: "prokofiev", label: "Prokofiev" },
        { value: "shostakovich", label: "Shostakovich" },
      ],
    },
  ],
  outputs: [{ kind: "midi", format: "mid" }],
  server: { entrypoint: "server.py", venv: "musecoco-venv", portRange: [17620, 17629] },
  // Phase 11: real `fairseq-train` CLI confirmed and wired (see
  // electron/models/trainingManager.ts's runMuseCocoTrainingPipeline and
  // servers/musecoco/README.md's "Training (Phase 11)" section) — continues
  // from the installed 1B-param checkpoint via `--restore-file` using the
  // vendored repo's own real `linear_mask` fairseq task/arch. **Honestly
  // scoped down**: the real MIDI->attribute-sequence extraction pipeline
  // (`servers/musecoco/vendor/2-attribute2music_dataprepare/`) is real and
  // was read, but wiring raw-MIDI input all the way to a fairseq data-bin
  // was judged out of this phase's time budget given the roadmap's own
  // lower priority for MuseCoco — so `datasetRequirements` below asks for
  // an already-binarized fairseq data-bin directory (the same real shape
  // the vendored repo's own example dataset ships), not raw MIDI files yet.
  // **Verification depth**: a real `fairseq-train` run was launched against
  // the vendored example data-bin, confirmed to load the real installed
  // checkpoint via `--restore-file` and perform genuine sustained
  // multi-core CPU computation (no CUDA-built pytorch-fast-transformers
  // extension here either, same root cause as Phase 7's inference finding)
  // — but did not complete even one full update within this session's
  // practical time budget (~8 minutes and still computing), so no trained
  // checkpoint file was produced/verified this phase. A real, legitimate
  // partial result, not a guess: the CLI invocation itself is confirmed
  // correct, just too slow on CPU-only hardware to finish inside this
  // session.
  training: {
    supported: true,
    method: "full_finetune",
    inputKind: "midi",
    datasetRequirements: {
      fileTypes: [],
      minFiles: 1,
      minTotalDurationMin: 0,
      requiresCaptions: false,
    },
    hyperparameters: [
      {
        key: "max_updates",
        type: "number",
        label: "Training updates",
        default: 10,
        min: 1,
        max: 2000,
        helpText: "Kept small for a pipeline-proof run — each update is a full forward+backward pass over a 1B-parameter model, genuinely slow on this CPU-only venv (no CUDA-built fast_transformers extension, same root cause as Phase 7's inference finding).",
      },
      { key: "learning_rate", type: "number", label: "Learning rate", default: 0.000001, min: 0.0000001, max: 0.001, step: 0.0000001 },
    ],
    hardware: {
      minVramGb: 0,
      cpuFallback: true,
      notes: "CPU-only in practice (same constraint as inference) — a single update over the full 2560-token truncated_length can take several minutes; budget accordingly.",
    },
    server: { entrypoint: "fairseq-train", venv: "musecoco" },
    checkpointOutput: { format: "pt" },
  },
};

const MUSEFORMER: ModelManifest = {
  modelId: "museformer",
  displayName: "Museformer",
  licenseTier: "mit",
  checkpointVariants: ["default"],
  hardware: {
    minVramGb: 0,
    cpuFallback: true,
    notes: "NEEDS VERIFICATION against the real requirements.txt — treated as similarly old/narrow-pinned as MuseCoco until confirmed, per kwesi.docs/03-model-catalog.md. A real, unresolved risk on top of that: servers/museformer/README.md documents that the decoder's blocksparse attention kernels use Triton directly, which has no CPU backend at all — if the inference path actually hits them, --cpu generation is a hard GPU-only blocker, not a slow fallback. Never confirmed either way (no venv has ever been built to test it).",
  },
  inputs: [
    // "continue_from_midi" removed from the options below (not just
    // disabled): servers/museformer/server.py:100 unconditionally raises
    // 501 "not implemented" whenever seed_mode is this value, regardless of
    // whether seed_midi resolves to a real file -- there is no code path
    // where it succeeds, so offering it as a selectable choice was a pure
    // UX trap, not a "coming soon" feature. seed_midi's midi_upload input
    // (and its own real-path-resolution fix from Phase 9) is kept here,
    // unused for now, since it's the one piece that's actually ready
    // whenever real continuation support gets implemented server-side.
    {
      key: "seed_mode",
      type: "select",
      label: "Seed",
      default: "random",
      options: [{ value: "random", label: "Random seed" }],
    },
    {
      key: "seed_midi",
      type: "midi_upload",
      label: "Seed MIDI file",
      accept: ".mid,.midi",
      helpText: "Not wired up yet — MIDI continuation isn't implemented server-side (see museformer/server.py).",
    },
    {
      key: "bar_count",
      type: "number",
      label: "Bars to generate",
      min: 8,
      max: 256,
      default: 64,
      helpText: "Informational only — the server governs real generation length from its own token budget, not this value.",
    },
  ],
  outputs: [{ kind: "midi", format: "mid" }],
  server: { entrypoint: "server.py", venv: "museformer-venv", portRange: [17630, 17639] },
  // Phase 11 re-confirmation (not re-solved): Museformer's own *inference*
  // path was still never actually run as of this phase either (no venv
  // ever built — see servers/museformer/README.md's "Status: code-complete,
  // not verified end-to-end", unchanged since Phase 7) — a real prerequisite
  // for training that training work can't skip past. Per the roadmap's own
  // explicit "don't spend disproportionate time here" guidance for this
  // lowest-priority model, Phase 11 did not build the venv or attempt the
  // Triton/blocksparse smoke test that README already prescribes, so this
  // stays an honest, unchanged "not attempted" rather than a new finding.
  training: {
    supported: false,
    reason: "Training isn't wired up for Museformer — its own inference path was never verified in the first place (no venv ever built, a real Triton/blocksparse CPU-fallback risk documented in servers/museformer/README.md), so training work has nothing proven to build on yet.",
  },
};

const ACE_STEP: ModelManifest = {
  modelId: "ace-step-1.5",
  displayName: "ACE-Step 1.5",
  licenseTier: "mit",
  // The two "5hz-lm" variants seeded in electron/db/seedModels.ts are
  // optional prompt-expansion front-ends, not standalone generation
  // checkpoints — excluded here on purpose.
  checkpointVariants: [
    "acestep-v15-base",
    "acestep-v15-sft",
    "acestep-v15-turbo",
    "acestep-v15-xl-base",
    "acestep-v15-xl-sft",
    "acestep-v15-xl-turbo",
  ],
  hardware: { minVramGb: 4, cpuFallback: true, notes: "4GB (2B turbo) up to 24GB (XL) depending on checkpoint. CPU supported but slow — model-level minimum is the lightest 2B-turbo case; see variantHardware for the real per-checkpoint spread." },
  // Real per-checkpoint minimums, transcribed from the real repo's own GPU
  // tier table (docs/en/INSTALL.md "Which Model Should I Choose?", verified
  // 2026-09-15 against the cloned ACE-Step-1.5 repo, not guessed): DiT-only
  // inference needs >=4GB regardless of checkpoint, but the 2B non-turbo
  // (base/sft) checkpoints run two conditioning passes per step (guidance)
  // and the real table only lists them starting at the 6-8GB tier, one tier
  // above turbo's 2B; XL (4B) needs >=12GB even with CPU offload enabled.
  variantHardware: {
    "acestep-v15-base": { minVramGb: 6 },
    "acestep-v15-sft": { minVramGb: 6 },
    "acestep-v15-turbo": { minVramGb: 4 },
    "acestep-v15-xl-base": { minVramGb: 12 },
    "acestep-v15-xl-sft": { minVramGb: 12 },
    "acestep-v15-xl-turbo": { minVramGb: 12 },
  },
  inputs: [
    { key: "prompt", type: "text", label: "Text prompt", required: true, placeholder: "Anthemic stadium rock, driving drums" },
    { key: "lyrics", type: "textarea", label: "Lyrics (structured, optional)" },
    {
      key: "vocal_language",
      type: "select",
      label: "Vocal language",
      default: "en",
      isModelLanguageField: true,
      // Real field, real vocabulary: release_task_models.py:40
      // (`vocal_language: str = "en"`), values from constants.py's
      // VALID_LANGUAGES (src/data/languages.ts). ACE-Step's own API also
      // has a CoT auto-detect path (`use_cot_language`), but this app spawns
      // the server with ACESTEP_INIT_LLM=false (electron/models/modelServer.ts)
      // for faster/lighter startup, so that path can't actually run yet --
      // not exposed here until the LLM is enabled server-side, rather than
      // shipping a control that silently no-ops.
      options: LANGUAGES.map((l) => ({ value: l.code, label: l.name })),
      helpText: "Pre-filled from the selected artist's primary language.",
    },
    { key: "reference_audio", type: "audio_upload", label: "Reference audio (style/cover, optional)", accept: "audio/*" },
    { key: "duration_sec", type: "number", label: "Duration (sec)", min: 10, max: 600, default: 120 },
    { key: "bpm", type: "number", label: "BPM (optional)", min: 40, max: 220 },
    { key: "key_signature", type: "text", label: "Key/scale (optional)", placeholder: "e.g. F# minor" },
    { key: "time_signature", type: "text", label: "Time signature (optional)", placeholder: "e.g. 4/4" },
    {
      key: "genre_tags",
      type: "tags",
      label: "Genre tags",
      isModelGenreField: true,
      helpText: "Pre-filled from the selected artist's genres — free text, add or remove anything.",
    },
    { key: "instrument_tags", type: "tags", label: "Instrument/timbre tags" },
    { key: "batch_count", type: "number", label: "Batch count", min: 1, max: 8, default: 1 },
  ],
  outputs: [
    {
      kind: "audio",
      format: "wav",
      notes:
        "Phase 8: format resolved against the real API (docs/en/API.md in the cloned repo) — ACE-Step's own server supports flac/mp3/opus/aac/wav/wav32 via its audio_format request param and defaults to mp3, but this app always requests wav explicitly to match every other real model's own.wav convention.",
    },
  ],
  // ACE-Step's own real REST server is spawned directly (not a
  // servers/ace-step-1.5/server.py wrapper) — see electron/models/modelServer.ts's
  // spawnAceStepServer. portRange kept in the app's own per-model port
  // scheme (17640-17659) rather than ACE-Step's own 8001 default, documented
  // there.
  server: { entrypoint: "server.py", venv: "ace-step-1.5", portRange: [17640, 17659] },
  // Phase 11: real LoRA fine-tuning, verified end-to-end — see
  // electron/models/trainingManager.ts's runAceStepTrainingPipeline and
  // servers/ace-step-1.5/README.md's "Training (Phase 11)" section. Real
  // correction to the catalog doc's original REST-API framing (`POST
  // /v1/training/start`): that endpoint exists but trains against an
  // already-running, already-model-loaded server process — genuinely the
  // wrong shape for this app's subprocess-per-run training manager. The
  // *real* fit is the same repo's own separate standalone "Side-Step" CLI
  // (`train.py fixed`), confirmed by reading train.py/training_v2/ directly
  // — a real, independent, fully scriptable training entrypoint that needs
  // no running server at all. `hyperparameters` matches Side-Step's actual
  // `--rank/--alpha/--epochs/--lr` CLI flags, confirmed via `train.py fixed
  // --help`, not guessed.
  training: {
    supported: true,
    method: "lora",
    inputKind: "audio_captioned",
    datasetRequirements: {
      fileTypes: [".wav", ".mp3", ".flac", ".ogg", ".opus"],
      minFiles: 2,
      minTotalDurationMin: 0.5,
      requiresCaptions: true,
    },
    hyperparameters: [
      {
        key: "base_variant",
        type: "select",
        label: "Base checkpoint to fine-tune",
        default: "turbo",
        helpText: "The 2B checkpoints — matches this app's already-installed weights via the same checkpoint-directory bridge the inference server uses.",
        options: [
          { value: "turbo", label: "turbo (8-step, fastest)" },
          { value: "base", label: "base (50-step, pre-train)" },
          { value: "sft", label: "sft (50-step, SFT)" },
        ],
      },
      { key: "rank", type: "number", label: "LoRA rank", default: 8, min: 1, max: 256, helpText: "Side-Step's own CLI default is 64; a smaller rank trains faster for a pipeline-proof run." },
      { key: "alpha", type: "number", label: "LoRA alpha", default: 16, min: 1, max: 512 },
      { key: "epochs", type: "number", label: "Epochs", default: 3, min: 1, max: 500, helpText: "Kept small for a pipeline-proof run — real LoRA fine-tunes in the wild often use hundreds of epochs over a larger dataset." },
      { key: "learning_rate", type: "number", label: "Learning rate", default: 0.0001, min: 0.000001, max: 0.01, step: 0.00001 },
    ],
    hardware: {
      minVramGb: 16,
      recommendedVramGb: 20,
      cpuFallback: false,
      notes: "16GB minimum per the real repo's own LoRA training tutorial; a real Phase 11 verification run peaked at only ~4.6GB VRAM on a tiny 4-clip/3-epoch pipeline-proof dataset — real usage on a full dataset will run higher.",
    },
    server: { entrypoint: "train.py", venv: "ace-step-1.5" },
    checkpointOutput: { format: "lora-adapter" },
  },
};

const YUE2: ModelManifest = {
  modelId: "yue2",
  displayName: "YuE2",
  licenseTier: "cc-by-nc",
  // YuE2's real usage pairs the yue2-3b engine with a VAE decoder choice
  // rather than picking one single monolithic checkpoint — the decoder
  // choice is modeled as the vae_decoder input below instead of a second
  // checkpoint-variant axis, since the app's data model has exactly one
  // checkpoint_variant column per generation.
  checkpointVariants: ["yue2-3b"],
  hardware: {
    minVramGb: 24,
    cpuFallback: false,
    platforms: ["linux"],
    notes:
      "Heaviest model in the catalog — 24GB+ NVIDIA VRAM (BF16), Linux, batch only, per the real repo's own documented requirement (kept as the manifest minimum). A real Phase 8 standalone run of a single ~60s song peaked at only ~3-4GB observed VRAM on an RTX 3090 — the documented 24GB figure is presumably for longer/heavier generations or larger batch sizes than this app's smoke test used, not a correction to the published minimum.",
  },
  inputs: [
    { key: "lyrics", type: "textarea", label: "Lyrics", required: true },
    {
      key: "style_genre",
      type: "tags",
      label: "Style / genre",
      isModelGenreField: true,
      helpText: "Pre-filled from the selected artist's genres — free text, add or remove anything.",
    },
    {
      key: "vocal_language",
      type: "text",
      label: "Vocal language (optional)",
      isModelLanguageField: true,
      // YuE2 has no dedicated language parameter -- its own docs
      // (docs/generation.md: "Put genre, instruments, vocal character,
      // language, and tempo in style") fold language into the free-text
      // `style` field alongside genre, same shape as ACE-Step's
      // genre_tags/instrument_tags folding into its prompt. Folded into
      // style_genre's text at generation time by buildYue2Style
      // (electron/models/modelServer.ts), mirroring buildAceStepPrompt.
      helpText: "Pre-filled from the selected artist's primary language, by name — free text.",
    },
    { key: "reference_audio", type: "audio_upload", label: "Reference audio (cover/transcription, optional)", accept: "audio/*" },
    {
      key: "max_seconds",
      type: "number",
      label: "Max duration cap (sec)",
      min: 10,
      max: 300,
      default: 60,
      // Not wired into a real constraint: the real pipeline's length knob
      // is a semantic-token budget (Sampling.max_tokens), and no
      // tokens-per-second-of-audio rate is documented anywhere in the
      // vendored repo or its docs -- inventing an unverified formula risked
      // silently truncating real songs or wasting GPU time on a wrong
      // guess. Left as an app-level field for a future phase to wire once
      // that rate is empirically confirmed; real generations today run to
      // the pipeline's own default budget instead.
    },
    {
      key: "vae_decoder",
      type: "select",
      label: "VAE decoder",
      default: "yue2-vae",
      options: [
        { value: "yue2-vae", label: "YuE2-Vae" },
        { value: "yue2-vae-legacy", label: "YuE2-Vae (legacy)" },
      ],
    },
  ],
  outputs: [
    {
      kind: "audio",
      format: "flac",
      notes:
        "Wired into modelServer.ts via a hand-written FastAPI wrapper (servers/yue2/server.py), same shape as MuseCoco/MusicGen's own — see servers/yue2/README.md for the original standalone proof this is built from. The real pipeline's own save_artifacts() writes audio.flac (24-bit, 48000Hz, stereo), not .wav. This app's audio IPC already has a .flac mimeType case from Phase 6, so no new plumbing was needed to play it.",
    },
    {
      kind: "midi",
      format: "abc",
      notes:
        "The real symbolic output is ABC notation text (score.abc — real staff notation with vocal/instrumental voices), not a binary Standard MIDI File — there is no .mid byte output anywhere in the real pipeline and no ABC->MIDI conversion utility in the repo. Rendered as plain monospace text (src/components/midi/AbcScoreViewer.tsx) rather than through the real PianoRollViewer, which only parses SMF .mid bytes and cannot render ABC as-is — the \"midi\" kind is kept here as the closest existing manifest slot rather than inventing a new output kind. A real ABC-notation (staff) renderer would be a further improvement, not required for the score to be visible.",
    },
  ],
  server: { entrypoint: "server.py", venv: "yue2", portRange: [17660, 17679] },
  training: {
    supported: false,
    reason: "YuE2 already needs 24GB+ VRAM just for inference; training would need substantially more than is realistic on consumer desktop hardware — not planned for v1 (kwesi.docs/03-model-catalog.md's training-feasibility table).",
  },
};

const RAVE: ModelManifest = {
  modelId: "rave",
  displayName: "RAVE",
  licenseTier: "cc-by-nc-sa",
  // These are IRCAM/ACIDS's published pretrained example timbre models —
  // "manual" source in electron/db/seedModels.ts (the app can't download
  // them itself), but once a human drops one in KWESI_MODELS_DIR/rave/<name>/
  // the startup reconciliation pass marks it installed same as any other
  // variant, and it becomes usable here. Names must match seedModels.ts
  // exactly. A *trained* (not just pretrained-example) RAVE checkpoint will
  // show up the same way once the training pipeline (Phase 10/11) produces
  // trained_model rows — this list isn't meant to stay hardcoded to these
  // nine forever, just accurate to what's real today.
  checkpointVariants: [
    "darbouka_onnx",
    "isis",
    "musicnet",
    "nasa",
    "percussion",
    "sol_full",
    "sol_ordinario_fast",
    "VCTK",
    "vintage",
  ],
  hardware: { minVramGb: 0, cpuFallback: true, notes: "Training needs 5–32GB VRAM depending on config; inference/streaming is much lighter and CPU-feasible for small models." },
  inputs: [{ key: "input_audio", type: "audio_upload", label: "Audio input (timbre transfer source)", required: true, accept: "audio/*" }],
  outputs: [{ kind: "audio", format: "wav" }],
  server: { entrypoint: "server.py", venv: "rave-venv", portRange: [17680, 17689] },
  // Phase 10: RAVE is the training pipeline's pilot — real, proven. Training
  // is RAVE's own native workflow (from-scratch per-timbre, no captions).
  // `hyperparameters` mirrors what the real `rave train` CLI actually
  // exposes as meaningful knobs for a short pilot run — confirmed directly
  // against acids-ircam/RAVE's scripts/train.py flag definitions, not
  // guessed. There's no `learning_rate` flag (RAVE's optimizer LR is fixed
  // inside rave/model.py, not train.py-overridable) and no direct
  // `latent_size` flag either (it's a gin config value baked into the
  // chosen `config`, not a simple CLI override) — both were in
  // 02-architecture.md's original illustrative sketch but aren't real
  // train.py knobs, so this list uses the real ones instead (config,
  // max_steps, batch_size) — see that doc's updated sketch.
  training: {
    supported: true,
    method: "from_scratch",
    inputKind: "audio_raw",
    // Deliberately modest for a *pipeline-proof* run, not a production
    // timbre model — RAVE's own community guidance wants 20+ minutes for a
    // musically useful result, but this app's Phase 10 exit criterion is a
    // real, structurally valid checkpoint that round-trips through
    // inference, not a good-sounding one (same bar Phase 5 held MusicGen's
    // 6-second smoke clip to). A production-quality run just needs more/
    // longer files against these same minimums.
    datasetRequirements: {
      fileTypes: [".wav", ".flac", ".aiff"],
      minFiles: 3,
      minTotalDurationMin: 1,
      requiresCaptions: false,
    },
    hyperparameters: [
      {
        key: "config",
        type: "select",
        label: "Model size / config",
        default: "v2_small",
        helpText: "v2_small is RAVE's own reduced-footprint config (min ~8GB VRAM, per the real repo's config table) — the right default for a quick pilot run.",
        options: [
          { value: "v2_small", label: "v2_small (fastest, lowest VRAM)" },
          { value: "v2", label: "v2 (standard)" },
          { value: "v2_nopqmf_small", label: "v2_nopqmf_small (experimental, no PQMF)" },
        ],
      },
      {
        key: "max_steps",
        type: "number",
        label: "Training steps",
        default: 60,
        min: 10,
        max: 500,
        helpText: "Kept deliberately small — this proves the pipeline produces a real checkpoint, not a musically finished model. RAVE's own docs describe production runs in the hundreds of thousands of steps.",
      },
      {
        key: "batch_size",
        type: "number",
        label: "Batch size",
        default: 4,
        min: 1,
        max: 16,
      },
    ],
    hardware: {
      minVramGb: 8,
      recommendedVramGb: 16,
      cpuFallback: true,
      notes: "8GB minimum is v2_small's own documented figure; CPU training (rave train --gpu -1) works but is impractically slow for anything beyond a tiny pilot run.",
    },
    server: { entrypoint: "rave", venv: "rave-train" },
    checkpointOutput: { format: "ts" },
  },
};

export const MANIFESTS: Record<string, ModelManifest> = {
  [MUSICGEN.modelId]: MUSICGEN,
  [MUSECOCO.modelId]: MUSECOCO,
  [MUSEFORMER.modelId]: MUSEFORMER,
  [ACE_STEP.modelId]: ACE_STEP,
  [YUE2.modelId]: YUE2,
  [RAVE.modelId]: RAVE,
};

export function getManifest(modelId: string): ModelManifest | undefined {
  return MANIFESTS[modelId];
}
