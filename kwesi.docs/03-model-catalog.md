# 03 — Model Catalog

Researched and cross-checked against real repos (Sept 2026). Items marked
`NEEDS VERIFICATION` should be re-confirmed directly against the model's repo
at integration time — treat this doc as a strong starting point, not gospel.

Your original naming, and what it actually maps to:

| You said | Real project |
|---|---|
| "step 1.5" | **ACE-Step 1.5** |
| "YuE 2" | **YuE2** (correct as said — real v2 release) |
| "MusicGen" | **MusicGen** (Meta AudioCraft) — as said |
| "MuseCoco" | **MuseCoco** (Microsoft) — as said |
| "Muse pharma... Muse forma" | **Museformer** (Microsoft) |
| "RAVE" | **RAVE** (IRCAM/ACIDS) — as said |
| "music agent" | **MusicAgent** (Microsoft) — real, but excluded (see [01-overview.md](01-overview.md)) |

License tiers, surfaced as a badge in the Model Manager and on the
acknowledgments screen:

| Tier | Meaning | Models |
|---|---|---|
| MIT | Free for any use | MuseCoco, Museformer, ACE-Step (code) |
| CC-BY-NC | Non-commercial only | YuE2 (weights), MusicGen (weights) |
| CC-BY-NC-SA | Non-commercial + share-alike | RAVE (code and weights) |

Training feasibility, since most of these are foundation models capable of
being fine-tuned on a user's own material (see [02-architecture.md](02-architecture.md)
"Training pipeline architecture" for the full mechanism):

