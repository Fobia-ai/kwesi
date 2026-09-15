# 02 — Architecture

## Stack (confirmed)

| Layer | Choice | Why |
|---|---|---|
| App shell | **Electron** | Every close comparable in this exact category — Invoke, LM Studio, ComfyUI Desktop — ships on Electron. Best-documented path for what we need most: spawning/managing long-lived local Python subprocess servers, large resumable file downloads, deep filesystem access, native OS packaging. Tauri (Rust) is a reasonable alternative for a smaller binary, but slower to build the Python-process-management layer against since it means crossing a Rust↔Python boundary instead of Node↔Python. |
| Frontend | React + TypeScript, Vite bundler | Standard, fast dev loop inside Electron. |
| Styling | Tailwind + a small design-token file (see below) | Matches the flat, utility-driven look of the reference screenshots without hand-rolling a CSS framework. |
| UI components | Radix primitives (unstyled) + custom styling | Gives accessible dropdowns/dialogs/toggles matching the reference screenshots' dropdown-chain and toggle-switch patterns, without importing a themed component library that fights the visual design. |
| Local state | Zustand (or Redux Toolkit if state grows complex) | Simple, no boilerplate for workspace/project/generation state. |
| Local database | SQLite via `better-sqlite3`, or Prisma over SQLite | Workspaces, projects, generations, model registry, settings. All local, no server. |
| Model execution | Per-model **local Python subprocess server** (FastAPI), one isolated **virtual environment per model** | Directly required by the research: YuE2's own sub-components need mutually incompatible Transformers versions (4.57.6 vs 4.45.2 vs 4.53.2), and MuseCoco pins PyTorch 1.11 against ACE-Step's modern PyTorch. A single shared Python env cannot satisfy all models at once — process + venv isolation per model is not optional, it's forced by the model set itself. |
| IPC between shell and model servers | Local HTTP + Server-Sent Events (progress/streaming) on `localhost:<port>` per running model server | Mirrors the exact pattern visible in the Voicebox reference Settings screen: `Server URL: http://localhost:17493` with an `Online` status pill. Reuse that proven pattern rather than inventing custom IPC. |
| Model weight downloads | HTTP downloads from the Hugging Face Hub's public API/CDN (Node `fetch`, no `huggingface_hub`/Python dependency), tracked via `model_variant`'s install-state columns rather than a separate table (see "Data model" below) | Matches the Invoke reference's Install Queue UI. **Implementation note (Phase 3):** not truly resumable in v1 — a retry restarts a variant's files from scratch rather than resuming from a byte offset; no checksum verification yet. Both are acceptable v1 simplifications, not the target end state. |

## App shell layout (from the reference screenshots)

- Fixed-width left icon rail (~72–84px): stacked nav icons, active icon
  highlighted (filled circle background), version number pinned at the
  bottom of the rail.
- Main content area: a list/detail split for most screens (e.g. workspace
  list on the left, detail/generation view on the right) — same shape as
  the Voicebox Stories screen and the Invoke Model Manager screen.
- Bottom-docked generation bar: the prompt input plus a **chain of
  dropdowns** for whatever parameters the current model manifest declares
  (in Voicebox: language → model → effects; in Kwesi this row is
  *generated from the active model's manifest*, so it might show
  duration / key / genre tags / reference-audio-picker instead).
- Empty states: dashed-border rounded rectangle, centered icon, one line of
  muted text, one primary pill-shaped CTA button.
- Settings: tabbed sub-navigation across the top (Profile / General /
  Generation / Models-in-use / Security / About), toggle switches for
  booleans, a boxed "Server status" indicator per running model server.
  - **Profile tab**: local display name, optional email, optional avatar.
    No account, no verification, no server round-trip — stored in the
    `settings`/`profile` table only. Explicitly local-only for now; if
    cloud sync is ever wanted later, that's a distinct future feature, not
    implied by having a profile.
  - **Security tab**: set/change/remove the app-lock passcode, idle-timeout
    minutes (see [04-roadmap.md](04-roadmap.md) Phase 12).
