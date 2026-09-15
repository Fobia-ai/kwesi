# ACE-Step 1.5 inference server

Real `ace-step/ACE-Step-1.5` inference, run as **its own real REST API
server** (`acestep.api_server`, cloned whole into `vendor/`) rather than a
hand-written FastAPI wrapper around a bare model class the way
`servers/musicgen/server.py` and `servers/musecoco/server.py` are. Wired
into the Electron main process by `electron/models/modelServer.ts` for
`modelId === "ace-step-1.5"` only.

## Why "run their own server" instead of a third hand-written wrapper

Investigated before writing any code, per the roadmap's explicit
instruction. ACE-Step's own repo ships a real, documented REST API server
out of the box (`docs/en/API.md`, `docs/en/INSTALL.md`, `start_api_server.sh`)
with:

- An async task-queue contract (`POST /release_task` → poll
  `POST /query_result` → `GET /v1/audio` to download) rather than a single
  blocking call — genuinely different from MusicGen/MuseCoco's shape, not
  just a different route name.
- Its own checkpoint-switching (`POST /v1/init`), model listing
  (`GET /v1/models`), and health check (`GET /health`) that already do
  everything this app's Model Server Manager needs.
- Its own `--port`/`--host` CLI flags (`acestep/api/server_cli.py`,
  confirmed by reading the file directly) and `ACESTEP_API_PORT`/
  `ACESTEP_API_HOST` env-var defaults, so it slots into the
  spawn/health-check/HTTP-call lifecycle `modelServer.ts` already has for
  every other real model with zero protocol translation needed.

Reimplementing this as a hand-rolled wrapper around
`acestep.acestep_v15_pipeline` (the way `servers/musicgen/server.py` wraps
`audiocraft.models.MusicGen`) would have meant re-deriving all of the
above — DiT/VAE/text-encoder loading, GPU-tier-based defaults (turbo vs.
base/sft, INT8 quantization, CPU offload), the task queue for a model whose
own README documents batch generation as async — for no real benefit over
the repo's own server. **Verdict: running ACE-Step's own server as-is is
more correct**, confirmed 2026-09-15 against the cloned repo, not assumed
from the catalog doc's earlier "own local-server pattern lines up well
with our architecture" note.

## Vendored code

`vendor/` is a full clone of `github.com/ace-step/ACE-Step-1.5` (`git clone
--depth 1`, `.git` stripped), gitignored at the project root the same way
`servers/musecoco/vendor/` is — reproducible, not ours, too large to belong
in this repo's own history (the repo itself is small; its `uv sync`-managed
`.venv` and downloaded checkpoints, which also live under `vendor/`, are
what's actually large).

```bash
git clone --depth 1 https://github.com/ace-step/ACE-Step-1.5 servers/ace-step-1.5/vendor
```

## Python environment

Unlike MusicGen/MuseCoco (hand-built venvs via `pip`/`uv venv` +
`requirements.txt`), ACE-Step's own install flow is `uv sync` against its
own `pyproject.toml`/`uv.lock` — used as-is, since second-guessing a
`uv.lock` someone else already pinned would just reintroduce the exact
version-conflict risk `uv.lock` exists to prevent. The only adjustment: its
venv is redirected to this app's own `$KWESI_VENVS_DIR/ace-step-1.5`
(rather than the default `vendor/.venv`) via `UV_PROJECT_ENVIRONMENT`, so
`electron/models/modelServer.ts`'s existing `venvPythonPath(modelId)`
convention (`$KWESI_VENVS_DIR/<model_id>/bin/python`) keeps working
unmodified for this model too — no ACE-Step-specific venv-location logic
needed in `modelServer.ts` beyond the spawn args themselves.

```bash
cd servers/ace-step-1.5/vendor
UV_PROJECT_ENVIRONMENT=$KWESI_VENVS_DIR/ace-step-1.5 uv sync
```

