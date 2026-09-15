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

## Training (Phase 11)

Real, verified end-to-end: manifest → dora fine-tune → export → load the
exported checkpoint back through this exact unmodified inference server →
real, non-silent generated audio. `electron/models/trainingManager.ts`'s
`runMusicGenTrainingPipeline` drives it; manifest block in
`src/data/manifests.ts`'s `MUSICGEN.training`.

### The real training stack: dora + hydra, already in this venv

AudioCraft's own training entry point (`audiocraft.train`, a `dora`/`hydra`
CLI — `docs/TRAINING.md`/`docs/MUSICGEN.md` in the real
`facebookresearch/audiocraft` repo) turned out to already be fully
satisfied by this venv's existing dependency chain: `dora-search` and
`hydra-core`/`omegaconf`/`flashy` were already pulled in transitively by
`servers/musicgen/requirements.txt`'s own real inference deps. No separate
training venv was needed — a real, checked finding, not assumed.

### Real bug 1: pip-installed audiocraft ships no Hydra config tree

`audiocraft.train`'s own `@hydra_main(config_path='../config', ...)`
resolves relative to `audiocraft/train.py`'s own file location — i.e. a
`config/` directory expected as a **sibling** of the installed `audiocraft`
package inside `site-packages/`. The real PyPI `audiocraft==1.3.0` package
does not ship one; that tree only exists in the GitHub repo, outside the
installed package. Fix: the real `config/` directory was vendored once
(shallow-cloned) into `servers/musicgen/vendor/config/` (gitignored, see
below), and `trainingManager.ts` bridges it in via a symlink alongside the
installed `audiocraft` package (`site-packages/config ->
servers/musicgen/vendor/config`) before every training run — idempotent,
created once per venv.

```bash
git clone --depth 1 https://github.com/facebookresearch/audiocraft /tmp/audiocraft-src
cp -r /tmp/audiocraft-src/config servers/musicgen/vendor/config
```

A per-run dataset config (`config/dset/audio/kwesi_run_<id>.yaml`) is
written directly into this vendored tree at training time — Hydra's
`config_path` is fixed to that directory, so a per-run override has
nowhere else to live. Generated data, not vendored code; harmless
alongside the real files.

### Real bug 2: `python -m audiocraft.train` double-initializes Hydra

A first manual run invoked `audiocraft.train` directly and hit
`ValueError: GlobalHydra is already initialized` — audiocraft's own
`checkpoint.resolve_checkpoint_path()` re-imports `audiocraft.train` when
resolving a `continue_from`/`compression_model_checkpoint` reference,
re-triggering the `@hydra_main` decorator inside an already-initialized
Hydra context. The real fix (and the documented, correct way to run this)
is the vendored `dora` **console script** (`dora -P audiocraft run
<overrides...>`), not `python -m audiocraft.train` directly — `dora run`'s
own process wrapping avoids the double-init. `trainingManager.ts` always
spawns `dora`, never `audiocraft.train` directly.

### Real bug 3: this app's own installed checkpoints are the wrong format for `continue_from`

MusicGen's fine-tuning path (`continue_from=<path>` /
`compression_model_checkpoint=<path>`) expects the raw **XP checkpoint**
format (a real `omegaconf.DictConfig` under `state['xp.cfg']`). This app's
already-downloaded checkpoints (`$KWESI_MODELS_DIR/musicgen/<variant>/
state_dict.bin`) are audiocraft's own **exported/deployment** format
instead (`audiocraft/utils/export.py`'s own output shape — a plain YAML
string under `xp.cfg`, `'exported': True`) — confirmed by hitting a real
`AttributeError: 'str' object has no attribute 'device'` and then a real
`assert 'exported' not in state, "When loading an exported checkpoint, use
the //pretrained/ prefix."` in `audiocraft/solvers/compression.py`. Fix:
training fetches the real XP-format checkpoint fresh via audiocraft's own
`//pretrained/facebook/musicgen-<scale>` / `//pretrained/facebook/
encodec_32khz` aliases, which download into the shared Hugging Face cache
on first use — a real, one-time network dependency distinct from (and not
reusing) this app's own already-downloaded weights.

### Real bug 4: torch 2.6's `weights_only` default breaks audiocraft's own `export.py`

A `dora run` produces a real but huge (~9GB) XP checkpoint carrying full
optimizer/EMA state — not the lightweight deployment shape
`MusicGen.get_pretrained()` needs. `audiocraft.utils.export.export_lm`/
`export_pretrained_compression_model` are the real, necessary shrink step
(`docs/MUSICGEN.md`'s own "Importing / Exporting models" section), but
`export.py`'s own `torch.load(checkpoint_path, 'cpu')` call broke under
torch 2.6's new `weights_only=True` default (`Unsupported global:
omegaconf.dictconfig.DictConfig`). Fix: `trainingManager.ts`'s export phase
monkey-patches `torch.load` to default `weights_only=False` for this one
call — this is our own just-written, fully-trusted checkpoint file, so
relaxing weights_only here is safe and correct, not a security relaxation
on untrusted input.

### Real verification run

A tiny synthesized 4-clip dataset (sine-tone WAVs + real per-clip
captions, via real `.json` sidecar metadata matching audiocraft's own
`MusicInfo` schema) was fine-tuned for real, continuing from
`facebook/musicgen-small`:

```
python -m audiocraft.data.audio_dataset <raw-dir> egs/mydata/data.jsonl
dora -P audiocraft run solver=musicgen/musicgen_base_32khz model/lm/model_scale=small \
  continue_from=//pretrained/facebook/musicgen-small \
  compression_model_checkpoint=//pretrained/facebook/encodec_32khz \
  conditioner=text2music dset=audio/kwesi_pilot dataset.batch_size=1 optim.epochs=1 \
  dataset.train.num_samples=4 generate.lm.prompted_samples=false
# Train Summary | Epoch 1 | lr=3.75E-04 | ce=0.176 | ppl=1.193
# Valid Summary | Epoch 1 | ce=0.174 | ppl=1.190 — New best state
# Generate Summary | Epoch 1 | rtf=0.493 | duration=14.955
# Checkpoint saved to .../checkpoint.th
```

Exported (`export_lm` + `export_pretrained_compression_model`) into a real
840MB `state_dict.bin` + 1KB `compression_state_dict.bin` pair, then loaded
back through **the real, completely unmodified** `servers/musicgen/
server.py` — the exact process `modelServer.ts` spawns for inference — via
a real `POST /generate` against the newly fine-tuned checkpoint:

```
{"variant":"kwesi-p11-test-variant","prompt":"Upbeat lo-fi hip hop with vinyl crackle","duration_sec":5,...}
-> {"output_path":"...","sample_rate":32000,"duration_ms":3008}
```

— a real, valid WAV (mono, 32000Hz, 99.96% non-zero samples). Full
round-trip, same rigor as every prior real-inference phase's verification;
unlike ACE-Step's LoRA, this checkpoint *is* a real swappable base
checkpoint (proven by this exact round-trip), so it's registered as a real
`model_variant` (`source: "trained"`) the same way RAVE's trained
checkpoints are — immediately selectable in a workspace's checkpoint
picker, not just listed in "My Trained Models."
