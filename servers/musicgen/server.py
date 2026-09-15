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
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
if DEVICE == "cpu":
    log.warning(
        "CUDA not available — falling back to CPU. This path is not exercised on the "
        "dev machine this server was built against (an RTX 3090 is always present there), "
        "so treat CPU generation as functionally plausible but unverified for real timing."
    )


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


@app.post("/generate", response_model=GenerateResponse)
def generate(req: GenerateRequest):
    from audiocraft.data.audio import audio_write

    model = get_model(req.variant)
    model.set_generation_params(duration=max(1.0, min(req.duration_sec, 30.0)))

    t0 = time.time()
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
