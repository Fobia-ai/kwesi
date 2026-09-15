#!/usr/bin/env python3
"""
download_models.py

Developer-side, one-time utility to pull every catalog model's weights down
to a local `models/` folder, so they can be re-uploaded to Cloudflare R2 for
end-user redistribution (see kwesi.docs/03-model-catalog.md, "Model
distribution" section).

This script is NOT part of the Electron app. It is meant to be run directly
by a developer in a terminal:

    pip install -r requirements.txt
    python3 download_models.py [--model <id>[,<id>...]] [--dry-run]

It requires no Hugging Face account/token for anything that is genuinely
public. If a download fails because a repo turns out to be gated/private,
the script prints a one-line error suggesting `huggingface-cli login` and
moves on to the next variant rather than aborting.

Confidence legend used in the MODELS config below:
  # CONFIRMED                  -> repo_id verified against prior research
  # NEEDS VERIFICATION -- why  -> best guess; double check before relying on it
Entries with source "manual" mean we do not have (or do not trust) a
Hugging Face repo id at all; the note/url points at where a human should go
look instead (GitHub README, release assets, org page, etc).
"""

import argparse
import os
import sys

MODELS_DIR = "/mnt/fast_data/Projects/kwesi/models"

# ---------------------------------------------------------------------------
# MODELS configuration
#
# Structure:
#   MODELS = {
#       "<model_id>": {
#           "variants": {
#               "<variant_name>": {
#                   "source": "huggingface" | "manual",
#                   "repo_id": "org/name",       # huggingface only
#                   "note": "...",                # manual (and optionally huggingface)
#                   "url": "https://...",         # manual, optional
#               },
#               ...
#           }
#       },
#       ...
#   }
# ---------------------------------------------------------------------------

