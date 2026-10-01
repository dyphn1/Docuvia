"""Pre-flight gate for B-5: can any commit-is-exact router certify multi-candidate requests?

The B-5 plan replaces the B-4 coverage routing target with "the committed set is exact" and
certifies only the multi-candidate stratum (#555). Doing that properly needs nested
pair-held-out candidate models (21 extra fits, several hours of CPU). Before paying for that,
this gate asks a cheaper question that bounds the answer from above:

- Features come from the B-4 OOF component diagnostics (candidate probabilities from the
  fold model that excluded the row's family) plus Tier A request facts. Labels never enter
  the features.
- A small L2 logistic router with pairwise feature products predicts whether the
  committed top-1 is the exact gold set, for two commit choices: CUA-S1 top-1 and Tier A rank 0.
- "in-sample" fits and ranks on all rows (an overfit upper bound). "lofo" fits on six
  families and ranks the seventh, the same family isolation the P2 policy uses.
- The gate is the largest score-ranked prefix whose one-sided Clopper-Pearson lower bound
  reaches each P2 precision target, counted per row. Rows are at least as many as duplicate
  groups, so a row-level bound is the optimistic one.

The LOFO router still sees candidate scores whose fold models trained on the other held-out
family, so even the "lofo" number is optimistic. If it certifies nothing, the full B-5
training cannot be expected to either.
"""

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

from adapter import is_trusted_label, state_repository_family
from constants import (
    CANDIDATE_OPTION_KIND,
    DEFAULT_DATASET_DIRECTORY,
    DEFAULT_MODEL_DIRECTORY,
    LABEL_POSITIVE_TARGET_IDS_KEY,
    OPTION_ATTRIBUTES_KEY,
    OPTION_KIND_KEY,
    OPTIONS_KEY,
    REQUEST_KEY,
    TARGET_ID_KEY,
    TIER_A_EVIDENCE_KEY,
    TIER_A_RANK_KEY,
    TRAINING_SPLITS,
)
from resource_budget import check_resource_budget
from train import paired_rows, sha256_file, write_json


FEASIBILITY_SCHEMA = "cua-s1-b5-router-feasibility/v1"
PRECISION_TARGETS = (0.99, 0.995, 0.999)
ONE_SIDED_ALPHA = 0.05
REGULARIZATION_STRENGTHS = (1e-4, 1e-3, 1e-2)
PREFIX_SIZES = (50, 100, 200, 400, 800, 1600, 3200)
LBFGS_MAX_ITERATIONS = 500
FEATURE_THREADS = 2
COMMIT_CHOICES = {
    "cua-s1-top1": "exactCuaTop1",
    "tier-a-rank0": "exactTierARank0",
}
CALLS_EDGE_EVIDENCE = "tier-a-calls-edge"
IMPORTS_FILE_EVIDENCE = "tier-a-imports-file"


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


def clopper_pearson_lower_bound(successes: int, trials: int, alpha: float = ONE_SIDED_ALPHA) -> float:
    """One-sided exact binomial lower bound, matching the P2 evaluator's rule."""
    if successes == 0:
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


