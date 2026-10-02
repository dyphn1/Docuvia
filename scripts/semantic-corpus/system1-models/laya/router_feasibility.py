"""B-5-style cross-family router feasibility check over Laya OOF features."""

from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path
from typing import Any

os.environ["OMP_NUM_THREADS"] = "2"
os.environ["MKL_NUM_THREADS"] = "2"
os.environ["VECLIB_MAXIMUM_THREADS"] = "2"

import torch
import torch.nn.functional as functional

from laya_constants import DEFAULT_OUTPUT_DIRECTORY, DIAGNOSTICS_NAME, ROUTER_REPORT_NAME
from resource_budget import check_resource_budget
from train import sha256_file, write_json


SCHEMA = "laya-system1-b5-router-feasibility/v1"
PRECISION_TARGETS = (0.99, 0.995, 0.999)
REGULARIZATION_STRENGTHS = (1e-4, 1e-3, 1e-2)
PREFIX_SIZES = (50, 100, 200, 400, 800, 1600, 3200)
LBFGS_MAX_ITERATIONS = 300
COMMIT_CHOICES = {
    "laya-top1": "exactLayaTop1",
    "tier-a-rank0": "exactTierARank0",
}


def _binomial_upper_tail(successes: int, trials: int, probability: float) -> float:
    log_probability = math.log(probability)
    log_complement = math.log1p(-probability)
    return sum(
        math.exp(
            math.lgamma(trials + 1)
            - math.lgamma(count + 1)
            - math.lgamma(trials - count + 1)
            + count * log_probability
            + (trials - count) * log_complement
        )
        for count in range(successes, trials + 1)
    )


def clopper_pearson_lower_bound(
    successes: int, trials: int, alpha: float = 0.05
) -> float:
    if trials <= 0 or successes <= 0:
        return 0.0
    if successes == trials:
        return alpha ** (1 / trials)
    low, high = 0.0, 1.0
    for _ in range(60):
        middle = (low + high) / 2
        if _binomial_upper_tail(successes, trials, middle) > alpha:
            high = middle
        else:
            low = middle
    return low