- **Visual direction (updated): glassmorphic, Apple/iOS-style** — not the
  Voicebox gold-on-black look. The reference screenshots set the
  *structural* patterns (icon rail, card lists, bottom generation bar,
  chained dropdowns, install queue) but not the final visual skin. Kwesi's
  actual skin:
  - Translucent, frosted "glass" surfaces (`backdrop-filter: blur(...)`)
    for panels, the bottom generation bar, modals, and the left rail — content
    scrolling behind them shows through softly instead of being fully opaque.
  - Layered depth via soft, diffuse shadows and subtle vibrancy rather than
    hard 1px borders — borders, where used at all, are hairline and low-
    contrast (translucent white/black at ~8–12% opacity).
  - Light and dark mode both fully supported and adaptive to the OS setting
    (this is core to the "Apple/iOS" feel — it should never look forced-dark
    the way the Voicebox reference is). Background is a soft off-white in
    light mode / near-black in dark mode, with the glass panels sitting a
    layer above it.
  - Rounded, continuous "squircle" corner radii (large-ish, ~16–24px on
    cards and panels, fully pill-shaped on buttons/chips), generous
    whitespace, restrained one-accent-color system rather than a busy
    multi-color UI.
  - Accent color is **confirmed as monochrome black/white, not a hue** —
    pure black in light mode / pure white in dark mode, inverting with the
    theme, used sparingly for primary actions, active nav state, and
    focus states only; everything else stays neutral/translucent.
  - Motion: smooth, physically-eased transitions (spring/ease-out, ~200–
    300ms) for panel opens, view switches, and the generation-progress
    states — snappy but never abrupt, consistent with iOS motion design.
  - Typography: a clean system-style sans (SF Pro on macOS via system font
    stack, falling back to Inter or similar cross-platform) with clear size
    hierarchy and restrained weight variation.
  - Implementation note: CSS `backdrop-filter` + layered `box-shadow` is
    sufficient in Electron/Chromium — no extra library needed, but blur
    performance over long scrolling lists should be checked early (Phase 1)
    since heavy blur regions can be costly to repaint.
  - Exact color tokens (background pair, glass tint/opacity, accent hue,
    shadow values) to be finalized as a small token file in Phase 1 once
    any further reference images are supplied — but this glassmorphic,
    light/dark-adaptive direction replaces the gold/black palette described
    in earlier drafts of this doc.
  - Additional confirmation from the newer glassmorphism mood-board
    references (`Pasted image (4)` through `(8)`): frosted panels read best
    sitting over a softly blurred, colorful backdrop rather than a flat
    background — worth a subtle gradient/blur wash behind the main content
    area, not just flat near-white/near-black. Small numeric/status badges
    (rounded pill, tiny, high-contrast) are a recurring pattern worth
    reusing for counts (e.g. "3 projects", queue counts). Circular
    rotary-style controls appear in one reference (a thermostat-style
    glass dial) — worth considering for a BPM/tempo input specifically,
    as a nicer alternative to a plain number field, but not required for
    v1. These are general skin/texture references, not literal screens to
    copy — no functional screen layout should be taken from them.

## Acknowledgments screen — exact spec

This is the very first thing a user sees, so its spec is locked precisely
rather than left to general "empty state" styling:

- Centered column layout, fixed max-width, vertically centered or top-
  anchored with comfortable margin — not edge-to-edge.
- One **small horizontal card per credited project** (every entry from
  [03-model-catalog.md](03-model-catalog.md): ACE-Step, YuE2, MusicGen/
  AudioCraft, MuseCoco, Museformer, RAVE — plus any library with a
  meaningful attribution requirement found during implementation).
- Each card: **very small corner radius** — a deliberate, intentional
  contrast to the large squircle radius used everywhere else in the app,
  giving these credit cards a flatter, more document/citation-like feel.
  Logo on the left (small, fixed size); a couple of lines of info on the
  right (project name, one-line description, license tier badge); a
  **GitHub mark icon only** (no visible URL text) at the right edge —
  clicking it opens that project's GitHub repo (or paper page, where the
  primary reference is a paper rather than a repo) in the OS default
  browser.
