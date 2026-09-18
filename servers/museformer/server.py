import argparse
import logging
import os
import re
import subprocess
import sys
import time

VENDOR_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "vendor")
# Museformer's own repo doesn't vendor a MIDI decoder -- its README points at
# a separate `MidiProcessor` package (github.com/btyu/MidiProcessor) using
# the same REMIGEN2 scheme MuseCoco's vendored copy already implements and
# was proven working against in Phase 7. Reusing that copy rather than
# re-vendoring a third copy of the same tool -- see README.md.
_MUSECOCO_MIDIPROCESSOR = os.path.join(
    os.path.dirname(VENDOR_ROOT), "..", "musecoco", "vendor", "2-attribute2music_model"
)
sys.path.insert(0, os.path.abspath(_MUSECOCO_MIDIPROCESSOR))

logging.basicConfig(level=logging.INFO, format="[museformer-server] %(message)s")
log = logging.getLogger("museformer")

from fastapi import FastAPI, HTTPException  # noqa: E402
from pydantic import BaseModel  # noqa: E402

app = FastAPI()

DATA_BIN = os.path.join(VENDOR_ROOT, "data-bin")
DICT_SRC = os.path.join(VENDOR_ROOT, "data", "meta", "dict.txt")


def models_dir() -> str:
    return os.environ.get("KWESI_MODELS_DIR", os.path.join(os.path.expanduser("~"), "kwesi-models"))


def checkpoint_path() -> str:
    override = os.environ.get("KWESI_MUSEFORMER_CHECKPOINT")
    if override:
        return override
    return os.path.join(models_dir(), "museformer", "default", "checkpoint_best.pt")


def ensure_data_bin():
    os.makedirs(DATA_BIN, exist_ok=True)
    dst = os.path.join(DATA_BIN, "dict.txt")
    if not os.path.isfile(dst) and os.path.isfile(DICT_SRC):
        import shutil

        shutil.copyfile(DICT_SRC, dst)


_dict_vocab = None


def _dict_vocab_tokens() -> set:
    global _dict_vocab
    if _dict_vocab is None:
        _dict_vocab = set()
        if os.path.isfile(DICT_SRC):
            with open(DICT_SRC) as f:
                for line in f:
                    line = line.strip()
                    if line:
                        _dict_vocab.add(line.split(" ")[0])
    return _dict_vocab


# How many real primer tokens (from the user's seed MIDI) to feed the model
# before it takes over -- real REMIGEN2 tokens run several per note (pos/
# instrument/pitch/duration/velocity), so this is roughly the first 10-15
# notes, not 256 notes. Kept intentionally small: enough for the model to
# pick up melody/register/instrumentation (proven live -- see README.md
# "Status"), while leaving most of the real generated-token budget for the
# model's own continuation rather than the primer itself.
SEED_PRIMER_MAX_TOKENS = 256


def build_seed_primer(seed_midi_path: str) -> str:
    from midiprocessor import MidiEncoder
    from midiprocessor.enc_remigen2_utils import convert_remigen_token_list_to_token_str_list

    encoder = MidiEncoder("REMIGEN2")
    token_lists = encoder.encode_file(seed_midi_path)
    if not token_lists or not token_lists[0]:
        raise HTTPException(status_code=400, detail="Seed MIDI file has no notes MidiEncoder could read.")

    token_strs = convert_remigen_token_list_to_token_str_list(token_lists[0])
    # Real REMIGEN2 encoding can emit token types this checkpoint's own
    # dict.txt doesn't have (e.g. "s-*" section markers -- confirmed live,
    # not every token type this encoder can produce was in this model's
    # training vocabulary). Dropping unsupported ones rather than crashing
    # fairseq-interactive on an OOV token -- see README.md "Status".
    vocab = _dict_vocab_tokens()
    filtered = [t for t in token_strs if t in vocab]
    dropped = len(token_strs) - len(filtered)
    if dropped:
        log.info(f"seed primer: dropped {dropped} token(s) not in this checkpoint's vocabulary")
    if not filtered:
        raise HTTPException(status_code=400, detail="Seed MIDI encoded to no tokens this checkpoint's vocabulary supports.")

    return " ".join(filtered[:SEED_PRIMER_MAX_TOKENS])


class GenerateRequest(BaseModel):
    input_params: dict
    output_path: str
    min_generated_tokens: int = 512
    max_generated_tokens: int = 2048


class GenerateResponse(BaseModel):
    output_path: str
    duration_ms: int


@app.get("/health")
def health():
    return {"status": "ok", "checkpoint_found": os.path.isfile(checkpoint_path())}