def multi_candidate_rows(diagnostics: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for request in diagnostics["requests"]:
        candidates = request["candidates"]
        if len(candidates) < 2 or not request["trusted"]:
            continue
        if request["foldFamily"] != request["repoFamily"]:
            raise AssertionError("Laya OOF row does not name its held-out family")
        ordered = sorted(
            candidates,
            key=lambda item: item["rawCandidateProbability"],
            reverse=True,
        )
        rank_zero = min(
            candidates,
            key=lambda item: (
                item["tierARank"] if item["tierARank"] is not None else 10_000
            ),
        )
        evidence = [item["tierAEvidence"] for item in candidates]
        positive = set(request["positiveTargetIds"])
        rows.append(
            {
                "requestId": request["requestId"],
                "family": request["repoFamily"],
                "exactLayaTop1": bool(request["candidateTop1Exact"]),
                "exactTierARank0": positive == {rank_zero["targetId"]},
                "top1Probability": ordered[0]["rawCandidateProbability"],
                "top2Probability": ordered[1]["rawCandidateProbability"],
                "candidateCount": len(candidates),
                "callsEdgeCount": evidence.count("tier-a-calls-edge"),
                "importsFileCount": evidence.count("tier-a-imports-file"),
                "layaAgreesWithRank0": ordered[0]["targetId"] == rank_zero["targetId"],
                "callKind": request["callKind"],
                "rank0Evidence": rank_zero["tierAEvidence"] or "unknown",
                "importKind": request["importKind"],
                "candidateMiss": request["candidateMiss"],
            }
        )
    return rows


def feature_matrix(rows: list[dict[str, Any]]) -> torch.Tensor:
    categories = {
        key: sorted({row[key] for row in rows})
        for key in ("callKind", "rank0Evidence", "importKind")
    }
    vectors: list[list[float]] = []
    for row in rows:
        top1, top2 = row["top1Probability"], row["top2Probability"]
        vector = [
            top1,
            top2,
            top1 - top2,
            math.log(row["candidateCount"]),
            float(row["callsEdgeCount"]),
            float(row["importsFileCount"]),
            float(row["layaAgreesWithRank0"]),
        ]
        for key, values in categories.items():
            vector.extend(float(row[key] == value) for value in values)
        vectors.append(vector)
    base = torch.tensor(vectors, dtype=torch.float64)
    return torch.cat([base, (base.unsqueeze(2) * base.unsqueeze(1)).flatten(1)], dim=1)


def fit_router(
    features: torch.Tensor, targets: torch.Tensor, strength: float
) -> tuple[torch.Tensor, torch.Tensor]:
    weights = torch.zeros(features.shape[1], dtype=torch.float64, requires_grad=True)
    bias = torch.zeros(1, dtype=torch.float64, requires_grad=True)
    optimizer = torch.optim.LBFGS(
        [weights, bias], max_iter=LBFGS_MAX_ITERATIONS, history_size=10
    )

    def closure() -> torch.Tensor:
        optimizer.zero_grad()
        loss = functional.binary_cross_entropy_with_logits(
            features @ weights + bias, targets
        ) + strength * (weights * weights).sum()
        loss.backward()
        return loss

    optimizer.step(closure)
    return weights.detach(), bias.detach()


def _standardized(
    train: torch.Tensor, other: torch.Tensor
) -> tuple[torch.Tensor, torch.Tensor]:
    mean, scale = train.mean(0), train.std(0) + 1e-6
    return (train - mean) / scale, (other - mean) / scale


def router_scores(
    features: torch.Tensor,
    targets: torch.Tensor,
    families: list[str],
    strength: float,
    *,
    lofo: bool,
) -> torch.Tensor:
    if not lofo:
        train, _ = _standardized(features, features)
        weights, bias = fit_router(train, targets, strength)
        return train @ weights + bias
    scores = torch.zeros(len(families), dtype=torch.float64)
    for held_out in sorted(set(families)):
        held = torch.tensor([family == held_out for family in families])
        train, test = _standardized(features[~held], features[held])
        weights, bias = fit_router(train, targets[~held], strength)
        scores[held] = test @ weights + bias
        check_resource_budget("Laya router LOFO fold")
    return scores


def prefix_report(
    scores: torch.Tensor, exact: list[bool], families: list[str]
) -> dict[str, Any]:
    order = scores.argsort(descending=True).tolist()
    exact_count = 0
    largest: dict[str, int] = {str(target): 0 for target in PRECISION_TARGETS}
    prefixes: list[dict[str, Any]] = []
    for size, index in enumerate(order, start=1):
        exact_count += int(exact[index])
        observed_precision = exact_count / size
        lower_bound: float | None = None
        if size in PREFIX_SIZES or observed_precision >= min(PRECISION_TARGETS):
            lower_bound = clopper_pearson_lower_bound(exact_count, size)
        if size in PREFIX_SIZES:
            per_family: dict[str, list[int]] = {}
            for row_index in order[:size]:
                counts = per_family.setdefault(families[row_index], [0, 0])
                counts[0] += int(exact[row_index])
                counts[1] += 1
            prefixes.append(
                {
                    "rows": size,
                    "exactRows": exact_count,
                    "lowerBound": round(lower_bound or 0.0, 6),
                    "byFamily": {
                        family: f"{counts[0]}/{counts[1]}"
                        for family, counts in sorted(per_family.items())
                    },
                }
            )
        if lower_bound is None:
            continue
        for target in PRECISION_TARGETS:
            if lower_bound >= target:
                largest[str(target)] = size
    return {"prefixes": prefixes, "largestCertifiablePrefixRows": largest}


def run_feasibility(diagnostics: dict[str, Any]) -> dict[str, Any]:
    rows = multi_candidate_rows(diagnostics)
    if not rows:
        raise ValueError("no trusted multi-candidate OOF rows are available")
    features = feature_matrix(rows)
    families = [row["family"] for row in rows]
    results: dict[str, Any] = {}
    for choice, key in COMMIT_CHOICES.items():
        exact = [row[key] for row in rows]
        targets = torch.tensor(exact, dtype=torch.float64)
        results[choice] = {
            "exactRows": sum(exact),
            "rows": len(exact),
            "candidateMissRows": sum(row["candidateMiss"] for row in rows),
            "byRegularization": {
                str(strength): {
                    mode: prefix_report(
                        router_scores(
                            features,
                            targets,
                            families,
                            strength,
                            lofo=mode == "lofo",
                        ),
                        exact,
                        families,
                    )
                    for mode in ("in-sample", "lofo")
                }
                for strength in REGULARIZATION_STRENGTHS
            },
        }
        check_resource_budget("Laya router feasibility")
    return {
        "schema": SCHEMA,
        "diagnosticsSchema": diagnostics["schema"],
        "trustedMultiCandidateRows": len(rows),
        "featureCount": features.shape[1],
        "precisionTargets": list(PRECISION_TARGETS),
        "alpha": 0.05,
        "rowLevelBoundIsOptimistic": True,
        "lofoFeaturesAreSecondOrderLeaky": True,
        "heldOutSplitsRead": [],
        "results": results,
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
        default=DEFAULT_OUTPUT_DIRECTORY / ROUTER_REPORT_NAME,
    )
    arguments = parser.parse_args()
    torch.set_num_threads(2)
    torch.set_num_interop_threads(1)
    torch.use_deterministic_algorithms(True)
    check_resource_budget("Laya router feasibility start")
    diagnostics = json.loads(arguments.diagnostics.read_text(encoding="utf-8"))
    report = run_feasibility(diagnostics)
    report["diagnosticsSha256"] = sha256_file(arguments.diagnostics)
    write_json(arguments.output, report)
    summary = {
        choice: {
            strength: values["lofo"]["largestCertifiablePrefixRows"]["0.99"]
            for strength, values in result["byRegularization"].items()
        }
        for choice, result in report["results"].items()
    }
    print(
        json.dumps(
            {
                "event": "laya-router-feasibility-complete",
                "output": str(arguments.output),
                "largestLofoPrefixAt099": summary,
            },
            sort_keys=True,
        ),
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