| Model | Trainable? | Method | Input kind |
|---|---|---|---|
| RAVE | Yes — **its native workflow** | From-scratch / fine-tune per timbre | Raw audio, no captions |
| MusicGen | Yes | Fine-tune / LoRA (via AudioCraft's own training scripts, `dora`-based) | Audio + text caption per clip |
| ACE-Step 1.5 | Yes — **confirmed Phase 8** | LoRA or LoKr fine-tune, via the real repo's own API (`POST /v1/training/start`, `/v1/training/start_lokr` — see `docs/en/API.md` "Training API" in the cloned repo, or `docs/en/LoRA_Training_Tutorial.md`) | Audio + lyrics/tags, pre-processed to tensors |
| MuseCoco | Yes | Full fine-tune | MIDI |
| Museformer | Yes | Full fine-tune | MIDI |
| YuE2 | **No, not in v1** | — | — already needs 24GB+ VRAM just for inference; training would need substantially more than is realistic on consumer desktop hardware. Manifest sets `training.supported: false` with that reason shown in the UI. |

---

### ACE-Step 1.5
- Repo: `github.com/ace-step/ACE-Step-1.5` (confirmed canonical org via `gh api`). License: MIT.
- Checkpoints — **verified 2026-09-15 live against the Hugging Face API** (`huggingface.co/api/models?author=ACE-Step`), all public/ungated: `acestep-v15-base` (2B, 50-step, pre-train only), `acestep-v15-sft` (2B, 50-step, SFT), `acestep-v15-turbo` (2B, 8-step — **its actual HF repo is named `ACE-Step/Ace-Step1.5`**, not `acestep-v15-turbo`, confirmed correct via the README's own Model Zoo table, not a typo), `acestep-v15-xl-base`/`acestep-v15-xl-sft`/`acestep-v15-xl-turbo` (4B, same pre-train/SFT/turbo split, 12–24GB). Optional LM prompt-expansion front-ends: only `acestep-5Hz-lm-0.6B` and `acestep-5Hz-lm-4B` are confirmed as real HF repos — no separate 1.7B repo was found despite being referenced in the README's GPU table, so it's dropped from the catalog rather than guessed. See `scripts/download_models.py` for the exact repo IDs.
- Inputs: text prompt (50+ languages), structured lyrics, reference audio (style/cover), duration (10–600s), BPM, key/scale, time signature, genre tags, 1000+ instrument/timbre tags.
- Outputs: rendered song audio — **format resolved (Phase 8)**: the real REST API's `audio_format` request parameter supports `flac`/`mp3`/`opus`/`aac`/`wav`/`wav32` and defaults to `mp3`; verified real by generating and downloading an actual file with `audio_format: "wav"` — a valid RIFF/WAVE, 16-bit PCM, stereo, 48000Hz file, non-silent (99.97% non-zero samples in the first 100k-sample window). 10s–10min, batch up to 8. See `servers/ace-step-1.5/README.md`.
- Hardware: 4GB VRAM min (2B turbo) up to 24GB (XL). Backends: CUDA, ROCm, Apple MLX, Intel XPU, CPU (slow). Batch, not realtime.
- Python: 3.11–3.12, **PyTorch pin resolved (Phase 8)**: `torch==2.10.0+cu128`, `torchvision==0.25.0+cu128`, `torchaudio==2.10.0+cu128`, `transformers==4.57.6` (Linux x86_64 — see the real repo's own `pyproject.toml`, installed via `uv sync` and verified from a real venv build), env via `uv`. Also ships its own real REST API server (`acestep.api_server`, run as-is by this app rather than reimplemented — see `servers/ace-step-1.5/README.md`) and a VST3 — its own local-server pattern lines up well with our architecture, confirmed correct to use directly rather than writing a third hand-rolled wrapper.

### YuE2
- Repo: `github.com/multimodal-art-projection/YuE` (hosts YuE2). Weights: `m-a-p/YuE2-3B`, `m-a-p/YuE2-Vae`.
- License: code Apache 2.0; **weights CC-BY-NC 4.0 — non-commercial only, badge prominently.**
- Checkpoints: YuE2-3B (semantic→acoustic engine), YuE2-Vae (decoder), YuE2-Vae-legacy (**confirmed 2026-09-15 as its own separate HF repo `m-a-p/YuE2-Vae-legacy`**, not a revision of YuE2-Vae), plus companion analysis models SheetSage2 (transcription→ABC/MIDI/chords) and MERT-v2-FullSong/30s (feature encoders).
- Inputs: lyrics text, style/genre spec, optional reference audio (WAV/MP3) for cover/transcription, `max_seconds` duration cap.
- Outputs: **dual** — stereo audio (via YuE2-Vae) **and** symbolic (ABC notation, MIDI, LAB beat/key/chord/structure annotations). Needs both viewer types mounted at once.
- Hardware: 24GB+ NVIDIA VRAM (BF16), Linux, batch only — heaviest model in the catalog.
- Python: **pinned and mutually incompatible across its own sub-components** — PyTorch 2.10.0 + Transformers 4.57.6 for YuE2 itself (confirmed Phase 8 directly from the real repo's `pyproject.toml`: `torch==2.10.0`, `transformers==4.57.6`, `requires-python = ">=3.10"`), but Transformers 4.45.2 for SheetSage2 and 4.53.2 for MERT. This single model may need *multiple* isolated venvs internally, not just one. **Confirmed Phase 8**: SheetSage2/MERT are only imported by the repo's "Cover a song" transcription workflow (`docs/covers.md`) — the core lyrics+style→song generation path (`YuE2Pipeline.from_pretrained("m-a-p/YuE2-3B", ...)`, `examples/generate.py`) never imports either, confirmed by reading the real README's Quick Start section and `src/yue2/pipeline.py` directly, not assumed. Basic generation only needs the `yue2-3b`/`yue2-vae` venv.

### MusicGen (Meta AudioCraft)
- Repo: `github.com/facebookresearch/audiocraft`. License: code MIT; **weights CC-BY-NC 4.0 — non-commercial only.**
- Checkpoints: small (300M), medium (1.5B), large (3.3B), melody (1.5B, melody-conditioned), style (1.5B).
- Inputs: text prompt; melody variant also takes reference audio (chromagram conditioning); duration set via API param, no hard UI cap documented — we'll impose a sane UI max.
- Outputs: WAV, 32kHz (EnCodec, 4 codebooks @ 50Hz), loudness-normalized to -14 LUFS.
- Hardware: GPU required; ~16GB VRAM comfortable for medium, small runs on lighter GPUs. Batch, not realtime.
- Python: PyTorch + CUDA, `torchaudio`, `transformers` 4.31+, `audiocraft` package (bundles EnCodec).
- **Recommended pilot/first integration** — simplest single-output-modality model, best documentation, proves the whole adapter pipeline end to end before tackling symbolic or dual-output models.

### MuseCoco
- Repo: `github.com/microsoft/muzic` (subfolder `/musecoco`). License: repo-level MIT, but **NEEDS VERIFICATION** on Hugging Face checkpoint terms before assuming full commercial clearance — Microsoft research releases sometimes carry checkpoint-level restrictions not stated at repo root.
- Checkpoints: two-stage pipeline (text→attribute understanding, then attribute→music generator), released June 2023. The stage-2 attribute-to-music generator — the actual music generation checkpoint — is **confirmed 2026-09-15** at `XinXuNLPer/MuseCoco_attribute2music` (public, ungated, linked directly from the musecoco subfolder README). The stage-1 text-to-attribute model's checkpoint is not separately published, so real inference (Phase 7) only ever consumes the structured-attribute inputs — free text is UI-only. **Param count corrected in Phase 7**: the real downloaded checkpoint (`checkpoints/linear_mask-1billion/checkpoint_2_280000.pt`, ~14.5GB fp32 on disk) is a ~1B-parameter model, not the ~200M this doc originally estimated — the vendored repo's own directory name (`linear_mask-1billion`) says so directly, missed in the original catalog pass.
- Inputs: free text description **plus** structured attributes — instrument, genre, mood, tempo, key, time signature, bar count, rhythm/danceability, pitch range, artist style. Richest structured-input model in the catalog. **Phase 7 correction**: the real attribute vocabulary (reverse-engineered from the vendored inference code, not documented anywhere in the repo's README) is narrower/differently-shaped than assumed here in several places — key only distinguishes major/minor, pitch range means octaves spanned not register, mood is a 4-quadrant valence/arousal model not free text, artist style is a fixed 17-classical-composer list not free text. Full table in `servers/musecoco/README.md`.
- Outputs: **MIDI only** — no audio rendering. Needs the piano-roll/MIDI viewer, not a waveform player. **Phase 7**: real generation proven, verified with a real, valid, non-empty `.mid` file (confirmed via `mido`).
- Hardware: CPU-feasible given small model size (no VRAM figure published). **Phase 7**: confirmed CPU-only in practice on this machine (no system CUDA toolchain to build the model's compiled attention extension against), and genuinely functional there — slow (minutes per generation) but real, not a fallback that was merely read-reviewed.
- Python: 3.8, PyTorch 1.11.0, requires `g++` for native deps. Old, narrow pin — isolated via `uv`-managed Python 3.8 (no system python3.8, no sudo available) — see `servers/musecoco/README.md` for the exact working venv build and two additional hard-won pins (`pytorch-fast-transformers==0.4.0` CPU-only build, `miditoolkit==0.1.16` not the current 1.0.1) beyond what this doc's original pin note covered.

### Museformer
- Repo: `github.com/microsoft/muzic` (subfolder `/museformer`), project page `ai-muzic.github.io/museformer`. License: MIT.
- What it is: efficient Transformer (fine+coarse-grained attention) for long-form *symbolic* music generation — models local note detail and long-range structure together.
- Inputs: symbolic seed/conditioning (MIDI-derived token sequence), **not** a free-text prompt — UI here should be seed-selection/continuation controls, not a text box. This is the one model whose input UI looks meaningfully different from the rest.
- Outputs: MIDI (symbolic).
- Checkpoint: **confirmed 2026-09-15** — hosted on Microsoft OneDrive (linked directly from the museformer subfolder README, `checkpoints/mf-lmd6remi-1`), **not** Hugging Face. A plain scripted request to the share link 403s (needs a real browser session), so it can't be automated the way the other models can — see `scripts/download_models.py`.
- Hardware/Python: Python 3.8, `fairseq==0.10.2` (same era/pin as MuseCoco) confirmed from the real vendored code in Phase 7, but **real inference was not verified end-to-end** — the decoder's custom kernels (`museformer/kernels/*` have a real CPU fallback; `museformer/blocksparse/*` is Triton-only with no CPU path, and whether it's on the default inference hot path is unconfirmed) are a genuine, undetermined risk, not just an untried formality. See `servers/museformer/README.md` for the full risk writeup and what's needed to actually verify this.

### RAVE (IRCAM/ACIDS)
- Repo: `github.com/acids-ircam/RAVE`, pip package `acids-rave`. License: **CC-BY-NC-SA 4.0 for both code and weights** — strictest tier in the catalog (non-commercial, share-alike derivatives). Badge this clearly.
- What it is: a timbre-transfer/neural-resynthesis autoencoder, **not** a from-scratch composer. Both input and output are raw audio waveforms — no text or symbolic input at all. Requires a model pretrained/fine-tuned per target timbre/instrument, so the UI needs a "select trained timbre model" control instead of a prompt box.
- Realtime: yes — `rave export --streaming` (cached convolutions), ships as VST (Win/Mac/Linux beta) and Max/PureData `nn~` external, or CLI batch mode. This is the one catalog entry suited to a **realtime** interaction tier, architecturally distinct from every other (batch-generation) model — plan its UI and its server lifecycle separately.
- Pretrained example timbre models: listed at `acids-ircam.github.io/rave_models_download` — **confirmed 2026-09-15** that page's model table is JS-rendered client-side (empty when fetched as static HTML), so it can't be scraped/automated; a human needs to open it in a browser.
- Hardware: training 5–32GB VRAM depending on config; inference/streaming much lighter, CPU-feasible for small models in realtime form.
- Python: PyTorch + torchaudio (no longer strictly version-pinned), FFmpeg required on the host.

### MusicAgent — excluded from the catalog
- Repo: `github.com/microsoft/muzic` (subfolder `/musicagent`), MIT.
- It's an LLM-orchestrated agent (plan → select tool → execute → respond) that wraps *other* HF/GitHub/Web-API music tools. No generation weights of its own, no fixed input/output schema to render a UI from — doesn't fit the adapter model.
- Confirmed correct to leave out of the model list per [01-overview.md](01-overview.md). Worth revisiting later purely as design inspiration for a possible cross-model "auto-compose" feature, not as a catalog entry.

---

## Integration order rationale (feeds the roadmap)

1. **MusicGen** first — single output modality (audio only), well-documented, moderate hardware — proves the adapter framework, the audio player/export UI, and the model-server lifecycle with the least risk.
2. **MuseCoco**, then **Museformer** — introduce the MIDI/piano-roll viewer and the "no audio output" case; Museformer additionally introduces the non-text-prompt input pattern.
3. **ACE-Step 1.5** — reintroduces audio output but with a much larger input surface (lyrics, BPM/key, tags, reference audio) and higher hardware tiers to gate in the UI.
4. **YuE2** last among generators — heaviest hardware requirement, dual audio+symbolic output, and the most complex internal venv isolation (multiple incompatible sub-component environments).
5. **RAVE** on its own track whenever convenient — architecturally separate (realtime, audio-to-audio, no prompt), doesn't block or get blocked by the others.

---

## Model distribution (developer download + Cloudflare re-hosting)

To avoid requiring end users to have a Hugging Face account or token just
to use Kwesi, model weights are pulled down **once** by the developer and
re-hosted on infrastructure we control:

1. The developer runs `scripts/download_models.py` (Python, `huggingface_hub`'s
   `snapshot_download`) directly in a terminal — this is a developer-only
   utility, not part of the Electron app and never invoked by end users.
   It populates a local, gitignored `models/<model_id>/<variant_name>/`
   folder at the repo root.
2. That local `models/` folder is then re-uploaded, in full, to Cloudflare
   R2 (object storage) for redistribution.
3. In a later phase, the in-app **Model Manager** (Phase 3) will download
   weights from Cloudflare-hosted URLs instead of Hugging Face directly —
   so end users never need a Hugging Face account or token. This doc's
   distribution plan and the in-app download logic are intentionally
   decoupled: the script above only stages files locally for the developer
   and does not touch Cloudflare or the app's own download code at all.

Per the `MODELS` config in `scripts/download_models.py`, **verified live
against the Hugging Face API and each project's own README on
2026-09-15** (not guessed):

- **Confirmed, downloadable now via Hugging Face (16 variants):**
  - MusicGen — all five checkpoints (`musicgen-small`, `musicgen-medium`,
    `musicgen-large`, `musicgen-melody`, `musicgen-style`) from the
    `facebook` org.
  - YuE2 — all three: `yue2-3b` (`m-a-p/YuE2-3B`), `yue2-vae`
    (`m-a-p/YuE2-Vae`), and `yue2-vae-legacy` (`m-a-p/YuE2-Vae-legacy`,
    confirmed to be its own separate repo, not a revision).
  - ACE-Step 1.5 — all eight: `acestep-v15-base`, `acestep-v15-sft`,
    `acestep-v15-turbo` (real repo name is `ACE-Step/Ace-Step1.5` — this is
    correct, not a typo, confirmed via the README's own Model Zoo table),
    `acestep-v15-xl-base`, `acestep-v15-xl-sft`, `acestep-v15-xl-turbo`,
    and the `acestep-5Hz-lm-0.6B`/`4B` prompt-expansion front-ends (no
    1.7B repo exists despite being referenced in the README's GPU table).
  - MuseCoco — the stage-2 attribute-to-music generator at
    `XinXuNLPer/MuseCoco_attribute2music`.
- **Genuinely not automatable (real location confirmed, but not
  scriptable) — the script prints a skip message pointing at the actual
  place to go, not a guess:**
  - Museformer — hosted on Microsoft OneDrive
    (`1drv.ms/u/s!Aq3YEPZCcV5ibz9ySjjNsEB74CQ`, linked from the museformer
    subfolder README); a plain scripted request to it 403s, so it needs a
    real browser session.
  - RAVE — pretrained example timbre models are listed at
    `acids-ircam.github.io/rave_models_download`, whose model table is
    JS-rendered client-side (empty when fetched as static HTML) and so
    can't be scraped either; also, RAVE's native workflow is
    training/fine-tuning per timbre rather than downloading a single
    generic checkpoint (see "Training pipeline architecture" in
    [02-architecture.md](02-architecture.md)).
