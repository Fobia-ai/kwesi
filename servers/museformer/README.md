# Museformer inference server

## Status: code-complete, **not verified end-to-end**

Unlike `servers/musicgen` and `servers/musecoco` (both proven with a real,
non-empty output file on this machine), `servers/museformer/server.py` was
never actually run in Phase 7 -- no venv was built for it and `/generate`
was never exercised. This is a deliberate, documented scope cut, not an
oversight: MuseCoco's integration (see `servers/musecoco/README.md`) took
the bulk of Phase 7's time budget after a much deeper reverse-engineering
effort than expected, and the roadmap explicitly allows landing one of the
two models fully proven and the other code-complete-but-unverified rather
than neither. `electron/models/modelServer.ts` still wires Museformer into
the same real-subprocess code path as MusicGen/MuseCoco (`isRealServerModel`
recognizes `museformer`, its own venv/port), so turning this from
"unverified" into "verified" is a matter of doing the dependency work below
and re-running the smoke test at the bottom of this file -- not further
code changes.

## Vendored code

`vendor/` is `github.com/microsoft/muzic`'s `museformer` subfolder (same
pull method as `servers/musecoco/vendor/` -- see that README for the exact
`git sparse-checkout` command). `.gitignore`'d at the project root, same
reasoning as MuseCoco's vendor dir (third-party code, not large here --
~1.6MB -- but kept out of this repo's history for consistency and because
it's trivially re-fetched).

## Why this is a real risk, not just "untested busywork"

Museformer's decoder (`vendor/museformer/museformer_decoder.py`) imports
custom kernels:
- `museformer/kernels/range_fill` and `museformer/kernels/segment_arange`
  **do have a real CPU fallback** -- `range_fill()`/`segment_arange()` check
  `tensor.is_cuda` and call a plain-PyTorch implementation
  (`range_fill_pytorch`, etc.) when false, only touching
  `torch.utils.cpp_extension.load` (which needs `nvcc`, unavailable here for
  the same reason documented in `servers/musecoco/README.md`) on the CUDA
  path. Running with `--cpu` should avoid these entirely.
- `museformer/blocksparse/optimized_matmul.py` and `optimized_softmax.py`
  **use Triton directly**, which has no CPU backend at all. Whether
  Museformer's default (non-`--user-dir`-overridden) attention path actually
  calls into `blocksparse` during plain `--cpu` generation, or only under a
  training-time/optimized-attention flag, was **not confirmed** -- the
  vendored README's own environment section recommends installing a
  from-source Triton build "at an arbitrary directory," itself a nontrivial,
  slow build (this isn't the modern self-contained Triton pip wheel; it's a
  2022-era version pinned to match this exact model code). If `blocksparse`
  does get hit on the inference path, this becomes a hard GPU-only blocker
  the same way `pytorch-fast-transformers`' CUDA extension briefly looked
  for MuseCoco before its CPU fallback was found (see that README) --
  except Triton doesn't have an equivalent fallback to reach for.
- The real MIDI tokenizer/decoder Museformer's own README points at
  (`github.com/btyu/MidiProcessor`, installed via `mp-batch-encoding`) was
  never vendored or resolved separately -- `server.py` currently reaches
  into `servers/musecoco/vendor/.../midiprocessor` (same REMIGEN2 scheme,
  proven working there) as a pragmatic reuse rather than re-vendoring a
  third copy of the same tool. This should work (both READMEs describe the
  same encoding), but was not exercised against real Museformer output.

## What would need to happen to actually verify this

1. Build a Python 3.8 venv the same way as MuseCoco's (`uv python install
   3.8` + `uv venv`), install `requirements.txt`.
2. Try a plain `fairseq-interactive` smoke test first, standalone, no
   Electron -- if it errors on a missing Triton/CUDA symbol, that confirms
   `blocksparse` is on the hot path and this becomes a real, harder
   dependency problem (likely needs an actual GPU + the from-source Triton
   build the vendored README describes) rather than a quick fix:
   ```bash
   source $KWESI_VENVS_DIR/museformer/bin/activate
   mkdir -p servers/museformer/vendor/data-bin
   cp servers/museformer/vendor/data/meta/dict.txt servers/museformer/vendor/data-bin/
   python -m fairseq_cli.interactive servers/museformer/vendor/data-bin \
     --path $KWESI_MODELS_DIR/museformer/default/checkpoint_best.pt \
     --user-dir servers/museformer/vendor \
     --task museformer_language_modeling \
     --sampling --sampling-topk 8 --beam 1 --nbest 1 \
     --min-len 64 --max-len-b 256 --cpu --buffer-size 1 <<< ""
   ```
2. If that works, `curl` the running server the same way
   `servers/musecoco/README.md`'s smoke test does, and verify the resulting
   `.mid` with `mido` the same way (non-zero length, real note events).
3. Update this file's "Status" section and `kwesi.docs/04-roadmap.md`'s
   Phase 7 entry once genuinely verified -- don't just delete this section.

## How the app spawns it

Same shape as MusicGen/MuseCoco: `electron/models/modelServer.ts` spawns
`$KWESI_VENVS_DIR/museformer/bin/python servers/museformer/server.py --port
17630` (the manifest's `[17630, 17639]` range) on first use, health-checks
`GET /health`, keeps the process alive across generations. `server.py`
itself shells out to `fairseq-interactive` as a subprocess per request
(rather than an in-process fairseq task/generator the way
`servers/musecoco/server.py` does) since Museformer's task/generator are
designed around the stock fairseq CLI (`--user-dir museformer`), and that's
the officially documented usage in the vendored repo's own README -- lower
risk of a hand-rolled invocation being subtly wrong in ways that are hard
to debug without a working environment to test against.

## Input mapping

`src/data/manifests.ts`'s Museformer inputs (`seed_mode`, `seed_midi`,
`bar_count`) map straightforwardly: `seed_mode: "random"` runs unconditional
generation (an empty prompt line, matching the vendored README's own
`printf '\n\n\n\n\n' | ...` usage for 5 pieces); `seed_mode:
"continue_from_midi"` is **not implemented** -- `server.py` returns a clear
400 explaining why, the same pre-existing Phase 4 gap MusicGen's melody
upload has (`DynamicGenerationForm`'s `midi_upload`/`audio_upload` handlers
only ever capture a file's *name*, never a real transferred path). `bar_count`
is informational only, logged but not translated into a hard constraint --
Museformer's real length control is `--min-len`/`--max-len-b` token budgets,
not a bar count, mirroring the same reality MuseCoco's `bar_count` field
ran into (see `servers/musecoco/README.md`).

## Training (Phase 11) — re-confirmed still blocked, not attempted

Phase 11's roadmap explicitly prioritized ACE-Step 1.5/MusicGen/MuseCoco
above Museformer and allowed "a quick honest re-confirmation that it's
still blocked" as a legitimate result for this model. That's what happened
here: no venv was built, no training code was written, and the "Status:
code-complete, not verified end-to-end" line at the top of this README is
unchanged from Phase 7.

The reasoning: training needs a real base to fine-tune from, and this
model's own *inference* path was never actually run even once — no venv
exists, and the real risk this file already documents above (Triton/
`blocksparse` having no CPU backend at all, confirmed not-yet-resolved) is
a genuine blocker for either inference or training, not something training
work could route around. Attempting training integration before inference
itself is proven would mean guessing at a real dependency problem twice
instead of once. Building the Python 3.8 venv and running the standalone
`fairseq-interactive` smoke test this README's "What would need to happen
to actually verify this" section already prescribes remains the correct
next step — for inference first, training after.
