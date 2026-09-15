# MusicGen inference server

Real Meta AudioCraft MusicGen inference, in its own venv, spoken to over
plain HTTP. Wired into the Electron main process by
`electron/models/modelServer.ts` for `modelId === "musicgen"` only — every
other model in the catalog still uses the Phase 4 mock.

## Venv location

`$KWESI_VENVS_DIR/musicgen` — defaults to `<KWESI_HOME>/venvs/musicgen`, or
`/mnt/fast_data/Projects/kwesi/venvs/musicgen` in this repo's local dev setup
(`KWESI_VENVS_DIR` is set in the gitignored project-root `.env`). The
manifest's `server.venv` field (`src/data/manifests.ts`) is just the bare
model id (`"musicgen"`) — `electron/models/modelServer.ts` joins it onto
`KWESI_VENVS_DIR` itself, matching the `venvs/<model_id>/` layout documented
in `kwesi.docs/02-architecture.md`.

## Reinstalling the venv from scratch

```bash
python3.12 -m venv $KWESI_VENVS_DIR/musicgen
source $KWESI_VENVS_DIR/musicgen/bin/activate
pip install --upgrade pip setuptools wheel
pip install -r servers/musicgen/requirements.txt
pip install --no-deps audiocraft==1.3.0
```

The `--no-deps` on the last line is load-bearing, not optional: audiocraft
1.3.0's declared dependencies (`torch==2.1.0`, `av==11.0.0`,
`xformers<0.0.23`, plus `torchvision`/`torchtext`/`demucs`/`gradio`) are a
2024-era pin set with no Python 3.12 wheels, and none of them are actually
imported anywhere in the code path this server exercises (verified by
grepping `audiocraft/` for every heavy import and tracing the real
`from . import data, modules, models` chain by hand — see git history of
this file for the trace if the exact set of "does this import chain
actually need it" questions comes up again). `requirements.txt` installs
the real transitive requirements (torch/torchaudio/xformers pinned to a
mutually-compatible newer combo, `av` at a version with a cp312 wheel,
`flashy`/`librosa`/`spacy`/`transformers`/`soundfile`/`torchmetrics` because
those genuinely are imported by `audiocraft/modules/conditioners.py`,
`audiocraft/data/audio.py`, and the `models/multibanddiffusion.py` ->
`solvers` -> `metrics` import chain), then `--no-deps audiocraft` just
drops the package's own code in without pip trying to "fix" it back to its
stale pins.

Two things worth knowing if this ever needs rebuilding:
- `pip install xformers` unpinned will happily upgrade torch out from under
  you (it resolved to `torch==2.14.0` at one point during integration,
  breaking torchaudio's compiled extension with an ABI mismatch) — always
  install xformers pinned exactly to a version whose own metadata declares
  the torch version you already have (`xformers==0.0.29.post3` <->
  `torch==2.6.0`; check `pip index versions xformers` and each release's
  `requires_dist` on PyPI if upgrading later).
- MusicGen's text conditioner loads `t5-base` from Hugging Face
  (`transformers.T5Tokenizer`/`T5EncoderModel`) — this is a real,
  necessary runtime dependency of the architecture itself, not one of the
  five MusicGen checkpoints, and it is not part of what's already staged in
  `KWESI_MODELS_DIR`. It was downloaded once into the normal Hugging Face
  cache (`~/.cache/huggingface/hub`) during setup; the server sets
  `HF_HUB_OFFLINE=1`/`TRANSFORMERS_OFFLINE=1` before importing audiocraft
  so every subsequent load reads only from that cache, never the network.
  If this is set up on a machine without that cache already warmed, run the
  server once with those two env vars unset (or `=0`) so it can fetch
  `t5-base` the first time.

## How the app spawns it

`electron/models/modelServer.ts` spawns
`$KWESI_VENVS_DIR/musicgen/bin/python servers/musicgen/server.py --port <p>`
as a child process the first time a MusicGen generation is submitted (or a
workspace bound to MusicGen is opened), picks `<p>` from the manifest's
`portRange` (17600-17619), polls `GET /health` until it responds, and keeps
the process alive across subsequent generations in the same app session —
it's torn down on app quit. A generation request becomes a
`POST /generate` with `{ variant, prompt, duration_sec, melody_audio_path,
output_path }`; the server loads that variant's checkpoint once (cached
in-process afterward) and writes a real WAV to `output_path`.

## Manual smoke test (no Electron needed)

```bash
source $KWESI_VENVS_DIR/musicgen/bin/activate
KWESI_MODELS_DIR=/mnt/fast_data/Projects/kwesi/models \
  python servers/musicgen/server.py --port 17600 &
curl http://127.0.0.1:17600/health
curl -X POST http://127.0.0.1:17600/generate \
  -H 'Content-Type: application/json' \
  -d '{"variant":"small","prompt":"upbeat lo-fi hip hop","duration_sec":6,"output_path":"/tmp/test.wav"}'
```

## GPU vs CPU

`server.py` picks `cuda` automatically when `torch.cuda.is_available()`,
else falls back to plain CPU inference (`device="cpu"` is a fully supported
value to `MusicGen.get_pretrained`, no code branch is skipped). The CPU
path was not actually exercised during Phase 5 integration — this machine
has an idle RTX 3090, so there was never a reason to force it — so treat it
as plausible-by-code-reading, not verified-by-running.
