// Kept in sync with src/data/modelVariants.ts (the browser-preview mock's
// mirror of this same data) and scripts/download_models.py (the real
// HF-verified repo IDs this is transcribed from) -- see the TODO in
// allowedExternalLinks.ts about consolidating shared catalog data once the
// build tooling supports it cleanly. Seeds the `model` table (one row per
// model family) and the `model_variant` table (one row per installable
// checkpoint variant, now carrying enough to drive Phase 3's real download
// mechanism: repo_id/source for Hugging Face variants, manual_note/
// manual_url for the two that aren't scriptable).
export type ModelVariantSource = "huggingface" | "manual";

export interface SeedVariant {
  name: string;
  source: ModelVariantSource;
  repoId?: string;
  note?: string;
  url?: string;
}

export interface SeedModel {
  id: string;
  displayName: string;
  licenseTier: "mit" | "cc-by-nc" | "cc-by-nc-sa";
  trainable: boolean;
  variants: SeedVariant[];
}

export const SEED_MODELS: SeedModel[] = [
  {
    id: "ace-step-1.5",
    displayName: "ACE-Step 1.5",
    licenseTier: "mit",
    trainable: true,
    // Verified 2026-09-15 against the live ACE-Step HF org (see
    // scripts/download_models.py) -- 6 real DiT checkpoints, not the
    // earlier guessed base/sft/xl-only shape, plus 2 optional LM
    // prompt-expansion front-ends.
    variants: [
      { name: "acestep-v15-base", source: "huggingface", repoId: "ACE-Step/acestep-v15-base" },
      { name: "acestep-v15-sft", source: "huggingface", repoId: "ACE-Step/acestep-v15-sft" },
      {
        name: "acestep-v15-turbo",
        source: "huggingface",
        // Repo name differs from the variant name -- confirmed correct via
        // the README's own Model Zoo table, not a typo.
        repoId: "ACE-Step/Ace-Step1.5",
      },
      { name: "acestep-v15-xl-base", source: "huggingface", repoId: "ACE-Step/acestep-v15-xl-base" },
      { name: "acestep-v15-xl-sft", source: "huggingface", repoId: "ACE-Step/acestep-v15-xl-sft" },
      { name: "acestep-v15-xl-turbo", source: "huggingface", repoId: "ACE-Step/acestep-v15-xl-turbo" },
      {
        name: "acestep-5hz-lm-0.6b",
        source: "huggingface",
        repoId: "ACE-Step/acestep-5Hz-lm-0.6B",
      },
      {
        name: "acestep-5hz-lm-4b",
        source: "huggingface",
        repoId: "ACE-Step/acestep-5Hz-lm-4B",
      },
    ],
  },
  {
    id: "yue2",
    displayName: "YuE2",
    licenseTier: "cc-by-nc",
    trainable: false,
    // SheetSage2 and MERT-v2 are companion analysis models (transcription /
    // feature-encoders), architecturally distinct from YuE2 itself -- left
    // out of this seed, could become their own catalog entries later.
    variants: [
      { name: "yue2-3b", source: "huggingface", repoId: "m-a-p/YuE2-3B" },
      { name: "yue2-vae", source: "huggingface", repoId: "m-a-p/YuE2-Vae" },
      {
        name: "yue2-vae-legacy",
        source: "huggingface",
        // Confirmed 2026-09-15 as its own separate HF repo, not a revision.
        repoId: "m-a-p/YuE2-Vae-legacy",
      },
    ],
  },
  {
    id: "musicgen",
    displayName: "MusicGen",
    licenseTier: "cc-by-nc",
    trainable: true,
    variants: [
      { name: "small", source: "huggingface", repoId: "facebook/musicgen-small" },
      { name: "medium", source: "huggingface", repoId: "facebook/musicgen-medium" },
      { name: "large", source: "huggingface", repoId: "facebook/musicgen-large" },
      { name: "melody", source: "huggingface", repoId: "facebook/musicgen-melody" },
      { name: "style", source: "huggingface", repoId: "facebook/musicgen-style" },
    ],
  },
  {
    id: "musecoco",
    displayName: "MuseCoco",
    licenseTier: "mit",
    trainable: true,
    // Single two-stage ~200M pipeline, not multiple published sizes. This
    // is the stage-2 attribute-to-music generator; the stage-1
    // text-to-attribute model's checkpoint is not separately published.
    variants: [
      { name: "default", source: "huggingface", repoId: "XinXuNLPer/MuseCoco_attribute2music" },
    ],
  },
  {
    id: "museformer",
    displayName: "Museformer",
    licenseTier: "mit",
    trainable: true,
    // Confirmed location, but not automatable: hosted on Microsoft OneDrive,
    // not Hugging Face, and the share link 403s on a plain scripted
    // request -- see scripts/download_models.py. Marked "manual" so the UI
    // shows a disabled row with a pointer link instead of a broken button.
    variants: [
      {
        name: "default",
        source: "manual",
        note:
          "Checkpoint is hosted on Microsoft OneDrive, not Hugging Face, and the share link 403s on a plain scripted request -- open it in a browser instead. Put the downloaded checkpoint in checkpoints/mf-lmd6remi-1 per the museformer README.",
        url: "https://1drv.ms/u/s!Aq3YEPZCcV5ibz9ySjjNsEB74CQ",
      },
    ],
  },
  {
    id: "rave",
    displayName: "RAVE",
    licenseTier: "cc-by-nc-sa",
    trainable: true,
    // RAVE has no repo the app can download from -- IRCAM/ACIDS publishes
    // pretrained example timbre models on a JS-rendered page that can't be
    // scraped (see 03-model-catalog.md), so every variant here is "manual":
    // the app's own Install button stays disabled and points at the real
    // page. That said, once a human downloads one of these .ts (TorchScript
    // export, not TypeScript) files themselves and drops it in
    // KWESI_MODELS_DIR/rave/<name>/, the startup reconciliation pass (see
    // electron/models/reconcile.ts) recognizes it as installed same as any
    // other variant -- "manual" only gates app-initiated download, not
    // recognition of what's already on disk. Names match the exact
    // filenames IRCAM publishes.
    variants: [
      "darbouka_onnx",
      "isis",
      "musicnet",
      "nasa",
      "percussion",
      "sol_full",
      "sol_ordinario_fast",
      "VCTK",
      "vintage",
    ].map((name) => ({
      name,
      source: "manual" as const,
      note:
        "RAVE pretrained models aren't downloadable from the app -- IRCAM/ACIDS publishes them on a JS-rendered page that can't be scraped. Download the .ts file yourself and it'll be recognized once it's on disk.",
      url: "https://acids-ircam.github.io/rave_models_download",
    })),
  },
];
