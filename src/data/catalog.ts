export type LicenseTier = "mit" | "cc-by-nc" | "cc-by-nc-sa";

export interface CatalogEntry {
  modelId: string;
  displayName: string;
  org: string;
  description: string;
  licenseTier: LicenseTier;
  repoUrl: string;
  trainable: boolean;
}

// Kept in sync with kwesi.docs/03-model-catalog.md — this is the data
// source for the acknowledgments screen and (later) the Model Manager.
export const CATALOG: CatalogEntry[] = [
  {
    modelId: "ace-step-1.5",
    displayName: "ACE-Step 1.5",
    org: "ACE-Step",
    description: "Text, lyrics and tag-conditioned full-song audio generation.",
    licenseTier: "mit",
    repoUrl: "https://github.com/ace-step/ACE-Step-1.5",
    trainable: true,
  },
  {
    modelId: "yue2",
    displayName: "YuE2",
    org: "Multimodal Art Projection (M-A-P)",
    description: "Lyrics-to-full-song generation with dual audio + symbolic output.",
    licenseTier: "cc-by-nc",
    repoUrl: "https://github.com/multimodal-art-projection/YuE",
    trainable: false,
  },
  {
    modelId: "musicgen",
    displayName: "MusicGen",
    org: "Meta AudioCraft",
    description: "Text and melody-conditioned instrumental music generation.",
    licenseTier: "cc-by-nc",
    repoUrl: "https://github.com/facebookresearch/audiocraft",
    trainable: true,
  },
  {
    modelId: "musecoco",
    displayName: "MuseCoco",
    org: "Microsoft Research",
    description: "Text-and-attribute-conditioned symbolic (MIDI) music generation.",
    licenseTier: "mit",
    repoUrl: "https://github.com/microsoft/muzic/tree/main/musecoco",
    trainable: true,
  },
  {
    modelId: "museformer",
    displayName: "Museformer",
    org: "Microsoft Research",
    description: "Fine- and coarse-grained attention transformer for long-form symbolic music.",
    licenseTier: "mit",
    repoUrl: "https://github.com/microsoft/muzic/tree/main/museformer",
    trainable: true,
  },
  {
    modelId: "rave",
    displayName: "RAVE",
    org: "IRCAM / ACIDS",
    description: "Realtime audio variational autoencoder for neural timbre transfer.",
    licenseTier: "cc-by-nc-sa",
    repoUrl: "https://github.com/acids-ircam/RAVE",
    trainable: true,
  },
];

export const LICENSE_LABEL: Record<LicenseTier, string> = {
  mit: "MIT",
  "cc-by-nc": "CC BY-NC",
  "cc-by-nc-sa": "CC BY-NC-SA",
};