def multi_candidate_rows(dataset_directory: Path, diagnostics: dict[str, Any]) -> list[dict[str, Any]]:
    """Join trusted multi-candidate pool rows with their OOF candidate probabilities."""
    by_request = {row["requestId"]: row for row in diagnostics["requests"]}
    rows: list[dict[str, Any]] = []
    for split in TRAINING_SPLITS:
        for state, labels in paired_rows(dataset_directory, split):
            request = state[REQUEST_KEY]
            candidates = [
                option for option in request[OPTIONS_KEY] if option[OPTION_KIND_KEY] == CANDIDATE_OPTION_KIND
            ]
            if len(candidates) < 2 or not is_trusted_label(labels):
                continue
            diagnostic = by_request[request["requestId"]]
            if diagnostic["foldFamily"] != state_repository_family(state):
                raise AssertionError("OOF diagnostics row was scored by a model that saw its family")
            probabilities = sorted(
                (candidate["rawCandidateProbability"] for candidate in diagnostic["candidates"]),
                reverse=True,
            )
            cua_top1 = max(diagnostic["candidates"], key=lambda item: item["rawCandidateProbability"])
            rank0 = min(candidates, key=lambda option: option[OPTION_ATTRIBUTES_KEY][TIER_A_RANK_KEY])
            evidence = [option[OPTION_ATTRIBUTES_KEY][TIER_A_EVIDENCE_KEY] for option in candidates]
            context = json.loads(request["context"]["text"])
            gold = set(labels[LABEL_POSITIVE_TARGET_IDS_KEY])
            rank0_target = rank0[OPTION_ATTRIBUTES_KEY][TARGET_ID_KEY]
            rows.append(
                {
                    "family": state_repository_family(state),
                    "exactCuaTop1": gold == {cua_top1["targetId"]},
                    "exactTierARank0": gold == {rank0_target},
                    "top1Probability": probabilities[0],
                    "top2Probability": probabilities[1],
                    "candidateCount": len(candidates),
                    "callsEdgeCount": evidence.count(CALLS_EDGE_EVIDENCE),
                    "importsFileCount": evidence.count(IMPORTS_FILE_EVIDENCE),
                    "cuaAgreesWithRank0": cua_top1["targetId"] == rank0_target,
                    "callKind": str(context.get("call", {}).get("kind")),
                    "rank0Evidence": str(rank0[OPTION_ATTRIBUTES_KEY][TIER_A_EVIDENCE_KEY]),
                    "importKind": str((context.get("importBinding") or {}).get("kind")),
                }
            )
    return rows


def feature_matrix(rows: list[dict[str, Any]]) -> torch.Tensor:
    """Numeric plus one-hot request facts with all pairwise products."""
    categories = {
        key: sorted({row[key] for row in rows}) for key in ("callKind", "rank0Evidence", "importKind")
    }
    vectors = []
    for row in rows:
        top1, top2 = row["top1Probability"], row["top2Probability"]
        vector = [
            top1,
            top2,
            top1 - top2,
            math.log(row["candidateCount"]),
            float(row["callsEdgeCount"]),
            float(row["importsFileCount"]),
            float(row["cuaAgreesWithRank0"]),
        ]
        for key, values in categories.items():
            vector.extend(float(row[key] == value) for value in values)
        vectors.append(vector)
    base = torch.tensor(vectors, dtype=torch.float64)
    return torch.cat([base, (base.unsqueeze(2) * base.unsqueeze(1)).flatten(1)], dim=1)


def fit_router(features: torch.Tensor, targets: torch.Tensor, strength: float) -> tuple[torch.Tensor, torch.Tensor]:
    weights = torch.zeros(features.shape[1], dtype=torch.float64, requires_grad=True)
    bias = torch.zeros(1, dtype=torch.float64, requires_grad=True)
    optimizer = torch.optim.LBFGS([weights, bias], max_iter=LBFGS_MAX_ITERATIONS)

    def closure() -> torch.Tensor:
        optimizer.zero_grad()
        loss = torch.nn.functional.binary_cross_entropy_with_logits(
            features @ weights + bias, targets
        ) + strength * (weights * weights).sum()
        loss.backward()
        return loss

    optimizer.step(closure)
    return weights.detach(), bias.detach()


