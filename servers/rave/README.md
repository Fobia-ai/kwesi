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
file back, same shape as every other model in this app. Training (from-
scratch or fine-tuning a new timbre) is Phase 10/11's job, not this one's.
