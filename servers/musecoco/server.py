import argparse
import logging
import os
import sys
import time

VENDOR_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "vendor", "2-attribute2music_model")
LINEAR_MASK_DIR = os.path.join(VENDOR_ROOT, "linear_mask")

os.chdir(LINEAR_MASK_DIR)
sys.path.insert(0, ".")
sys.path.insert(0, "..")

import numpy as np
import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="[musecoco-server] %(message)s")
log = logging.getLogger("musecoco")

from fairseq import checkpoint_utils, tasks, utils, options  # noqa: E402
from fairseq_cli.generate import get_symbols_to_strip_from_output  # noqa: E402

import A2M_task_new  # noqa: E402,F401  registers the "language_modeling_control" fairseq task
from linear import transformer_lm  # noqa: E402,F401  registers the "linear_mask" model architecture
from midiprocessor import MidiDecoder  # noqa: E402

app = FastAPI()

# The real attention kernel (fast_transformers.causal_product) needs a CUDA
# extension compiled with nvcc at pip-install time. Originally always "cpu"
# here since this dev machine had no system CUDA toolkit to build that
# extension against -- see servers/musecoco/README.md's "Why this runs on
# CPU" section for the full story (now historical: a conda-provided nvcc +
# matching cudart, verified by actually compiling and running a CUDA kernel
# on this box's RTX 3090, produced a real, numerically-verified CUDA build
# of pytorch-fast-transformers). Detects for real now rather than hardcoding
# either way, so this keeps working on a machine without a CUDA build too.
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
if DEVICE == "cuda":
    log.info("Running on CUDA.")
else:
    log.warning("Running on CPU -- the fast_transformers CUDA extension needs a system nvcc this box doesn't have.")

_DATA_BIN = os.path.join(VENDOR_ROOT, "data", "truncated_2560", "data-bin")
_CHECKPOINT = os.path.join(VENDOR_ROOT, "checkpoints", "linear_mask-1billion", "checkpoint_2_280000.pt")

_state = {}


def checkpoint_path() -> str:
    override = os.environ.get("KWESI_MUSECOCO_CHECKPOINT")
    return override if override else _CHECKPOINT


def load_state():
    if _state:
        return _state

    if not os.path.isfile(checkpoint_path()):
        raise HTTPException(status_code=404, detail=f"No checkpoint at {checkpoint_path()}")

    torch.manual_seed(2024)
    np.random.seed(2024)

    argv = [
        _DATA_BIN,
        "--task", "language_modeling_control",
        "--path", checkpoint_path(),
        "--max-len-b", "600",
        "--min-len", "1",
        "--sampling",
        "--beam", "1",
        "--sampling-topk", "15",
        "--temperature", "1.0",
        "--no-repeat-ngram-size", "0",
        "--buffer-size", "1",
        "--batch-size", "1",
    ]
    if DEVICE == "cpu":
        argv.append("--cpu")
    sys.argv = ["musecoco-server"] + argv
    parser = options.get_interactive_generation_parser()
    parser.add_argument("--save_root", type=str, default="/tmp")
    parser.add_argument("--need_num", type=int, default=1)
    parser.add_argument("--ctrl_command_path", type=str, default="")
    parser.add_argument("--start", type=int, default=None)
    parser.add_argument("--end", type=int, default=None)
    parser.add_argument("--use_gold_labels", type=int, default=0)
    args = options.parse_args_and_arch(parser)

    log.info(f"loading task/model from {checkpoint_path()} (this reads a ~14.5GB checkpoint)")
    t0 = time.time()
    task = tasks.setup_task(args)
    models, _model_args = checkpoint_utils.load_model_ensemble(
        args.path.split(os.pathsep),
        arg_overrides=eval(args.model_overrides),
        task=task,
        suffix=getattr(args, "checkpoint_suffix", ""),
        strict=(args.checkpoint_shard_count == 1),
        num_shards=args.checkpoint_shard_count,
    )
    for model in models:
        model.prepare_for_inference_(args)
        model.decoder.args.is_inference = True
        # Real bug: dropping --cpu from argv above only stops fairseq's own
        # CLI plumbing from forcing CPU -- it never itself moves a model
        # loaded via checkpoint_utils.load_model_ensemble onto the GPU.
        # fairseq_cli/generate.py's own reference driver does this
        # explicitly (`if use_cuda: model.cuda()`); this server needs the
        # same explicit call, or "cuda" here is just a label with no effect
        # -- confirmed for real: without this, a request ran for 12+ minutes
        # with zero GPU compute usage, identical to the old CPU-only timing.
        if DEVICE == "cuda":
            model.cuda()
    log.info(f"loaded in {time.time() - t0:.1f}s")

    _state["args"] = args
    _state["task"] = task
    _state["models"] = models
    _state["generator"] = task.build_generator(models, args)
    _state["midi_decoder"] = MidiDecoder("REMIGEN2")
    return _state


