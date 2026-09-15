# 04 — Phased Roadmap

Each phase lists its objective, deliverables, and exit criteria (what has to
be true/working before moving on). Phases are ordered so every later phase
builds on a proven foundation rather than guessing ahead.

---

## Phase 0 — Foundations & Decisions ✅ complete
**Objective:** lock the decisions everything else depends on, before writing
app code.

- Stack confirmed: Electron + React + SQLite + per-model Python venvs (see
  [02-architecture.md](02-architecture.md)).
- On-disk layout confirmed: fully environment-variable-driven (`KWESI_*`),
  defaults documented in [02-architecture.md](02-architecture.md).
- `referenceImages/` reviewed in full, including the later glassmorphism
  mood-board additions — visual direction locked (glassmorphic,
  Apple/iOS-style, light/dark adaptive).
- Repo scaffold: Electron + Vite + React + TypeScript project, linting,
  Tailwind config with the working color tokens from
  [02-architecture.md](02-architecture.md).

**Exit criteria:** stack decision written down and confirmed; empty app
window boots on all three target OSes from source.

---

## Phase 1 — App Shell & Design System
**Objective:** the chrome every other screen lives inside, styled to match
the reference apps' visual language (not their content).

- Left icon rail navigation (workspaces, model manager, settings), active-
  state styling, version number footer.
- Base routing between: Workspaces list → Workspace detail → Settings →
  Model Manager → Acknowledgments.
- Reusable primitives: pill button, glass card, dashed empty-state block,
  toggle switch, tabbed sub-nav — built once as a small component library
  so every later screen composes from these instead of re-styling per
  screen.
- Acknowledgments/first-run screen, built to the exact spec in
  [02-architecture.md](02-architecture.md): centered column of small
  horizontal cards (very small corner radius, deliberately distinct from
  the rest of the app), one per catalog entry — logo left, info + license
  badge right, GitHub-mark-only link. **"Start Application"** button at
  the bottom gates into the app. No auth anywhere.

**Exit criteria:** navigating the shell feels like the reference apps
(spacing, color, empty states); first-run acknowledgments screen shows all
catalog entries and gates correctly; nothing here is model-aware yet.

---

## Phase 2 — Workspace & Project Data Layer
**Objective:** the structural backbone — workspaces, projects, generations —
with no model execution wired up yet (generations can be created as inert
placeholder rows to test the hierarchy).

- SQLite schema from [02-architecture.md](02-architecture.md): workspace,
  project, generation, model, settings tables + migrations setup.
- Workspace creation flow: name + **model selection, locked permanently at
  creation** (no model field editable afterward — enforce in both UI and
  data layer).
- Project CRUD inside a workspace.
- Deletion flows for workspace/project/generation, each with an explicit
  confirmation and an honest choice about deleting underlying files vs.
  just the database record.

**Exit criteria:** can create multiple workspaces each bound to a different
(placeholder) model, create multiple projects per workspace, delete at any
level with correct cascade behavior, no data orphaned on disk silently.

---

## Phase 3 — Model Manager Core ✅ complete
**Objective:** browse, download, install, and remove models — modeled on
the Invoke reference screenshot's two-pane layout.

- Model catalog list sourced from the manifests in
  [03-model-catalog.md](03-model-catalog.md) (one card per model family,
  variants listed within, per the actual "What to build" spec used to
  implement this phase rather than a literal two-pane/bottom-table
  layout); each variant row shows install status, and disk footprint once
  installed. `electron/db/seedModels.ts` (mirrored for the browser-preview
  mock in `src/data/modelVariants.ts`) carries the real, HF-verified
  `repo_id`/`source` per variant transcribed from `scripts/download_models.py`.
- Download flow: real Hugging Face downloads from the Electron main
  process (`electron/models/hfClient.ts` + `downloadQueue.ts`) — no
  `huggingface_hub`/Python dependency, just the public HF model API +
  `fetch`, streamed straight to `KWESI_MODELS_DIR/<model_id>/<variant>/`.
  Progress (bytes downloaded/total, current file) is relayed to the
  renderer over a plain IPC event channel rather than SSE, since this is
  same-process IPC, not a separate local server (see
  [02-architecture.md](02-architecture.md), which has been updated to
  match). No Hugging Face account/token needed — every catalog repo used
  is confirmed public.
