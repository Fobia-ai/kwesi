"""Turns a folder of MIDI files into the fairseq dataset MuseCoco trains on.

Run by the Training screen's MuseCoco pipeline (trainingManager.ts) in the
musecoco venv:

    python prepare_dataset.py <midi_dir> <out_dir> --dict <dict.txt> --truncated-length 2560

Writes <out_dir>/data-bin (binarized REMI tokens) plus <out_dir>/{split}_command.npy
(each sample's attribute values) -- the two inputs A2M_task_new's
language_modeling_control task reads (--command_path is <out_dir>).

Reuses the vendored extractor (2-attribute2music_dataprepare) but not the
upstream split/binarize scripts, which don't work as shipped:
  - extract_data.py passes a 12-attribute list, but training's CommandDataset
    looks up all 15 keys of attribute version "v3" (I4, C1, ST1 too) and
    raises KeyError -- so this extracts with "v3".
  - the dataprepare extractor stores ST1 as a raw field dict (see below).
  - split_data.py hard-codes 1000 input files (crashes on fewer) and saves
    [values] lists, while CommandDataset reads command["values"] from the
    whole piece dict (the format of the vendored example dataset).
"""
import argparse
import json
import os
import random
import shutil
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
DATAPREPARE = os.path.join(HERE, "vendor", "2-attribute2music_dataprepare")
sys.path.insert(0, DATAPREPARE)

import midi_data_extractor as mde  # noqa: E402


def midi_files(root):
    out = []
    for dirpath, _, names in os.walk(root):
        for name in sorted(names):
            if name.lower().endswith((".mid", ".midi")):
                out.append(os.path.relpath(os.path.join(dirpath, name), root))
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("midi_dir")
    parser.add_argument("out_dir")
    parser.add_argument("--dict", required=True, help="the model's dict.txt (must match its vocabulary)")
    parser.add_argument("--truncated-length", type=int, default=2560)
    args = parser.parse_args()

    files = midi_files(args.midi_dir)
    print(f"Reading {len(files)} MIDI file(s)...", flush=True)
    extractor = mde.DataExtractor("v3", encoding_method="REMIGEN2")

    samples = []  # (token string, piece dict)
    failed = []
    too_long = 0
    for i, rel in enumerate(files, 1):
        try:
            tokens, _, _, info_dict, _ = extractor.extract(
                args.midi_dir, rel, cut_method="random_2", normalize_pitch_value=True,
                artist=None, genre=None, emotion=None,
            )
        except Exception as exc:  # one bad file shouldn't sink the dataset
            failed.append(rel)
            print(f"  skipped {rel}: {type(exc).__name__}: {exc}", flush=True)
            continue
        kept = 0
        for piece in info_dict["pieces"]:
            # ST1 (piece structure) can only be supplied by hand. The
            # dataprepare copy of the extractor stores it as its raw field
            # dict ({"piece_structure": None}); the model's own copy of the
            # unit expects the label itself or None, as in the vendored
            # example dataset -- otherwise training dies with KeyError.
            st1 = piece["values"].get("ST1")
            if isinstance(st1, dict):
                piece["values"]["ST1"] = st1.get("piece_structure")
            begin, end = piece["token_begin"], piece["token_end"]
            if end - begin > args.truncated_length:
                too_long += 1
                continue
            samples.append((" ".join(tokens[begin:end]), piece))
            kept += 1
        print(f"  [{i}/{len(files)}] {rel}: {kept} segment(s)", flush=True)

    if not samples:
        print("ERROR: none of the MIDI files produced a usable training segment.", flush=True)
        sys.exit(2)

    random.Random(2023).shuffle(samples)
    os.makedirs(args.out_dir, exist_ok=True)
    # Everything trains; one sample doubles as the (unused, --disable-
    # validation) valid split fairseq-preprocess and the task expect.
    splits = {"train": samples, "valid": samples[:1]}
    for split, rows in splits.items():
        with open(os.path.join(args.out_dir, f"{split}.txt"), "w", encoding="utf-8") as f:
            for text, _ in rows:
                f.write(text + "\n")
        commands = np.empty(len(rows), dtype=object)
        for j, (_, piece) in enumerate(rows):
            commands[j] = piece
        np.save(os.path.join(args.out_dir, f"{split}_command.npy"), commands)

    dict_path = os.path.join(args.out_dir, "dict.txt")
    shutil.copyfile(args.dict, dict_path)
    preprocess = os.path.join(os.path.dirname(sys.executable), "fairseq-preprocess")
    print("Binarizing...", flush=True)
    subprocess.run(
        [preprocess, "--only-source", "--srcdict", dict_path,
         "--trainpref", os.path.join(args.out_dir, "train.txt"),
         "--validpref", os.path.join(args.out_dir, "valid.txt"),
         "--destdir", os.path.join(args.out_dir, "data-bin"), "--workers", "1"],
        check=True,
    )
    summary = {"files": len(files), "failed": failed, "segments": len(samples), "too_long": too_long}
    print("KWESI_DATASET " + json.dumps(summary), flush=True)


if __name__ == "__main__":
    main()
