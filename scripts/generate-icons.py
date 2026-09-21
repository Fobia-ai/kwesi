#!/usr/bin/env python3
"""Generate the Kwesi app icon set from src/assets/logo.png.

Outputs:
  - build/icons/<size>x<size>.png for common sizes
  - build/icons/icon.ico (Windows, multi-resolution)
  - build/icons/icon.icns (macOS, multi-resolution)
"""

import os
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "src" / "assets" / "logo.png"
OUT_DIR = ROOT / "build" / "icons"

PNG_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
ICO_SIZES = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
ICNS_SIZES = [(16, 16), (32, 32), (64, 64), (128, 128), (256, 256), (512, 512), (1024, 1024)]


def main() -> None:
    if not SOURCE.exists():
        raise FileNotFoundError(f"Source logo not found: {SOURCE}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    with Image.open(SOURCE) as img:
        if img.mode != "RGBA":
            img = img.convert("RGBA")
        # Use the source at its native resolution if it is large enough,
        # otherwise upscale once to 1024 for best downscaling quality.
        source_max = max(img.size)
        target_max = max(PNG_SIZES)
        if source_max < target_max:
            img = img.resize((target_max, target_max), Image.Resampling.LANCZOS)

        # Generate size-named PNGs.
        for size in PNG_SIZES:
            resized = img.resize((size, size), Image.Resampling.LANCZOS)
            resized.save(OUT_DIR / f"{size}x{size}.png", "PNG")

        # Multi-resolution Windows .ico.
        img.save(OUT_DIR / "icon.ico", format="ICO", sizes=ICO_SIZES)

        # Multi-resolution macOS .icns.
        img.save(OUT_DIR / "icon.icns", format="ICNS", sizes=ICNS_SIZES)

    print(f"Generated icon set in {OUT_DIR}")
    for entry in sorted(OUT_DIR.iterdir()):
        print(f"  {entry.name} ({entry.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
