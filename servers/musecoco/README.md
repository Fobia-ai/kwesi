# MuseCoco inference server

Real Microsoft MuseCoco attribute-to-music generation (stage 2 only -- see
below), in its own venv, spoken to over plain HTTP. Wired into the Electron
main process by `electron/models/modelServer.ts` for `modelId === "musecoco"`
only.

## Vendored code

`vendor/` is `github.com/microsoft/muzic`'s `musecoco` subfolder, pulled in
whole (`git clone --depth 1` + sparse-checkout, then `.git` stripped) rather
than hand-copying files, since the code cross-references itself heavily
(`2-attribute2music_model/linear_mask` imports `../midiprocessor`,
`../midi_data_extractor`, `../data_process`, etc.) and picking pieces out
would have been more error-prone than keeping the real directory shape.
`.gitignore`'d at the project root -- it's ~57MB of someone else's code, not
ours, and is trivially re-fetched (see below) rather than worth carrying in
this repo's own history.

To rebuild `vendor/` from scratch:
```bash
git clone --depth 1 --filter=blob:none --sparse https://github.com/microsoft/muzic /tmp/muzic
cd /tmp/muzic && git sparse-checkout set musecoco
rm -rf /mnt/fast_data/Projects/kwesi/servers/musecoco/vendor
cp -r /tmp/muzic/musecoco/. /mnt/fast_data/Projects/kwesi/servers/musecoco/vendor/
```
(`--filter=blob:none` avoids the ~140MB full-history fetch a plain
sparse-checkout clone pulls down even though only one subfolder is checked
out -- the first clone here didn't use it and paid for it.)

## Checkpoint layout

The already-downloaded weights (`$KWESI_MODELS_DIR/musecoco/default/
attribute2music.pt`, the `XinXuNLPer/MuseCoco_attribute2music` HF snapshot)
are what the vendored code calls `checkpoint_2_280000.pt` under
`checkpoints/linear_mask-1billion/` -- a symlink, not a copy, so the 14.5GB
file isn't duplicated:
```bash
mkdir -p servers/musecoco/vendor/2-attribute2music_model/checkpoints/linear_mask-1billion
ln -sf $KWESI_MODELS_DIR/musecoco/default/attribute2music.pt \
  servers/musecoco/vendor/2-attribute2music_model/checkpoints/linear_mask-1billion/checkpoint_2_280000.pt
```
`server.py` does this check at request time and 404s with a clear message if
the symlink/checkpoint is missing, rather than failing an import-time crash.

The vendored repo already ships a real, usable fairseq `data-bin` at
`vendor/2-attribute2music_model/data/truncated_2560/data-bin/` (dict.txt +
binarized train/valid/test, checked into `microsoft/muzic` itself) -- no
`fairseq-preprocess` step was needed, just pointing `--data` at it. Only
`dict.txt` from it is actually read at inference time (no dataset is
loaded, just the task's dictionary), but the whole folder is kept as-is
since it's small and came from the real repo.

## Stage 1 does not exist -- structured attributes only

MuseCoco is a two-stage pipeline (text→attributes, then attributes→music).
**Only the stage-2 checkpoint was ever published** (confirmed by
`kwesi.docs/03-model-catalog.md` and the muzic repo's own README, which
only links a stage-2 Hugging Face repo). This server therefore only
implements stage 2: it consumes the manifest's structured attribute fields
directly (`src/data/manifests.ts`'s `MUSECOCO.inputs`) and ignores the
`description` free-text field entirely -- there is no code path that could
turn free text into attributes without the missing stage-1 checkpoint.

## Real attribute vocabulary (why the manifest changed)

The manifest's original v1 field *values* were guesses. The real ones were
reverse-engineered by reading `vendor/2-attribute2music_model/
midi_data_extractor/attribute_unit/*.py` (each attribute's `get_vector`
method documents its exact class ordering) and
`vendor/1-text2attribute_model/data/att_key.json` (the full attribute-key
list). Findings, and what changed in `src/data/manifests.ts` as a result
(full reasoning is inlined as a comment directly above `MUSECOCO` there):

| Attribute | Real encoding | Manifest field |
|---|---|---|
| `I1s2` | 28 instrument categories, each independently yes/no/NA (multi-hot) | `instrument` (tags, matched against the 28 category words -- **known bug**, see below) |
| `S4` | 22 genre categories, each independently yes/no/NA (multi-hot) — corrected from this table's earlier "24" | `genre` (multiselect against the real 22-value vocabulary — was `tags`, see below) |
| `EM1` | Russell 4-quadrant mood (Q1-Q4) + NA | `mood` (select, was free-text tags) |
| `K1` | major / minor / NA only -- no specific tonic | `key_signature` (select: Major/Minor, was C major/G major/etc.) |
| `TS1s1` | exactly `(4,4) (2,4) (3,4) (1,4) (6,8) (3,8) other NA` | `time_signature` (select, added 1/4 and 3/8) |
| `B1s1` | 4-bar bins: 1-4/5-8/9-12/13-16 + NA | `bar_count` (number, capped 1-16, was 4-128) |
| `R1` | danceable yes/no/NA | `danceability` (select yes/no, was low/medium/high) |
| `P4` | octaves of pitch spanned (0-11) + NA | `pitch_range` (select narrow/medium/wide/full = ~1/4/7/10 octaves, was low/mid/high/full registers -- a different concept entirely) |
| `S2s1` | 17 fixed classical composers + NA | `artist_style` (select, was free-text tags) |
| `T1s1` | tempo bucket (slow <=76bpm / moderate / fast >=120bpm) + NA, computed server-side from `tempo_bpm` | `tempo_bpm` (number, unchanged) |

`I4`, `C1`, `ST1`, `R3`, `TM1` have no manifest field and are always sent as
NA -- they exist in the model's attribute vocabulary but nothing in the
catalog doc's original MuseCoco spec called for them, and NA is a
first-class, fully-supported value for every attribute (this is how the
model was trained to handle partial specification).

**A real bug, found while wiring artist-profile genres into the generation
form**: `match_categories()` (`server.py`) does
`{str(t).strip().lower()... for t in tags}` -- it expects `tags` to already
be a list, and iterates whatever it's given. The manual curl example further
down this README has always sent `"genre":["classical"]` (a real JSON
array), matching the server's actual contract -- but the app's own
`DynamicGenerationForm` rendered `genre` as a `"tags"` input (one
comma-separated text field), so `values.genre` was a plain *string* like
`"pop, jazz"`. Iterating a Python string yields characters, not words, so
every real generation through the app was silently matching zero genre
categories no matter what was typed. Fixed by making `genre` a real
`"multiselect"` manifest input (`src/data/manifests.ts`) backed by the exact
22-value vocabulary above, sent as a proper array — verified via `debug`
button-state assertions and a real generation through the app (not just
that it renders): see `kwesi.docs/03-model-catalog.md`'s MuseCoco entry.
`instrument` has the identical bug and is still open -- flagged as a
separate follow-up rather than fixed here, since today's change was scoped
to genre.

## Why `prefix_tokens` is required (the actual bug hunted down in Phase 7)

The naive approach -- put the attribute-token string in
`sample.net_input.src_tokens` and call `task.inference_step(generator,
models, sample)` the way `interactive_dict_v5_1billion.py`'s own `attributes()`
function appears to -- reliably produces a **near-empty output**: the model
free-generates its own guess at an attribute prefix (often landing on
"everything NA", since that's the most common pattern in training data)
and then emits EOS immediately after, regardless of `--min-len`. This is
not a bug in the checkpoint or the vocabulary above -- it's because the
attribute-prefix positions are masked out of the training loss
(`CommandDataset.__getitem__` in `A2M_task_new.py` pads the target at those
positions), so the model was **never trained to predict them as real
autoregressive content** -- only to condition on them if they're forced in.
The fix is to pass the encoded attribute+`<sep>` prefix as the
`prefix_tokens` argument to `generator.generate()`/`task.inference_step()`
(fairseq's standard teacher-forced-prefix mechanism), which makes
`CommandSequenceGenerator._generate`'s `_prefix_tokens` branch place the
real attributes at each of those positions instead of letting the model
freely (and uselessly) guess them.

A second, related gotcha: `--min-len`/`--max-len-b` are **total sequence
length budgets counted from step 0**, which includes the forced-prefix
region. `min_generated_tokens`/`max_generated_tokens` in a `/generate`
request are real-content lengths; `server.py` adds `sep_pos + 1` to both
before setting `generator.min_len`/`generator.max_len_b`. Getting this
backwards (or leaving `min_len` smaller than the prefix length) is exactly
what produced empty/near-empty `.mid` files during this phase's early
attempts, not a broken decode path.

## Python/dependency archaeology

Catalog doc's declared pin (Python 3.8, PyTorch 1.11.0) holds -- no
python3.8 was installed system-wide and there's no passwordless sudo, so
the venv was built with `uv` instead of a system Python/conda:
```bash
uv python install 3.8
uv venv --python 3.8 $KWESI_VENVS_DIR/musecoco
uv pip install --python $KWESI_VENVS_DIR/musecoco/bin/python \
  torch==1.11.0 --index-url https://download.pytorch.org/whl/cu113
$KWESI_VENVS_DIR/musecoco/bin/pip install -r servers/musecoco/requirements.txt
```

Two real, hard-won pins beyond the catalog doc's own note:

- **`pytorch-fast-transformers==0.4.0` builds CPU-only on this machine, and
  that's fine.** The model's `linear_mask/linear/causal_linear_attention.py`
  imports `fast_transformers.causal_product.causal_dot_product`, a compiled
  extension. There is no system CUDA toolkit here (`nvcc` isn't on `PATH`,
  and there's no passwordless sudo to install one -- the pip-installable
  `nvidia-cuda-nvcc-cu11` wheel was tried and rejected: it ships `ptxas` and
  headers but not an actual `nvcc` binary, so it can't drive
  `torch.utils.cpp_extension`). `pytorch-fast-transformers`'s own `setup.py`
  detects this (`cuda_toolkit_available()` just tries to run `nvcc`) and
  skips the CUDA extension, building only the CPU ones --
  `fast_transformers.causal_product.__init__` then dispatches
  `CausalDotProduct.dot["cpu"]` vs. `["cuda"]` based on `Q.device.type`, so
  running on `--cpu` (which this server always does, see below) picks the
  CPU kernel automatically with zero code changes needed. This is *why*
  the model is CPU-feasible at all despite depending on a package that
  looks CUDA-only from its README.
- **`miditoolkit==0.1.16`, not the current `1.0.1` on PyPI.** The vendored
  decoder (`midiprocessor/enc_remigen2_utils.py`) uses the pre-1.0 API
  (`miditoolkit.containers.Instrument`, `miditoolkit.midi.parser.MidiFile`)
  that the 1.0 rewrite renamed/restructured away. `pip install miditoolkit`
  unpinned installs 1.0.1 and fails with `AttributeError: module
  'miditoolkit' has no attribute 'containers'` the first time a real MIDI
  gets decoded.

## Why this runs on CPU, not the RTX 3090

Not a choice made for simplicity -- it's the direct consequence of the
`pytorch-fast-transformers` situation above (no CUDA extension built, no
system CUDA toolkit available to build one). `server.py` hardcodes
`DEVICE = "cpu"` and `--cpu` on the generation args. The checkpoint is
~1B parameters (`checkpoints/linear_mask-1billion/checkpoint_2_280000.pt`,
14.5GB on disk in fp32 -- larger than `kwesi.docs/03-model-catalog.md`'s
original "~200M params" estimate, corrected there in Phase 7), so CPU
inference is slow (minutes, not seconds) but genuinely functional --
verified end-to-end, see below.

## Manual smoke test (no Electron needed)

```bash
source $KWESI_VENVS_DIR/musecoco/bin/activate
cd /mnt/fast_data/Projects/kwesi
KWESI_MODELS_DIR=/mnt/fast_data/Projects/kwesi/models \
  python servers/musecoco/server.py --port 17620 &
curl http://127.0.0.1:17620/health
curl -X POST http://127.0.0.1:17620/generate \
  -H 'Content-Type: application/json' \
  -d '{"input_params":{"instrument":["piano","strings"],"genre":["classical"],"mood":"Q4","tempo_bpm":90,"key_signature":"major","time_signature":"4/4","bar_count":8,"danceability":"no","pitch_range":"medium","artist_style":"chopin"},"output_path":"/tmp/musecoco_test.mid","min_generated_tokens":200,"max_generated_tokens":350}'
```

**Proven real** (Phase 7, this machine, CPU): both the standalone (direct
Python, no server/Electron) and in-process `server.generate()` paths
produced a real, valid, parseable `.mid` file -- verified with `mido`
(non-zero `mid.length`, real `note_on`/`note_off` event pairs, not an
empty/corrupt placeholder). A `~200-token` real-content request (the
smoke-test default above) took roughly two minutes end-to-end on CPU
including the ~12s checkpoint load; a fuller composition
(`min_generated_tokens`/`max_generated_tokens` in the several-hundred range)
will take proportionally longer -- there is no streaming/partial-progress
output, matching Phase 5's MusicGen precedent (`modelServer.ts` shows a
single 0% "running" tick, then done/failed).

## How the app spawns it

Same shape as `servers/musicgen/README.md` describes: `electron/models/
modelServer.ts` spawns `$KWESI_VENVS_DIR/musecoco/bin/python
servers/musecoco/server.py --port 17620` (the manifest's `[17620, 17629]`
range, fixed to the first port) on first use, health-checks `GET /health`,
and keeps the process (and its loaded ~1B-param model) alive across
subsequent generations in the same app session.

## Training (Phase 11) — real CLI confirmed, real run started, not completed

`electron/models/trainingManager.ts`'s `runMuseCocoTrainingPipeline` wires
up a real `fairseq-train` invocation, continuing from the installed
checkpoint. Manifest block in `src/data/manifests.ts`'s
`MUSECOCO.training`. This is an honest partial result — lower verification
depth than ACE-Step/MusicGen (both fully round-tripped), higher than
Museformer (not attempted) — documented precisely, not glossed over.

### The real training tooling

`servers/musecoco/vendor/2-attribute2music_model/train-xl.sh` is the real,
vendored reference invocation (for the XL model) — this app's pipeline
adapts it for the real installed `linear_mask-1billion` checkpoint instead:
a plain `fairseq-train` console script, the vendored repo's own real
`linear_mask` fairseq user-dir (`--task language_modeling_control --arch
linear_transformer_lm_1billion`), continuing from the installed checkpoint
via `--restore-file <path> --reset-optimizer --reset-dataloader
--reset-lr-scheduler --reset-meters` (a real fine-tune from that
checkpoint's weights, not resuming its original optimizer state/step
count). One real phase — fairseq's own checkpoint format needs no
preprocess or export step, unlike RAVE/ACE-Step/MusicGen.

Real finding: this venv's `fairseq-train`, `dict.txt`, and a full
already-binarized example `data-bin` (`2-attribute2music_model/data/
truncated_2560/data-bin/`, real, vendored, 101 real example sequences —
the same tiny illustrative dataset the real `microsoft/muzic` repo itself
ships) were all confirmed present and usable with **zero additional
dependency work** beyond what Phase 7's inference venv already built.

### Real, honest scope cut: raw-MIDI dataset prep isn't wired up

The real MIDI → attribute-sequence extraction pipeline exists in the
vendored repo (`servers/musecoco/vendor/2-attribute2music_dataprepare/`,
confirmed by reading `extract_data.py`/`midi_data_extractor/`), but wiring
it end-to-end (raw MIDI upload → attribute extraction → `fairseq-preprocess`
→ binarized data-bin) was judged out of this phase's time budget, given the
roadmap's own explicit lower priority for MuseCoco relative to ACE-Step/
MusicGen. So `Training.tsx`'s dataset input for this model is a **directory
picker** (`DatasetDirPicker`), pointed at an already-binarized fairseq
data-bin directory (dict.txt + .bin/.idx files — the same shape the
vendored example dataset already has), not a raw-MIDI drop-zone. A future
phase closing this gap would extend `runMuseCocoTrainingPipeline` with a
real `preprocess` phase calling into `2-attribute2music_dataprepare/
extract_data.py`, then `fairseq-preprocess`.

### Real run: launched, computed, did not finish in-session

```bash
$KWESI_VENVS_DIR/musecoco/bin/fairseq-train data/truncated_2560/data-bin \
  --user-dir linear_mask --task language_modeling_control \
  --arch linear_transformer_lm_1billion --command_path data/truncated_2560 \
  --truncated_length 2560 --command_mask_prob -1 --sample-break-mode eos \
  --tokens-per-sample 10000000 --max-tokens 10000000 \
  --batch-size 1 --batch-size-valid 1 --update-freq 1 \
  --optimizer adam --adam-betas '(0.9, 0.98)' --adam-eps 1e-9 --weight-decay 0.01 \
  --lr 1e-6 --lr-scheduler fixed --log-format simple --log-interval 1 \
  --num-workers 0 --max-update 3 --validate-interval 100000000 \
  --save-interval-updates 3 --save-dir <dir> --no-epoch-checkpoints \
  --restore-file $KWESI_MODELS_DIR/musecoco/default/attribute2music.pt \
  --reset-optimizer --reset-dataloader --reset-lr-scheduler --reset-meters --cpu
```

Confirmed real: the process launched cleanly, loaded the real 14.5GB
installed checkpoint via `--restore-file` with no errors, and then
performed genuine sustained multi-core CPU computation (~1000% CPU,
~29GB resident, actively growing CPU-time) for the full verification
window. It did **not** complete a single real update (and so produced no
checkpoint file) within an ~8-minute budget before being killed. Consistent
with — and a real, harder-hit extension of — Phase 7's own "CPU-bound and
slow" finding for inference (no CUDA-built `pytorch-fast-transformers`
extension on this machine, same root cause): training is strictly more
expensive than inference (a full forward *and* backward pass, at the same
`truncated_length=2560` token budget as a real full-length example), so
the CPU-boundedness that made inference merely slow (~2 minutes per
generation, per the section above) makes a single training update
impractically slow to verify within a normal working session.

**What a real GPU (or a much shorter `--truncated_length`/synthetic tiny
sequence) would unblock**: this app has an idle RTX 3090, but this venv's
`pytorch-fast-transformers` extension has no CUDA build here (the same
"no system CUDA toolchain to build the model's compiled attention
extension against" constraint Phase 7's README documents for inference) —
so `--cpu` isn't an arbitrary choice for this run, it's the only mode this
venv actually supports. A future phase either builds that CUDA extension
for real, or accepts a much smaller `--truncated_length`/synthetic-token
pipeline-proof run to get a real checkpoint file inside a practical time
budget.