- Logo assets: sourced/stored locally as small local image files per
  project (fetch or recreate each org's official mark) — this is an asset
  task to complete during Phase 1, not something to fake with generic
  icons in the final build. Until real assets are sourced, a neutral
  monogram placeholder is an acceptable stand-in.
- A single **"Start Application"** button, bottom of the screen, primary/
  accent-colored, pill-shaped — proceeds straight into the app. No sign-up
  or account step exists anywhere before or after this button.
- Reachable again later from Settings > About for reference, using the
  same card component.

## Data model (SQLite)

```
workspace
  id, name, model_id (fk -> model, immutable after create), created_at

project
  id, workspace_id (fk), name, created_at, updated_at

generation
  id, project_id (fk), status (queued|running|done|failed),
  input_params (json, matches the model's manifest schema),
  output_kind (audio|midi|audio+midi),
  output_files (json: paths on disk, one per output artifact),
  created_at, duration_ms, error (nullable)

-- Split in two: a workspace binds permanently to a model FAMILY (`model`),
-- while the checkpoint variant/size is chosen independently per generation
-- job, so multiple variants of one family can be installed side-by-side
-- (`model_variant`) instead of one install slot per model.
model
  id, display_name, license_tier (mit|cc-by-nc|cc-by-nc-sa), trainable,
  venv_path, server_port (nullable, runtime only)

model_variant
  id, model_id (fk -> model), variant_name,
  install_status (not_installed|queued|downloading|installed|failed),
  install_path, disk_size_bytes,
  repo_id, source (huggingface|manual), manual_note, manual_url,
  -- bytes_downloaded/bytes_total/current_file/error track an in-flight (or
  -- last-failed) download's progress -- Phase 3 keeps this on the variant
  -- row itself rather than a separate download_job table, since exactly
  -- one queue position is ever active per variant. A variant found
  -- queued/downloading with no active job at startup (crash/quit
  -- mid-download) is swept to failed rather than left lying -- see
  -- "Model weight downloads" below.
  bytes_downloaded, bytes_total, current_file, error

settings
  key, value   -- app lock passcode hash, storage locations, theme, etc.

profile
  id (singleton row), display_name, email (nullable), avatar_path (nullable)

training_run
  id, model_id (fk -> model), base_checkpoint_variant, run_name,
  status (queued|preparing|running|completed|failed|cancelled|interrupted),
  dataset_manifest (json: file list, per-file captions, validation summary),
  hyperparams (json, matches the model's training manifest schema),
  output_dir (chosen save location for this run),
  output_checkpoint_id (fk -> trained_model, nullable until completed),
  log_path, pid (nullable, runtime), started_at, completed_at, error (nullable)

trained_model
  id, base_model_id (fk -> model), training_run_id (fk -> training_run),
  display_name, checkpoint_path, created_at
  -- appears in Model Manager under "My Trained Models"; selectable as a
  -- workspace's bound model exactly like a stock catalog variant
```

Deleting a workspace/project/generation from the UI must also offer to
delete the underlying files from disk (with a clear, explicit confirmation —
this is a destructive, hard-to-reverse action per file-safety norms and
should never be silent).

## Model Adapter Manifest

This is the contract that makes the "plug and play" UI possible. Every
catalog model ships one of these (hand-written by us during integration,
not auto-generated). **Implemented in Phase 4** as TypeScript data in
`src/data/manifests.ts` (camelCase fields, not the jsonc sketch below
verbatim, but the same shape) — one manifest per catalog model, kept
renderer-side only since the Phase 4 mock Model Server Manager doesn't need
the full manifest (see `04-roadmap.md` Phase 4's simplifications):

```jsonc
{
  "modelId": "musicgen",
  "displayName": "MusicGen",
  "licenseTier": "cc-by-nc",              // surfaced in UI as a badge
  "checkpointVariants": ["small", "medium", "large", "melody", "style"],
  "hardware": { "minVramGb": 4, "cpuFallback": false },
  "inputs": [
    { "key": "prompt", "type": "text", "required": true, "label": "Describe the music" },
    { "key": "melody_audio", "type": "audio_upload", "accept": "audio/*",
      "label": "Melody reference (optional)", "onlyForVariant": "melody" },
    { "key": "duration_sec", "type": "number", "min": 1, "max": 30, "default": 8 }
  ],
  "outputs": [
    { "kind": "audio", "format": "wav", "sampleRate": 32000 }
  ],
  "server": { "entrypoint": "server.py", "venv": "musicgen-venv", "portRange": [17600, 17619] }
}
```

The generation-screen renderer (`src/components/generation/
DynamicGenerationForm.tsx`) walks `inputs[]` to build the generation form,
filtering each input by `onlyForVariant` against the selected checkpoint
variant and by which variants are actually `installed`; a sibling component
(`OutputViewerPlaceholder.tsx`) walks `outputs[]` (via the `outputKindOf`
helper) to decide which viewer placeholder(s) to mount (waveform player
vs. piano-roll vs. both). Adding a model later means adding a manifest + a
server adapter, not touching the generic UI code. Input types implemented:
`text`, `textarea`, `number`, `select`, `tags`, `audio_upload`,
`midi_upload`.

### Manifest extension: training

Most of the catalog models are foundation models capable of being
fine-tuned/trained on a user's own material, not just run for inference.
The same manifest-driven-UI principle applies here: a model declares a
`training` block, and the **same generic form renderer from the generation
screen** renders the training wizard's dataset/hyperparameter inputs —
this is a second consumer of the existing renderer, not a new one.

```jsonc
{
  "model_id": "rave",
  // ...existing inference fields...
  "training": {
    "supported": true,
    "method": "from_scratch",          // "lora" | "full_finetune" | "from_scratch"
    "input_kind": "audio_raw",         // "audio_raw" | "audio_captioned" | "midi"
    "dataset_requirements": {
      "file_types": [".wav", ".flac", ".aiff"],
      "min_files": 20,
      "min_total_duration_min": 20,
      "requires_captions": false
    },
    "hyperparameters": [
      { "key": "epochs", "type": "number", "default": 1000, "min": 1 },
      { "key": "latent_size", "type": "number", "default": 128 }
    ],
    "hardware": { "min_vram_gb": 8, "recommended_vram_gb": 16 },
    "server": { "entrypoint": "train.py", "venv": "rave-venv" },
    "checkpoint_output": { "format": "ts" }
  }
}
```

For a model with `"training": { "supported": false, "reason": "..." }`,
the Training screen lists it but disables it with that reason shown
inline (e.g. YuE2 — see [03-model-catalog.md](03-model-catalog.md)) rather
than hiding it, so the user understands why it's absent instead of
wondering if it was forgotten.

## Training pipeline architecture

A first-class feature, separate from generation but built on the same
machinery (manifests, per-model venvs, the Model Server Manager, hardware
gating). Where MusicGen was chosen as the pilot for the **inference**
pipeline (Phase 5), **RAVE is the pilot for the training pipeline**
(Phase 10): it's the simplest case in the catalog — raw audio in, no
captions/text required, and training-your-own-timbre is literally RAVE's
native intended workflow.

**Where it lives:** its own top-level nav item ("Training"), not nested
inside a workspace — a trained checkpoint is a reusable asset that outlives
any one workspace/project, so it shouldn't be scoped like a generation is.

**Flow:**
1. **New Training Run** wizard: pick a base model (only entries with
   `training.supported: true` are selectable; others are listed, disabled,
   with their `reason` shown), then a base checkpoint variant to start
   from.
2. **Drop-in dataset**: a drop-zone accepting exactly the file types the
   model's `dataset_requirements.file_types` declares. A mismatched file
   (e.g. a `.wav` dropped onto a MIDI-only model like MuseCoco) is
   rejected inline with a specific reason and a pointer to a model that
   does accept that format, rather than a generic error.
3. **Captions, if required** (`requires_captions: true` — MusicGen,
   ACE-Step): an inline per-file caption/tag field next to each dropped
   file, plus a bulk CSV/JSON import option for larger datasets.
   Auto-captioning (a lightweight tagger suggesting text per clip) is a
   nice-to-have flagged for later, not required for v1.
4. **Dataset validation pass**: duration/sample-rate/channel checks
   against `dataset_requirements`, a plain-language summary ("42 files,
   38 minutes total — meets the 20-file/20-minute minimum"), and a hard
   stop with clear messaging if the dataset falls short.
5. **Hyperparameters**: rendered from `training.hyperparameters[]` via
   the shared form renderer; a Simple/Advanced toggle keeps the default
   view to just the couple of knobs that matter (e.g. epochs, a
   quality-vs-speed preset), with everything else tucked behind Advanced.
6. **Hardware preflight**: reuses the same hardware-gating component from
   Phase 8, checked against `training.hardware` — training thresholds are
   generally higher than inference thresholds for the same model, so this
   check is run independently, not inferred from the inference gate.
7. **Output location**: a folder picker, defaulting to
   `$KWESI_TRAINED_MODELS_DIR/<model_id>/<run_name>` — unlike the
   structural app directories, this is a per-run, always-user-editable
   "Save As"-style choice (the env var only seeds where the picker opens
   to), matching how `KWESI_EXPORTS_DIR` already behaves.
8. **Run**: the Training Job Manager (a sibling to the Model Server
   Manager, same subprocess/venv pattern) launches the model's `train.py`
   inside its own venv. Progress — step/epoch, loss, ETA — streams back via
   SSE to a Training Run detail screen with a live log tail and a loss
   chart.
9. **Resilience across app restarts**: a training run can take hours, far
   longer than the app may stay open. Each run writes a PID + heartbeat
   file; on relaunch, the app reattaches to any still-running process and
   resumes showing live progress. If a run's process is found dead with no
   completion marker, it's surfaced as **interrupted** (not silently lost),
   with a resume-from-last-checkpoint option where the training script
   supports periodic checkpointing.
10. **On completion**: the output checkpoint is registered as a
    `trained_model` row and immediately appears in the Model Manager under
    "My Trained Models," selectable when creating a new workspace exactly
    like any stock catalog checkpoint.
11. **Failure/cancel**: partial checkpoints are preserved whenever the
    training script checkpoints periodically; the run is marked
    failed/cancelled with its log retained for diagnosis, never silently
    discarded.

See [03-model-catalog.md](03-model-catalog.md) for which models support
training and with what input kind, and
[04-roadmap.md](04-roadmap.md) Phases 10–11 for the build sequence.

## Process/sandboxing model

- Electron main process owns a small **Model Server Manager**: starts a
  model's Python subprocess server on demand (first generation request, or
  eagerly if the user pins a workspace's model), health-checks it, tears it
  down on app quit or workspace switch to free VRAM/RAM. **Phase 4 status:**
  implemented as `electron/models/modelServer.ts` with the real start/stop/
  status/generate shape described here, but its actual body was a mock — no
  Python process spawned, "starting"/"running" were timed in-memory status
  transitions and a submitted generation was a timed queued → running →
  done/failed walk (with a small simulated-failure chance) that wrote empty
  placeholder output files. This proved the queue/IPC/UI plumbing described
  below. **Phase 5 status:** for `modelId === "musicgen"` specifically, this
  is now real — `modelServer.ts` spawns `servers/musicgen/server.py`
  (its own venv at `$KWESI_VENVS_DIR/musicgen`) as a child process on first
  use, health-checks `GET /health` on `127.0.0.1:17600` (the manifest's
  `portRange[0]`), keeps it alive across subsequent generations in the same
  app session, and routes a submitted generation to a real
  `POST /generate` call that runs actual `audiocraft.models.MusicGen`
  inference and writes a real WAV under the generation's own directory. The
  IPC surface/event shape (`GenerationProgressEvent`) is unchanged from
  Phase 4 — real progress just doesn't stream sub-steps mid-inference (see
  `kwesi.docs/04-roadmap.md` Phase 5's simplifications). Every other
  model_id still walks the exact Phase 4 mock path described above,
  unmodified.
- A sibling **Training Job Manager** handles the training side (see
  "Training pipeline architecture" above): same venv/subprocess pattern,
  but for long-running `train.py` jobs that must survive app restarts via
  a PID + heartbeat file per run, rather than short-lived generation
  requests.
- Each model's venv is created and pip-installed once, at model-install
  time (from the Model Manager screen), using the exact pinned versions
  captured per-model in [03-model-catalog.md](03-model-catalog.md) — not
  "latest," since several of these models are sensitive to exact versions.
- Generation requests go: Renderer → Electron main (IPC) → local HTTP call
  to the model's own server → SSE progress events relayed back to the
  renderer → final artifact path(s) written under the project's folder.

## Configuration & environment variables

**Principle: every path or directory the app depends on is controlled by an
environment variable, with a sensible built-in default.** Nothing about
where data lives is hardcoded. This applies not just to the top-level
folders below but to anything added later that needs a directory (a new
model's cache dir, a log rotation path, etc.) — default it, but expose it
as `KWESI_*`.

**Precedence, per value, resolved once at app startup:**
1. Explicit environment variable, if set — always wins. This lets the app
   be run in a scripted/headless/CI-like context with fully controlled
   paths, and is treated as an operator override the UI must not silently
   contradict.
2. Otherwise, the persisted value in the `settings` table (set previously
   via the Settings UI).
3. Otherwise, the built-in default below.

If a value is currently pinned by an explicit env var, the Settings UI
shows it read-only with a "set via `KWESI_MODELS_DIR`" badge instead of an
editable folder picker — changing it in the UI would be silently
overridden on next launch otherwise, which is worse than just being honest
about who owns the value.

| Variable | Purpose | Default |
|---|---|---|
| `KWESI_HOME` | Root data directory; every other path below defaults to a subfolder of this unless independently overridden | OS user-data dir (Electron `app.getPath('userData')`) — e.g. `~/Library/Application Support/Kwesi` (macOS), `%APPDATA%/Kwesi` (Windows), `~/.local/share/kwesi` (Linux) |
| `KWESI_DB_PATH` | SQLite database file | `$KWESI_HOME/kwesi.db` |
| `KWESI_MODELS_DIR` | Downloaded model weights, one subfolder per `<model_id>/<variant>` | `$KWESI_HOME/models` |
| `KWESI_VENVS_DIR` | Per-model isolated Python environments — kept **separate from weights** deliberately: venvs are cheap/disposable (rebuildable via pip install), weights are expensive multi-GB downloads worth backing up separately | `$KWESI_HOME/venvs` |
| `KWESI_WORKSPACES_DIR` | Workspace/project/generation working files (internal, app-managed) | `$KWESI_HOME/workspaces` |
| `KWESI_EXPORTS_DIR` | Default destination offered by the "export/download" action — a user-facing location, distinct from the internal workspaces dir | OS Music folder, e.g. `~/Music/Kwesi` |
| `KWESI_CACHE_DIR` | In-progress/partial downloads, temp files | `$KWESI_HOME/cache` |
| `KWESI_LOGS_DIR` | App and model-server logs | `$KWESI_HOME/logs` |
| `KWESI_TRAINED_MODELS_DIR` | Default starting location for the per-training-run output picker (always user-editable per run, same pattern as `KWESI_EXPORTS_DIR` — this is not a locked structural dir) | `$KWESI_MODELS_DIR/custom` |
| `KWESI_MODEL_SERVER_PORT_RANGE` | Local port range the Model Server Manager allocates from | `17600-17999` |
| `KWESI_LOCK_IDLE_TIMEOUT_MINUTES` | Minutes of inactivity before the app auto-locks (app-lock feature, Phase 12) | `10` (only applies once a passcode is set; `0` disables idle-lock and keeps relaunch-only locking) |

Example resulting layout with defaults:

```
$KWESI_HOME/
  kwesi.db
  models/<model_id>/<variant>/...        # downloaded weights
  models/custom/<model_id>/<run_name>/   # trained checkpoints (default location)
  venvs/<model_id>/                      # isolated python env, separate from weights
  workspaces/<workspace_id>/<project_id>/<generation_id>/
    output.wav
    output.mid
    params.json
  cache/                                 # partial downloads
  logs/
```

A `.env.example` in the repo documents every `KWESI_*` variable for local
development; production builds resolve the same variables from the real OS
environment at launch.
