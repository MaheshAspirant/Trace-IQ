#!/usr/bin/env python3
"""Regenerate the dataset twice with the same seed and compare the outputs.

    python src/repro_check.py --profile full --seed 20261022 --out out

Writes ``out/reproducibility.json`` and exits non-zero when the two runs
differ in row counts or per-file SHA-256 checksums.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import domain as D  # noqa: E402
from generate import Generator  # noqa: E402


def main(argv=None):
    ap = argparse.ArgumentParser(description="Demonstrate fixed-seed reproducibility")
    ap.add_argument("--profile", default="full", choices=sorted(D.PROFILES))
    ap.add_argument("--seed", type=int, default=D.SEED)
    ap.add_argument("--out", default="out")
    args = ap.parse_args(argv)

    tmp = tempfile.mkdtemp(prefix="trace-repro-")
    try:
        first = Generator(profile=args.profile, seed=args.seed).run(os.path.join(tmp, "run_a"))
        second = Generator(profile=args.profile, seed=args.seed).run(os.path.join(tmp, "run_b"))
        differing = sorted(name for name, digest in first["checksums_sha256"].items()
                           if second["checksums_sha256"].get(name) != digest)
        result = {
            "profile": args.profile,
            "seed": args.seed,
            "row_counts": first["row_counts"],
            "identical_row_counts": first["row_counts"] == second["row_counts"],
            "files_compared": len(first["checksums_sha256"]),
            "identical_files": len(first["checksums_sha256"]) - len(differing),
            "differing_files": differing,
            "reproducible": first["row_counts"] == second["row_counts"] and not differing,
        }
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    os.makedirs(args.out, exist_ok=True)
    with open(os.path.join(args.out, "reproducibility.json"), "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=2)
    print(json.dumps(result, indent=2))
    return 0 if result["reproducible"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
