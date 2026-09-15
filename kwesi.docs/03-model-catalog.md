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
| ACE-Step 1.5 | Likely (**NEEDS VERIFICATION**) | LoRA fine-tune | Audio + lyrics/tags |
| MuseCoco | Yes | Full fine-tune | MIDI |
| Museformer | Yes | Full fine-tune | MIDI |
| YuE2 | **No, not in v1** | — | — already needs 24GB+ VRAM just for inference; training would need substantially more than is realistic on consumer desktop hardware. Manifest sets `training.supported: false` with that reason shown in the UI. |

---

### ACE-Step 1.5
- Repo: `github.com/ace-step/ACE-Step-1.5`. License: MIT (verify canonical org before bundling — similarly-named forks exist).
- Checkpoints: `acestep-v15-turbo` (2B, 8-step, 4GB+ VRAM), `acestep-v15-sft` (2B, 50-step, 6–8GB), `acestep-v15-xl-*` (4B, 12–24GB). Optional 0.6B/1.7B/4B "5Hz-lm" prompt-expansion front-ends.
- Inputs: text prompt (50+ languages), structured lyrics, reference audio (style/cover), duration (10–600s), BPM, key/scale, time signature, genre tags, 1000+ instrument/timbre tags.
- Outputs: rendered song audio — **format NEEDS VERIFICATION** (likely WAV/FLAC), 10s–10min, batch up to 8.
- Hardware: 4GB VRAM min (2B turbo) up to 24GB (XL). Backends: CUDA, ROCm, Apple MLX, Intel XPU, CPU (slow). Batch, not realtime.
- Python: 3.11–3.12, PyTorch (pin **NEEDS VERIFICATION**), env via `uv`. Also ships its own REST API and a VST3 — its own local-server pattern lines up well with our architecture.

### YuE2
- Repo: `github.com/multimodal-art-projection/YuE` (hosts YuE2). Weights: `m-a-p/YuE2-3B`, `m-a-p/YuE2-Vae`.
- License: code Apache 2.0; **weights CC-BY-NC 4.0 — non-commercial only, badge prominently.**
- Checkpoints: YuE2-3B (semantic→acoustic engine), YuE2-Vae (decoder), YuE2-Vae-legacy, plus companion analysis models SheetSage2 (transcription→ABC/MIDI/chords) and MERT-v2-FullSong/30s (feature encoders).
- Inputs: lyrics text, style/genre spec, optional reference audio (WAV/MP3) for cover/transcription, `max_seconds` duration cap.
- Outputs: **dual** — stereo audio (via YuE2-Vae) **and** symbolic (ABC notation, MIDI, LAB beat/key/chord/structure annotations). Needs both viewer types mounted at once.
- Hardware: 24GB+ NVIDIA VRAM (BF16), Linux, batch only — heaviest model in the catalog.
- Python: **pinned and mutually incompatible across its own sub-components** — PyTorch 2.10.0 + Transformers 4.57.6 for YuE2 itself, but Transformers 4.45.2 for SheetSage2 and 4.53.2 for MERT. This single model may need *multiple* isolated venvs internally, not just one.

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
- Checkpoints: two-stage pipeline (text→attribute understanding, ~then attribute→music generator), ~200M params, released June 2023.
- Inputs: free text description **plus** structured attributes — instrument, genre, mood, tempo, key, time signature, bar count, rhythm/danceability, pitch range, artist style. Richest structured-input model in the catalog; the dynamic form here will have the most fields.
- Outputs: **MIDI only** — no audio rendering. Needs the piano-roll/MIDI viewer, not a waveform player.
- Hardware: CPU-feasible given small model size (no VRAM figure published, but ~200M is light).
- Python: 3.8, PyTorch 1.11.0, requires `g++` for native deps. Old, narrow pin — isolate hard.

### Museformer
- Repo: `github.com/microsoft/muzic` (subfolder `/museformer`), project page `ai-muzic.github.io/museformer`. License: MIT.
- What it is: efficient Transformer (fine+coarse-grained attention) for long-form *symbolic* music generation — models local note detail and long-range structure together.
- Inputs: symbolic seed/conditioning (MIDI-derived token sequence), **not** a free-text prompt — UI here should be seed-selection/continuation controls, not a text box. This is the one model whose input UI looks meaningfully different from the rest.
- Outputs: MIDI (symbolic).
- Hardware/Python: **NEEDS VERIFICATION** directly from the subfolder's `requirements.txt` at integration time — treat as similarly old/narrow-pinned as MuseCoco until confirmed.

### RAVE (IRCAM/ACIDS)
- Repo: `github.com/acids-ircam/RAVE`, pip package `acids-rave`. License: **CC-BY-NC-SA 4.0 for both code and weights** — strictest tier in the catalog (non-commercial, share-alike derivatives). Badge this clearly.
- What it is: a timbre-transfer/neural-resynthesis autoencoder, **not** a from-scratch composer. Both input and output are raw audio waveforms — no text or symbolic input at all. Requires a model pretrained/fine-tuned per target timbre/instrument, so the UI needs a "select trained timbre model" control instead of a prompt box.
- Realtime: yes — `rave export --streaming` (cached convolutions), ships as VST (Win/Mac/Linux beta) and Max/PureData `nn~` external, or CLI batch mode. This is the one catalog entry suited to a **realtime** interaction tier, architecturally distinct from every other (batch-generation) model — plan its UI and its server lifecycle separately.
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