# --- Real MuseCoco attribute vocabulary --------------------------------------
# Reverse-engineered from servers/musecoco/vendor/2-attribute2music_model/
# midi_data_extractor/attribute_unit/*.py and 1-text2attribute_model/
# att_key.json -- see servers/musecoco/README.md and the comment block above
# MUSECOCO in src/data/manifests.ts for the full trace. key_order and the
# NA index per key match A2M_task_new.py's CommandDataset.key_order exactly;
# I1s2 (instrument) and S4 (genre) are multi-hot, one token per category
# slot, everything else is a single class-id token.
KEY_ORDER = [
    "I1s2", "I4", "C1", "R1", "R3", "S2s1", "S4", "B1s1", "TS1s1", "K1",
    "T1s1", "P4", "ST1", "EM1", "TM1",
]
I1S2_CATEGORIES = [
    "piano", "keyboard", "percussion", "organ", "guitar", "bass", "violin",
    "viola", "cello", "harp", "strings", "voice", "trumpet", "trombone",
    "tuba", "horn", "brass", "sax", "oboe", "bassoon", "clarinet",
    "piccolo", "flute", "pipe", "synthesizer", "ethnic_instruments",
    "sound_effects", "drum",
]
S4_CATEGORIES = [
    "new_age", "electronic", "rap", "religious", "international",
    "easy_listening", "avant_garde", "rnb", "latin", "children", "jazz",
    "classical", "comedy_spoken", "pop_rock", "reggae", "stage", "folk",
    "blues", "vocal", "holiday", "country", "symphony",
]
TIME_SIGNATURES = [(4, 4), (2, 4), (3, 4), (1, 4), (6, 8), (3, 8)]
ARTIST_TO_ID = {
    "beethoven": 0, "mozart": 1, "chopin": 2, "schubert": 3, "schumann": 4,
    "bach-js": 5, "haydn": 6, "brahms": 7, "handel": 8, "tchaikovsky": 9,
    "mendelssohn": 10, "dvorak": 11, "liszt": 12, "stravinsky": 13,
    "mahler": 14, "prokofiev": 15, "shostakovich": 16,
}
PITCH_RANGE_TO_OCTAVES = {"narrow": 1, "medium": 4, "wide": 7, "full": 10}


def tempo_bucket(bpm):
    if bpm is None:
        return 3  # NA
    if bpm >= 120:
        return 2  # fast
    if bpm <= 76:
        return 0  # slow
    return 1  # moderate


def bar_bucket(bar_count):
    if bar_count is None:
        return 4  # NA
    n = max(1, min(16, int(bar_count)))
    return (n - 1) // 4  # 0: 1-4, 1: 5-8, 2: 9-12, 3: 13-16


def match_categories(tags, vocabulary):
    if not tags:
        return set()
    lowered = {str(t).strip().lower().replace(" ", "_") for t in tags}
    matched = {c for c in vocabulary if c in lowered}
    unmatched = lowered - matched
    if unmatched:
        log.warning(f"unmatched tags dropped (no real attribute category): {sorted(unmatched)}")
    return {vocabulary.index(c) for c in matched}


def build_attribute_tokens(params: dict) -> list:
    tokens = []

    instrument_idxs = match_categories(params.get("instrument"), I1S2_CATEGORIES)
    for slot in range(len(I1S2_CATEGORIES)):
        tokens.append(f"I1s2_{slot}_{0 if slot in instrument_idxs else 2}")

    tokens.append("I4_28")
    tokens.append("C1_4")

    danceability = params.get("danceability", "unspecified")
    tokens.append("R1_" + {"yes": "0", "no": "1"}.get(danceability, "2"))
    tokens.append("R3_3")

    artist = str(params.get("artist_style") or "").strip().lower()
    tokens.append(f"S2s1_{ARTIST_TO_ID.get(artist, len(ARTIST_TO_ID))}")

    genre_idxs = match_categories(params.get("genre"), S4_CATEGORIES)
    for slot in range(len(S4_CATEGORIES)):
        tokens.append(f"S4_{slot}_{0 if slot in genre_idxs else 2}")

    tokens.append(f"B1s1_{bar_bucket(params.get('bar_count'))}")

    ts_raw = str(params.get("time_signature") or "").strip()
    ts_id = 7
    if "/" in ts_raw:
        try:
            num, den = (int(x) for x in ts_raw.split("/"))
            ts_id = TIME_SIGNATURES.index((num, den))
        except (ValueError, IndexError):
            ts_id = 6  # "other"
    tokens.append(f"TS1s1_{ts_id}")

    key_sig = params.get("key_signature", "unspecified")
    tokens.append("K1_" + {"major": "0", "minor": "1"}.get(key_sig, "2"))

    tokens.append(f"T1s1_{tempo_bucket(params.get('tempo_bpm'))}")

    pitch_range = params.get("pitch_range", "unspecified")
    octaves = PITCH_RANGE_TO_OCTAVES.get(pitch_range)
    tokens.append(f"P4_{octaves if octaves is not None else 12}")

    tokens.append("ST1_14")

    mood = params.get("mood", "unspecified")
    mood_idx = {"Q1": 0, "Q2": 1, "Q3": 2, "Q4": 3}.get(mood, 4)
    tokens.append(f"EM1_{mood_idx}")

    tokens.append("TM1_5")

    return tokens


