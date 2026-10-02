"""Summarize pool-only out-of-fold option and protocol-control components."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from laya_constants import DEFAULT_OUTPUT_DIRECTORY, DIAGNOSTICS_NAME, TRAINING_SPLITS
from train import sha256_file, write_json


def _weighted_brier(rows: list[tuple[float, float, float]]) -> float | None:
    denominator = sum(weight for _, _, weight in rows)
    if denominator <= 0:
        return None
    return sum(weight * (score - target) ** 2 for score, target, weight in rows) / denominator


def summarize_diagnostics(document: dict[str, Any]) -> dict[str, Any]:
    candidate_events: list[tuple[float, float, float]] = []
    control_events: list[tuple[float, float, float]] = []
    split_rows = {
        split: {
            "requests": 0,
            "trustedRequests": 0,
            "candidateMisses": 0,
            "candidateTop1Exact": 0,
            "candidateTop1Eligible": 0,
            "multiCandidateTop1Exact": 0,
            "multiCandidateTop1Eligible": 0,
        }
        for split in TRAINING_SPLITS
    }
    counts = {
        "positiveCandidates": 0,
        "confirmedNegativeCandidates": 0,
        "maskedCandidates": 0,
        "trustedControlEvents": 0,
        "untrustedRequests": 0,
    }
    for row in document["requests"]:
        split = row["split"]
        metrics = split_rows[split]
        metrics["requests"] += 1
        metrics["trustedRequests"] += int(row["trusted"])
        metrics["candidateMisses"] += int(row["candidateMiss"] and row["trusted"])
        if not row["trusted"]:
            counts["untrustedRequests"] += 1
        if row["candidateTop1Exact"] is not None:
            metrics["candidateTop1Exact"] += int(row["candidateTop1Exact"])
            metrics["candidateTop1Eligible"] += 1
            if row["candidateCount"] > 1:
                metrics["multiCandidateTop1Exact"] += int(row["candidateTop1Exact"])
                metrics["multiCandidateTop1Eligible"] += 1
        for candidate in row["candidates"]:
            weight = float(candidate["candidateMaskWeight"])
            target = float(candidate["candidateTarget"])
            score = float(candidate["rawCandidateProbability"])
            candidate_events.append((score, target, weight))
            if weight <= 0:
                counts["maskedCandidates"] += 1
            elif target == 1:
                counts["positiveCandidates"] += 1
            else:
                counts["confirmedNegativeCandidates"] += 1
        for control in row["controls"]:
            weight = float(control["controlMaskWeight"])
            control_events.append(
                (
                    float(control["rawControlProbability"]),
                    float(control["controlTarget"]),
                    weight,
                )
            )
            counts["trustedControlEvents"] += int(weight > 0)
    return {
        "schema": "laya-system1-oof-diagnostic-summary/v1",
        "sourceSchema": document["schema"],
        "sourceSplits": document["sourceSplits"],
        "heldOutSplitsRead": document["heldOutSplitsRead"],
        "requestCount": document["requestCount"],
        "labelCounts": counts,
        "candidateBrierOnWeightedOofEvents": _weighted_brier(candidate_events),
        "controlBrierOnTrustedOofEvents": _weighted_brier(control_events),
        "candidateTop1Diagnostic": {
            "gate": False,
            "bySplit": split_rows,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--diagnostics",
        type=Path,
        default=DEFAULT_OUTPUT_DIRECTORY / DIAGNOSTICS_NAME,
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT_DIRECTORY / "diagnostics-summary.json",
    )
    arguments = parser.parse_args()
    document = json.loads(arguments.diagnostics.read_text(encoding="utf-8"))
    report = summarize_diagnostics(document)
    report["sourceSha256"] = sha256_file(arguments.diagnostics)
    write_json(arguments.output, report)
    print(json.dumps({"event": "laya-diagnostics-complete", "output": str(arguments.output)}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