**Exact working pins, verified from this real `uv sync` run** (resolves
`kwesi.docs/03-model-catalog.md`'s "PyTorch pin NEEDS VERIFICATION" flag):
`torch==2.10.0+cu128`, `torchvision==0.25.0+cu128`, `torchaudio==2.10.0+cu128`,
`transformers==4.57.6` — pulled automatically by `uv sync` per
`pyproject.toml`'s `sys_platform == 'linux' and platform_machine ==
'x86_64'` dependency block, needing no manual pin selection on this
machine. Python 3.11-3.12 per the repo's own `requires-python`; this
machine's `uv`-resolved interpreter satisfied it without needing a separate
`uv python install`.

## Checkpoint layout: the real bridging problem, and its real fix

This app's already-downloaded weights
(`$KWESI_MODELS_DIR/ace-step-1.5/<variant>/`, all 8 variants, 84GB total —
see the root `kwesi.docs/03-model-catalog.md`) use a **different on-disk
shape** than what ACE-Step's own code expects, for a real structural
reason: `acestep-v15-turbo`'s real Hugging Face repo is `ACE-Step/Ace-Step1.5`
(the "main model" bundle — confirmed in the catalog doc), which bundles the
turbo DiT weights together with the shared VAE, the shared Qwen3-Embedding
text encoder, and the default 5Hz LM **inside one repo**. This app's
install layout (`electron/db/seedModels.ts`) downloads that whole bundle
into `$KWESI_MODELS_DIR/ace-step-1.5/acestep-v15-turbo/`, so those shared
components end up nested one level deeper than sibling directories.

ACE-Step's own code (`acestep/model_downloader.py`'s
`MAIN_MODEL_COMPONENTS`) expects `vae/`, `Qwen3-Embedding-0.6B/`,
`acestep-5Hz-lm-1.7B/`, and each DiT checkpoint (`acestep-v15-turbo/`,
`acestep-v15-base/`, etc.) as **siblings directly under one
checkpoints_dir** — confirmed by reading `model_downloader.py` and
`model_downloader_test.py` directly, not guessed.

**The fix**: `electron/models/modelServer.ts`'s
`ensureAceStepCheckpointsLayout()` builds a small symlink farm at
`$KWESI_MODELS_DIR/ace-step-1.5/.server-checkpoints/` bridging the two
layouts — same "symlink, not copy" precedent as
`servers/musecoco/README.md`'s checkpoint-layout section, for the same
reason (avoid duplicating tens of GB on disk). Only variants actually
installed get linked, so a partial install doesn't break startup.

**A second, non-obvious problem found by actually running this**:
`ACESTEP_CHECKPOINTS_DIR` — the env var `acestep/model_downloader.py`
documents for exactly this "share a checkpoints directory" use case — is
**only read by `model_downloader.py`'s own `get_checkpoints_dir()`**. The
real API-server startup path (`acestep/api/startup_model_init.py` and
`acestep/acestep_v15_pipeline.py`) hardcodes
`checkpoint_dir = os.path.join(project_root, "checkpoints")` and never
calls `get_checkpoints_dir()` at all. Found the hard way: the first real
end-to-end test run set `ACESTEP_CHECKPOINTS_DIR` correctly, the server
started and reported healthy, but a real generation request silently
triggered a ~9.4GB re-download of the entire main model bundle from
Hugging Face into `vendor/checkpoints/` instead of using the
already-installed weights the symlink farm pointed at — confirmed by
`tail -f`'ing the running server's own stdout during the test and seeing
live `huggingface_hub` download progress bars for files that were already
on disk. The fix: `ensureAceStepCheckpointsLayout()` also symlinks
`vendor/checkpoints` itself to the farm, so the hardcoded
`<project_root>/checkpoints` path resolves to real local weights regardless
of the env var. A second real run after this fix produced no download
activity at all (verified by watching the server's own log for
`huggingface_hub`/`Downloading` lines during startup and generation — none
appeared).

## How the app spawns it

`electron/models/modelServer.ts`'s `spawnAceStepServer()` runs:

```bash
$KWESI_VENVS_DIR/ace-step-1.5/bin/python \
  servers/ace-step-1.5/vendor/acestep/api_server.py \
  --port 17640 --host 127.0.0.1
```

with `cwd` set to `vendor/` (so its own relative-path resolution —
`.cache/acestep/tmp`, the `checkpoints/` symlink above — works the same as
running it manually from that directory) and:

- `ACESTEP_CHECKPOINTS_DIR` — set anyway (harmless, and used by any
  `model_downloader.py` code path that *does* read it, e.g. `/v1/init`
  switching to a not-yet-linked variant).
- `ACESTEP_CONFIG_PATH=acestep-v15-turbo` — the default DiT model loaded at
  startup; the fastest/smallest real checkpoint (2B, 8-step), matching the
  roadmap's "start with the smallest/fastest variant" guidance for the
  first real integration.
- `ACESTEP_INIT_LLM=false` — the 5Hz LM ("thinking"/metadata auto-fill) is
  a real, optional feature of ACE-Step's own API that this app's manifest
  doesn't expose a control for yet (every generation request already
  supplies prompt/duration/bpm/key/time-signature explicitly). Disabling it
  keeps first-integration startup fast and avoids pulling the `vllm`
  backend into the dependency surface for a feature nothing calls yet.

**Port**: 17640, the first port in the manifest's own `[17640, 17659]`
range (`src/data/manifests.ts`) — **not** ACE-Step's own default (8001,
confirmed still current against `docs/en/API.md` and
`server_cli.py`'s `--port` default, not a stale detail the roadmap's
"historically 8001" phrasing implied might have changed). Kept in this
app's own per-model port scheme deliberately: every other real model here
gets its own slice from its own manifest range so multiple real servers or
a workspace switch never collide, and there's no reason to special-case
ACE-Step into competing for 8001 with any standalone ACE-Step install a
user might also happen to run on the same machine.

A generation request becomes: `POST /release_task` (prompt/lyrics/bpm/
key_scale/time_signature/audio_duration/batch_size, `audio_format: "wav"`,
`model: <checkpoint_variant>`), then this app polls
`POST /query_result` every 2s (20-minute budget, matching
`servers/musecoco/README.md`'s spirit of generous CPU-era budgets, here for
long-duration/high-batch requests instead) until `status` is `1`
(succeeded) or `2` (failed), then downloads the result via
`GET /v1/audio?path=...` and writes it to the generation's own
`output.wav`. See `electron/models/modelServer.ts`'s `runRealAceStepJob`.

Switching checkpoint variants between generations calls the real
`POST /v1/init` endpoint (`ensureAceStepModelLoaded`) — skipped when the
requested variant is already loaded, since it's a real (not free) model
reload.

## Manifest mapping notes

- `genre_tags`/`instrument_tags` (this app's manifest fields) have no
  dedicated parameter in ACE-Step's real API — only a single free-text
  `prompt` (caption). `buildAceStepPrompt()` folds them into the caption
  text sent to the server (`"<prompt>. Genre: <tags>. Instruments/timbre:
  <tags>"`) rather than dropping them, since ACE-Step's own caption format
  is natural-language music description and tags read naturally as part of
  it.
- `reference_audio` is only usable if `input_params.reference_audio`
  already happens to be a real absolute file path — same pre-existing
  Phase 4 upload-capture gap as MusicGen's `melody_audio` and Museformer's
  seed input (`DynamicGenerationForm`'s `audio_upload` handler only ever
  captures a picked file's *name*, not a real transferred path).
- `audio_format` is always requested as `"wav"` explicitly. ACE-Step's own
  API defaults to `mp3` (`docs/en/API.md` section 4.2) — this app requests
  `wav` to match every other real model's own `.wav` convention and
  `electron/ipc/audio.ts`'s `mimeTypeFor`.

## Manual smoke test (no Electron needed)

```bash
cd servers/ace-step-1.5/vendor
ACESTEP_CHECKPOINTS_DIR=$KWESI_MODELS_DIR/ace-step-1.5/.server-checkpoints \
ACESTEP_CONFIG_PATH=acestep-v15-turbo \
ACESTEP_INIT_LLM=false \
  $KWESI_VENVS_DIR/ace-step-1.5/bin/python acestep/api_server.py --port 17640 --host 127.0.0.1 &

curl http://127.0.0.1:17640/health

curl -X POST http://127.0.0.1:17640/release_task \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Short upbeat acoustic guitar instrumental, warm and simple","audio_duration":12,"batch_size":1,"audio_format":"wav","model":"acestep-v15-turbo","thinking":false,"use_cot_caption":false,"use_cot_language":false,"use_format":false,"sample_mode":false}'

# poll with the returned task_id:
curl -X POST http://127.0.0.1:17640/query_result -H 'Content-Type: application/json' \
  -d '{"task_id_list": ["<task_id>"]}'

# then download the file field's URL:
curl "http://127.0.0.1:17640<file field from the result>" -o test.wav
```

**Proven real** (Phase 8, this machine, GPU): a real, valid, non-silent WAV
was produced and independently verified with Python's `wave` module — RIFF/
WAVE header correct, 16-bit PCM, **stereo, 48000Hz** (resolves the catalog
doc's "format NEEDS VERIFICATION — likely WAV/FLAC" flag: it's WAV, PCM16,
48kHz stereo, when `audio_format: "wav"` is requested), exactly 12.0s
duration matching the request, 99.97% non-zero samples in the first
100k-sample window with a max amplitude of 27953/32767 — genuinely
generated audio, not a silent placeholder. DiT inference itself
(`acestep-v15-turbo`, 8 steps) took **0.81 seconds** on the RTX 3090 per
the server's own `generation_info` field. A second full run (fresh server
process) confirmed no re-download occurs once the `vendor/checkpoints`
symlink fix (above) is in place.

Verified twice: (1) standalone, spawning `acestep/api_server.py` directly
with no Electron involved (both smoke-test runs above); (2) the exact spawn
args/env `electron/models/modelServer.ts`'s `spawnAceStepServer()` uses
were reproduced by hand for this test, so the only difference from the real
app path is that Electron itself didn't spawn the process — not re-run a
third time through a compiled `npx electron` harness the way Phase 5's
MusicGen bonus step did, given the time this phase's checkpoint-layout
investigation actually took (see the "second, non-obvious problem" section
above). `electron/models/modelServer.ts`'s ACE-Step wiring was
read-reviewed and type-checks (`npx tsc -p electron/tsconfig.json`) but
wasn't exercised by actually submitting a generation through a running
Electron main process in this phase.

## What's not verified

- **XL variants (4B) were not test-run** — only `acestep-v15-turbo` (2B),
  per the roadmap's "start with the smallest/fastest variant" guidance.
  The checkpoint-layout symlinks for `acestep-v15-xl-*` are wired the same
  way and the files are present on disk (84GB total across all 8 variants),
  but loading/generating with them was not exercised.
- **`acestep-v15-base`/`acestep-v15-sft` (non-turbo, 32-64 step) were not
  test-run** — same reasoning, turbo was the fastest first proof.
- **The 5Hz LM ("thinking"=true, prompt/lyrics auto-expansion) path is
  untested** — deliberately disabled (`ACESTEP_INIT_LLM=false`) for this
  phase; see "How the app spawns it" above.
- **Reference-audio-conditioned generation (cover/repaint/style-transfer
  task types)** is wired in the request shape (`reference_audio_path`) but
  untested end-to-end, blocked on the same pre-existing upload-capture gap
  noted in "Manifest mapping notes."
- **No real streaming progress** — this app polls `/query_result` on a
  fixed interval and estimates a progress percentage from elapsed-vs-budget
  time, not from ACE-Step's own per-job progress (`/v1/stats` exposes
  `avg_job_seconds` server-wide, but not this specific job's real
  completion fraction).
- **CPU-only mode was not exercised** — this machine always has an idle RTX
  3090; ACE-Step's own docs confirm CPU inference is supported (slow), same
  read-reviewed-not-run status as MusicGen's CPU fallback in Phase 5.
