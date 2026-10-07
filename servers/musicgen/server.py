import argparse
import logging
import os
import sys
import time

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="[musicgen-server] %(message)s")
log = logging.getLogger("musicgen")

app = FastAPI()

_models: dict[str, "object"] = {}


def pick_device() -> str:
    """Where to run. KWESI_DEVICE=cpu (the app's "CPU only" setting) forces
    the CPU; otherwise an NVIDIA GPU, then Apple's GPU (Metal), then the CPU."""
    if os.environ.get("KWESI_DEVICE", "auto").strip().lower() == "cpu":
        return "cpu"
    if torch.cuda.is_available():
        return "cuda"
    mps = getattr(torch.backends, "mps", None)
    if mps is not None and mps.is_available():
        return "mps"
    return "cpu"


DEVICE = pick_device()
if DEVICE == "cpu":
    log.warning("Running on the CPU. MusicGen works there, but much more slowly than on a GPU.")
elif DEVICE == "mps":
    # Not proven on a real Mac from this repo: generate() falls back to the
    # CPU if anything fails on Metal.
    log.info("Running on Apple's GPU (Metal).")


def models_dir() -> str:
    return os.environ.get("KWESI_MODELS_DIR", os.path.join(os.path.expanduser("~"), "kwesi-models"))


def get_model(variant: str):
    if variant in _models:
        return _models[variant]

    from audiocraft.models import MusicGen

    checkpoint_dir = os.path.join(models_dir(), "musicgen", variant)
    if not os.path.isdir(checkpoint_dir):
        raise HTTPException(status_code=404, detail=f"No local checkpoint at {checkpoint_dir}")

    log.info(f"loading MusicGen variant '{variant}' from {checkpoint_dir} on {DEVICE}")
    t0 = time.time()
    model = MusicGen.get_pretrained(checkpoint_dir, device=DEVICE)
    log.info(f"loaded '{variant}' in {time.time() - t0:.1f}s")
    _models[variant] = model
    return model


class GenerateRequest(BaseModel):
    variant: str
    prompt: str
    duration_sec: float = 8.0
    melody_audio_path: str | None = None
    output_path: str


class GenerateResponse(BaseModel):
    output_path: str
    sample_rate: int
    duration_ms: int


@app.get("/health")
def health():
    return {"status": "ok", "device": DEVICE, "loaded_variants": list(_models.keys())}


def _generate_wav(req: GenerateRequest):
    model = get_model(req.variant)
    model.set_generation_params(duration=max(1.0, min(req.duration_sec, 30.0)))

    if req.melody_audio_path and os.path.isfile(req.melody_audio_path):
        import torchaudio

        melody_wav, melody_sr = torchaudio.load(req.melody_audio_path)
        wav = model.generate_with_chroma(
            [req.prompt], melody_wav[None].to(DEVICE), melody_sr, progress=False
        )
    elif req.melody_audio_path:
        log.warning(f"melody_audio_path '{req.melody_audio_path}' not found on disk — generating without it")
        wav = model.generate([req.prompt], progress=False)
    else:
        wav = model.generate([req.prompt], progress=False)
    return model, wav


@app.post("/generate", response_model=GenerateResponse)
def generate(req: GenerateRequest):
    global DEVICE
    from audiocraft.data.audio import audio_write

    t0 = time.time()
    try:
        model, wav = _generate_wav(req)
    except HTTPException:
        raise
    except Exception:
        # Metal doesn't implement every operation audiocraft uses. Rather
        # than fail the track, drop to the CPU for the rest of this process.
        if DEVICE != "mps":
            raise
        log.exception("generation failed on Apple's GPU (Metal) -- retrying on the CPU")
        _models.clear()
        DEVICE = "cpu"
        model, wav = _generate_wav(req)

    elapsed_ms = int((time.time() - t0) * 1000)

    os.makedirs(os.path.dirname(req.output_path), exist_ok=True)
    written = audio_write(
        req.output_path,
        wav[0].cpu(),
        model.sample_rate,
        strategy="loudness",
        loudness_compressor=True,
        add_suffix=False,
    )

    log.info(f"generated '{req.variant}' ({req.duration_sec}s) in {elapsed_ms}ms -> {written}")
    return GenerateResponse(output_path=str(written), sample_rate=model.sample_rate, duration_ms=elapsed_ms)


if __name__ == "__main__":
    import uvicorn

    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--host", type=str, default="127.0.0.1")
    args = parser.parse_args()

    log.info(f"starting on {args.host}:{args.port}, device={DEVICE}, models_dir={models_dir()}")
    sys.stdout.flush()
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")
