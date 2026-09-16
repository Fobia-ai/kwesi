export type ModelVariantSource = "huggingface" | "manual";

export interface SeedVariant {
  name: string;
  source: ModelVariantSource;
  repoId?: string;
  note?: string;
  url?: string;
  gatewayFilename?: string;
}

export interface SeedModelVariants {
  id: string;
  variants: SeedVariant[];
}

/**
 * Mirrors electron/db/seedModels.ts (itself transcribed from the
 * HF-verified repo IDs in scripts/download_models.py) — see the TODO in
 * allowedExternalLinks.ts about consolidating shared catalog data once the
 * build tooling supports it cleanly. Used only to seed the
 * localStorage-backed mock model-variant store for browser-preview UI
 * development (src/lib/modelVariantStore.ts); the real Electron path reads
 * this same data from the model_variant DB table instead.
 */
export const MODEL_VARIANTS_SEED: SeedModelVariants[] = [
  {
    id: "ace-step-1.5",
    variants: [
      { name: "acestep-v15-base", source: "huggingface", repoId: "ACE-Step/acestep-v15-base" },
      { name: "acestep-v15-sft", source: "huggingface", repoId: "ACE-Step/acestep-v15-sft" },
      { name: "acestep-v15-turbo", source: "huggingface", repoId: "ACE-Step/Ace-Step1.5" },
      { name: "acestep-v15-xl-base", source: "huggingface", repoId: "ACE-Step/acestep-v15-xl-base" },
      { name: "acestep-v15-xl-sft", source: "huggingface", repoId: "ACE-Step/acestep-v15-xl-sft" },
      { name: "acestep-v15-xl-turbo", source: "huggingface", repoId: "ACE-Step/acestep-v15-xl-turbo" },
      { name: "acestep-5hz-lm-0.6b", source: "huggingface", repoId: "ACE-Step/acestep-5Hz-lm-0.6B" },
      { name: "acestep-5hz-lm-4b", source: "huggingface", repoId: "ACE-Step/acestep-5Hz-lm-4B" },
    ],
  },
  {
    id: "yue2",
    variants: [
      { name: "yue2-3b", source: "huggingface", repoId: "m-a-p/YuE2-3B" },
      { name: "yue2-vae", source: "huggingface", repoId: "m-a-p/YuE2-Vae" },
      { name: "yue2-vae-legacy", source: "huggingface", repoId: "m-a-p/YuE2-Vae-legacy" },
    ],
  },
  {
    id: "musicgen",
    variants: [
      { name: "small", source: "huggingface", repoId: "facebook/musicgen-small" },
      { name: "medium", source: "huggingface", repoId: "facebook/musicgen-medium" },
      { name: "large", source: "huggingface", repoId: "facebook/musicgen-large" },
      { name: "melody", source: "huggingface", repoId: "facebook/musicgen-melody" },
      // "style" deliberately absent — see manifests.ts's MUSICGEN note.
    ],
  },
  {
    id: "musecoco",
    variants: [
      { name: "default", source: "huggingface", repoId: "XinXuNLPer/MuseCoco_attribute2music" },
    ],
  },
  {
    id: "museformer",
    variants: [
      {
        name: "default",
        source: "manual",
        note:
          "Checkpoint is hosted on Microsoft OneDrive, not Hugging Face, and the share link 403s on a plain scripted request — open it in a browser instead.",
        url: "https://1drv.ms/u/s!Aq3YEPZCcV5ibz9ySjjNsEB74CQ",
        gatewayFilename: "checkpoint_best.pt",
      },
    ],
  },
  {
    id: "rave",
    // Matches electron/db/seedModels.ts: real IRCAM/ACIDS pretrained example
    // timbre model names, "manual" source since the app can't download them
    // itself, but recognized once a human drops the .ts file in place.
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
        "RAVE pretrained models aren't downloadable from the app — IRCAM/ACIDS publishes them on a JS-rendered page that can't be scraped. Download the .ts file yourself and it'll be recognized once it's on disk.",
      url: "https://acids-ircam.github.io/rave_models_download",
      gatewayFilename: `${name}.ts`,
    })),
  },
];