def standardized(train: torch.Tensor, other: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
    mean, scale = train.mean(0), train.std(0) + 1e-6
    return (train - mean) / scale, (other - mean) / scale


def router_scores(
    features: torch.Tensor,
    targets: torch.Tensor,
    families: list[str],
    strength: float,
    lofo: bool,
) -> torch.Tensor:
    if not lofo:
        train, _ = standardized(features, features)
        weights, bias = fit_router(train, targets, strength)
        return train @ weights + bias
    scores = torch.zeros(len(families), dtype=torch.float64)
    for held_out in sorted(set(families)):
        held = torch.tensor([family == held_out for family in families])
        train, test = standardized(features[~held], features[held])
        weights, bias = fit_router(train, targets[~held], strength)
        scores[held] = test @ weights + bias
    return scores


def prefix_report(scores: torch.Tensor, exact: list[bool], families: list[str]) -> dict[str, Any]:
    order = scores.argsort(descending=True).tolist()
    exact_count = 0
    largest: dict[float, int] = {target: 0 for target in PRECISION_TARGETS}
    prefixes = []
    for size, index in enumerate(order, start=1):
        exact_count += exact[index]
        if size in PREFIX_SIZES:
            top = order[:size]
            per_family: dict[str, list[int]] = {}
            for row_index in top:
                counts = per_family.setdefault(families[row_index], [0, 0])
                counts[0] += exact[row_index]
                counts[1] += 1
            prefixes.append(
                {
                    "rows": size,
                    "exactRows": exact_count,
                    "lowerBound": round(clopper_pearson_lower_bound(exact_count, size), 6),
                    "byFamily": {family: f"{good}/{total}" for family, (good, total) in sorted(per_family.items())},
                }
            )
        for target in PRECISION_TARGETS:
            if size - exact_count <= size * (1 - target) and clopper_pearson_lower_bound(exact_count, size) >= target:
                largest[target] = size
    return {
        "prefixes": prefixes,
        "largestCertifiablePrefixRows": {str(target): rows for target, rows in largest.items()},
    }


def main() -> int:
    torch.set_num_threads(FEATURE_THREADS)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset-dir", type=Path, default=DEFAULT_DATASET_DIRECTORY)
    parser.add_argument(
        "--diagnostics",
        type=Path,
        default=DEFAULT_MODEL_DIRECTORY / "domain-adapt-independent-v2" / "diagnostics-oof.json",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_MODEL_DIRECTORY / "b5-router-feasibility" / "router-feasibility.json",
    )
    args = parser.parse_args()
    check_resource_budget("router feasibility")
    diagnostics = json.loads(args.diagnostics.read_text(encoding="utf-8"))
    rows = multi_candidate_rows(args.dataset_dir.resolve(), diagnostics)
    families = [row["family"] for row in rows]
    features = feature_matrix(rows)
    results: dict[str, Any] = {}
    for choice, key in COMMIT_CHOICES.items():
        exact = [row[key] for row in rows]
        targets = torch.tensor(exact, dtype=torch.float64)
        results[choice] = {
            "exactRows": sum(exact),
            "rows": len(exact),
            "byRegularization": {
                str(strength): {
                    mode: prefix_report(
                        router_scores(features, targets, families, strength, lofo=mode == "lofo"),
                        exact,
                        families,
                    )
                    for mode in ("in-sample", "lofo")
                }
                for strength in REGULARIZATION_STRENGTHS
            },
        }
        check_resource_budget("router feasibility")
    report = {
        "schema": FEASIBILITY_SCHEMA,
        "diagnosticsSha256": sha256_file(args.diagnostics),
        "diagnosticsSchema": diagnostics["schema"],
        "trustedMultiCandidateRows": len(rows),
        "featureCount": features.shape[1],
        "precisionTargets": list(PRECISION_TARGETS),
        "alpha": ONE_SIDED_ALPHA,
        "rowLevelBoundIsOptimistic": True,
        "lofoFeaturesAreSecondOrderLeaky": True,
        "heldOutSplitsRead": [],
        "results": results,
    }
    write_json(args.output, report)
    summary = {
        choice: {
            strength: {
                mode: values[mode]["largestCertifiablePrefixRows"]["0.99"]
                for mode in ("in-sample", "lofo")
            }
            for strength, values in result["byRegularization"].items()
        }
        for choice, result in results.items()
    }
    print(json.dumps({"event": "router-feasibility-complete", "output": str(args.output), "largestPrefixAt0.99": summary}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
