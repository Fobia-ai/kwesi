# Kwesi — Planning Docs

Kwesi is a desktop music-generation application that wraps multiple open-source
music generation models behind one consistent, dynamically-adapting UI. A user
picks a model, and the app reconfigures its input form and output viewer to
match exactly what that model takes in and produces — text prompt, MIDI
piano-roll, waveform player, whatever fits.

No accounts, no sign-up. First launch shows an acknowledgments screen crediting
every paper/org whose model is bundled, then the user is straight into the app.
An optional local passcode can lock the app afterward, and a local-only
profile (name/email) lives in Settings.

Beyond generation, most catalog models are foundation models the user can
**train on their own music** — a dedicated Training pipeline (drop in your
own audio/MIDI, configure, run, choose an output folder) turns the result
into a custom checkpoint usable in any new workspace.

## Reading order

1. [01-overview.md](01-overview.md) — product vision, core concepts, what's confirmed vs. still open
2. [02-architecture.md](02-architecture.md) — tech stack, app shell, data model, the model-adapter plugin system
3. [03-model-catalog.md](03-model-catalog.md) — every target model, its real identity, inputs/outputs, license, hardware needs
4. [04-roadmap.md](04-roadmap.md) — the phased build plan (the actual thing we execute against)

## Status

Phases 0–12 of 13 are done — see [04-roadmap.md](04-roadmap.md) for the
precise per-phase/per-model breakdown. In short: the app shell, data layer,
Model Manager (real Hugging Face downloads), the manifest-driven dynamic
generation UI, and real local inference are all working end to end for
MusicGen, MuseCoco, ACE-Step 1.5, and RAVE (Museformer inference is code-
complete but unverified — blocked on an unconfirmed Triton/CPU-fallback
question; YuE2 inference is proven standalone but not wired into the app).
A real training pipeline exists too — RAVE (the pilot), MusicGen, and
ACE-Step can all be fine-tuned on your own audio for real, with the
resulting checkpoint immediately usable in a new workspace. A local profile
and an optional OS-keychain-backed app-lock passcode (relaunch + idle
timeout) round out Phase 12. Every real integration in this project has
been independently re-verified (not just taken on a build report's word)
with actual generated audio/MIDI files, checked for validity and
non-silence.

Remaining: Phase 13 (packaging/distribution installers) — see
[04-roadmap.md](04-roadmap.md).

- Stack **confirmed and built**: Electron + React + local Python sidecar
  servers per model, one isolated venv per model (several models needed
  more than one venv per model — see each `servers/<model>/README.md` for
  the real dependency archaeology, since more than one turned out to have
  version pins narrower than initially assumed).
- All data directories are **environment-variable-driven** with sensible
  defaults (`KWESI_HOME`, `KWESI_MODELS_DIR`, `KWESI_EXPORTS_DIR`,
  `KWESI_VENVS_DIR`, `KWESI_TRAINED_MODELS_DIR`, etc.) — see
  [02-architecture.md](02-architecture.md).
- Model catalog was researched against real repos (Sept 2026) and has
  since been re-verified repeatedly against actual running code during
  integration — see [03-model-catalog.md](03-model-catalog.md) for what
  was corrected along the way (e.g. MuseCoco's real param count, ACE-Step's
  real checkpoint names, RAVE's real pretrained timbre list).
