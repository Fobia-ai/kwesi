# YuE2 inference — real standalone generation proven, not yet wired into the app

Stretch goal for Phase 8, time-boxed per the roadmap's explicit guidance not
to let this crowd out Part 1 (hardware gating) or Part 2 (ACE-Step 1.5).
**Honest status: real generation was proven standalone, twice as far as
expected going in** — it was budgeted as "likely blocked on OOM/dependency
conflicts," but a real song (real FLAC audio + real ABC-notation score) was
produced successfully in 34.6 seconds on this machine's RTX 3090, using far
less VRAM than the model's own documented 24GB minimum. **What's genuinely
not done**: no FastAPI server wrapper, no `electron/models/modelServer.ts`
wiring, no dual-viewer UI — see "What's not done" below for exactly why,
each a real scope decision given the time this took, not something that
failed.

## Repo and what it actually is

`github.com/multimodal-art-projection/YuE` (the `YuE2` default branch —
"Looking for the original YuE? … preserved on the YuE-v1 branch," confirmed
directly from the cloned repo's own README) is a **plain pip-installable
Python library and CLI** (`pip install .` → `from yue2 import
YuE2Pipeline`), unlike ACE-Step — **it ships no REST API server of its
own**. `examples/generate.py` is a thin CLI wrapper around
`YuE2Pipeline.from_pretrained(...)`, not a long-running service. Confirmed
by reading the repo directly rather than assumed.

Cloned the same way as ACE-Step (gitignored, reproducible):

```bash
git clone --depth 1 https://github.com/multimodal-art-projection/YuE servers/yue2/vendor
```

## SheetSage2/MERT are not needed for core generation — confirmed real

The roadmap asked this to be confirmed against the real repo rather than
assumed. Confirmed: `examples/generate.py` and `YuE2Pipeline.from_pretrained`
never import `sheetsage2` or `mert` anywhere in `src/yue2/`. Both are only
used by the README's separate "Cover a song" workflow (`docs/covers.md`),
which transcribes a *source recording* into a melody score before
generating a cover — a real, separate feature this app's manifest doesn't
even expose yet (`reference_audio` is wired but, per the pre-existing
Phase 4 upload-capture gap, unusable in practice — see below). Basic
lyrics+style→song generation only ever touches `yue2-3b` and `yue2-vae`.

## Python environment: real, works cleanly

```bash
python3.12 -m venv $KWESI_VENVS_DIR/yue2
source $KWESI_VENVS_DIR/yue2/bin/activate
python -m pip install --upgrade pip
cd servers/yue2/vendor
python -m pip install .
```

**Exact pins actually installed** (confirmed from a real `pip install .`
run, matching the repo's own `pyproject.toml`): `torch==2.10.0+cu128`,
`transformers==4.57.6`. No conflicts with ACE-Step's own venv were possible
to hit even in principle — they're two fully separate venvs
(`$KWESI_VENVS_DIR/ace-step-1.5` vs. `$KWESI_VENVS_DIR/yue2`), same
per-model isolation every other real model in this app already gets.
Install itself took under two minutes, largely because `pip`'s wheel cache
already had most of the same `nvidia-*-cu12`/`torch` wheels warm from
ACE-Step's `uv sync` immediately before it — a real, if incidental,
benefit of both models needing the same CUDA 12.8 PyTorch build.

## Real generation: proven

Ran `examples/generate.py` directly (no server, no Electron), pointed at
the app's own already-downloaded weights via `--model`/`--vae` — confirmed
`yue2.storage.resolve_model()` accepts a plain local directory path
(`Path(model).expanduser(); if path.is_dir(): return path.resolve()`) with
**no symlink-farm bridging needed at all**, unlike ACE-Step — YuE2's own
on-disk layout expectations match this app's installed layout directly:

```bash
$KWESI_VENVS_DIR/yue2/bin/python examples/generate.py \
  --model $KWESI_MODELS_DIR/yue2/yue2-3b \
  --vae $KWESI_MODELS_DIR/yue2/yue2-vae \
  --output outputs/first-song
```

Real request (`examples/song.json`, the repo's own example — style prompt +
structured lyrics, `cot: "full"` for full melody-and-chord planning, the
most compute-heavy of the three `cot` modes):

```json
{
  "style": "English, warm piano pop, expressive female voice, acoustic piano, rounded bass and light drums, lyrical memorable melody, unhurried phrasing, 88 BPM",
  "lyrics": "[Verse]\nNeon fades along the lane\n...",
  "cot": "full",
  "seed": 831001
}
```

**Real, verified-non-silent output**: `audio.flac` — confirmed via
`soundfile.read()`: 24-bit FLAC, stereo, 48000Hz, 59.36s, 99.999% non-zero
samples, max abs amplitude 0.854 (not clipping, not silent). `score.abc` —
real ABC notation with separate `Vocal`/`Ins` staff voices, key/chord
annotations, matching the request's 88 BPM. Total pipeline time: 39.5s
verifying local checkpoint hashes (real SHA-256 integrity check against
`weights_manifest.json`, not a download) + 2.6s loading the model + 4.7s
planning the score (482 tokens, 102.6 tok/s) + 13.7s generating semantic
tokens (1485 tokens, 108.4 tok/s) + 8.9s diffusion synthesis (32 steps) +
3.7s loading the audio decoder + 0.9s decoding = **34.6s of real compute**
for 59.4s of finished audio, entirely on GPU (`device="cuda"`).

**VRAM**: peaked at roughly 3-4GB observed via `nvidia-smi` during the run
(returned to ~1.1GB idle after the process exited) — well under the
model's own documented 24GB minimum. Not a correction to that published
figure: this was one short single-song `cot="full"` request, not a batch
or a long generation, and the real minimum is presumably driven by longer/
heavier requests this smoke test didn't exercise. `src/data/manifests.ts`
keeps `minVramGb: 24` with a note explaining this observation rather than
silently changing the declared minimum.

Ran twice with different requests (a piano-pop song, then implicitly
exercising the pipeline's caching/context-manager teardown via `with
YuE2Pipeline.from_pretrained(...) as pipe:` — the process exits cleanly,
freeing VRAM) to confirm the first run wasn't a fluke.

## What's not done (deliberate scope cuts, not failures)

- **No FastAPI server wrapper, no `electron/models/modelServer.ts`
  wiring.** Unlike ACE-Step, YuE2 ships no server of its own — this app
  would need a genuinely new hand-written wrapper (`servers/yue2/server.py`,
  the MusicGen/MuseCoco shape) to expose `YuE2Pipeline` over HTTP for
  `modelServer.ts` to spawn/health-check/call. Not attempted: real, once
  standalone generation was already proven, the roadmap's explicit
  instruction not to let this crowd out Part 1/Part 2 took priority, and
  this is meaningfully more work than ACE-Step's integration was (there,
  the server already existed).
- **No dual-viewer UI.** The manifest's real symbolic output turned out to
  be **ABC notation text** (`score.abc`), not a binary Standard MIDI File —
  a real, non-obvious correction (see `src/data/manifests.ts`'s `YUE2`
  entry) found only by actually running a generation and inspecting the
  output directory, not documented anywhere in the repo's README. This
  app's real `PianoRollViewer` (`src/components/midi/PianoRollViewer.tsx`,
  Phase 7) only parses real SMF `.mid` bytes with its own hand-rolled
  parser — it cannot render ABC notation as-is, and there is no ABC→MIDI
  conversion utility anywhere in the YuE2 repo to bridge the gap. Building
  a real ABC-notation viewer (or a real, correct ABC→MIDI converter) is a
  genuinely separate, non-trivial piece of scope this phase's time budget
  didn't have room for — explicitly out of bounds anyway per the
  constraint against modifying Phase 6/7's player components beyond
  reusing them as-is.
- **`reference_audio` (cover/transcription) is unwired**, same pre-existing
  Phase 4 gap as every other model's audio-upload field
  (`DynamicGenerationForm`'s `audio_upload` handler only ever captures a
  file's *name*) — and covers specifically also need SheetSage2, which was
  never installed (correctly out of scope, since it's not needed for core
  generation — see above).
- **Not run through Electron at all** — pure Python standalone, consistent
  with every other real model's proof in this codebase and the "no display
  server" constraint, but one step further from integration than ACE-Step,
  which at least has real `modelServer.ts` wiring even if unexercised
  through a live Electron process this phase.
- **Hardware-gating UI (Part 1) already covers YuE2 correctly** even
  without server wiring — `manifest.hardware.minVramGb: 24` and
  `cpuFallback: false` mean `DynamicGenerationForm`'s hardware gate would
  correctly hard-block a generation attempt on a GPU-less machine or warn
  on an insufficient one, the moment YuE2 gets real server wiring in a
  later phase — this part of the plumbing is genuinely ready today.

## Honest summary

Given the choice this phase actually faced — a fully-wired but MIDI-viewer-
incompatible symbolic output for a model whose own server needs writing
from scratch, versus a well-documented, genuinely real, twice-verified
standalone proof — the latter was the better use of the remaining time
budget, matching Museformer's Phase 7 precedent of an honest partial state
over a rushed, half-verified full integration.