- Install Queue: a DB-backed view (any variant `queued`/`downloading`/
  `failed`) with progress bars, cancel, and retry — not a separate
  in-memory-only concept, so it survives a page reload correctly. Venv
  creation is **not yet wired up** here — that lands with Phase 4/5's
  Model Server Manager, since Phase 3 explicitly only needed to prove the
  install lifecycle, not execution.
- Remove-variant flow: deletes the variant's files and resets its DB row;
  warns (never blocks) if a workspace is bound to the model family, naming
  it, since a workspace isn't tied to one specific variant.
- Disk space pre-check via `fs.promises.statfs` before a download starts;
  if the check itself is unavailable/fails, the download proceeds rather
  than being silently blocked.

**Simplifications made (v1, noted as acceptable scope calls):**
- **No true resumable range-request downloads.** A retry (or a fresh
  install after a cancel/crash) restarts the variant's folder from scratch
  rather than resuming from a byte offset. Real resume would need
  per-file byte offsets persisted across restarts and reconciled against
  Hugging Face's ETags — meaningfully more scope than a first cut of the
  install queue needs.
- **No venv creation kicked off after download** — that's Phase 4/5's
  concern (Model Server Manager + per-model venvs), not duplicated here.
- Two variants (Museformer's `default`, RAVE's `pretrained-examples`) are
  not downloadable from the app at all — both are shown as disabled rows
  with a pointer link to their real (non-Hugging-Face) location, matching
  `scripts/download_models.py`'s own skip behavior.

**Exit criteria:** can download, see progress, install, and remove real
model weights end-to-end (MusicGen and 13 other Hugging-Face-backed
variants) — install lifecycle only, doesn't run yet.

---

## Phase 4 — Model Adapter Framework
**Objective:** the dynamic-UI engine — the actual "plug and play" promise
of the app.

- Manifest schema finalized (per [02-architecture.md](02-architecture.md))
  and a manifest written for every catalog model (data only, no execution
  yet).
- Dynamic input-form renderer: walks a manifest's `inputs[]` and renders
  the bottom generation bar + any needed modal fields, matching the
  reference's chained-dropdown pattern.
- Dynamic output-viewer mount point: picks waveform player vs. piano-roll
  vs. both based on `outputs[]`, with a clean placeholder for each until
  Phase 6/7 build the real viewers.
- Model Server Manager in the Electron main process: start/health-
  check/stop a model's local Python server subprocess, relay SSE progress
  to the renderer.
- Generation job queue: request → running → done/failed, persisted to the
  `generation` table from Phase 2.

**Exit criteria:** switching a workspace's bound model changes the
generation screen's inputs and output-viewer placeholder correctly for
every catalog manifest, using fake/mocked server responses (no real model
inference required yet).

---

## Phase 5 — Pilot Model: MusicGen (end-to-end)
**Objective:** prove the entire pipeline for real, with the simplest model
in the catalog.

- Real MusicGen Python server (FastAPI) in its own venv, matching pinned
  deps from [03-model-catalog.md](03-model-catalog.md).
- Wire Phase 4's adapter framework to it for real: text prompt (+ optional
  melody reference for the melody variant) in, WAV out.
- First real generation, end to end: Model Manager install → workspace
  bound to MusicGen → project → generate → job completes → file lands on
  disk under the project folder → row written to `generation` table.

**Exit criteria:** a user can install MusicGen, create a workspace bound to
it, generate a real audio clip from a text prompt, and see it complete —
without touching any other model's code path.

---

## Phase 6 — Audio Output Experience
**Objective:** make the audio side of the app actually pleasant to use,
matching the reference apps' bottom mini-player and per-item playback.

- Waveform player component (per-generation and a persistent bottom mini-
  player like the Voicebox reference), transport controls, seek.
- Save/export flow: export to a user-chosen location, with format options
  if relevant (e.g. WAV as generated, or a convenience MP3/FLAC export).
