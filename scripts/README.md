# download_models.py

Developer-only script to pull catalog model weights from Hugging Face down
to a local `models/` folder, once, before re-uploading them to Cloudflare
R2 for end-user distribution. It is not part of the Electron app and is
never run by end users.

## Install

```
pip install -r requirements.txt
```

## Run

```
python3 /mnt/fast_data/Projects/kwesi/scripts/download_models.py
```

The script uses absolute paths internally (both for `models/` and its own
config), so it can be run from any working directory.

## Flags

- `--model <id>[,<id>...]` — restrict to one or more model ids (repeatable
  or comma-separated). Ids: `ace-step-1.5`, `yue2`, `musicgen`, `musecoco`,
  `museformer`, `rave`.
- `--dry-run` — print the full download/skip plan without calling
  `snapshot_download` or touching the network.

## Why this exists

End users should never need a Hugging Face account or token just to use
Kwesi. This script is the one-time developer step that stages every
model's weights in the local, gitignored `models/` folder; from there the
developer re-uploads the whole folder to Cloudflare R2. In a later phase,
the in-app Model Manager will download weights from Cloudflare-hosted URLs
instead of Hugging Face directly, so nothing here is exposed to or run by
end users.
