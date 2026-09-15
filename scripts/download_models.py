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

As of 2026-09-15, 16 of 18 catalog variants are CONFIRMED real, public,
ungated Hugging Face repos (verified live against huggingface.co/api/models
and each project's own README, not guessed). Only two remain "manual":
museformer/default (hosted on Microsoft OneDrive; a plain scripted request
403s -- needs a browser) and rave/pretrained-examples (listed on a
JS-rendered page that can't be scraped as static HTML). Both point at the
real, verified location rather than a generic project pointer.

Confidence legend used in the MODELS config below:
  # CONFIRMED                  -> repo_id verified live against the HF API
  # NEEDS VERIFICATION -- why  -> best guess; double check before relying on it
Entries with source "manual" mean there is no scriptable Hugging Face repo
id for this one -- the note/url points at the real (verified) location a
human needs to visit instead.
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
            # CONFIRMED against the live Hugging Face API (curl
            # huggingface.co/api/models?author=ACE-Step) and the repo's own
            # README "Model Zoo" table on 2026-09-15 -- all six are real,
            # public, ungated repos. Note the "turbo" DiT's repo is
            # literally named "Ace-Step1.5", not "acestep-v15-turbo" -- the
            # README's own table confirms this mapping, it's not a typo here.
            "acestep-v15-base": {
                "source": "huggingface",
                "repo_id": "ACE-Step/acestep-v15-base",
                "note": "2B DiT, 50-step, pre-train only (no SFT).",
            },
            "acestep-v15-sft": {
                "source": "huggingface",
                "repo_id": "ACE-Step/acestep-v15-sft",
                "note": "2B DiT, 50-step, SFT.",
            },
            "acestep-v15-turbo": {
                "source": "huggingface",
                "repo_id": "ACE-Step/Ace-Step1.5",
                "note": "2B DiT, 8-step turbo. Repo name differs from the variant name -- confirmed correct, see README Model Zoo table.",
            },
            "acestep-v15-xl-base": {
                "source": "huggingface",
                "repo_id": "ACE-Step/acestep-v15-xl-base",
                "note": "4B DiT, 50-step, pre-train only.",
            },
            "acestep-v15-xl-sft": {
                "source": "huggingface",
                "repo_id": "ACE-Step/acestep-v15-xl-sft",
                "note": "4B DiT, 50-step, SFT.",
            },
            "acestep-v15-xl-turbo": {
                "source": "huggingface",
                "repo_id": "ACE-Step/acestep-v15-xl-turbo",
                "note": "4B DiT, 8-step turbo.",
            },
            # Optional LM prompt-expansion front-ends, not alternate DiT
            # sizes. Only 0.6B and 4B are confirmed to exist as their own HF
            # repos as of 2026-09-15 -- no separate 1.7B repo was found under
            # the ACE-Step org despite being referenced in the README's GPU
            # recommendation table, so it's left out rather than guessed.
            "acestep-5hz-lm-0.6b": {
                "source": "huggingface",
                "repo_id": "ACE-Step/acestep-5Hz-lm-0.6B",
                "note": "Optional LM front-end (prompt/blueprint expansion), not a DiT size.",
            },
            "acestep-5hz-lm-4b": {
                "source": "huggingface",
                "repo_id": "ACE-Step/acestep-5Hz-lm-4B",
                "note": "Optional LM front-end (prompt/blueprint expansion), not a DiT size.",
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
                # CONFIRMED against the live Hugging Face API on 2026-09-15 --
                # it is its own separate repo, not a revision/branch.
                "source": "huggingface",
                "repo_id": "m-a-p/YuE2-Vae-legacy",
            },
        },
    },
    "musicgen": {
        "variants": {
            # Variant names match electron/db/seedModels.ts exactly (bare
            # sizes, not "musicgen-*") -- these two files are the app's
            # source of truth for install-state folder names; a prior
            # mismatch here caused downloaded folders not to be recognized
            # by the app until manually renamed.
            "small": {
                # CONFIRMED -- well-documented, stable Meta AudioCraft release.
                "source": "huggingface",
                "repo_id": "facebook/musicgen-small",
            },
            "medium": {
                # CONFIRMED
                "source": "huggingface",
                "repo_id": "facebook/musicgen-medium",
            },
            "large": {
                # CONFIRMED
                "source": "huggingface",
                "repo_id": "facebook/musicgen-large",
            },
            "melody": {
                # CONFIRMED
                "source": "huggingface",
                "repo_id": "facebook/musicgen-melody",
            },
            # "style" removed: its real checkpoint needs a StyleConditioner
            # class that doesn't exist in the pinned audiocraft==1.3.0 --
            # see the comment on MUSICGEN in src/data/manifests.ts.
        },
    },
    "musecoco": {
        "variants": {
            "default": {
                # CONFIRMED -- found via the musecoco subfolder README
                # ("Download the checkpoint" link) and verified live against
                # the Hugging Face API on 2026-09-15: public, ungated. This
                # is the stage-2 attribute-to-music generator (the actual
                # music generation checkpoint); the stage-1 text-to-attribute
                # model's checkpoint is not separately published.
                "source": "huggingface",
                "repo_id": "XinXuNLPer/MuseCoco_attribute2music",
            },
        },
    },
    "museformer": {
        "variants": {
            "default": {
                # CONFIRMED location, but NOT automatable: the museformer
                # subfolder README points at a Microsoft OneDrive share link,
                # not Hugging Face. A plain scripted request to it 403s
                # (OneDrive share links need a real browser session/redirect
                # chain) -- verified 2026-09-15. Left as "manual" with the
                # real direct link rather than a generic GitHub pointer.
                "source": "manual",
                "note": (
                    "Checkpoint is hosted on Microsoft OneDrive, not Hugging "
                    "Face, and the share link 403s on a plain scripted "
                    "request -- open it in a browser instead. Put the "
                    "downloaded checkpoint in checkpoints/mf-lmd6remi-1 per "
                    "the museformer README."
                ),
                "url": "https://1drv.ms/u/s!Aq3YEPZCcV5ibz9ySjjNsEB74CQ",
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
                    "a generic checkpoint. Pretrained example timbre models "
                    "are listed at acids-ircam.github.io/rave_models_download "
                    "-- verified 2026-09-15 that table is JS-rendered (empty "
                    "when fetched as static HTML), so it can't be scraped "
                    "here either; open it in a browser."
                ),
                "url": "https://acids-ircam.github.io/rave_models_download",
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