MODELS = {
    "ace-step-1.5": {
        "variants": {
            # The exact HF repo IDs for ACE-Step 1.5 checkpoints are not
            # confirmed from prior research -- only the GitHub repo is
            # confirmed. Marking these "manual" rather than guessing a
            # repo_id and risking a confidently-wrong download.
            "acestep-v15-turbo": {
                # NEEDS VERIFICATION -- no confirmed HF repo id; check the
                # ACE-Step-1.5 GitHub README for HF links before assuming a
                # pattern like "ACE-Step/ACE-Step-1.5-turbo" is correct.
                "source": "manual",
                "note": (
                    "No confirmed HF repo id for the 2B/8-step turbo "
                    "checkpoint. Check github.com/ace-step/ACE-Step-1.5 "
                    "README for the current Hugging Face link."
                ),
                "url": "https://github.com/ace-step/ACE-Step-1.5",
            },
            "acestep-v15-sft": {
                # NEEDS VERIFICATION -- same situation as turbo above.
                "source": "manual",
                "note": (
                    "No confirmed HF repo id for the 2B/50-step SFT "
                    "checkpoint. Check github.com/ace-step/ACE-Step-1.5 "
                    "README for the current Hugging Face link."
                ),
                "url": "https://github.com/ace-step/ACE-Step-1.5",
            },
            "acestep-v15-xl": {
                # NEEDS VERIFICATION -- same situation, 4B XL checkpoint.
                "source": "manual",
                "note": (
                    "No confirmed HF repo id for the 4B XL checkpoint. "
                    "Check github.com/ace-step/ACE-Step-1.5 README for the "
                    "current Hugging Face link."
                ),
                "url": "https://github.com/ace-step/ACE-Step-1.5",
            },
        },
    },
    "yue2": {
        "variants": {
            "yue2-3b": {
                # CONFIRMED -- reasonably well-attested in prior research.
                "source": "huggingface",
                "repo_id": "m-a-p/YuE2-3B",
                "note": "Semantic->acoustic engine.",
            },
            "yue2-vae": {
                # CONFIRMED -- reasonably well-attested in prior research.
                "source": "huggingface",
                "repo_id": "m-a-p/YuE2-Vae",
                "note": "Audio decoder.",
            },
            "yue2-vae-legacy": {
                # NEEDS VERIFICATION -- not sure this has its own separate
                # HF repo (vs being a revision/branch of m-a-p/YuE2-Vae).
                "source": "manual",
                "note": (
                    "Exact repo id/location for the legacy VAE checkpoint "
                    "is unconfirmed. Check the m-a-p org on Hugging Face "
                    "(https://huggingface.co/m-a-p) for a separate "
                    "YuE2-Vae-legacy repo or a tagged revision."
                ),
                "url": "https://huggingface.co/m-a-p",
            },
        },
    },
    "musicgen": {
        "variants": {
            "musicgen-small": {
                # CONFIRMED -- well-documented, stable Meta AudioCraft release.
                "source": "huggingface",
                "repo_id": "facebook/musicgen-small",
            },
            "musicgen-medium": {
                # CONFIRMED
                "source": "huggingface",
                "repo_id": "facebook/musicgen-medium",
            },
            "musicgen-large": {
                # CONFIRMED
                "source": "huggingface",
                "repo_id": "facebook/musicgen-large",
            },
            "musicgen-melody": {
                # CONFIRMED
                "source": "huggingface",
                "repo_id": "facebook/musicgen-melody",
            },
            "musicgen-style": {
                # CONFIRMED
                "source": "huggingface",
                "repo_id": "facebook/musicgen-style",
            },
        },
    },
    "musecoco": {
        "variants": {
            "default": {
                # MuseCoco checkpoints are not confirmed to be on Hugging
                # Face at all -- the original microsoft/muzic repo has
                # historically pointed to GitHub release assets / Google
                # Drive links for weights.
                "source": "manual",
                "note": (
                    "Checkpoints are not confirmed to be on Hugging Face. "
                    "Check github.com/microsoft/muzic (musecoco subfolder) "
                    "README directly for GitHub release assets or Google "
                    "Drive links."
                ),
                "url": "https://github.com/microsoft/muzic/tree/main/musecoco",
            },
        },
    },
    "museformer": {
        "variants": {
            "default": {
                # Same situation as MuseCoco -- checkpoints historically
                # distributed outside Hugging Face for this repo.
                "source": "manual",
                "note": (
                    "Checkpoints are not confirmed to be on Hugging Face. "
                    "Check github.com/microsoft/muzic (museformer subfolder) "
                    "README directly for GitHub release assets or Google "
                    "Drive links."
                ),
                "url": "https://github.com/microsoft/muzic/tree/main/museformer",
            },
        },
    },
    "rave": {
        "variants": {
            # RAVE is normally trained per-timbre rather than downloaded as
            # a single generic checkpoint (see 02-architecture.md, "Training
            # pipeline architecture" -- RAVE's native workflow is
            # from-scratch/fine-tune per target timbre). Pretrained example
            # timbre models that IRCAM/ACIDS does publish are distributed
            # via their own links, not primarily Hugging Face, so there is
            # no fixed variant list here -- just a pointer for a developer
            # to go pick example models manually if desired.
            "pretrained-examples": {
                "source": "manual",
                "note": (
                    "RAVE is normally trained per-timbre, not downloaded as "
                    "a generic checkpoint. For optional pretrained example "
                    "timbre models, check github.com/acids-ircam/RAVE "
                    "README for current download links (historically "
                    "IRCAM/ACIDS-hosted, not primarily Hugging Face)."
                ),
                "url": "https://github.com/acids-ircam/RAVE",
            },
        },
    },
}


def is_auth_error(exc: Exception) -> bool:
    """Best-effort sniff for gated/private-repo or auth-related failures."""
    text = str(exc).lower()
    keywords = (
        "401",
        "403",
        "gated",
        "authentication",
        "unauthorized",
        "access to model",
        "token",
        "permission",
        "login",
    )
    return any(k in text for k in keywords)


