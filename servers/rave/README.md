# RAVE inference server

Real IRCAM/ACIDS RAVE batch-mode timbre transfer, in its own venv, spoken to
over plain HTTP. Wired into the Electron main process by
`electron/models/modelServer.ts` for `modelId === "rave"`, following the
exact `runReal<Model>Job` shape MusicGen/MuseCoco/Museformer/ACE-Step 1.5
already established.

## The one-line version of why this server is so small

All nine pretrained checkpoints in `models/rave/<name>/<name>.ts` are
**self-contained TorchScript exports** — confirmed by loading one with
nothing installed but `torch` itself:

```python
import torch
m = torch.jit.load("models/rave/darbouka_onnx/darbouka_onnx.ts", map_location="cpu")
m.forward(torch.randn(1, 1, 44100))  # real encode+decode round trip, no other imports
```

This is architecturally different from every other model in this catalog:
there's no separate "load model code, then load a checkpoint into it" step,
and no `acids-rave` pip package import anywhere in `server.py`. The scripted
module exposes `forward(x)` (full encode→decode round trip), `encode(x)`,
and `decode(z)` directly as TorchScript methods — real RAVE architecture,
confirmed by reading the exported graph's own decompiled code
(`ScriptedRAVE.encode`/`.decode`, PQMF + variational encoder + generator,
same components as the real `acids-ircam/RAVE` repo).

## Venv location

`$KWESI_VENVS_DIR/rave` — CPU-only torch, deliberately, not because a GPU
wasn't available (this machine has an idle RTX 3090, same as every other
server here) but because RAVE's own docs call inference/streaming
CPU-feasible for small models, and that held up in practice: a standalone
timing test against `darbouka_onnx` (26MB) encoded+decoded 3 real seconds of
audio in well under half a second on CPU. Rebuild from scratch:

```bash
python3.12 -m venv $KWESI_VENVS_DIR/rave
source $KWESI_VENVS_DIR/rave/bin/activate
pip install --upgrade pip setuptools wheel
pip install -r servers/rave/requirements.txt
```

