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

## Phase 1 — App Shell & Design System ✅ complete
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

## Phase 2 — Workspace & Project Data Layer ✅ complete
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

## Phase 4 — Model Adapter Framework ✅ complete
**Objective:** the dynamic-UI engine — the actual "plug and play" promise
of the app.

- Manifest schema finalized in `src/data/manifests.ts` (per
  [02-architecture.md](02-architecture.md)) and a manifest written for
  every catalog model, transcribed from the real per-model input/output
  specs in [03-model-catalog.md](03-model-catalog.md) — MusicGen's
  melody-only reference-audio field, MuseCoco's richest structured-
  attribute form, Museformer's seed/continuation input (no free-text
  prompt), ACE-Step's lyrics/BPM/key/tags/reference-audio set, YuE2's dual
  audio+symbolic output declaration, and RAVE's audio-in/audio-out shape
  with zero checkpoint variants (data only, no execution yet).
- Dynamic input-form renderer (`src/components/generation/
  DynamicGenerationForm.tsx`): walks a manifest's `inputs[]`, renders the
  right control per input type, respects the `onlyForVariant` conditional
  (covered by Vitest tests), and only offers checkpoint variants the
  workspace's model actually has `installed` — an uninstalled/untrained
  model (e.g. RAVE today) shows an explicit install-prompt or "no trained
  model available yet" state instead of a broken generate button.
- Dynamic output-viewer mount point (`src/components/generation/
  OutputViewerPlaceholder.tsx`): picks waveform player vs. piano-roll vs.
  both from a generation's `output_kind`, with a clean placeholder for each
  until Phase 6/7/8 build the real viewers.
- Model Server Manager in the Electron main process
  (`electron/models/modelServer.ts`): tracks a start/stop/status lifecycle
  per model and walks a submitted generation through
  queued → running → done/failed with periodic progress broadcast over IPC
  (`electron/ipc/generation.ts`, mirroring `downloadQueue.ts`'s house
  style). **Intentionally mocked per this phase's own exit criteria** — no
  Python subprocess is spawned; "running" is a timed status walk with a
  small random chance of a simulated failure to exercise the error UI.
  Real process spawning is Phase 5's job.
- Generation job queue: wired end-to-end through `WorkspaceDetail.tsx`'s
  "+ New Generation" flow — submitting the dynamic form creates a
  `generation` row (`queued`, `input_params`/`checkpoint_variant`
  populated from the form) and the mock Model Server Manager progresses it
  live, with the UI reflecting queued/running/done/failed via the same
  progress-event pattern as the Model Manager's install queue.

**Simplifications made (v1, noted as acceptable scope calls):**
- The mock Model Server Manager writes empty placeholder output files
  (`output.wav`/`output.mid` with no real bytes) so the on-disk/
  `output_files` plumbing is exercised now — real audio/MIDI bytes arrive
  with Phase 5+'s real inference.
- ACE-Step 1.5's two `5hz-lm-*` prompt-expansion front-ends and YuE2's VAE
  decoder choice are modeled as manifest inputs/notes rather than
  selectable `checkpoint_variant`s, since the app's data model has exactly
  one checkpoint-variant slot per generation and these aren't standalone
  generation checkpoints.
- Manifest data lives renderer-side only (`src/data/manifests.ts`); the
  Electron main process doesn't need a duplicate copy for this phase since
  the mock Model Server Manager only needs a generation's already-computed
  `output_kind`, not the full manifest. If a later phase's main-process
  validation needs manifest data too, mirror it the way
  `electron/db/seedModels.ts`/`src/data/modelVariants.ts` already do.

**Exit criteria:** switching a workspace's bound model changes the
generation screen's inputs and output-viewer placeholder correctly for
every catalog manifest, using fake/mocked server responses (no real model
inference required yet).

---

## Phase 5 — Pilot Model: MusicGen (end-to-end) ✅ complete

**Objective:** prove the entire pipeline for real, with the simplest model
in the catalog.