class GenerateRequest(BaseModel):
    input_params: dict
    output_path: str
    min_generated_tokens: int = 250
    max_generated_tokens: int = 450


class GenerateResponse(BaseModel):
    output_path: str
    generated_token_count: int
    duration_ms: int


@app.get("/health")
def health():
    return {"status": "ok", "device": DEVICE, "loaded": bool(_state)}


@app.post("/generate", response_model=GenerateResponse)
def generate(req: GenerateRequest):
    state = load_state()
    task = state["task"]
    models = state["models"]
    generator = state["generator"]
    midi_decoder = state["midi_decoder"]

    attribute_tokens = build_attribute_tokens(req.input_params)
    src_str = " ".join(attribute_tokens) + " <sep>"
    src_dict = task.source_dictionary
    tgt_dict = task.target_dictionary

    encoded = src_dict.encode_line(src_str, add_if_not_exist=False).long()
    sep_pos_val = len(attribute_tokens)
    prefix_tokens = encoded[: sep_pos_val + 1].unsqueeze(0)

    sample = {
        "net_input": {
            "src_tokens": encoded.unsqueeze(0),
            "src_lengths": torch.LongTensor([encoded.numel()]),
            "sep_pos": np.array([sep_pos_val]),
        },
    }
    # Same reason models.cuda() was added in load_state(): moving the model
    # to the GPU does nothing for a request whose own input tensors stay on
    # CPU -- fairseq's own reference drivers (fairseq_cli/interactive.py)
    # move src_tokens/src_lengths and any prefix_tokens explicitly for
    # exactly this reason. sep_pos is a plain numpy array, not a tensor, and
    # doesn't need moving.
    if DEVICE == "cuda":
        sample["net_input"]["src_tokens"] = sample["net_input"]["src_tokens"].cuda()
        sample["net_input"]["src_lengths"] = sample["net_input"]["src_lengths"].cuda()
        prefix_tokens = prefix_tokens.cuda()

    # min_len/max_len_b are TOTAL sequence-length budgets counted from step 0,
    # which includes the forced attribute-prefix region (sep_pos_val + 1
    # tokens) -- see servers/musecoco/README.md's "why prefix_tokens is
    # required" section. Setting them smaller than the prefix length makes
    # the model stop with an empty/near-empty generation immediately after
    # echoing the prefix, since it was never trained to predict real content
    # unconditionally (the prefix positions are masked out of the training
    # loss). This was the actual bug behind Phase 7's first non-working
    # attempts, not a broken checkpoint or wrong vocabulary.
    generator.min_len = sep_pos_val + 1 + max(1, req.min_generated_tokens)
    generator.max_len_b = sep_pos_val + 1 + max(req.min_generated_tokens, req.max_generated_tokens)

    t0 = time.time()
    translations = task.inference_step(generator, models, sample, prefix_tokens=prefix_tokens)
    elapsed_ms = int((time.time() - t0) * 1000)

    hypo = translations[0][0]
    _, hypo_str, _ = utils.post_process_prediction(
        hypo_tokens=hypo["tokens"].int().cpu(),
        src_str=None,
        alignment=hypo.get("alignment"),
        align_dict=None,
        tgt_dict=tgt_dict,
        remove_bpe=None,
        extra_symbols_to_ignore=get_symbols_to_strip_from_output(generator),
    )
    all_tokens = hypo_str.split(" ")
    remi_tokens = all_tokens[sep_pos_val + 1:]
    if not remi_tokens:
        raise HTTPException(status_code=500, detail="Model produced no music tokens beyond the attribute prefix.")

    os.makedirs(os.path.dirname(req.output_path), exist_ok=True)
    midi_obj = midi_decoder.decode_from_token_str_list(remi_tokens)
    midi_obj.dump(req.output_path)

    log.info(f"generated {len(remi_tokens)} remi tokens in {elapsed_ms}ms -> {req.output_path}")
    return GenerateResponse(output_path=req.output_path, generated_token_count=len(remi_tokens), duration_ms=elapsed_ms)


if __name__ == "__main__":
    import uvicorn

    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--host", type=str, default="127.0.0.1")
    args = parser.parse_args()

    log.info(f"starting on {args.host}:{args.port}")
    sys.stdout.flush()
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")