No `--no-deps` two-step, no vendored repo, no `acids-rave` install — the
`.ts` files genuinely need nothing beyond `torch`/`torchaudio` (I/O and
resampling) and `soundfile` (real WAV writing, sidesteps torchaudio's
backend-selection questions). If real-time streaming or training work later
needs the actual `acids-rave` package (for `rave train`/`rave export`, which
this batch server doesn't touch), that's a separate addition, not a
correction to this finding.

## Real problems hit, and how they were actually fixed

**Not every checkpoint's decoder output is bounded to `[-1, 1]`.** First
`/generate` call against the `percussion` checkpoint failed inside
`soundfile.write` with `LibsndfileError: Format not recognised` — two real,
separate bugs stacked on top of each other, both confirmed by isolating them
outside the server:

1. `percussion` is a **stereo** checkpoint (`model.stereo == True`) —
   `forward()` returns `[1, 2, T]`, not `[1, 1, T]` like the mono
   checkpoints. Squeezing both leading dims and handing soundfile a `(2, T)`
   array (channels-first) rather than the `(T, 2)` it expects for
   multichannel data is what actually produced "Format not recognised" —
   soundfile read the huge first-dimension-as-frame-count and the tiny
   second dimension as an invalid channel count. Fixed by transposing
   whenever the model's channel count is >1, matching soundfile's real
   `(frames, channels)` convention.
2. Once transposition was fixed, `percussion`'s decoder output peaked
   around **±13** on ordinary (non-random) input — `darbouka_onnx`'s output
   stayed within `[-1, 1]` on the exact same input. Writing that directly as
   `PCM_16` would either hard-clip into garbage or (depending on the
   soundfile/libsndfile version) refuse to open at all. Fixed with a
   peak-normalize-only-if-needed step (`server.py`'s `generate()`) — models
   that are already well-behaved are left untouched, hot ones get scaled
   down to just inside `[-1, 1]` rather than clipped.

Both fixes verified by re-running the exact failing request against
`percussion` and confirming a real, valid, correctly-2-channel, non-silent
WAV came back (see "Verification" below).

**No sample-rate metadata anywhere in the `.ts` files.** Checked directly —
no `extra_files` entry under any of `sr`/`sample_rate`/`sampling_rate`/
`model_sr`, nothing in `constants.pkl`, no exported attribute on the
scripted module itself (`m.sr` raises `AttributeError`). `server.py`
defaults to **44100Hz** (`DEFAULT_SAMPLE_RATE` in `server.py`), matching
what IRCAM/ACIDS's own published model zoo documents as the training rate
for the large majority of its pretrained examples — but that page
(`acids-ircam.github.io/rave_models_download`) is the same JS-rendered one
`03-model-catalog.md` already noted can't be scraped to confirm this
per-checkpoint. Getting this wrong doesn't break inference — the model
still runs and writes a valid WAV either way — it just risks a
pitch-shifted timbre transfer if a specific checkpoint's real training rate
differs from 44100Hz. `generate()` accepts an optional `sample_rate`
override in its request body if a future manifest ever exposes a real
per-checkpoint value.

## How the app spawns it

Identical shape to `servers/musicgen/server.py`'s integration —
`electron/models/modelServer.ts` spawns
`$KWESI_VENVS_DIR/rave/bin/python servers/rave/server.py --port 17680`
(the manifest's `portRange[0]`, `src/data/manifests.ts`) on first use,
health-checks `GET /health`, and keeps it alive across subsequent
generations. A submitted generation becomes one blocking
`POST /generate` with `{ variant, input_audio_path, output_path }` — no
async task-queue polling like ACE-Step needs, RAVE's own inference is fast
enough for a single blocking call the same way MusicGen's is.

Unlike MusicGen's melody reference or ACE-Step's reference audio (both
optional), RAVE's `input_audio` is required — there is nothing to transform
without it — so `runRealRaveJob` fails the generation outright with a clear
message if `input_params.input_audio` isn't a real, existing absolute path,
rather than silently making a meaningless request to the server.

## Verification

Two real, independent checks (same "proven twice" bar every prior
real-inference phase used), both against a synthesized 3-second sine sweep
(200Hz→4000Hz) plus light noise — a legitimate timbre-transfer test input
since RAVE has no text/symbolic conditioning to satisfy, just real audio in:

1. **Standalone, no server** — called `server.py`'s own `generate()`
   function directly against the `darbouka_onnx` checkpoint.
2. **Through a real running `uvicorn` instance** — `POST /generate` against
   both `darbouka_onnx` (mono) and `percussion` (stereo, the checkpoint that
   surfaced both bugs above), confirmed via `GET /health` that each
   checkpoint was really cached (`loaded_variants`) rather than reloaded per
   request.

Every output WAV was checked with Python's `wave` module directly (not
assumed from the server's own reported success): real RIFF/WAVE header,
correct channel count (1 for `darbouka_onnx`, 2 for `percussion`), correct
44100Hz sample rate, non-silent (92–96% non-zero 16-bit samples, RMS in the
low thousands out of a 32768 ceiling — not a placeholder or degenerate
near-silent file), and genuinely different from the input (99.9997% of
overlapping sample positions differ in value; output length also differs
slightly from input length, since the model's internal ratio rounds the
frame count up).

```bash
source $KWESI_VENVS_DIR/rave/bin/activate
KWESI_MODELS_DIR=/mnt/fast_data/Projects/kwesi/models \
  python servers/rave/server.py --port 17680 &
curl http://127.0.0.1:17680/health
curl -X POST http://127.0.0.1:17680/generate \
  -H 'Content-Type: application/json' \
  -d '{"variant":"percussion","input_audio_path":"/tmp/test_input.wav","output_path":"/tmp/test_output.wav"}'
```

**Not verified**: the other seven checkpoints (`isis`, `musicnet`, `nasa`,
`sol_full`, `sol_ordinario_fast`, `VCTK`, `vintage`) are wired identically
but weren't individually run — `darbouka_onnx` and `percussion` were chosen
specifically because they cover both the mono and stereo cases, which is
where the real bugs above actually were. The real compiled Electron path
(submitting a generation through a running `npx electron` process) was not
exercised this phase either, same simplification Phase 7/8 already made for
MuseCoco/Museformer/ACE-Step's own wiring — read-reviewed and type-checked
(`npx tsc -p electron/tsconfig.json`), not run.

## What's explicitly out of scope here

Realtime/streaming inference (`rave export --streaming`, the VST/Max `nn~`
external) is a stretch goal per `kwesi.docs/04-roadmap.md` Phase 9, not part
of this server — this is batch mode only: upload a file, get a transformed
file back, same shape as every other model in this app.

---

# Training (Phase 10)

RAVE is the pilot model for the app's training pipeline
(`electron/models/trainingManager.ts`) — see
`kwesi.docs/02-architecture.md`'s "Training pipeline architecture" and
`kwesi.docs/04-roadmap.md` Phase 10. This section covers what's real vs.
assumed, and the dependency archaeology getting there.

## Training venv is separate from the inference venv, deliberately

`$KWESI_VENVS_DIR/rave` (this file's inference venv, above) is CPU-only
`torch`/`torchaudio` on whatever Python the system defaults to — genuinely
enough for loading a self-contained `.ts` export, but training needs the
actual `acids-rave` pip package (real model construction, the `rave train`/
`rave preprocess`/`rave export` CLI, GPU torch), a materially different
dependency surface. Rather than widen the inference venv (risking Phase 9's
already-proven, narrow CPU-only install), training gets its own venv:
`$KWESI_VENVS_DIR/rave-train`.

**Real problem hit #1 — Python version.** This machine's only system Python
is 3.12 (no `python3.10`/`python3.11`, no passwordless `sudo` to install
one — same constraint MuseCoco/Museformer hit needing Python 3.8). RAVE's
real PyPI package (`acids-rave==2.3.1`) pins `scipy==1.10.0` and
`pytorch_lightning==1.9.0` exactly — confirmed directly against PyPI's own
JSON API, not guessed — and `scipy==1.10.0` has no `cp312` wheel at all
(only up to `cp311`), so a straight `pip install acids-rave` on Python 3.12
would force a from-source scipy build (slow, and this container has no
Fortran toolchain to make it likely to succeed). Fixed the same way
MuseCoco's venv was: `uv python install 3.11` (a real, sandboxed standalone
CPython build, no system package manager involved) +
`uv venv --python 3.11 $KWESI_VENVS_DIR/rave-train`.

**Real problem hit #2 — `pkg_resources` missing.** A fresh `import rave`
failed with `ModuleNotFoundError: No module named 'pkg_resources'` —
`pytorch_lightning` -> `lightning_fabric` still does
`__import__("pkg_resources").declare_namespace(...)` at import time, but the
`setuptools` version `uv pip install acids-rave` pulled in (84.0.0) no
longer vendors `pkg_resources` by default. Fixed with `setuptools<81`
pinned explicitly (a real, confirmed-working combination, not a guess) —
see `requirements-train.txt`.

**Torch/CUDA**: plain `pip install torch==2.4.1 torchaudio==2.4.1` from
PyPI (no special `--index-url` needed, unlike the inference venv's CPU-only
pin) resolved a real CUDA 12.1-enabled Linux wheel on this machine —
confirmed via `torch.cuda.is_available()` returning `True` — since PyPI's
own `torch` Linux wheels bundle CUDA through the `nvidia-cu12-*` dependency
packages now. `acids-rave`'s own `torch` dependency (unpinned) is satisfied
by this without conflict.

Full working install:

```bash
uv python install 3.11
uv venv --python 3.11 $KWESI_VENVS_DIR/rave-train
uv pip install --python $KWESI_VENVS_DIR/rave-train/bin/python torch==2.4.1 torchaudio==2.4.1
uv pip install --python $KWESI_VENVS_DIR/rave-train/bin/python "pytorch_lightning==1.9.0" "setuptools<81" acids-rave
```

See `requirements-train.txt` for the pinned, reproducible version of the
above.

## Real finding: no hand-written `train.py` needed

Unlike every generation-side model, RAVE ships its own real CLI — the
`rave` console-script entry point the `acids-rave` package installs
(`$KWESI_VENVS_DIR/rave-train/bin/rave`), exposing `preprocess`/`train`/
`export`/`train_prior`/`generate` subcommands directly from
`acids-ircam/RAVE`'s own `scripts/`. `trainingManager.ts` spawns this real
binary across all three phases rather than writing a wrapper — the same
"run the vendor's own tooling directly" call Phase 8 made for ACE-Step's own
REST server. `src/data/manifests.ts`'s `RAVE.training.server` reflects this:
`{ entrypoint: "rave", venv: "rave-train" }` — `entrypoint` names a real
console-script command, not a Python file under `servers/rave/`.

## The three real phases, and the exact flags used

1. **`rave preprocess --input_path <raw> --output_path <lmdb> --channels 1
   --sampling_rate 44100 --num_signal 65536`** — chunks the staged dataset
   into a real LMDB-backed windowed dataset. `--num_signal 65536` (~1.49s
   windows) rather than RAVE's own default `131072` (~2.97s) is a
   deliberate pilot-scale choice — smaller windows mean shorter audio files
   still yield real chunks, and training steps are cheaper. **Real bug hit
   and fixed during development**: `preprocess.py`'s own chunk reader
   requires each input file to be at least `num_signal * 4` *bytes*
   (`num_signal * 2` samples) long or it silently yields zero chunks
   (`0it [00:00, ?it/s]`, a documented failure mode in RAVE's own FAQ) — a
   first attempt with 5-second synthetic clips at the default
   `num_signal=131072` produced an empty dataset; fixed by using
   `num_signal=65536` and clips comfortably longer than the
   `num_signal*4/2` = ~2.97s threshold it implies.
2. **`rave train --name <runId> --config v2_small --db_path <lmdb>
   --out_path <runsDir> --max_steps <N> --val_every 999999 --save_every
   <N/2> --n_signal 65536 --channels 1 --batch <B> --workers 0 --gpu 0
   --progress True`** — real training. `--val_every 999999` deliberately
   disables validation entirely for these short pilot runs (confirmed real
   and safe: RAVE's own `export.py` reads the model's `fidelity`/
   `latent_pca`/`latent_mean` buffers, which default to zero-initialized
   tensors and export without erroring even if validation never populated
   them — it just yields a maximally-truncated, unrefined latent space,
   fine for a pipeline-proof checkpoint, not fine for a musically good one).
   `--save_every` is computed as `max_steps / 2` so a real periodic
   checkpoint (`epoch_N.ckpt`, via `rave.core.ModelCheckpoint`) always lands
   within the run's step budget regardless of whether validation-triggered
   `best.ckpt` ever saves.
3. **`rave export --run <checkpoint.ckpt> --output <exportDir> --name
   <variantName>`** — real TorchScript export, identical file shape to
   every pretrained `.ts` this app already ships.

## Live progress: real, but honestly partial

`trainingManager.ts` parses RAVE's own real `tqdm`-based progress bar text
from the training subprocess's stdout/stderr (confirmed format via an
actual run: `Epoch 0:  91%|█████████ | 20/22 [00:01<00:00, 13.68it/s,
v_num=0]`) for step count, ETA, and rate. **Real per-step loss values are
not surfaced** — `rave/model.py`'s `self.log_dict(loss_gen)` calls don't set
`prog_bar=True`, so loss only reaches the run's real TensorBoard event file
(`events.out.tfevents.*` under the run directory), not stdout. Reading that
file live would need a protobuf-based TensorBoard event reader in Node,
judged out of scope for this phase — documented honestly rather than faked
with an invented number.

## Bridging a trained checkpoint into the existing inference server

`server.py`'s `get_model()` (above) hardcodes
`KWESI_MODELS_DIR/rave/<variant>/<variant>.ts` — it was never touched for
training, on purpose. The real exported checkpoint is written to the run's
chosen `output_dir` (a "Save As" location, `$KWESI_TRAINED_MODELS_DIR/rave/
<run_name>/<variant>.ts` by default, always user-editable — the actual
user-facing artifact), and `trainingManager.ts` symlinks
`KWESI_MODELS_DIR/rave/<variant>/<variant>.ts` to it — same "symlink, not
copy" precedent as `modelServer.ts`'s ACE-Step checkpoint-layout bridge,
pointed the other direction (app-managed location -> real user-chosen
file). **Known trade-off**: if the user later moves or deletes the
`output_dir` file, this symlink breaks and that trained variant's inference
will fail until it's restored — not silently corrected, but also not
hidden; noted in `kwesi.docs/04-roadmap.md`.

## Verification (real, run twice)

1. **Standalone CLI** (`venvs/.rave-train-smoketest/`, not committed): a
   synthesized 30-file/9s-each dataset (270s of sine-sweep + light noise,
   generated with `soundfile`, same "synthesize a test input" precedent as
   the inference side above) → real `rave preprocess` (90 real chunks) →
   real `rave train --max_steps 40 --save_every 20` on the RTX 3090 (~15s
   wall time) → real `rave export` → a genuine, structurally valid 31MB
   `.ts` file. Loaded back with a bare `torch.jit.load()` (no server
   involved) and run through `.forward()` against a real 3-second test
   tone — produced a real, non-silent WAV (99.99% non-zero 16-bit samples),
   verified with Python's `wave` module.
2. **Through the actual compiled Electron path**: a standalone script
   (`npx electron <script>.mjs`, same "no display server, drive it
   headless" technique Phase 5 established, with `app.whenReady()` skipped
   entirely since it hangs indefinitely in this sandboxed container with no
   GUI subsystem at all — confirmed with both `--disable-gpu`/`--no-sandbox`
   flags and without, neither helped, so the script calls straight into
   `dist-electron/models/trainingManager.js`'s `submitTrainingRun()`
   instead of trying to boot the Electron app shell) drove a real run
   end-to-end through `trainingManager.ts`'s actual code path: real
   `training_run` row (`queued` → `preparing` → `running` → `completed` in
   ~14s), a real `trained_model` row, a real `model_variant` row
   (`source: "trained"`, `install_status: "installed"`), a real 31MB `.ts`
   checkpoint at the chosen output dir, and the symlink bridge created at
   `KWESI_MODELS_DIR/rave/<variant>/<variant>.ts`. **Then loaded back
   through the real, completely unmodified `servers/rave/server.py`** —
   started a real `uvicorn` instance, `POST /generate` against the newly
   trained variant name, confirmed via `GET /health`'s `loaded_variants`
   that it actually loaded the trained checkpoint (not a pretrained one),
   and verified the output WAV the same rigorous way as every other real
   generation in this app: real RIFF/WAVE header, mono, 44100Hz, 99.98%
   non-zero 16-bit samples. The interrupted-run reconciliation sweep
   (`reconcileTrainingRunsOnStartup`) was exercised in the same script run
   against a synthetic stale `training_run` row (`status: "running"`, a
   nonexistent `pid`) and correctly flipped it to `interrupted` with a
   clear error message.

**Not verified**: real interruption of a run genuinely *mid-training* (kill
`rave train`'s actual process out from under a live run, rather than
constructing a stale DB row with a dead pid) — the dead-pid reconciliation
path itself is proven for real (above), but the "kill -9 a live training
subprocess, then relaunch and confirm interrupted" exact scenario the
roadmap describes wasn't separately re-run after the dead-pid version
passed, since both exercise the identical reconciliation code path
(`reconcileTrainingRunsOnStartup` treats every active row the same way
regardless of *why* its process is gone). True cross-restart resume (the
architecture doc's optional "resume-from-last-checkpoint" enhancement) is
not attempted — see `trainingManager.ts`'s own comment on why: the
multi-phase orchestration is an async function inside the Electron process
that submitted it, so restarting the app has nothing left to resume even if
a `detached` child process were still alive, only a daemon-style redesign
would change that. Every active run found at startup is unconditionally
marked `interrupted` (with a best-effort kill of any orphaned process at
its stored pid) rather than attempting partial reattachment.
