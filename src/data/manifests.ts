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

export type LicenseTier = "mit" | "cc-by-nc" | "cc-by-nc-sa";

export type ManifestInputType =
  | "text"
  | "textarea"
  | "number"
  | "select"
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
  | TagsManifestInput
  | FileManifestInput;

export type ManifestOutputKind = "audio" | "midi";

export interface ManifestOutput {
  kind: ManifestOutputKind;
  format: string;
  sampleRate?: number;
  notes?: string;
}

export interface ModelHardware {
  minVramGb: number;
  cpuFallback: boolean;
  notes?: string;
}

export interface ModelServerConfig {
  entrypoint: string;
  venv: string;
  portRange?: [number, number];
}

export interface ModelManifest {
  modelId: string;
  displayName: string;
  licenseTier: LicenseTier;
  // Checkpoint variants selectable for a *generation* job. Deliberately not
  // always identical to electron/db/seedModels.ts's install-time variant
  // list — e.g. RAVE's "pretrained-examples" row there is a manual pointer
  // link, not a real usable generation checkpoint, so this list is empty
  // for RAVE until the training pipeline (Phase 10/11) produces real
  // trained_model rows.
  checkpointVariants: string[];
  hardware: ModelHardware;
  inputs: ManifestInput[];
  outputs: ManifestOutput[];
  server: ModelServerConfig;
}

export function outputKindOf(manifest: ModelManifest): "audio" | "midi" | "audio+midi" {
  const hasAudio = manifest.outputs.some((o) => o.kind === "audio");
  const hasMidi = manifest.outputs.some((o) => o.kind === "midi");
  if (hasAudio && hasMidi) return "audio+midi";
  return hasAudio ? "audio" : "midi";
}

const MUSICGEN: ModelManifest = {
  modelId: "musicgen",
  displayName: "MusicGen",
  licenseTier: "cc-by-nc",
  checkpointVariants: ["small", "medium", "large", "melody", "style"],
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
};

const MUSECOCO: ModelManifest = {
  modelId: "musecoco",
  displayName: "MuseCoco",
  licenseTier: "mit",
  checkpointVariants: ["default"],
  hardware: { minVramGb: 0, cpuFallback: true, notes: "~200M params, CPU-feasible; no VRAM figure published." },
  inputs: [
    { key: "description", type: "textarea", label: "Free text description", placeholder: "A hopeful piano ballad" },
    { key: "instrument", type: "tags", label: "Instruments" },
    { key: "genre", type: "tags", label: "Genre" },
    { key: "mood", type: "tags", label: "Mood" },
    { key: "tempo_bpm", type: "number", label: "Tempo (BPM)", min: 40, max: 240, default: 120 },
    {
      key: "key_signature",
      type: "select",
      label: "Key",
      default: "c-major",
      options: [
        { value: "c-major", label: "C major" },
        { value: "g-major", label: "G major" },
        { value: "d-major", label: "D major" },
        { value: "a-minor", label: "A minor" },
        { value: "e-minor", label: "E minor" },
      ],
    },
    {
      key: "time_signature",
      type: "select",
      label: "Time signature",
      default: "4/4",
      options: [
        { value: "4/4", label: "4/4" },
        { value: "3/4", label: "3/4" },
        { value: "6/8", label: "6/8" },
        { value: "2/4", label: "2/4" },
      ],
    },
    { key: "bar_count", type: "number", label: "Bar count", min: 4, max: 128, default: 32 },
    {
      key: "danceability",
      type: "select",
      label: "Danceability",
      default: "medium",
      options: [
        { value: "low", label: "Low" },
        { value: "medium", label: "Medium" },
        { value: "high", label: "High" },
      ],
    },
    {
      key: "pitch_range",
      type: "select",
      label: "Pitch range",
      default: "mid",
      options: [
        { value: "low", label: "Low" },
        { value: "mid", label: "Mid" },
        { value: "high", label: "High" },
        { value: "full", label: "Full" },
      ],
    },
    { key: "artist_style", type: "tags", label: "Artist style reference" },
  ],
  outputs: [{ kind: "midi", format: "mid" }],
  server: { entrypoint: "server.py", venv: "musecoco-venv", portRange: [17620, 17629] },
};

