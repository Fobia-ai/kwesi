// Kept in sync with src/data/catalog.ts (see the TODO there and in
// allowedExternalLinks.ts about consolidating shared catalog data once the
// build tooling supports it cleanly). This seeds the `model` table (one row
// per model family) and the `model_variant` table (one row per installable
// checkpoint variant) so workspace.model_id and per-generation
// checkpoint_variant choices have real rows to reference from Phase 2
// onward, ahead of Phase 3's actual install/download lifecycle.
export interface SeedModel {
  id: string;
  displayName: string;
  licenseTier: "mit" | "cc-by-nc" | "cc-by-nc-sa";
  trainable: boolean;
  variants: string[];
}

export const SEED_MODELS: SeedModel[] = [
  {
    id: "ace-step-1.5",
    displayName: "ACE-Step 1.5",
    licenseTier: "mit",
    trainable: true,
    variants: [
      "acestep-v15-turbo",
      "acestep-v15-sft",
      "acestep-v15-xl",
      // Optional prompt-expansion front-ends, not alternate generator sizes.
      "acestep-v15-lm-0.6b",
      "acestep-v15-lm-1.7b",
      "acestep-v15-lm-4b",
    ],
  },
  {
    id: "yue2",
    displayName: "YuE2",
    licenseTier: "cc-by-nc",
    trainable: false,
    // SheetSage2 and MERT-v2 are companion analysis models (transcription /
    // feature-encoders), architecturally distinct from YuE2 itself — left
    // out of this seed, could become their own catalog entries later.
    variants: ["yue2-3b", "yue2-vae", "yue2-vae-legacy"],
  },
  {
    id: "musicgen",
    displayName: "MusicGen",
    licenseTier: "cc-by-nc",
    trainable: true,
    variants: ["small", "medium", "large", "melody", "style"],
  },
  {
    id: "musecoco",
    displayName: "MuseCoco",
    licenseTier: "mit",
    trainable: true,
    // Single two-stage ~200M pipeline, not multiple published sizes.
    variants: ["default"],
  },
  {
    id: "museformer",
    displayName: "Museformer",
    licenseTier: "mit",
    trainable: true,
    // No multiple published sizes confirmed — see 03-model-catalog.md.
    variants: ["default"],
  },
  {
    id: "rave",
    displayName: "RAVE",
    licenseTier: "cc-by-nc-sa",
    trainable: true,
    // RAVE has no generic pretrained size variants — it's trained per-target
    // -timbre via the training pipeline (Phase 10/11), not downloaded here.
    variants: [],
  },
];