- Download and share actions (share = OS-native share sheet or "reveal in
  folder" + copy, no cloud upload involved unless later requested).
- Project-level audio library view: list of a project's generations with
  inline playback.

**Exit criteria:** MusicGen generations from Phase 5 can be played, saved,
exported, and downloaded through a polished UI — this phase is the
reference bar for "beautiful audio UI" the rest of the app is held to.

---

## Phase 7 — Symbolic/MIDI Models: MuseCoco, Museformer
**Objective:** prove the adapter framework handles a completely different
output modality, and MuseCoco's much richer structured-input form.

- MIDI/piano-roll viewer component (new — first non-audio output viewer).
- MuseCoco server + venv (Python 3.8/PyTorch 1.11 pin, isolated), wired
  through the adapter framework; validate the richer structured-input form
  (instrument/genre/mood/tempo/key/time-signature/bar-count/etc.) renders
  and submits correctly.
- Museformer server + venv, wired through; validate the seed/continuation-
  style input (no free-text prompt) renders sensibly in the same generic
  form renderer, or extend the manifest schema if it genuinely can't.
- MIDI export/download/save parity with the audio flow from Phase 6.

**Exit criteria:** both models installable and generate real MIDI output,
viewable and exportable, without the generic input/output framework needing
model-specific hacks in the renderer.

---

## Phase 8 — Heavy Multi-Modal Models: ACE-Step 1.5, YuE2
**Objective:** the most demanding catalog entries — large input surfaces,
high hardware requirements, and (for YuE2) simultaneous audio + symbolic
output.

- Hardware-gating UI: warn/block generation if the active machine's VRAM
  doesn't meet a model's declared minimum (from the manifest), rather than
  failing opaquely mid-run.
- ACE-Step 1.5 server + venv; validate lyrics/BPM/key/tags/reference-audio
  input set and confirm actual output file format (flagged
  `NEEDS VERIFICATION` in the catalog doc — resolve here).
- YuE2 server (potentially multiple internal venvs per its own
  sub-components) + venv; validate dual output — audio player **and**
  symbolic viewer mounted together for one generation.
- License-tier badges (CC-BY-NC) visibly surfaced wherever these models'
  outputs can be exported/shared, so the user isn't surprised later.

**Exit criteria:** both models generate real output end-to-end on
appropriate hardware, with correct dual-viewer behavior for YuE2 and clear
hardware-gating messaging for both.

---

## Phase 9 — Realtime Adapter: RAVE
**Objective:** the one model that doesn't fit the batch-generation pattern
at all — audio-in/audio-out timbre transfer, potentially realtime.

- Distinct UI paradigm: "select a trained timbre model" + audio input
  (file or live capture) instead of a prompt bar.
- RAVE server lifecycle for streaming/realtime use, separate from the
  batch job queue used by every other model.
- CC-BY-NC-SA license badge, share-alike terms surfaced clearly given it's
  the strictest tier in the catalog.

**Exit criteria:** a user can run an audio file (or live input, if in
scope for v1) through a RAVE timbre model and get resynthesized audio out,
saved through the same Phase 6 export flow.

---

## Phase 10 — Training Pipeline Framework & RAVE Training Pilot
**Objective:** prove the training pipeline end to end with the simplest,
most natural case in the catalog before generalizing it.

- `training` manifest block finalized (per [02-architecture.md](02-architecture.md))
  and written for every catalog model, including `supported: false` +
  reason for YuE2.
- Training Job Manager in the Electron main process: spawn/health-check a
  model's `train.py` in its own venv, PID + heartbeat file per run so a
  run survives app restarts and can be reattached to on relaunch.
- Training screen (new top-level nav item, not nested in a workspace):
  New Training Run wizard reusing the Phase 4 form renderer against
  `training.hyperparameters[]`; dataset drop-zone with file-type
  validation; hardware preflight reusing Phase 8's gating component
  against `training.hardware`; output-directory picker defaulting to
  `KWESI_TRAINED_MODELS_DIR`.
- Real RAVE training end-to-end: drop in a raw-audio dataset (no captions
  needed — RAVE's native case), run training, watch live loss/progress,
  land a completed checkpoint that registers as a `trained_model` and
  shows up in Model Manager under "My Trained Models," selectable for a
  new workspace exactly like a stock checkpoint.
- Interrupted-run handling: kill the app mid-run, relaunch, confirm the
  run is correctly surfaced as interrupted rather than silently lost.

**Exit criteria:** a user can take an installed RAVE model, drop in their
own audio files, train a custom timbre model, and immediately use that
trained checkpoint in a new workspace — with the run surviving an app
restart along the way.

---

## Phase 11 — Training: Remaining Trainable Models
**Objective:** generalize the training pipeline proven in Phase 10 across
the rest of the catalog's trainable models.

- MusicGen training: audio + per-clip text caption dataset input (inline
  captioning UI + bulk CSV/JSON import), fine-tune/LoRA via AudioCraft's
  own training scripts.
- ACE-Step 1.5 training: audio + lyrics/tags dataset input, LoRA
  fine-tuning (confirm exact supported method against the real repo —
  flagged `NEEDS VERIFICATION` in the catalog doc).
- MuseCoco and Museformer training: MIDI dataset input, full fine-tune.
- Confirm YuE2 stays correctly disabled in the Training screen with its
  hardware-infeasibility reason shown, not just hidden.

**Exit criteria:** every catalog model marked `training.supported: true`
can produce a real trained checkpoint through the same generic wizard used
in Phase 10, with per-model dataset-format validation correctly steering
the user (e.g. rejecting audio dropped on a MIDI-only model with a clear
explanation).

---

## Phase 12 — Profile, Security & App Lock
**Objective:** the local profile and the optional local passcode feature.

- Settings > Profile: local display name, optional email, optional
  avatar — stored locally only, no account, no server round-trip.
- Settings > Security: set/change/remove a local passcode.

- Settings > Security: set/change/remove a local passcode.
- Passcode verification and any derived key stored via the OS keychain
  (Keychain/Credential Manager/Secret Service), never plaintext on disk.
- Idle-timer in the renderer/main process tracks user activity; on timeout
  (default `KWESI_LOCK_IDLE_TIMEOUT_MINUTES` = 10, configurable in
  Settings) the app locks itself even while still open, not just on
  relaunch.
- Lock screen shown both on next launch and on idle timeout when a
  passcode is set; unlock returns to exactly where the user left off.

**Exit criteria:** setting a passcode locks the app both on relaunch and
after the configured idle period; removing it returns to the current
no-auth behavior; nothing about workspace/project data depends on the lock
(it's a UI gate, not encryption of the data itself, unless later
requested).

---

## Phase 13 — Polish, Packaging & Distribution
**Objective:** ship it.

- Installers for Windows/macOS/Linux (electron-builder or equivalent),
  code signing where applicable.
- Auto-update mechanism.
- Crash/error reporting (local-only unless the user opts into anything
  external — no telemetry by default, consistent with the no-account
  philosophy).
- Performance pass on large model downloads, training runs, and app
  startup with several models (and trained checkpoints) installed.
- Full pass through every model's acknowledgment card, license badge, and
  export warning copy for accuracy.

**Exit criteria:** a clean install on each target OS reproduces the full
flow from first-run acknowledgments through generating audio, training a
custom model, and exporting output, with at least MusicGen, MuseCoco, RAVE,
and one heavy model installed.

---

## Notes on sequencing

- Phases 0–6 are the critical path and should not be reordered — they
  build the framework and prove it once, cheaply, before the expensive
  per-model integration work in 7–9.
- Phases 7, 8, and 9 are largely independent of each other once Phase 6 is
  done — they can be reordered or parallelized if that becomes useful, but
  the catalog doc's integration-order rationale (simplest input/output
  surface first) is the recommended default.
- Phase 10 depends on Phase 9 (RAVE inference) being done, since RAVE is
  also the training pilot — reuses the same installed model. Phase 11
  depends on Phase 10's framework, not on Phases 7–9 individually having
  happened in any particular order, only on having happened at all.
- Phase 12 (profile + app lock) has no dependency on 7–11 and could move
  earlier if you want it sooner — it only depends on Phase 1's shell
  existing.
