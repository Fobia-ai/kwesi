# Museformer inference server

## Status: verified end-to-end (GPU only)

A real generation was run and checked all the way through, from a
completely fresh `uv venv` built from nothing but this directory's own
`requirements.txt`, through fairseq's real decoder, to a real, valid,
non-empty `.mid` file (127 real note events, ~10s, opened and inspected with
`mido`) -- on this machine's GPU. That confirms the thing Phase 7 left
unknown and closes out the "not verified end-to-end" status this file used
to carry.

What that live run found, and fixed, along the way:

1. **`server.py`'s own `--user-dir` was wrong.** fairseq's `--user-dir`
   loader imports the given directory itself as a package by its own
   basename (see `fairseq.utils.import_user_module`). `server.py` passed
   `vendor/` (no `__init__.py`, silently imports as an empty namespace
   package -- registers nothing), when it needed to pass `vendor/museformer`
   (whose `__init__.py` runs the real `@register_task`/`@register_model`
   decorators). Real symptom before the fix:
   `--task: invalid choice: 'museformer_language_modeling'`. Fixed.

2. **The decoder's default config is really `attention_impl='blocksparse'`
   -- confirmed via the real checkpoint's own saved args, not guessed.**
   That is Triton-only, no CPU backend at all: `--cpu` generation hard-fails
   at kernel launch with `ValueError: Pointer argument (at 0) cannot be
   accessed from Triton (cpu tensor?)`. Verified real, not hypothetical.
   `server.py` no longer passes `--cpu` -- **Museformer generation requires
   a CUDA GPU**, full stop, for any checkpoint trained with the (default)
   blocksparse attention implementation.

3. **On GPU, the exact `sdd`/`dsd` blocksparse matmul + blocksparse softmax
   kernels the real attention code calls (`qk_mul_1.py`/`av_mul_1.py`) were
   tested standalone, forward-only (matching real inference, which never
   needs backward) -- they compiled via Triton 3.0.0 and ran correctly, no
   NaNs.** The 2022-era vendored Triton kernel code (this predates Triton's
   modern pip-wheel distribution) is not actually broken against a modern
   Triton/CUDA 12.1 stack, contrary to what "never tested" left open.
   (`triton` itself needs `setuptools` present just to `import` -- not
   related to CUDA at all, `triton/runtime/build.py` imports it at module
   load. `uv venv` doesn't ship `setuptools` the way a system Python often
   does. Added to `requirements.txt`.)

4. **Two other vendored kernels, `range_fill` and `segment_arange`, JIT-
   compile a real CUDA C++ extension via `torch.utils.cpp_extension.load`
   when their input tensors are on GPU -- which needs a working `nvcc`.**
   A plain `pip`/`uv` install has no system CUDA devel toolkit, and the
   modern `nvidia-cuda-nvcc-cu12` wheel no longer even ships an `nvcc`
   binary (only `ptxas`/`nvvm` -- checked directly, not assumed). A third,
   previously-undocumented kernel with the identical pattern,
   **`block_fill`** (used by attention mask generation), was found live
   while GPU-testing this -- this file's kernel list below used to only
   name range_fill/segment_arange.
   All three kernels already ship a `no_cuda_kernel` escape hatch in their
   own source that forces their existing plain-PyTorch fallback even for
   CUDA tensors -- correct, just not custom-kernel-accelerated for these
   small bar/beat-id-construction/mask-fill steps (not the expensive
   per-layer attention itself). `server.py` can't pass that flag through
   (`museformer_decoder.py` calls these with its own fixed argument list),
   so `_run_interactive.py` monkeypatches the three kernels' module-level
   `*_cuda` entry points to their pytorch fallback before generation starts
   -- see that file's own docstring for exactly why it has to be structured
   the way it is (a naive pre-import trips fairseq's own
   "module name is not globally unique" guard against double-imports).
   **This means no CUDA devel toolkit / `nvcc` is required at all** for a
   real user's install -- confirmed by rebuilding the venv from scratch with
   only `requirements.txt` and no `ninja`/`nvcc` packages, and re-running
   the same generation successfully.

5. **MIDI decoding reuses `servers/musecoco/vendor/.../midiprocessor`**
   (same REMIGEN2 scheme, same pragmatic-reuse choice this file already
   documented) -- confirmed genuinely working now, not just plausible: the
   real `.mid` bytes sent through it came out valid. One real, missing
   dependency found along the way: `miditoolkit`'s own `pianoroll`
   submodule imports `matplotlib.pylab` unconditionally at import time
   (nothing here plots anything -- it's just an eager import in a submodule
   `midiprocessor` pulls in), so a plain `miditoolkit` install without
   `matplotlib` fails at decode time. Added to `requirements.txt`.