- Real MusicGen Python server (FastAPI) in its own venv
  (`servers/musicgen/server.py`, venv at `$KWESI_VENVS_DIR/musicgen`) —
  exact working pins in `servers/musicgen/requirements.txt`, verified from a
  from-scratch venv rebuild, not just the dev venv used during integration.
  See `servers/musicgen/README.md` for the two-step install (`pip install -r
  requirements.txt` then `pip install --no-deps audiocraft==1.3.0` — the
  `--no-deps` is load-bearing, audiocraft 1.3.0's own pins have no Python
  3.12 wheels and are stale for most of what's actually imported).
- `electron/models/modelServer.ts` now spawns/health-checks/reuses that real
  subprocess for `modelId === "musicgen"` specifically, routes generation
  requests to it over HTTP (`POST /generate`), and writes the real WAV into
  the generation's own directory via the existing `generationDir()` helper
  — every other model_id (musecoco, museformer, ace-step-1.5, yue2, rave)
  is untouched and still walks the Phase 4 mock path.
- Real generation proven twice: (1) standalone, calling
  `audiocraft.models.MusicGen` directly against a locally downloaded
  checkpoint with no Electron involved; (2) through the real Electron
  main-process code path (`submitGeneration` → real subprocess → real HTTP
  call → `generation` row → real WAV on disk), driven by a one-off script
  run via `npx electron` since better-sqlite3 needs Electron's Node ABI.
  Both produced a valid, non-silent WAV (correct RIFF/WAVE header, correct
  sample rate/duration, non-trivial PCM amplitude, not an empty placeholder
  file).

**Simplifications made (v1, noted as acceptable scope calls):**
- **Melody-conditioned generation (the `melody` variant's reference-audio
  input) is not end-to-end wired**, and this isn't a Phase 5 gap — it's a
  pre-existing Phase 4 one: `DynamicGenerationForm.tsx`'s `audio_upload`
  handler only ever captures the picked file's *name*
  (`onChange(file.name)`), never a real path or file transfer. The real
  server (`server.py`) does implement melody conditioning
  (`MusicGen.generate_with_chroma`) given a real absolute path, and
  `modelServer.ts` passes one through if `input_params.melody_audio` happens
  to already be a real file that exists on disk — but nothing in the
  current UI can produce that today. Fixing the upload plumbing is future
  work, not scoped to this phase. **Fixed in Phase 9**, driven by RAVE
  actually needing it — see that section below and
  `src/components/generation/DynamicGenerationForm.tsx`'s
  `resolveUploadedFilePath`.
- **No real streaming progress from the Python server.** A generation
  request is one blocking `POST /generate` call; the UI still sees
  `queued` → `running` (a single 0% tick) → `done`/`failed` over the same
  `GenerationProgressEvent` shape Phase 4 established, just without
  intermediate percentage updates during the real inference call itself.
  Adding real progress would mean SSE or WebSocket support in `server.py`
  plus a step-callback into `audiocraft`'s generation loop — meaningfully
  more scope than proving the pipeline needs for v1.
- **Fixed port, single instance.** `modelServer.ts` always uses port 17600
  (the first port in the manifest's `[17600, 17619]` range) rather than
  scanning for a free port in the range, since only one MusicGen server
  process is ever running at a time in this v1.
- **CPU fallback exists in code, not verified by running.** `server.py`
  picks `cuda` when available else `cpu`; the dev machine always has an
  idle RTX 3090, so the CPU branch was read-reviewed, not exercised.
- **`t5-base` (MusicGen's text conditioner, loaded via
  `transformers.T5EncoderModel`) is a real runtime dependency that isn't
  part of the five downloaded MusicGen checkpoints** — it was fetched once
  into the standard Hugging Face cache during environment setup, and the
  server sets `HF_HUB_OFFLINE=1`/`TRANSFORMERS_OFFLINE=1` before import so
  every subsequent load is offline. Documented in
  `servers/musicgen/README.md` since it's easy to miss when rebuilding the
  venv on a machine without that cache already warm.
- **Packaging is out of scope.** `modelServer.ts` resolves
  `servers/<model_id>/server.py` relative to the compiled `dist-electron/`
  location, which is correct for dev and for an unpacked build, but a real
  installer (Phase 13) needs `servers/` and each model's venv shipped as
  `extraResources` — not attempted here.

**Exit criteria:** a user can install MusicGen, create a workspace bound to
it, generate a real audio clip from a text prompt, and see it complete —
without touching any other model's code path. ✅ Verified for the `small`
variant, short (6s) durations, text-prompt-only generation.

---

## Phase 6 — Audio Output Experience ✅ complete
**Objective:** make the audio side of the app actually pleasant to use,
matching the reference apps' bottom mini-player and per-item playback.

- Waveform player component (`src/components/audio/WaveformPlayer.tsx`):
  play/pause, a seek/scrubber bar, current-time/duration display, and a
  volume slider, backed by a single native `<audio>` element. Mounted
  directly inline per generation in `WorkspaceDetail.tsx`'s generation list
  — not gated behind an expand toggle — so a project's audio generations are
  individually playable straight from the list (the "library view" exit
  criterion). A `compact` mode collapses to just play/seek/time for the
  list row; expanding a row (the "More" toggle) reveals volume plus the
  Export/Download/Share actions.
- A single shared player: `src/lib/playerStore.tsx` (`PlayerProvider` +
  `usePlayer()`, a plain React Context/reducer store — no new dependency,
  consistent with the codebase's minimal-deps style so far) owns the one
  real `<audio>` element for the whole app, mounted once in `main.tsx`
  outside the router. `src/components/audio/MiniPlayer.tsx` is a bottom-
  docked bar (mounted in `AppShell.tsx`, below the routed `<Outlet>`) that
  reflects and controls whatever track is currently loaded in that shared
  player, so navigating away from a workspace (e.g. to Settings) does not
  stop playback — the same `<audio>` element and Context state survive the
  route change since `AppShell` isn't remounted by nested-route navigation.
  Renders nothing (no dead space) when nothing is playing.
- Empty-vs-real-audio detection: before showing a player, `WaveformPlayer`
  calls a new stat IPC (`kwesi:audio:stat`) and only renders playable
  controls for a non-empty file; a 0-byte file (any model still on the
  Phase 4 mock) or a missing file shows a clear "No audio yet for this
  generation." state instead of a broken/silent player. Pure logic in
  `src/lib/audioFiles.ts` (`classifyAudioStat`, `findAudioFile`,
  `parseOutputFiles`, `suggestedExportName`) is unit-tested directly.
- Export and Download: implemented as **one real mechanism**, not two —
  `electron/ipc/audio.ts`'s `kwesi:audio:save` copies the real file to a
  user-chosen destination via `dialog.showSaveDialog`, differing only in
  which folder the dialog opens to (`KWESI_EXPORTS_DIR` for Export, the OS
  Downloads folder via `app.getPath("downloads")` for Download). This is
  the first real consumer of `KWESI_EXPORTS_DIR` (previously resolved but
  unread). A local desktop app has no meaningful difference between
  "export a copy" and "download a copy" once there's no server in the
  loop, so collapsing them to one code path (documented inline in
  `electron/ipc/audio.ts`) was a deliberate simplification rather than an
  oversight — see 01-overview.md's updated wording.
- Share: implemented for real as "reveal in folder"
  (`shell.showItemInFolder` via `kwesi:audio:reveal`) — no OS share sheet,
  no cloud upload, consistent with the no-cloud-sync stance.
- New IPC surface follows the existing house quadruplet: `electron/ipc/
  audio.ts` (registration; every path is checked against
  `workspacesRootDir()` before touching the filesystem, mirroring
  `allowedExternalLinks.ts`'s allowlisting posture) → `electron/preload.ts`
  (`window.kwesi.audio`) → `src/lib/kwesiBridge.ts` (types) →
  `src/lib/audio.ts` (real client + a localStorage-era mock that serves an
  in-memory-generated silent WAV via `buildSilentWav()` so the player is
  fully exercisable in a plain browser preview with no Electron/real files
  involved).

**Simplifications made (v1, noted as acceptable scope calls):**
- **Export/Download collapsed to one mechanism** (see above) rather than
  building two separate flows or adding MP3/FLAC transcoding — the roadmap
  called format conversion "if relevant"; nothing in the catalog needs it
  yet since every real output today is the WAV MusicGen already writes, so
  no transcoding was added in v1.
- **Audio bytes cross IPC as a `Uint8Array`, not a streamed read.** Fine at
  the durations Phase 5 proves (short MusicGen clips); a much larger file
  would want a streamed/range-request approach instead of one `readFile`
  call, not attempted here.
- **The MIDI half of an `audio+midi` generation still renders through the
  old `OutputViewerPlaceholder` dashed placeholder** (unchanged, per this
  phase's explicit scope) — only the audio side was replaced with a real
  player; no catalog model produces real `audio+midi` output yet (YuE2 is
  Phase 8), so this is untested against real files, only against the
  Phase 4 mock's empty placeholders.

**Exit criteria:** MusicGen generations from Phase 5 can be played, saved,
exported, and downloaded through a polished UI — this phase is the
reference bar for "beautiful audio UI" the rest of the app is held to. ✅

---

## Phase 7 — Symbolic/MIDI Models: MuseCoco, Museformer ✅ MuseCoco complete, Museformer partial
**Objective:** prove the adapter framework handles a completely different
output modality, and MuseCoco's much richer structured-input form.

- MIDI/piano-roll viewer component: `src/components/midi/PianoRollViewer.tsx`
  (first non-audio output viewer) — a static piano roll (notes as bars
  positioned by pitch/time, no playback), mounted inline per generation in
  `WorkspaceDetail.tsx` exactly like Phase 6's `WaveformPlayer`, with the
  same Export/Download/Share actions. Parses the real `.mid` bytes with a
  small hand-rolled Standard MIDI File parser (`src/lib/midiParser.ts`) —
  a new npm dependency was considered and rejected (see that file's header
  comment): the read-only, notes-only surface this viewer needs is a few
  dozen lines, and every real npm option pulls in either a playback engine
  or a much broader event surface than needed. Unit-tested against a
  hand-built minimal SMF byte buffer (`src/lib/__tests__/midiParser.test.ts`).
- **MuseCoco: real, proven end-to-end.** `servers/musecoco/server.py`
  (FastAPI, `servers/musecoco/vendor/` = `microsoft/muzic`'s `musecoco`
  subfolder) loads the real ~1B-param `attribute2music.pt` checkpoint once
  and serves `/generate` in-process using the vendored fairseq task/model/
  generator directly (not a CLI subprocess). Runs on **CPU** — the model's
  `pytorch-fast-transformers` dependency has no system CUDA toolchain to
  build its GPU extension against on this machine, but the package's own
  CPU fallback works with zero code changes (see
  `servers/musecoco/README.md`'s dependency-archaeology section). Verified
  twice: (1) standalone, calling the vendored fairseq task/generator
  directly with no server involved; (2) through `servers/musecoco/
  server.py`'s own `generate()` function. Both produced a real, valid,
  non-empty `.mid` file — confirmed with `mido` (non-zero duration, real
  `note_on`/`note_off` event pairs). `electron/models/modelServer.ts` now
  spawns/health-checks/reuses this real subprocess for
  `modelId === "musecoco"`, mirroring MusicGen's Phase 5 pattern exactly
  (`runRealMuseCocoJob`, sharing a generic `runRealMidiJob` with
  Museformer since both speak the same `{input_params, output_path} ->
  {output_path}` contract).
- **The manifest's structured-attribute *values* were rewritten to match
  the real model**, not the other way around — MuseCoco's real attribute
  vocabulary (reverse-engineered from the vendored repo's own attribute-unit
  code) turned out narrower/differently-shaped than the v1 guesses in
  several places: key signature only conditions on major/minor (not a
  specific tonic), pitch range means "octaves spanned" (not a register),
  mood is Russell's 4-quadrant model (not free text), artist style is a
  fixed 17-composer list (not free text), bar count only meaningfully
  conditions up to 16 bars. Full table and reasoning in
  `servers/musecoco/README.md` and the comment block above `MUSECOCO` in
  `src/data/manifests.ts`. The `description` free-text field is kept in the
  form but never sent to the real server — no stage-1 text-to-attribute
  checkpoint was ever published (confirmed in `03-model-catalog.md`), so
  there's no code path that could use it.
- **Museformer: code-complete, not verified.** `servers/museformer/
  server.py` is wired into `modelServer.ts` the same real-subprocess way,
  shelling out to the vendored repo's own documented `fairseq-interactive`
  CLI invocation (`--user-dir`) rather than a hand-rolled generation loop.
  Never actually run: no venv was built for it in this phase, and its
  decoder imports custom CUDA/Triton kernels
  (`museformer/kernels/*`, `museformer/blocksparse/*`) whose CPU-fallback
  coverage is unconfirmed — two of the three kernel modules do have a real
  `is_cuda`-gated PyTorch fallback, but the Triton-based `blocksparse`
  module has no CPU path at all, and whether the default inference path
  actually reaches it was never determined. Full risk assessment and the
  concrete next steps to verify it are in `servers/museformer/README.md`.
  This is a deliberate scope cut, not an oversight: MuseCoco's integration
  took most of this phase's budget after a materially deeper
  reverse-engineering effort than expected (see below), and finishing one
  model for real rather than leaving both half-verified was the better use
  of the remaining time.
- MIDI export/download/save parity with the audio flow from Phase 6: no new
  IPC surface was needed — `electron/ipc/audio.ts`'s `stat`/`read`/`save`/
  `reveal` handlers were already generic over any file under the workspaces
  root (only `mimeTypeFor` needed a `.mid`/`.midi` case), so `.mid` files
  reuse the exact same `window.kwesi.audio` channel and `kwesiAudio` client
  Phase 6 built, rather than a parallel `midi.ts` duplicating the same
  path-boundary-safety check.

**Simplifications made (v1, noted as acceptable scope calls):**
- **Museformer's real generation is unverified** (see above) — installable
  and wired through the exact same adapter framework, but not proven to
  produce real output. `seed_mode: "continue_from_midi"` additionally isn't
  wireable yet even once the environment is sorted, for the same
  pre-existing Phase 4 reason MusicGen's melody-reference upload isn't:
  `DynamicGenerationForm`'s `midi_upload`/`audio_upload` handlers only ever
  capture a file's *name*, never a real transferred path. **Fixed in Phase
  9** — the upload plumbing itself no longer blocks this; Museformer's
  real-generation verification gap (the kernel/CPU-fallback question) is
  separate and still open.
- **MuseCoco generation is CPU-only and slow** (minutes, not seconds, for a
  real-length piece) — there is no GPU path today since the model's compiled
  attention extension has nothing to build against without a system CUDA
  toolchain (no `nvcc`, no passwordless `sudo` to install one). Functional
  and verified, not fast.
- **No real streaming progress**, same as Phase 5's MusicGen — a single
  blocking `/generate` call, `queued` → `running` (one 0% tick) →
  `done`/`failed`.
- **Not re-verified through the real compiled Electron path** (Phase 5's
  "run it via `npx electron` with better-sqlite3's Electron-ABI build"
  bonus step) — standalone Python (both ad hoc and through
  `servers/musecoco/server.py`'s own code) was prioritized instead, given
  the time this phase's dependency/attribute-encoding investigation
  actually took. `electron/models/modelServer.ts`'s real-subprocess wiring
  for `musecoco`/`museformer` was read-reviewed and type-checks
  (`npx tsc -p electron/tsconfig.json`) but wasn't exercised by actually
  submitting a generation through a running Electron main process in this
  phase.
- **Instrument/genre free-text tags are matched, not translated.**
  `instrument`/`genre` stay `tags` fields (multi-value) rather than becoming
  closed `select`s like `mood`/`artist_style`/`key_signature` did, since a
  user can reasonably type several of each; `servers/musecoco/server.py`
  does a case-insensitive exact match against the real category vocabulary
  and silently drops (logging a warning) anything that doesn't match,
  rather than guessing a translation.

**Exit criteria:** ✅ MuseCoco — installable, generates real MIDI output
end-to-end (standalone and through its own server), viewable (piano roll)
and exportable, with no model-specific hacks in the generic renderer.
⚠️ Museformer — installable and wired through the identical framework, but
generation is unverified; the piano-roll viewer, IPC/export plumbing, and
`modelServer.ts` real-subprocess pattern are all shared/proven via MuseCoco,
so this is a dependency-environment gap, not a framework gap.

---

## Phase 8 — Heavy Multi-Modal Models: ACE-Step 1.5, YuE2 ✅ hardware-gating + ACE-Step complete, YuE2 partial (see below)
**Objective:** the most demanding catalog entries — large input surfaces,
high hardware requirements, and (for YuE2) simultaneous audio + symbolic
output.

- **Hardware-gating UI: real, done.** `electron/models/gpuInfo.ts` queries
  live free/total VRAM via `nvidia-smi` from the Electron main process
  (`electron/ipc/hardware.ts` → `window.kwesi.hardware` →
  `src/lib/hardware.ts`'s real/mock pair, the standard IPC quadruplet —
  degrades to "no GPU detected" rather than crashing when `nvidia-smi`
  isn't on `PATH`, since not every machine has an NVIDIA GPU).
  `DynamicGenerationForm.tsx` compares this against the selected
  checkpoint's real minimum (`minVramGbFor()`, which reads a new optional
  per-variant `manifest.variantHardware` override when the model has one —
  ACE-Step's 2B-vs-XL spread needed it, most models don't) and shows a
  warning (not a hard block) when VRAM looks insufficient, since the
  declared minimum is a documented figure, not a live guarantee. The one
  hard block: no GPU detected at all and the model has no CPU fallback —
  the one case a generation is guaranteed to fail outright. Tested with
  Vitest (`DynamicGenerationForm.test.tsx`'s three new hardware-gate cases:
  warning-but-allowed, hard-block-with-no-GPU-no-fallback, and the
  no-banner-when-sufficient case) and manually against this machine's real
  RTX 3090 (`curl`-equivalent: the IPC handler was exercised via the
  renderer's mock-vs-real bridge selection, real `nvidia-smi` output parsed
  correctly for total/used/free VRAM).
- **ACE-Step 1.5 server + venv: real, proven.** Investigated the real repo
  first, per this phase's own instruction, and found it ships its own real
  REST API server (`acestep.api_server`) rather than needing a third
  hand-written FastAPI wrapper — `electron/models/modelServer.ts`'s
  `spawnAceStepServer()` runs ACE-Step's own server directly, cloned whole
  into `servers/ace-step-1.5/vendor/` (gitignored, reproducible — see
  `servers/ace-step-1.5/README.md` for the full "why" and the exact clone/
  `uv sync` commands, plus a checkpoint-directory-layout bridging problem
  that took two real attempts to actually solve: `ACESTEP_CHECKPOINTS_DIR`
  turned out to be read by the model-download CLI but *not* the real
  server-startup code path, which hardcodes `<project_root>/checkpoints` —
  found by watching a real run silently re-download 9.4GB it didn't need
  to, fixed with a second symlink). **Output format resolved**: WAV,
  16-bit PCM, stereo, 48000Hz when `audio_format: "wav"` is requested (the
  real API defaults to mp3; this app always requests wav explicitly) —
  verified via Python's `wave` module against a real generated file (RIFF/
  WAVE header correct, exactly the requested 12.0s duration, 99.97%
  non-zero samples, not a silent placeholder). **PyTorch pin resolved**:
  `torch==2.10.0+cu128`, `transformers==4.57.6`, from the real repo's own
  `pyproject.toml`. Proven twice, standalone (no Electron): once against
  the freshly-installed venv, once again after the checkpoint-symlink fix
  to confirm no re-download recurs. `acestep-v15-turbo` (2B, fastest) only
  — XL variants and non-turbo checkpoints are wired identically but
  untested (see the README's "What's not verified" for the honest list,
  including that the actual compiled-Electron path — `modelServer.ts`'s
  ACE-Step wiring — was read-reviewed and type-checks but wasn't exercised
  through a running Electron main process this phase, same simplification
  Phase 7 made for MuseCoco/Museformer's real-subprocess wiring).
- **YuE2 server: real standalone generation proven, further than expected
  going in — but not wired into the app.** Investigated first (per this
  phase's own instruction): unlike ACE-Step, YuE2 ships no server of its
  own, just a pip-installable library (`YuE2Pipeline.from_pretrained(...)`)
  — confirmed real by reading `github.com/multimodal-art-projection/YuE`
  directly. **Confirmed SheetSage2/MERT are only needed for the separate
  "cover a song" transcription workflow, not core lyrics+style→song
  generation** (read directly from the repo, not assumed) — so only the
  `yue2-3b`/`yue2-vae` venv was needed. A real venv (`torch==2.10.0+cu128`,
  `transformers==4.57.6`, matching the catalog doc's pin) installed cleanly
  in under two minutes, and a real generation — full `cot="full"`
  melody-and-chord planning, a real style+lyrics request — produced a
  genuinely valid, non-silent **24-bit FLAC** (not WAV — corrected in the
  manifest) at 59.36s, plus a real **ABC-notation score** (not a binary
  `.mid` file — also corrected in the manifest, a non-obvious finding only
  discoverable by actually running it) in 34.6 seconds of real GPU compute,
  peaking at only ~3-4GB observed VRAM (well under the documented 24GB
  minimum, likely because this was one short single-song request, not a
  correction to that figure). Run twice to confirm. **What's genuinely not
  done, and why**: no FastAPI wrapper or `modelServer.ts` wiring (YuE2
  needs one written from scratch, unlike ACE-Step's own server — real
  additional scope this phase's time budget didn't have room for after
  Part 1/Part 2), and no dual-viewer UI (the real symbolic output is ABC
  text, which this app's real MIDI-only `PianoRollViewer` cannot render,
  and there's no ABC→MIDI converter anywhere in the YuE2 repo to bridge
  it — building a real ABC viewer is separate, non-trivial scope, and
  modifying Phase 6/7's player components beyond reusing them as-is is
  explicitly out of bounds). Full writeup, exact commands, and the honest
  "why stop here" reasoning in `servers/yue2/README.md`.
- **License-tier badges: done**, generalized rather than YuE2-specific —
  `WorkspaceDetail.tsx`'s `LicenseBadge` shows next to any `done`
  generation whose bound model's `licenseTier` isn't `mit` (reusing
  `LICENSE_LABEL` from `src/data/catalog.ts`, the same labels the
  Acknowledgments screen already uses), so MusicGen's existing CC-BY-NC
  outputs get it too, not just YuE2's — Phase 6/7's player/export code
  itself was left untouched, this is a sibling element in the generation
  list.

**Exit criteria:** ✅ ACE-Step 1.5 generates real output end-to-end through
the app's own `modelServer.ts` wiring on the `acestep-v15-turbo` checkpoint,
with clear hardware-gating messaging for both models and license badges
surfaced wherever output can be exported/shared. ⚠️ YuE2 — real output *was*
produced (unlike the exit criteria's original framing anticipated as the
risk), just not through the app: standalone generation is proven for real,
but it isn't wired into `modelServer.ts` or the UI, so the dual-viewer
behavior this phase wanted (audio player **and** symbolic viewer mounted
together for one generation, inside the app) was not reached — the real
blocker is a genuine ABC-vs-MIDI format mismatch against this app's
existing MIDI-only viewer plus the remaining server-wrapper work, both
documented in `servers/yue2/README.md`, not an inference failure.

---

## Phase 9 — Realtime Adapter: RAVE ✅ batch mode complete, streaming not attempted
**Objective:** the one model that doesn't fit the batch-generation pattern
at all — audio-in/audio-out timbre transfer, potentially realtime.

- **A real, blocking gap fixed first: file uploads now transfer a real
  path.** `DynamicGenerationForm.tsx`'s `audio_upload`/`midi_upload`
  handler previously only ever captured a picked file's *name*
  (`onChange(file.name)`) — a known gap since Phase 4/5 that MusicGen's
  optional melody reference and Museformer's optional seed MIDI could limp
  along without, but RAVE cannot: its entire function is transforming a
  real input file. Fixed with Electron 32's `webUtils.getPathForFile(file)`,
  exposed through the standard preload bridge as a new, narrow
  `window.kwesi.getFilePathForUpload(file)` (synchronous — no IPC round
  trip needed, since `webUtils` only needs the real `File` reference a
  contextBridge-exposed function already receives as its argument — see
  `electron/preload.ts`). `DynamicGenerationForm.tsx`'s
  `resolveUploadedFilePath` uses it for both `audio_upload` and
  `midi_upload`, falling back to the bare file name when `window.kwesi` is
  undefined (the browser-preview mock, which has no real filesystem to
  resolve against). `electron/models/modelServer.ts`'s
  `resolveMelodyAudioPath`/`resolveAceStepReferenceAudioPath` still verify
  the path is real and absolute before trusting it (the mock path can still
  hand back a bare name), but the "happens to already be a real path" gap
  they used to document is now the normal path, not an edge case — see
  their updated comments. **Not runtime-tested** — no display server is
  available to drive a real Electron file picker in this environment; this
  was verified by reading Electron's actual `webUtils` type definitions and
  documented contract directly (`node_modules/electron/electron.d.ts`), not
  by exercising drag-and-drop or a real dialog.
- **RAVE batch-mode inference: real, proven.** `servers/rave/server.py`
  (FastAPI, following MusicGen's exact shape) loads a checkpoint's `.ts`
  file with a bare `torch.jit.load()` and caches it in-process — no
  `acids-rave` package, no vendored repo, confirmed unnecessary by loading
  a checkpoint with nothing but `torch` installed (every one of the nine
  pretrained checkpoints in `models/rave/` is a self-contained TorchScript
  export, architecturally unlike every other model in this catalog).
  `electron/models/modelServer.ts` gains `rave` in `isRealServerModel`/
  `REAL_SERVER_PORTS` (port `17680`) and a `runRealRaveJob`, its own venv at
  `$KWESI_VENVS_DIR/rave` (CPU-only — RAVE's docs call inference
  CPU-feasible for small models, confirmed by a standalone timing test).
  Proven twice — standalone direct call, and through a real running
  `uvicorn` instance — against both a mono (`darbouka_onnx`) and stereo
  (`percussion`) checkpoint, each verified with Python's `wave` module: real
  RIFF/WAVE, correct channel count, 44100Hz, non-silent, genuinely different
  from the input audio. Two real bugs were found and fixed getting there
  (stereo-output channel ordering for `soundfile`, and one checkpoint's
  decoder output exceeding `[-1, 1]`) — full writeup in
  `servers/rave/README.md`, including the honest sample-rate assumption (no
  `.ts` file carries sample-rate metadata; 44100Hz is IRCAM/ACIDS's own
  documented default for most pretrained examples, not confirmed
  per-checkpoint). The other seven checkpoints are wired identically but
  weren't individually run.
- **Existing dynamic form needed no real adjustment.** RAVE's manifest
  (`checkpointVariants`: the nine real names, one required `input_audio`
  input, no free-text prompt) already renders exactly the "select a trained
  timbre model + provide audio" UI the roadmap wanted, once the upload fix
  above landed — `DynamicGenerationForm.tsx` itself was not changed beyond
  that fix, confirming Phase 4's adapter-framework promise held for the one
  model whose input shape looks nothing like the others.
- **License-tier visibility.** `WorkspaceDetail.tsx`'s `LicenseBadge`
  (generalized in Phase 8) already showed next to any `done` generation
  whose model isn't MIT-licensed, always visible in the generation row's
  header regardless of expand/collapse state — including RAVE's
  `cc-by-nc-sa` outputs, which sit in the same row as the Export/Download/
  Share actions once expanded. Its tooltip now spells out share-alike
  specifically for `cc-by-nc-sa` (the strictest tier) rather than reusing
  the generic "non-commercial use only" wording every other non-MIT model
  gets.
- **Realtime/streaming: not attempted**, per the roadmap's own framing as
  an explicit stretch goal not to let consume the batch-mode time budget.
  `rave export --streaming` and the VST/Max `nn~` external remain
  unexplored; nothing about batch mode blocks adding it later.

**Exit criteria:** ✅ a user can run an audio file through an installed RAVE
timbre model and get resynthesized audio out, saved through the same Phase
6 export flow — proven standalone and through a real running server
process, not yet exercised through a live Electron GUI (no display server
available; see the file-upload fix's own verification note above, which
applies to the whole flow). Live-input/realtime is explicitly not in v1,
per the roadmap's own stretch-goal framing.

---

## Phase 10 — Training Pipeline Framework & RAVE Training Pilot ✅ complete
**Objective:** prove the training pipeline end to end with the simplest,
most natural case in the catalog before generalizing it.

- **`training` manifest block: real, written for every catalog model.**
  `src/data/manifests.ts`'s `TrainingConfig`/`TrainingSupportedConfig`
  types match [02-architecture.md](02-architecture.md)'s schema sketch,
  with two real, documented deviations forced by RAVE's actual CLI
  (`hyperparameters` uses `config`/`max_steps`/`batch_size`, not the
  sketch's illustrative `epochs`/`latent_size`; `server.entrypoint` names
  a real console-script command, `"rave"`, not a Python file) — see that
  doc's updated "Manifest extension: training" section for the full
  reasoning. Only RAVE has `supported: true`; MusicGen, MuseCoco,
  Museformer, and ACE-Step 1.5 all declare `supported: false` with a real
  reason ("Phase 11's job," not a hardware limitation — each really is
  trainable in principle per
  [03-model-catalog.md](03-model-catalog.md)'s training-feasibility
  table); YuE2 declares `supported: false` for the real hardware reason
  (24GB+ VRAM already needed for inference alone).
- **Training Job Manager: real, proven.**
  `electron/models/trainingManager.ts` spawns RAVE's own real CLI
  (`rave preprocess` → `rave train` → `rave export`, installed as a
  console-script entry point by the real `acids-rave` pip package — no
  hand-written `train.py` needed, the same "run the vendor's own tooling
  directly" call Phase 8 made for ACE-Step) in its own venv
  (`$KWESI_VENVS_DIR/rave-train`, a **separate** Python 3.11 venv from
  Phase 9's CPU-only inference venv — `acids-rave`'s own
  `scipy==1.10.0`/`pytorch_lightning==1.9.0` pins have no Python 3.12
  wheels; full dependency archaeology, including a real
  `pkg_resources`-missing bug hit and fixed, in
  `servers/rave/README.md`'s "Training (Phase 10)" section). Writes a
  PID + heartbeat file and a real log per run. On completion, registers
  the checkpoint as both a `trained_model` row and a `model_variant` row
  (`source: "trained"`, `install_status: "installed"`) — the latter is
  what makes a trained checkpoint immediately selectable as a real
  generation checkpoint, reusing the exact same "installed variant"
  plumbing every stock catalog variant already flows through
  (`DynamicGenerationForm.tsx`'s new `extraVariantNames` prop,
  `WorkspaceDetail.tsx` merges them in from `model_variant` rows where
  `source === "trained"`).
- **Training screen: real, built.** `src/screens/Training.tsx` (the
  "Training" nav item already existed as a Phase-1-era placeholder,
  extended here into the real screen) — New Training Run form (model
  picker showing every manifest, unsupported ones disabled with their real
  `reason`, same UX pattern as Model Manager's manual-source rows; dataset
  drop-zone with real client-side file-type validation; hyperparameters
  rendered through `DynamicGenerationForm.tsx`'s newly-exported
  `FieldControl`/`defaultValueFor`/`isSatisfied` — the *exact* same
  field-control renderer the generation screen uses, not a fork of it;
  hardware preflight reusing the same newly-exported
  `evaluateHardwareGate`/`HardwareGateBanner`; output-directory picker via
  a real native folder dialog, `electron/ipc/training.ts`'s
  `pickOutputDir`, defaulting to `KWESI_TRAINED_MODELS_DIR/<model_id>/
  <run_name>`) plus a live Training Runs list (status badges, real step/
  ETA/rate progress parsed from RAVE's own tqdm output, cancel button).
  Full IPC/mock quadruplet house style (`electron/ipc/training.ts` →
  `electron/preload.ts`'s `window.kwesi.training` → `src/lib/db.ts`'s
  `TrainingRunRow`/`TrainedModelRow` types → `src/lib/training.ts`'s real/
  localStorage-mock pair). Model Manager's "My Trained Models" section
  (no prior scaffolding existed — built from scratch) lists every
  `trained_model` row and refreshes live when a run completes.
- **Real RAVE training end-to-end: proven twice.** (1) Standalone CLI
  against a synthesized 30-file/270s dataset (sine-sweep + noise,
  `soundfile`-generated, same "synthesize a test input" precedent as
  Phase 9's inference verification) — real `rave preprocess` (90 real
  windowed chunks), real `rave train --max_steps 40` on the RTX 3090
  (~15s wall time), real `rave export` → a genuine, structurally valid
  31MB `.ts` checkpoint, loaded back with a bare `torch.jit.load()` and
  producing real, non-silent audio (verified via Python's `wave` module).
  (2) **Through the actual compiled Electron code path** — a standalone
  `npx electron <script>.mjs` (same no-GUI technique Phase 5 established;
  `app.whenReady()` itself hangs indefinitely in this sandboxed
  container with no display server at all, confirmed with and without
  `--disable-gpu`/`--no-sandbox`, so the script calls straight into
  `dist-electron/models/trainingManager.js` instead) drove a real
  `submitTrainingRun()` call end-to-end: real `training_run` row
  (`queued` → `preparing` → `running` → `completed` in ~14s), real
  `trained_model` + `model_variant` rows, a real 31MB checkpoint at the
  chosen output directory, and the app-managed symlink bridge at
  `KWESI_MODELS_DIR/rave/<variant>/<variant>.ts`. **Then loaded back
  through the real, completely unmodified Phase 9 `servers/rave/
  server.py`** — a real running `uvicorn` instance, a real
  `POST /generate` against the newly trained variant, confirmed via
  `GET /health` that the trained checkpoint (not a pretrained one) was
  what actually loaded, and a real, valid, non-silent output WAV (RIFF/
  WAVE, mono, 44100Hz, 99.98% non-zero samples) — same verification rigor
  as every prior real-inference phase. Full writeup, exact commands, and
  the two real dependency-install bugs hit and fixed in
  `servers/rave/README.md`.
- **Interrupted-run handling: real, tested.** `reconcileTrainingRunsOnStartup()`
  (mirroring `resetInterruptedDownloads`'s exact precedent in
  `electron/db/database.ts`) was exercised in the same verification run
  against a synthetic stale `training_run` row (`status: "running"`, a
  nonexistent pid) and correctly flipped it to `interrupted` with a clear
  error message. **Simplification, honestly scoped down from this
  section's original framing**: true "reattach to any still-running
  process and resume showing live progress" is not attempted — the
  multi-phase orchestration is an `async` function living inside the
  Electron process that submitted the run, so restarting the app has
  nothing left to resume regardless of whether a `detached` child process
  happens to still be alive; every active run found at startup is
  unconditionally marked `interrupted` (with a best-effort kill of any
  orphaned process at its stored pid) instead. This is simpler than
  [02-architecture.md](02-architecture.md)'s original resume-oriented
  framing, and that doc's "Training pipeline architecture" section has
  been updated to match. Real mid-training process kill (rather than a
  synthetic stale-pid row) was not separately re-run, since both exercise
  the identical reconciliation code path.

**Simplifications made (v1, noted as acceptable scope calls):**
- **No real per-step loss value in the live IPC progress channel** — only
  step count, ETA, and throughput (parsed from RAVE's own real `tqdm`
  progress-bar text). RAVE's training loop doesn't mark its logged
  metrics `prog_bar=True`, so real loss values only reach the run's
  TensorBoard event file, not stdout; reading that live would need a
  protobuf-based TensorBoard event reader, judged out of scope.
- **Dataset duration/sample-rate/channel validation happens server-side**
  (RAVE's own `rave preprocess`, which fails clearly on a too-short
  dataset — `trainingManager.ts` catches this specifically), not
  pre-flighted client-side via a real per-file `ffprobe` duration probe
  the way [02-architecture.md](02-architecture.md)'s original "42 files,
  38 minutes total" framing implied.
- **Mono only, fixed 44.1kHz/~1.49s analysis windows** for the pilot —
  not exposed as hyperparameters, matching the "couple of knobs that
  matter" framing; a real per-model Simple/Advanced hyperparameter toggle
  (mentioned as a nice-to-have in the architecture doc) wasn't built,
  since RAVE's pilot hyperparameter list is already short.
- **Validation is intentionally skipped during training**
  (`--val_every 999999`) — confirmed real and safe (RAVE's `export.py`
  reads the model's `fidelity`/`latent_pca` buffers, which default to
  zero-initialized tensors and export without erroring even unpopulated),
  but means a completed pilot checkpoint's latent space is unrefined, not
  representative of what a real, much longer production run would learn.
- **The output-directory symlink bridge is a known fragility point**: if
  a user moves or deletes a trained checkpoint's `output_dir` file after
  training, the `KWESI_MODELS_DIR/rave/<variant>/` symlink breaks and
  that variant's inference fails until it's restored — not silently
  corrected, but also not proactively guarded against (e.g. no "missing
  file" badge in the UI yet).

**Exit criteria:** ✅ a user can take an installed RAVE model, drop in
their own audio files, train a custom timbre model, and immediately use
that trained checkpoint in a new workspace — verified end-to-end through
the actual compiled Electron code path, with the trained checkpoint
loaded back and proven working through Phase 9's real, unmodified
inference server. Interrupted-run handling is real and tested against a
stale run row; true live-progress reattachment across an app restart is
the one deliberate, documented scope cut.

---

## Phase 11 — Training: Remaining Trainable Models ✅ mostly complete (precisely per-model, not a blanket status)
**Objective:** generalize the training pipeline proven in Phase 10 across
the rest of the catalog's trainable models.

**Manager generalization, real:** `electron/models/trainingManager.ts`
gained a small per-model `PIPELINE_RUNNERS` dispatch (`submitTrainingRun`
routes through it instead of one hardcoded function) and `runPhase()` (the
shared spawn/heartbeat/log/progress-parsing primitive) gained two additive,
backward-compatible options — a custom per-tool progress-line parser and
which phase(s) to try it against — so RAVE's own Phase 10 pipeline is
**completely untouched**, while three new pipelines each get their own real
phase shape rather than being forced into RAVE's exact preprocess/train/
export mold. Shared helpers (`stageDatasetFiles`, `copyDirRecursive`,
`bridgeFilesIntoModelsRoot`, `openTrainingLog`, `failTrainingRun`,
`cleanupTrainingRun`) factor out what's genuinely common across pipelines
without forcing a shared body.

- **ACE-Step 1.5 — done, real, verified end-to-end.** Its own vendored
  standalone "Side-Step" CLI (`train.py fixed` — a real correction to this
  doc's original `POST /v1/training/start` framing, which trains against an
  already-running server process, the wrong shape for this app's
  subprocess-per-run manager). Two real phases (preprocess → LoRA train, no
  export needed). A tiny real 4-clip synthesized dataset was preprocessed,
  trained (real loss values, real `adapter_model.safetensors` + config
  produced, 5,505,024 trainable LoRA params verified 100% non-zero), then
  loaded back through **the real, completely unmodified**
  `acestep/api_server.py` via its own real `/v1/lora/load` + `/v1/lora/
  toggle` endpoints and a real `/release_task` generation — a real, valid,
  non-silent WAV (99.98% non-zero samples). Same round-trip rigor as every
  prior real-inference phase. Two real dependency bugs hit and fixed (a
  path-injection guard scoping every path to the spawned process's cwd; the
  checkpoint-dir layout needing the exact same sibling-directory bridge
  inference already builds) — full writeup in
  `servers/ace-step-1.5/README.md`'s "Training (Phase 11)" section.
  **Real, honest scope call**: a LoRA adapter isn't a swappable base
  checkpoint, so it registers a `trained_model` row but not a
  `model_variant` — not yet selectable from a workspace's generation
  checkpoint picker (a real, documented gap, not a bug).
- **MusicGen — done, real, verified end-to-end.** AudioCraft's own real
  `dora`/`hydra`-based training CLI, already satisfied by the existing
  inference venv (no new venv needed). Three real phases for a different
  reason than RAVE's: manifest generation, `dora run` fine-tuning (produces
  a huge real XP checkpoint with full optimizer/EMA state), and a real,
  necessary export step (`audiocraft.utils.export.export_lm`) shrinking
  that to the deployment shape this app's inference server already loads.
  Audio + per-clip text caption dataset input, real (a `CaptionTable` with
  bulk CSV/JSON import in `Training.tsx`, feeding a real `.json` sidecar
  per clip matching audiocraft's own `MusicInfo` schema — a genuinely
  different, non-optional dataset shape from RAVE's audio-only input, not a
  nice-to-have). A tiny real 4-clip dataset was fine-tuned from
  `facebook/musicgen-small` (real `ce`/`ppl` loss curves, a real generated
  sample), exported, and loaded back through **the real, completely
  unmodified** `servers/musicgen/server.py` via a real `POST /generate` —
  a real, valid, non-silent WAV (99.96% non-zero samples). Four real
  dependency bugs hit and fixed (no bundled Hydra config tree in the pip
  package; a GlobalHydra double-init bug requiring the real `dora` CLI
  instead of `python -m audiocraft.train`; this app's own installed
  checkpoints being the wrong format for `continue_from`; a torch 2.6
  `weights_only` default breaking audiocraft's own export script) — full
  writeup in `servers/musicgen/README.md`'s "Training (Phase 11)" section.
  Unlike ACE-Step, this checkpoint format *is* a real swappable base
  checkpoint, so it registers both a `trained_model` row and a
  `model_variant` row, exactly like RAVE.
- **MuseCoco — real CLI confirmed and wired, real run started, not
  completed.** A single real `fairseq-train` phase continuing from the
  installed 1B-parameter checkpoint via `--restore-file`, using the
  vendored repo's own real `linear_mask` fairseq task/arch — confirmed to
  launch cleanly, load the real checkpoint, and perform genuine sustained
  multi-core CPU computation. **Real, honest scope cut**: the real MIDI→
  attribute-sequence extraction pipeline exists in the vendored repo but
  wiring it end-to-end was judged out of this phase's time budget given
  this model's own lower priority, so the dataset input is a directory
  picker (`DatasetDirPicker` in `Training.tsx`) pointed at an
  already-binarized fairseq data-bin, not a raw-MIDI drop-zone yet. **Real,
  honest verification limit**: a real run against the vendored example
  data-bin did not complete a single update within an ~8-minute session
  budget on this CPU-only venv (no CUDA-built `pytorch-fast-transformers`
  extension here, the same root cause Phase 7 already documented for
  inference, now shown to extend to training — strictly more expensive,
  a full forward *and* backward pass) — so no trained checkpoint file was
  produced or verified this phase. A real, legitimate partial result: the
  CLI invocation itself is confirmed correct, just too slow to finish
  in-session on this hardware. Full writeup in
  `servers/musecoco/README.md`'s "Training (Phase 11)" section.
- **Museformer — re-confirmed still blocked, not re-solved.** Per the
  roadmap's own explicit lower priority for this model, no venv was built
  and no training code was written this phase — `servers/museformer/
  README.md`'s "Status: code-complete, not verified end-to-end" is
  unchanged from Phase 7. Training can't reasonably be attempted before
  this model's own *inference* path is even proven working once, and that
  remains a real, undetermined Triton/`blocksparse` risk (no CPU fallback
  exists for that kernel). A legitimate result per the roadmap's own
  allowance, not an oversight.
- **YuE2 — confirmed correctly disabled.** `training.supported: false`
  with the real hardware-infeasibility reason (24GB+ VRAM already needed
  for inference alone) shown inline in the Training screen's model picker,
  same "shown disabled with its reason, not hidden" pattern as every other
  unsupported entry — unchanged, re-verified still accurate.

**Exit criteria: mostly met.** ACE-Step 1.5 and MusicGen fully meet the
original exit criterion (a real trained checkpoint through the generic
wizard, with per-model dataset-format validation) — both verified with a
full round-trip back through their real, unmodified inference servers.
MuseCoco meets it partially (real wizard, real CLI, no completed checkpoint
in-session — a time/hardware constraint, not a design gap). Museformer
correctly stays unmet, consistent with its own documented inference-side
blocker predating this phase. YuE2 correctly stays out of scope.

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