def parse_args():
    parser = argparse.ArgumentParser(
        description=(
            "Developer-only script: download catalog model weights from "
            "Hugging Face into a local models/ folder for later re-upload "
            "to Cloudflare R2. Not used by the Electron app itself."
        )
    )
    parser.add_argument(
        "--model",
        action="append",
        default=None,
        help=(
            "Restrict to one or more model ids. Repeatable "
            "(--model musicgen --model rave) or comma-separated "
            "(--model musicgen,rave). Defaults to all models."
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the download plan without calling snapshot_download or touching the network.",
    )
    return parser.parse_args()


def resolve_model_ids(requested):
    if not requested:
        return list(MODELS.keys())

    ids = []
    for item in requested:
        ids.extend(part.strip() for part in item.split(",") if part.strip())

    unknown = [m for m in ids if m not in MODELS]
    if unknown:
        print(f"Unknown model id(s): {', '.join(unknown)}", file=sys.stderr)
        print(f"Known model ids: {', '.join(MODELS.keys())}", file=sys.stderr)
        sys.exit(1)

    return ids


def main():
    args = parse_args()
    model_ids = resolve_model_ids(args.model)

    results = {
        "downloaded": [],  # (model_id, variant_name, local_dir)
        "failed": [],      # (model_id, variant_name, error_message)
        "skipped": [],     # (model_id, variant_name, note)
    }

    snapshot_download = None
    if not args.dry_run:
        try:
            from huggingface_hub import snapshot_download as _snapshot_download

            snapshot_download = _snapshot_download
        except ImportError:
            print(
                "huggingface_hub is not installed. Run:\n"
                "  pip install -r requirements.txt",
                file=sys.stderr,
            )
            sys.exit(1)

    for model_id in model_ids:
        variants = MODELS[model_id]["variants"]
        print(f"\n=== {model_id} ===")

        for variant_name, cfg in variants.items():
            local_dir = os.path.join(MODELS_DIR, model_id, variant_name)
            source = cfg.get("source")

            if source == "manual":
                note = cfg.get("note", "")
                url = cfg.get("url", "")
                pointer = f" ({url})" if url else ""
                print(f"[skip:manual] {model_id}/{variant_name}: {note}{pointer}")
                results["skipped"].append((model_id, variant_name, note))
                continue

            if source == "huggingface":
                repo_id = cfg.get("repo_id")
                if args.dry_run:
                    print(
                        f"[dry-run] would download {model_id}/{variant_name} "
                        f"from huggingface repo '{repo_id}' -> {local_dir}"
                    )
                    continue

                print(f"[download] {model_id}/{variant_name} <- {repo_id} ...")
                os.makedirs(local_dir, exist_ok=True)
                try:
                    snapshot_download(
                        repo_id=repo_id,
                        local_dir=local_dir,
                        local_dir_use_symlinks=False,
                    )
                    print(f"[ok] {model_id}/{variant_name} -> {local_dir}")
                    results["downloaded"].append((model_id, variant_name, local_dir))
                except Exception as exc:  # noqa: BLE001 - intentionally broad, continue on any failure
                    message = str(exc).splitlines()[0] if str(exc) else repr(exc)
                    print(f"[error] {model_id}/{variant_name}: {message}")
                    if is_auth_error(exc):
                        print(
                            "         This looks like an auth/gated-repo error. "
                            "If the repo genuinely requires access, run "
                            "`huggingface-cli login` and re-run this script."
                        )
                    results["failed"].append((model_id, variant_name, message))
                continue

            print(
                f"[warn] {model_id}/{variant_name}: unknown source '{source}', skipping."
            )
            results["skipped"].append((model_id, variant_name, f"unknown source '{source}'"))

    print_summary(results, dry_run=args.dry_run)


def print_summary(results, dry_run):
    print("\n" + "=" * 60)
    print("SUMMARY" + (" (dry run - nothing was downloaded)" if dry_run else ""))
    print("=" * 60)

    if not dry_run:
        print(f"\nDownloaded ({len(results['downloaded'])}):")
        if results["downloaded"]:
            for model_id, variant_name, local_dir in results["downloaded"]:
                print(f"  [OK]     {model_id}/{variant_name} -> {local_dir}")
        else:
            print("  (none)")

        print(f"\nFailed ({len(results['failed'])}):")
        if results["failed"]:
            for model_id, variant_name, message in results["failed"]:
                print(f"  [FAILED] {model_id}/{variant_name}: {message}")
        else:
            print("  (none)")

    print(f"\nSkipped as manual ({len(results['skipped'])}):")
    if results["skipped"]:
        for model_id, variant_name, note in results["skipped"]:
            print(f"  [MANUAL] {model_id}/{variant_name}: {note}")
    else:
        print("  (none)")

    print()


if __name__ == "__main__":
    main()
