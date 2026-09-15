import argparse
import logging
import os
import sys
import time

import soundfile as sf
import torch
import torchaudio
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="[rave-server] %(message)s")
log = logging.getLogger("rave")

app = FastAPI()

_models: dict[str, "object"] = {}
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

# The nine pretrained .ts exports in models/rave/ carry no sample-rate
# metadata at all (confirmed by inspecting the TorchScript archive directly:
# no extra_files, no exported sr/sampling_rate attribute on the scripted
# module, nothing in constants.pkl) — this export's own forward()/encode()/
# decode() methods just operate on whatever waveform tensor they're given,
# at whatever rate it happens to be. IRCAM/ACIDS's published RAVE model zoo
# documents 44100Hz as the training rate for the overwhelming majority of
# its pretrained examples (the same page the catalog doc already noted is
# JS-rendered and can't be scraped to verify per-checkpoint, so this is a
# documented assumption, not a confirmed-per-model fact) — used as the
# default here, overridable per-request via `sample_rate` if a future
# manifest exposes it. Getting this wrong doesn't break inference (the
# model still runs and writes a valid WAV), it just risks a pitch-shifted
# timbre transfer if a specific checkpoint's real training rate differs.
DEFAULT_SAMPLE_RATE = 44100

if DEVICE == "cpu":
    log.info(
        "running on CPU — RAVE's own docs call inference/streaming CPU-feasible for "
        "small models, and a standalone smoke test against darbouka_onnx (26MB) took "
        "well under a second for a few seconds of audio, so no CUDA build was installed "
        "for this venv (see servers/rave/README.md)."
    )


def models_dir() -> str:
    return os.environ.get("KWESI_MODELS_DIR", os.path.join(os.path.expanduser("~"), "kwesi-models"))


def get_model(variant: str):
    if variant in _models:
        return _models[variant]

    checkpoint_path = os.path.join(models_dir(), "rave", variant, f"{variant}.ts")
    if not os.path.isfile(checkpoint_path):
        raise HTTPException(status_code=404, detail=f"No local checkpoint at {checkpoint_path}")

    log.info(f"loading RAVE variant '{variant}' from {checkpoint_path} on {DEVICE}")
    t0 = time.time()
    # Each *.ts is a self-contained TorchScript export — no separate model-
    # code/checkpoint split, so torch.jit.load is the entire loading step;
    # no acids-rave package import needed (see servers/rave/README.md).
    model = torch.jit.load(checkpoint_path, map_location=DEVICE)
    model.eval()
    log.info(f"loaded '{variant}' in {time.time() - t0:.1f}s")
    _models[variant] = model
    return model


class GenerateRequest(BaseModel):
    variant: str
    input_audio_path: str
    output_path: str
    sample_rate: int | None = None


class GenerateResponse(BaseModel):
    output_path: str
    sample_rate: int
    duration_ms: int


@app.get("/health")
def health():
    return {"status": "ok", "device": DEVICE, "loaded_variants": list(_models.keys())}


@app.post("/generate", response_model=GenerateResponse)
def generate(req: GenerateRequest):
    if not os.path.isfile(req.input_audio_path):
        raise HTTPException(status_code=404, detail=f"No input audio at {req.input_audio_path}")

    model = get_model(req.variant)
    sample_rate = req.sample_rate or DEFAULT_SAMPLE_RATE

    t0 = time.time()
    wav, in_sr = torchaudio.load(req.input_audio_path)
    if wav.shape[0] > 1:
        wav = wav.mean(dim=0, keepdim=True)
    if in_sr != sample_rate:
        wav = torchaudio.functional.resample(wav, in_sr, sample_rate)

    x = wav.unsqueeze(0).to(DEVICE)  # [1, 1, T]
    with torch.no_grad():
        y = model.forward(x)
    elapsed_ms = int((time.time() - t0) * 1000)

    out = y.squeeze(0).cpu().numpy()  # [C, T] -- C is 2 for a stereo checkpoint (e.g. percussion), 1 otherwise
    if out.shape[0] > 1:
        out = out.T  # soundfile wants (frames, channels) for multi-channel data
    else:
        out = out.reshape(-1)

    # Not every checkpoint's decoder output is bounded to [-1, 1] (confirmed
    # real, not hypothetical: the percussion checkpoint peaks around +-13 on
    # ordinary input, while darbouka_onnx stays within [-1, 1] on the same
    # input) — peak-normalizing only when needed avoids both a hard-clipping
    # write on the hot checkpoints and needlessly rescaling the ones that
    # are already well-behaved.
    peak = float(abs(out).max()) if out.size else 0.0
    if peak > 1.0:
        out = out / peak

    os.makedirs(os.path.dirname(req.output_path), exist_ok=True)
    sf.write(req.output_path, out, sample_rate, subtype="PCM_16")

    log.info(f"transferred '{req.variant}' ({out.shape[0] / sample_rate:.1f}s) in {elapsed_ms}ms -> {req.output_path}")
    return GenerateResponse(output_path=req.output_path, sample_rate=sample_rate, duration_ms=elapsed_ms)


if __name__ == "__main__":
    import uvicorn

    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--host", type=str, default="127.0.0.1")
    args = parser.parse_args()

    log.info(f"starting on {args.host}:{args.port}, device={DEVICE}, models_dir={models_dir()}")
    sys.stdout.flush()
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")
