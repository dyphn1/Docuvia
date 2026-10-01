"""Write component-level LOFO diagnostics outside the P2 scorer protocol."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

import torch

from adapter import is_trusted_label, state_repository_family, training_targets
from constants import DEFAULT_DATASET_DIRECTORY, REQUEST_KEY, TRAINING_SPLITS
from resource_budget import check_resource_budget
from score import domain_paths, score_chunk
from train import paired_rows, sha256_file


DIAGNOSTICS_SCHEMA = "cua-s1-independent-event-diagnostics/v1"


def binary_auc(observations: list[tuple[float, int]]) -> float | None:
    positives = sum(target == 1 for _, target in observations)
    negatives = len(observations) - positives
    if positives == 0 or negatives == 0:
        return None
    ordered = sorted(observations, key=lambda item: item[0])
    positive_rank_sum = 0.0
    index = 0
    while index < len(ordered):
        end = index + 1
        while end < len(ordered) and ordered[end][0] == ordered[index][0]:
            end += 1
        average_rank = ((index + 1) + end) / 2
        positive_rank_sum += average_rank * sum(
            target == 1 for _, target in ordered[index:end]
        )
        index = end
    return (positive_rank_sum - positives * (positives + 1) / 2) / (positives * negatives)


def classification_metrics(observations: list[tuple[float, int]]) -> dict[str, Any]:
    return {
        "sampleCount": len(observations),
        "positiveCount": sum(target == 1 for _, target in observations),
        "negativeCount": sum(target == 0 for _, target in observations),
        "auroc": _rounded(binary_auc(observations)),
        "brier": _rounded(
            sum((probability - target) ** 2 for probability, target in observations)
            / len(observations)
            if observations
            else None
        ),
    }


def _rounded(value: float | None) -> float | None:
    return round(value, 8) if value is not None else None


def _top1_summary(rows: list[dict[str, Any]], *, require_multiple: bool) -> dict[str, Any]:
    eligible = [
        row
        for row in rows
        if row["trusted"]
        and not row["candidateMiss"]
        and row["candidateCount"] > 0
        and (not require_multiple or row["candidateCount"] > 1)
        and row["candidatePositiveCount"] > 0
    ]
    correct = sum(row["candidateTop1Correct"] for row in eligible)
    return {
        "correct": correct,
        "eligibleRequestCount": len(eligible),
        "accuracy": _rounded(correct / len(eligible) if eligible else None),
    }


def _process_batch(
    split: str,
    pairs: list[tuple[dict[str, Any], dict[str, Any]]],
    scorer_arguments: argparse.Namespace,
    model_paths: tuple[dict[str, str], set[str], Path],
    model_cache: dict[str, tuple[Any, Any]],
    fold_training_families: dict[str, list[str]],
) -> tuple[list[dict[str, Any]], list[tuple[float, int]]]:
    states = [state for state, _ in pairs]
    component_rows: list[dict[str, Any]] = []
    responses = score_chunk(
        states,
        scorer_arguments,
        model_paths,
        model_cache,
        component_rows,
    )
    component_by_id = {row["requestId"]: row for row in component_rows}
    result_rows: list[dict[str, Any]] = []
    routing_observations: list[tuple[float, int]] = []
    for state, labels, response in (
        (state, labels, response)
        for (state, labels), response in zip(pairs, responses, strict=True)
    ):
        request = state[REQUEST_KEY]
        request_id = request["requestId"]
        family = state_repository_family(state)
        components = component_by_id.get(request_id)
        if response.get("status") != "ok" or components is None:
            raise RuntimeError(f"OOF component scorer failed for {request_id}")
        if response.get("foldFamily") != family or components.get("foldFamily") != family:
            raise AssertionError(f"OOF fold assignment mismatch for {request_id}")
        if family in fold_training_families.get(family, []):
            raise AssertionError(f"LOFO model was trained on its held-out family {family}")

        targets = training_targets(request, labels)
        trusted = is_trusted_label(labels)
        positive_targets = set(labels.get("positiveTargetIds", []))
        candidates = [option for option in request["options"] if option.get("kind") == "candidate"]
        option_probabilities = components["optionProbabilities"]
        candidate_rows = []
        for option, is_candidate, target, weight in zip(
            request["options"],
            targets.candidate_mask,
            targets.option_targets,
            targets.option_weights,
            strict=True,
        ):
            if not is_candidate:
                continue
            option_id = option["id"]
            target_id = option.get("attributes", {}).get("targetId")
            raw_probability = float(option_probabilities[option_id])
            candidate_rows.append(
                {
                    "optionId": option_id,
                    "targetId": target_id,
                    "rawCandidateProbability": raw_probability,
                    "composedProbability": response["scores"][option_id],
                    "target": int(target),
                    "lossWeight": weight,
                }
            )
        candidate_probabilities = [row["rawCandidateProbability"] for row in candidate_rows]
        top_index = max(
            range(len(candidate_rows)),
            key=lambda index: candidate_probabilities[index],
            default=None,
        )
        top1_correct = (
            top_index is not None and candidate_rows[top_index]["targetId"] in positive_targets
        )
        candidate_positive_count = sum(target_id in positive_targets for target_id in (row["targetId"] for row in candidate_rows))
        output_row = {
            "requestId": request_id,
            "split": split,
            "repoFamily": family,
            "foldFamily": components["foldFamily"],
            "trusted": trusted,
            "candidateMiss": labels.get("candidateMiss"),
            "candidateCount": len(candidates),
            "goldPositiveCount": len(positive_targets),
            "candidatePositiveCount": candidate_positive_count,
            "routingTarget": int(targets.routing_target),
            "routingProbability": float(components["routingProbability"]),
            "candidateTop1Correct": bool(top1_correct),
            "candidates": candidate_rows,
        }
        result_rows.append(output_row)
        if trusted:
            routing_observations.append(
                (output_row["routingProbability"], output_row["routingTarget"])
            )
    return result_rows, routing_observations


def run_diagnostics(
    dataset_directory: Path,
    weights_directory: Path,
    training_manifest_path: Path,
) -> dict[str, Any]:
    check_resource_budget("OOF diagnostics")
    training_manifest = json.loads(training_manifest_path.read_text(encoding="utf-8"))
    fold_training_families = training_manifest.get("foldTrainingFamilies")
    if not isinstance(fold_training_families, dict):
        raise ValueError("training manifest is missing its fold-family plan")
    scorer_arguments = argparse.Namespace(weights_dir=weights_directory, reference_config=None)
    model_paths = domain_paths(weights_directory)
    model_cache: dict[str, tuple[Any, Any]] = {}
    all_rows: list[dict[str, Any]] = []
    routing_observations: list[tuple[float, int]] = []
    by_split: dict[str, dict[str, Any]] = {}

    for split in TRAINING_SPLITS:
        split_rows: list[dict[str, Any]] = []
        split_routing_observations: list[tuple[float, int]] = []
        batch: list[tuple[dict[str, Any], dict[str, Any]]] = []
        for pair in paired_rows(dataset_directory, split):
            batch.append(pair)
            if len(batch) >= 64:
                rows, routes = _process_batch(
                    split,
                    batch,
                    scorer_arguments,
                    model_paths,
                    model_cache,
                    fold_training_families,
                )
                split_rows.extend(rows)
                split_routing_observations.extend(routes)
                batch.clear()
        if batch:
            rows, routes = _process_batch(
                split,
                batch,
                scorer_arguments,
                model_paths,
                model_cache,
                fold_training_families,
            )
            split_rows.extend(rows)
            split_routing_observations.extend(routes)
        all_rows.extend(split_rows)
        routing_observations.extend(split_routing_observations)
        by_split[split] = {
            "requestCount": len(split_rows),
            "trustedRequestCount": sum(row["trusted"] for row in split_rows),
            "routing": classification_metrics(split_routing_observations),
            "candidate": _candidate_summary(split_rows),
        }

    check_resource_budget("OOF diagnostics completion")
    return {
        "schema": DIAGNOSTICS_SCHEMA,
        "scorerVersion": training_manifest.get("scorerVersion"),
        "protocol": "system1-eval-protocol/v2",
        "heldOutSplitsRead": [],
        "trainingManifestSha256": sha256_file(training_manifest_path),
        "routingTargetDefinition": training_manifest.get("routingTargetDefinition"),
        "maskingCounts": training_manifest.get("labelCounts"),
        "oof": {
            "requestCount": len(all_rows),
            "trustedRequestCount": sum(row["trusted"] for row in all_rows),
            "routing": classification_metrics(routing_observations),
            "candidate": _candidate_summary(all_rows),
            "bySplit": by_split,
        },
        "requests": all_rows,
    }


def _candidate_summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
    trusted_rows = [row for row in rows if row["trusted"]]
    return {
        "trustedRequestCount": len(trusted_rows),
        "multiCandidateRequestCount": sum(row["candidateCount"] > 1 for row in trusted_rows),
        "multiPositiveRequestCount": sum(row["goldPositiveCount"] > 1 for row in trusted_rows),
        "multiPositiveMultiCandidateRequestCount": sum(
            row["goldPositiveCount"] > 1 and row["candidateCount"] > 1
            for row in trusted_rows
        ),
        "top1AllCandidateSets": _top1_summary(trusted_rows, require_multiple=False),
        "top1MultiCandidateSets": _top1_summary(trusted_rows, require_multiple=True),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset-dir", type=Path, default=DEFAULT_DATASET_DIRECTORY)
    parser.add_argument("--weights-dir", type=Path, required=True)
    parser.add_argument("--training-manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    torch.set_num_threads(4)
    torch.set_num_interop_threads(1)
    torch.use_deterministic_algorithms(True)
    report = run_diagnostics(
        arguments.dataset_dir.resolve(),
        arguments.weights_dir.resolve(),
        arguments.training_manifest.resolve(),
    )
    output_path = arguments.output.resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    summary = {key: value for key, value in report.items() if key != "requests"}
    print(json.dumps(summary, sort_keys=True), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