6. **Real MIDI-seeded continuation** (`seed_mode: "continue_from_midi"`),
   added after the above: unconditional-only generation is not directable,
   so this was worth building rather than leaving as a manifest-level
   dead field. Same `midiprocessor` copy point 5 uses to decode also has a
   `MidiEncoder` -- symmetric to the decoder, same REMIGEN2 vocabulary.
   `server.py`'s `build_seed_primer()` encodes the picked MIDI, drops any
   token type outside this checkpoint's own `dict.txt` (a real gap found
   live: REMIGEN2 can emit `"s-*"` section-marker tokens this checkpoint
   was never trained on), and feeds the result as `fairseq-interactive`'s
   real input line in place of a blank one. **Verified live that the model
   actually uses it**, not just accepts it silently: primed with a
   hand-written synthetic 8-note ascending scale (a register/pitch pattern
   unlike anything the model's unconditional runs produced on their own),
   the real continuation picked up that exact scale, mirrored it back
   down, repeated the pattern, then layered its own bassline on top --
   the token-level and audible evidence that separates real conditioning
   from a primer the model silently ignores. See "Input mapping" below.

Real measured numbers from this machine (RTX-class GPU, CUDA 12.1): ~11-13s
per generation (128-512 tokens), under ~450MB of the model's own VRAM (peak
process GPU memory ~1.1GB against a ~0.7GB baseline) -- a small model,
4 decoder layers / 512 embed dim per the checkpoint's own saved config.

## What's still not automated by this repo

Everything above is about the *code and environment* being real and
correct. What's still missing is the checkpoint itself: there is no
`gateway_filename`/Model Manager download path wired up for Museformer's
weights in this repo, so a real end user has no in-app way to fetch
`checkpoint_best.pt` yet -- that's a separate, still-open hosting/
distribution question, not a code correctness one.

## Vendored code

`vendor/` is `github.com/microsoft/muzic`'s `museformer` subfolder (same
pull method as `servers/musecoco/vendor/` -- see that README for the exact
`git sparse-checkout` command). `.gitignore`'d at the project root, same
reasoning as MuseCoco's vendor dir (third-party code, not large here --
~1.6MB -- but kept out of this repo's history for consistency and because
it's trivially re-fetched).

## How the app spawns it

Same shape as MusicGen/MuseCoco: `electron/models/modelServer.ts` spawns
`$KWESI_VENVS_DIR/museformer/bin/python servers/museformer/server.py --port
17630` (the manifest's `[17630, 17639]` range) on first use, health-checks
`GET /health`, keeps the process alive across generations. `server.py`
itself shells out to `_run_interactive.py` (a thin, patched wrapper around
`fairseq_cli.interactive.cli_main()` -- see point 4 above and that file's
own docstring) as a subprocess per request, rather than an in-process
fairseq task/generator the way `servers/musecoco/server.py` does, since
Museformer's task/generator are designed around the stock fairseq CLI
(`--user-dir museformer`), matching the vendored repo's own documented
usage -- lower risk of a hand-rolled invocation being subtly wrong in ways
that are hard to debug without a working environment to test against (which
is now exactly what this file's verification above used to prove it out).

## Input mapping — real MIDI-primed continuation, verified live

`src/data/manifests.ts`'s Museformer inputs are `seed_mode` and `seed_midi`
only (no `bar_count` -- removed, see below). Both `seed_mode` values are
real:

- `"random"`: unconditional generation (an empty prompt line, matching the
  vendored README's own `printf '\n\n\n\n\n' | ...` usage for 5 pieces).
- `"continue_from_midi"`: real conditioning, not a stub. `server.py`'s
  `build_seed_primer()` encodes the picked MIDI file to REMIGEN2 tokens via
  `MidiEncoder` (the same reused `servers/musecoco/vendor/.../midiprocessor`
  copy `/generate`'s decode step already depends on), drops any token type
  this checkpoint's own `dict.txt` doesn't have (confirmed real: a `"s-*"`
  section-marker token REMIGEN2 encoding can emit isn't in this checkpoint's
  training vocabulary), caps it at `SEED_PRIMER_MAX_TOKENS` (256), and feeds
  the result as `fairseq-interactive`'s real input line instead of a blank
  one -- that's what makes it a real prefix the decoder continues from,
  not just a prompt string it ignores.

  **This was verified live, not assumed**: a hand-written synthetic MIDI (an
  8-note ascending scale, register and pitch content unlike anything the
  model's own unconditional runs produced) was encoded and fed in as a
  primer -- the model's real continuation picked up the exact scale,
  mirrored it back down, repeated the pattern, and then layered its own
  bassline on top. That's the actual test that separates "the model reads
  the primer" from "the model ignores the primer and the output happens to
  look similar" -- see the git history around this section for the exact
  token-level before/after if you want to reproduce it.

  A fresh MIDI upload resolves to a real absolute path in the real app
  (`DynamicGenerationForm`'s `resolveUploadedFilePath`, via Electron's
  `webUtils.getPathForFile` bridge) -- no library-file-only restriction.

`bar_count` was removed from the manifest entirely rather than kept: the
server has no real length control to attach it to (generation length is
governed by the shared min/max generated-token budget every model already
gets, same as before), so keeping it would just be decorative UI again.

## Training -- still blocked, and now for a clearer reason

Training was never wired up, and this verification pass didn't change that
-- but the *reason* is now precise rather than speculative: inference is
GPU-only (point 2 above, confirmed, not a maybe), so any training work
would need the same real GPU dependency plus its own from-scratch
integration effort. That's real, scoped work for whenever it's prioritized,
not a blocked-on-unknowns situation anymore.
