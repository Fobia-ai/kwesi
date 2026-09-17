import logging
import os
import sys
import time

import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="[yue2-server] %(message)s")
log = logging.getLogger("yue2")

app = FastAPI()

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
if DEVICE == "cuda":
    log.info("Running on CUDA.")
else:
    # servers/yue2/README.md's own real proof ran entirely on GPU (3-4GB
    # observed VRAM); the pipeline's own __init__ hard-requires CUDA BF16
    # support whenever device="cuda", but never checks in on a CPU device --
    # a CPU run isn't confirmed to work at all here, just not blocked
    # outright, consistent with every other real model's own device-detect
    # pattern in this app (see servers/musecoco/server.py).
    log.warning("Running without CUDA -- YuE2's real generation was only ever proven on GPU; this is unverified.")

_MODELS_DIR = os.environ.get("KWESI_MODELS_DIR")
if not _MODELS_DIR:
    raise RuntimeError("KWESI_MODELS_DIR is required")

_MODEL_PATH = os.path.join(_MODELS_DIR, "yue2", "yue2-3b")
# The manifest's vae_decoder field lets the user pick between these two
# real, separately-installable VAE checkpoints (src/data/manifests.ts).
_VAE_PATHS = {
    "yue2-vae": os.path.join(_MODELS_DIR, "yue2", "yue2-vae"),
    "yue2-vae-legacy": os.path.join(_MODELS_DIR, "yue2", "yue2-vae-legacy"),
}

# One loaded YuE2Pipeline per VAE choice, cached and kept resident for the
# life of this process -- same "load once, reuse across requests" precedent
# as every other real server here (see servers/musecoco/server.py's _state).
# Loading involves a real SHA-256 integrity check across the whole ~3B-param
# checkpoint (servers/yue2/README.md measured ~40s cold), so this matters
# more here than most. Two decoders loaded at once roughly doubles VRAM --
# acceptable given the real proof's own ~3-4GB single-decoder footprint on
# this app's target hardware (24GB+), and switching is rare in practice.
_pipelines = {}


def load_pipeline(vae_key: str):
    if vae_key not in _VAE_PATHS:
        raise HTTPException(status_code=400, detail=f"Unknown vae_decoder {vae_key!r}")
    if vae_key in _pipelines:
        return _pipelines[vae_key]

    vae_path = _VAE_PATHS[vae_key]
    if not os.path.isdir(_MODEL_PATH):
        raise HTTPException(status_code=404, detail=f"No checkpoint at {_MODEL_PATH}")
    if not os.path.isdir(vae_path):
        raise HTTPException(status_code=404, detail=f"No VAE checkpoint at {vae_path}")

    from yue2 import YuE2Pipeline

    log.info(f"loading YuE2 pipeline ({vae_key}) from {_MODEL_PATH} / {vae_path} (this verifies checkpoint integrity)")
    t0 = time.time()
    pipe = YuE2Pipeline.from_pretrained(_MODEL_PATH, vae=vae_path, device=DEVICE, progress=False)
    log.info(f"loaded in {time.time() - t0:.1f}s")
    _pipelines[vae_key] = pipe
    return pipe


class GenerateRequest(BaseModel):
    style: str
    lyrics: str
    vae_decoder: str = "yue2-vae"
    output_dir: str


class GenerateResponse(BaseModel):
    output_files: list
    duration_ms: int


@app.get("/health")
def health():
    return {"status": "ok", "device": DEVICE, "loaded_vae_decoders": list(_pipelines.keys())}


@app.post("/generate", response_model=GenerateResponse)
def generate(req: GenerateRequest):
    if not req.style.strip() or not req.lyrics.strip():
        raise HTTPException(status_code=400, detail="style and lyrics are both required")

    pipe = load_pipeline(req.vae_decoder)

    # SongRequest's own default seed (831001) is fixed -- reusing it for
    # every request would make identical text produce identical songs every
    # time. A fresh random seed per request is the sane default every other
    # real model in this app already has (via its own sampling/torch RNG
    # state, not fixed either).
    seed = int.from_bytes(os.urandom(4), "big")

    t0 = time.time()
    song = pipe(style=req.style, lyrics=req.lyrics, seed=seed)
    elapsed_ms = int((time.time() - t0) * 1000)

    os.makedirs(req.output_dir, exist_ok=True)
    song.save_artifacts(req.output_dir)
    # save_artifacts also writes semantic.npy/latent.npy/request.json/
    # config.json/result.json/plan.json/abc_tokens.npy/prefix.npy/
    # plan_manifest.json (real reproducibility artifacts, see pipeline.py) --
    # only the two this app's UI actually knows how to play/display are
    # surfaced as this generation's output_files.
    output_files = [
        os.path.join(req.output_dir, name)
        for name in ("audio.flac", "score.abc")
        if os.path.exists(os.path.join(req.output_dir, name))
    ]
    if not output_files:
        raise HTTPException(status_code=500, detail="Generation produced no audio.flac or score.abc")

    log.info(f"generated {song.audio.shape[0] / song.sample_rate:.1f}s of audio in {elapsed_ms}ms -> {req.output_dir}")
    return GenerateResponse(output_files=output_files, duration_ms=elapsed_ms)


if __name__ == "__main__":
    import argparse
    import uvicorn

    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--host", type=str, default="127.0.0.1")
    args = parser.parse_args()

    log.info(f"starting on {args.host}:{args.port}")
    sys.stdout.flush()
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")
