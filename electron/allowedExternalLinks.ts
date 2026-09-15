/**
 * External URLs the renderer is allowed to ask the main process to open.
 * Kept in lockstep with the `repoUrl` values in src/data/catalog.ts — the
 * acknowledgments screen is the only place these links are surfaced.
 * TODO(Phase 1 polish): generate this set from catalog.ts at build time
 * instead of hand-duplicating, once the build tooling supports sharing
 * code between the Electron main process and the renderer cleanly.
 */
export const ALLOWED_EXTERNAL_LINKS = new Set<string>([
  "https://github.com/ace-step/ACE-Step-1.5",
  "https://github.com/multimodal-art-projection/YuE",
  "https://github.com/facebookresearch/audiocraft",
  "https://github.com/microsoft/muzic/tree/main/musecoco",
  "https://github.com/microsoft/muzic/tree/main/museformer",
  "https://github.com/acids-ircam/RAVE",
]);