const MUSEFORMER: ModelManifest = {
  modelId: "museformer",
  displayName: "Museformer",
  licenseTier: "mit",
  checkpointVariants: ["default"],
  hardware: {
    minVramGb: 0,
    cpuFallback: true,
    notes: "NEEDS VERIFICATION against the real requirements.txt — treated as similarly old/narrow-pinned as MuseCoco until confirmed, per kwesi.docs/03-model-catalog.md.",
  },
  inputs: [
    {
      key: "seed_mode",
      type: "select",
      label: "Seed",
      default: "random",
      options: [
        { value: "random", label: "Random seed" },
        { value: "continue_from_midi", label: "Continue from a MIDI file" },
      ],
    },
    {
      key: "seed_midi",
      type: "midi_upload",
      label: "Seed MIDI file",
      accept: ".mid,.midi",
      helpText: "Only used when Seed is set to \"Continue from a MIDI file\".",
    },
    { key: "bar_count", type: "number", label: "Bars to generate", min: 8, max: 256, default: 64 },
  ],
  outputs: [{ kind: "midi", format: "mid" }],
  server: { entrypoint: "server.py", venv: "museformer-venv", portRange: [17630, 17639] },
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
  hardware: { minVramGb: 4, cpuFallback: true, notes: "4GB (2B turbo) up to 24GB (XL) depending on checkpoint. CPU supported but slow." },
  inputs: [
    { key: "prompt", type: "text", label: "Text prompt", required: true, placeholder: "Anthemic stadium rock, driving drums" },
    { key: "lyrics", type: "textarea", label: "Lyrics (structured, optional)" },
    { key: "reference_audio", type: "audio_upload", label: "Reference audio (style/cover, optional)", accept: "audio/*" },
    { key: "duration_sec", type: "number", label: "Duration (sec)", min: 10, max: 600, default: 120 },
    { key: "bpm", type: "number", label: "BPM (optional)", min: 40, max: 220 },
    { key: "key_signature", type: "text", label: "Key/scale (optional)", placeholder: "e.g. F# minor" },
    { key: "time_signature", type: "text", label: "Time signature (optional)", placeholder: "e.g. 4/4" },
    { key: "genre_tags", type: "tags", label: "Genre tags" },
    { key: "instrument_tags", type: "tags", label: "Instrument/timbre tags" },
    { key: "batch_count", type: "number", label: "Batch count", min: 1, max: 8, default: 1 },
  ],
  outputs: [
    {
      kind: "audio",
      format: "wav",
      notes: "Output format NEEDS VERIFICATION against the real repo (likely WAV/FLAC) — see kwesi.docs/03-model-catalog.md.",
    },
  ],
  server: { entrypoint: "server.py", venv: "ace-step-1.5-venv", portRange: [17640, 17659] },
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
  hardware: { minVramGb: 24, cpuFallback: false, notes: "Heaviest model in the catalog — 24GB+ NVIDIA VRAM (BF16), Linux, batch only." },
  inputs: [
    { key: "lyrics", type: "textarea", label: "Lyrics", required: true },
    { key: "style_genre", type: "tags", label: "Style / genre" },
    { key: "reference_audio", type: "audio_upload", label: "Reference audio (cover/transcription, optional)", accept: "audio/*" },
    { key: "max_seconds", type: "number", label: "Max duration cap (sec)", min: 10, max: 300, default: 60 },
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
    { kind: "audio", format: "wav" },
    {
      kind: "midi",
      format: "mid",
      notes: "Also includes ABC notation and LAB beat/key/chord/structure annotations alongside MIDI — the symbolic viewer placeholder stands in for this whole bundle.",
    },
  ],
  server: { entrypoint: "server.py", venv: "yue2-venv", portRange: [17660, 17679] },
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