@app.post("/generate", response_model=GenerateResponse)
def generate(req: GenerateRequest):
    """
    Verified real end-to-end, both unconditional and MIDI-primed (see
    README.md "Status") -- shells out to the real `fairseq-interactive` CLI
    (the vendored repo's own documented inference path, see
    tgen/generation__mf-lmd6remi-x.sh) rather than reimplementing the
    generation loop by hand the way servers/musecoco/server.py does, since
    Museformer's task/generator are designed to work with the stock fairseq
    CLI via --user-dir.
    """
    if not os.path.isfile(checkpoint_path()):
        raise HTTPException(status_code=404, detail=f"No checkpoint at {checkpoint_path()}")
    ensure_data_bin()

    seed_mode = req.input_params.get("seed_mode", "random")
    seed_midi = req.input_params.get("seed_midi")
    seed_primer = ""
    if seed_mode == "continue_from_midi":
        if not (isinstance(seed_midi, str) and os.path.isabs(seed_midi) and os.path.isfile(seed_midi)):
            raise HTTPException(
                status_code=400,
                detail="seed_mode is 'continue_from_midi' but seed_midi is not a real file path on disk.",
            )
        # Real MIDI -> REMIGEN2 token encoding via the same reused
        # midiprocessor copy /generate's decode step already depends on --
        # verified live to produce a genuine, checkpoint-recognized primer
        # the model actually continues from (not just a blank-equivalent
        # prefix) -- see README.md "Status" for the exact test.
        seed_primer = build_seed_primer(seed_midi)

    min_len = max(64, req.min_generated_tokens)
    max_len_b = max(min_len + 64, req.max_generated_tokens)

    # _run_interactive.py (not "-m fairseq_cli.interactive" directly) --
    # real checkpoints ship with attention_impl='blocksparse', whose Triton
    # kernels have no CPU backend at all (confirmed: --cpu hard-fails with
    # "Pointer argument cannot be accessed from Triton"), so this must run
    # on GPU. Two other vendored kernels (range_fill, block_fill) then hit a
    # *different* real gap on GPU -- they JIT-compile a CUDA extension via
    # nvcc, which a plain pip/uv install doesn't have (the modern
    # nvidia-cuda-nvcc-cu12 wheel no longer even ships an nvcc binary).
    # _run_interactive.py patches those to their existing plain-PyTorch
    # fallback before generation starts. See its own docstring and
    # README.md "Status" for the full, GPU-verified story.
    cmd = [
        sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), "_run_interactive.py"),
        DATA_BIN,
        "--path", checkpoint_path(),
        # fairseq's --user-dir imports the given directory itself as a
        # package by its own basename (see fairseq.utils.import_user_module)
        # -- it needs to land on the "museformer" package (whose __init__.py
        # runs the @register_task/@register_model decorators), not its
        # "vendor" parent, which has no __init__.py and so silently imports
        # as an empty namespace package, registering nothing.
        "--user-dir", os.path.join(VENDOR_ROOT, "museformer"),
        "--task", "museformer_language_modeling",
        "--sampling", "--sampling-topk", "8",
        "--beam", "1", "--nbest", "1",
        "--min-len", str(min_len),
        "--max-len-b", str(max_len_b),
        "--buffer-size", "1",
    ]
    log.info(f"seed_mode={seed_mode} primer_tokens={len(seed_primer.split()) if seed_primer else 0}; running: {' '.join(cmd)}")

    t0 = time.time()
    proc = subprocess.run(
        cmd,
        # A real primer here (seed_mode="continue_from_midi") is fed as the
        # fairseq-interactive input line itself -- that's what makes it a
        # real primer/prefix the decoder continues from, not just a prompt
        # string; a blank line is real unconditional generation.
        input=(seed_primer + "\n") if seed_primer else "\n",
        capture_output=True,
        text=True,
        timeout=1800,
    )
    elapsed_ms = int((time.time() - t0) * 1000)
    if proc.returncode != 0:
        raise HTTPException(status_code=500, detail=f"fairseq-interactive exited {proc.returncode}: {proc.stderr[-4000:]}")

    matches = re.findall(r"^D-\d+\t\S+\t(.+)$", proc.stdout, re.MULTILINE)
    if not matches:
        raise HTTPException(status_code=500, detail=f"No hypothesis line found in fairseq-interactive output:\n{proc.stdout[-4000:]}")

    remi_tokens = matches[0].strip().split(" ")

    from midiprocessor import MidiDecoder

    os.makedirs(os.path.dirname(req.output_path), exist_ok=True)
    midi_decoder = MidiDecoder("REMIGEN2")
    midi_obj = midi_decoder.decode_from_token_str_list(remi_tokens)
    midi_obj.dump(req.output_path)

    log.info(f"generated {len(remi_tokens)} tokens in {elapsed_ms}ms -> {req.output_path}")
    return GenerateResponse(output_path=req.output_path, duration_ms=elapsed_ms)


if __name__ == "__main__":
    import uvicorn

    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--host", type=str, default="127.0.0.1")
    args = parser.parse_args()

    log.info(f"starting on {args.host}:{args.port}, checkpoint={checkpoint_path()}")
    sys.stdout.flush()
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")
