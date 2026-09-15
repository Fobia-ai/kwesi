# 01 — Overview & Product Vision

## What Kwesi is

A desktop app for generating music using open-source ML models, running
entirely local to the user's machine. The app itself does not train or host
models — it downloads, manages, and runs models the user chooses, and gives
each one a purpose-built input/output UI.

## Core concepts

**Model** — a bundled, pre-integrated open-source music generation model (see
[03-model-catalog.md](03-model-catalog.md)). Kwesi ships with code that knows,
per model, exactly what parameters it accepts and what it outputs. Models are
not user-supplied/arbitrary — every model in the catalog has been individually
integrated and verified. Adding a new model to the catalog is a development
task, not a runtime plugin drop-in by the end user.

**Model Manager** — the screen where the user browses the model catalog and
downloads/removes model weights, similar in spirit to the Invoke reference
screenshot (`referenceImages/Screenshot from 2026-09-14 22-16-41.png`):
launchpad-style add flow, an install queue with progress, per-model storage
footprint.

**Workspace** — the top-level container. Created by the user, bound to
**exactly one model at creation time**, and that binding is permanent — to use
a different model, the user creates a new workspace. This mirrors "pick your
instrument once, commit to the session."

**Project** — lives inside a workspace. A user can create multiple projects
per workspace (e.g. different songs/sessions using the same model).

**Generation** — a single output produced inside a project (one piece of
music, one take). A project can hold many generations. Generations can be
played, saved, exported, downloaded, and shared.

Hierarchy: `Workspace (1 model) → Project → Generation (audio and/or MIDI)`

## Dynamic, model-driven UI

This is the architectural core of the app. Every model in the catalog has a
**manifest** describing its inputs (text prompt, duration, BPM/key, reference
audio upload, lyrics, genre tags, etc.) and its output modality (raw audio,
symbolic MIDI, or both). The generation screen is *rendered from that
manifest* — not hand-built per model. See
[02-architecture.md](02-architecture.md) for the manifest schema and the
renderer/viewer design.

Two output viewer families are needed at minimum:
- **Audio viewer**: waveform, transport controls, save/export/download, matches the bottom mini-player pattern in the Voicebox references.
- **Symbolic/MIDI viewer**: piano-roll or notation display, for models that only output MIDI (MuseCoco, Museformer) with no audio rendering.

Some models need both simultaneously (YuE2 outputs audio + ABC notation/MIDI +
chord/structure annotations).

## First run — acknowledgments screen

On first launch (and reachable later from Settings > About), show a screen of
rectangular cards, one per referenced paper/organization/model, crediting the
original research (ACE-Step, YuE, MusicGen/AudioCraft, MuseCoco, Museformer,
RAVE, and any libraries with meaningful attribution requirements). A
**Continue** action proceeds straight into the app. No sign-up or account
creation exists anywhere in the app.

## App lock (optional)

In Settings, the user can set a local passcode. Once set, two things lock
the app: reopening it after being closed, **and** an idle timeout — the
app also auto-locks itself after a period of inactivity while still open
(default 10 minutes, configurable via `KWESI_LOCK_IDLE_TIMEOUT_MINUTES` —
see [02-architecture.md](02-architecture.md)). This is local-only, no
cloud account tied to it. See the relevant phase in
[04-roadmap.md](04-roadmap.md) for storage approach (OS keychain, not a
plaintext file).

## Desktop & filesystem requirements

- Full local filesystem access: every directory the app depends on (model
  weights, venvs, workspaces, exports, cache, logs) is controlled by an
  environment variable with a sensible default — see "Configuration &
  environment variables" in [02-architecture.md](02-architecture.md). The
  user can delete generations/projects/workspaces and models from disk
  through the app (not just from the app's database).
- Must run without an internet connection once models are downloaded, except
  where a model's own weights require re-verification.
- Cross-platform target: Windows, macOS, Linux (the reference screenshots
  show both native macOS chrome and Windows-style chrome, so cross-platform
  packaging is expected from day one, not bolted on later).

## Explicitly out of scope (for now)

- **MusicAgent** — confirmed to be an LLM orchestration layer over other
  tools, not a generation model with a fixed input/output schema. Doesn't fit
  the adapter model. Worth revisiting later as an "auto-compose across models"
  power feature, but it is not a catalog entry.
- Cloud sync/backup (the Voicebox reference has a "Voicebox Cloud" opt-in —
  Kwesi has no account system, so this is not planned; revisit only if asked).
- Any collaborative/multi-user features.

## Decisions confirmed

1. **App shell: Electron.** Tauri would give a smaller/lighter binary, but
   Electron has far more mature precedent for exactly what this app leans
   on hardest — spawning/managing multiple long-lived Python subprocess
   servers, per-model venvs, resumable large downloads. See
   [02-architecture.md](02-architecture.md).
2. **App lock: relaunch + idle timeout.** A passcode, once set, locks the
   app both on reopen and after inactivity (default 10 min, configurable).
3. **All data directories are environment-variable-driven**, each with a
   sensible built-in default (`KWESI_HOME`, `KWESI_MODELS_DIR`,
   `KWESI_EXPORTS_DIR`, etc.) — full list and precedence rules in
   [02-architecture.md](02-architecture.md). Any new directory need
   introduced later follows the same pattern.

## Open questions

None blocking Phase 1 currently. Re-check `referenceImages/` for any
further UI references before Phase 1 UI work begins.
