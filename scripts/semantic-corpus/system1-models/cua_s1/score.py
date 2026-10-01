"""CPU JSONL scorer adapter for CUA-S1 and the P2 external protocol."""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from pathlib import Path
from typing import Any

os.environ["OMP_NUM_THREADS"] = "4"
os.environ["MKL_NUM_THREADS"] = "4"
os.environ["VECLIB_MAXIMUM_THREADS"] = "4"

import torch
from cua_s1.model import ChoiceExample, load_checkpoint

from adapter import EncodedExample, encode_example, state_repository_family
from constants import MODEL_CONFIG, ROUTING_HEAD_FILENAME
from constants import (
    CHECKPOINT_PATH_KEY,
    FOLD_FAMILY_KEY,
    INFERENCE_BATCH_SIZE,
    MAX_STATE_LINE_BYTES,
    POOL_FAMILIES_KEY,
    REQUEST_ID_KEY,
    REQUEST_KEY,
    SCORE_KIND_KEY,
    SCORE_KIND_RAW,
    SCORES_KEY,
    STATUS_ERROR,
    STATUS_KEY,
    STATUS_OK,
    UNKNOWN_OPTION_ID,
    VERIFY_OPTION_ID,
)
from resource_budget import check_process_rss_budget, check_resource_budget
from routed_model import RoutedModel, load_routing_head

def assert_process_budget() -> None:
    check_resource_budget("scorer")


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--weights-dir", type=Path)
    group.add_argument("--reference-config", type=Path)
    return parser.parse_args()


def domain_paths(weights_directory: Path) -> tuple[dict[str, str], set[str], Path]:
    root = weights_directory.resolve()
    config_path = root.parent / "scorer-config.json"
    configuration = json.loads(config_path.read_text(encoding="utf-8"))
    fold_families = configuration.get("foldTrainingFamilies")
    checkpoint_paths = configuration.get("foldModelPaths")
    if (
        configuration.get("schema") != "cua-s1-system1-scorer-config/v2"
        or configuration.get("routingHeadFile") != ROUTING_HEAD_FILENAME
        or not isinstance(fold_families, dict)
        or not isinstance(checkpoint_paths, dict)
    ):
        raise ValueError("domain scorer config is missing LOFO fold families")
    model_paths = {
        family: str(root / checkpoint_paths[family])
        for family in fold_families
        if isinstance(checkpoint_paths.get(family), str)
    }
    if set(model_paths) != set(fold_families):
        raise ValueError("domain scorer config has incomplete fold checkpoint paths")
    final_model = root / "final" / "model.safetensors"
    return model_paths, set(fold_families), final_model


def select_model(
    family: str,
    arguments: argparse.Namespace,
    domain_model_paths: tuple[dict[str, str], set[str], Path] | None,
) -> tuple[str, str | None]:
    if arguments.reference_config is not None:
        checkpoint = arguments.reference_document.get(CHECKPOINT_PATH_KEY)
        pool_families = arguments.reference_document.get(POOL_FAMILIES_KEY)
        if not isinstance(checkpoint, str) or not isinstance(pool_families, list):
            raise ValueError("reference config must declare checkpointPath and poolFamilies")
        if any(not isinstance(item, str) for item in pool_families):
            raise ValueError("reference poolFamilies must contain only strings")
        return checkpoint, family if family in set(pool_families) else None
    assert domain_model_paths is not None
    fold_paths, pool_families, final_model = domain_model_paths
    if family in pool_families:
        return fold_paths[family], family
    return str(final_model), None


def error_response(request_id: str) -> dict[str, Any]:
    return {
        REQUEST_ID_KEY: request_id,
        STATUS_KEY: STATUS_ERROR,
        SCORE_KIND_KEY: SCORE_KIND_RAW,
        SCORES_KEY: {},
    }


def request_id_of(state: Any) -> str:
    if isinstance(state, dict):
        request = state.get(REQUEST_KEY)
        if isinstance(request, dict) and isinstance(request.get(REQUEST_ID_KEY), str):
            return request[REQUEST_ID_KEY]
    return "invalid-request"


def format_score_map(
    option_ids: tuple[str, ...],
    option_probabilities: tuple[float, ...] | list[float],
    routing_probability: float | None,
) -> dict[str, float]:
    """Map independent head probabilities onto the unchanged P2 option keys."""
    if len(option_ids) != len(option_probabilities):
        raise ValueError("option ids and probabilities must have equal lengths")
    if routing_probability is not None and not 0.0 <= routing_probability <= 1.0:
        raise ValueError("routing probability must be in [0, 1]")
    scores: dict[str, float] = {}
    for option_id, probability in zip(option_ids, option_probabilities, strict=True):
        if not math.isfinite(probability) or not 0.0 <= probability <= 1.0:
            raise ValueError("option probabilities must be finite values in [0, 1]")
        if routing_probability is None:
            score = probability
        elif option_id == VERIFY_OPTION_ID:
            score = 1.0 - routing_probability
        elif option_id == UNKNOWN_OPTION_ID:
            score = probability
        else:
            score = probability * routing_probability
        scores[option_id] = round(float(score), 6)
    return scores


def success_response(
    request_id: str,
    encoded: EncodedExample,
    option_probabilities: tuple[float, ...] | list[float],
    routing_probability: float | None,
    fold_family: str | None,
) -> dict[str, Any]:
    """Create the unchanged P2 response envelope from the model components."""
    response: dict[str, Any] = {
        REQUEST_ID_KEY: request_id,
        STATUS_KEY: STATUS_OK,
        SCORE_KIND_KEY: SCORE_KIND_RAW,
        SCORES_KEY: format_score_map(
            encoded.option_ids,
            option_probabilities,
            routing_probability,
        ),
    }
    if fold_family is not None:
        response[FOLD_FAMILY_KEY] = fold_family
    return response


def score_chunk(
    states: list[dict[str, Any]],
    arguments: argparse.Namespace,
    domain_model_paths: tuple[dict[str, str], set[str], Path] | None,
    model_cache: dict[str, tuple[Any, Any]],
    diagnostic_rows: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    responses: list[dict[str, Any] | None] = [None] * len(states)
    groups: dict[str, list[tuple[int, Any, str | None]]] = {}
    for index, state in enumerate(states):
        request_id = request_id_of(state)
        try:
            encoded = encode_example(state)
            family = state_repository_family(state)
            checkpoint, fold_family = select_model(family, arguments, domain_model_paths)
            groups.setdefault(checkpoint, []).append((index, encoded, fold_family))
        except Exception:
            responses[index] = error_response(request_id)

    for checkpoint, rows in groups.items():
        try:
            if checkpoint not in model_cache:
                option_model, collator, _ = load_checkpoint(checkpoint, "cpu")
                if arguments.weights_dir is None:
                    model = option_model
                else:
                    model = RoutedModel(option_model, MODEL_CONFIG["width"])
                    model.routing_head = load_routing_head(
                        Path(checkpoint).with_name(ROUTING_HEAD_FILENAME),
                        MODEL_CONFIG["width"],
                        "cpu",
                    )
                model.eval()
                model_cache[checkpoint] = (model, collator)
            assert_process_budget()
            model, collator = model_cache[checkpoint]
        except MemoryError:
            raise
        except Exception:
            for index, encoded, _fold in rows:
                responses[index] = error_response(request_id_of(states[index]))
            continue

        for offset in range(0, len(rows), INFERENCE_BATCH_SIZE):
            batch_rows = rows[offset : offset + INFERENCE_BATCH_SIZE]
            examples = [ChoiceExample(row.context, row.options, 0) for _, row, _ in batch_rows]
            try:
                batch = collator(examples)
                with torch.inference_mode():
                    if arguments.weights_dir is None:
                        option_probabilities = torch.sigmoid(model(batch)).cpu()
                        routing_probabilities = None
                    else:
                        option_logits, routing_logits = model(batch)
                        option_probabilities = torch.sigmoid(option_logits).cpu()
                        routing_probabilities = torch.sigmoid(routing_logits).cpu()
                for local_index, (state_index, encoded, fold_family) in enumerate(batch_rows):
                    row_probabilities = [
                        float(value)
                        for value in option_probabilities[local_index, : len(encoded.option_ids)]
                    ]
                    routing_probability = (
                        float(routing_probabilities[local_index])
                        if routing_probabilities is not None
                        else None
                    )
                    request_id = request_id_of(states[state_index])
                    response = success_response(
                        request_id,
                        encoded,
                        row_probabilities,
                        routing_probability,
                        fold_family,
                    )
                    responses[state_index] = response
                    if diagnostic_rows is not None:
                        if routing_probability is None:
                            raise ValueError("component diagnostics require a trained routing head")
                        diagnostic_rows.append(
                            {
                                REQUEST_ID_KEY: request_id,
                                FOLD_FAMILY_KEY: fold_family,
                                "routingProbability": routing_probability,
                                "optionProbabilities": dict(
                                    zip(encoded.option_ids, row_probabilities, strict=True)
                                ),
                            }
                        )
                check_process_rss_budget("scorer")
            except MemoryError:
                raise
            except Exception:
                for state_index, _encoded, _fold_family in batch_rows:
                    responses[state_index] = error_response(request_id_of(states[state_index]))
    return [response or error_response(request_id_of(state)) for response, state in zip(responses, states, strict=True)]


def main() -> int:
    torch.set_num_threads(4)
    torch.set_num_interop_threads(1)
    torch.use_deterministic_algorithms(True)
    arguments = parse_arguments()
    domain_model_paths = None
    if arguments.weights_dir is not None:
        domain_model_paths = domain_paths(arguments.weights_dir)
    else:
        arguments.reference_document = json.loads(
            arguments.reference_config.read_text(encoding="utf-8")
        )
        if not isinstance(arguments.reference_document, dict):
            raise ValueError("reference config must contain an object")
    assert_process_budget()
    model_cache: dict[str, tuple[Any, Any]] = {}
    batch: list[dict[str, Any]] = []
    for raw_line in sys.stdin.buffer:
        if len(raw_line) > MAX_STATE_LINE_BYTES:
            sys.stdout.write(json.dumps(error_response("invalid-request"), separators=(",", ":")) + "\n")
            continue
        try:
            value = json.loads(raw_line)
            if not isinstance(value, dict):
                raise ValueError("state line must be an object")
            batch.append(value)
        except (json.JSONDecodeError, ValueError):
            sys.stdout.write(json.dumps(error_response("invalid-request"), separators=(",", ":")) + "\n")
            continue
        if len(batch) >= 64:
            for response in score_chunk(batch, arguments, domain_model_paths, model_cache):
                sys.stdout.write(json.dumps(response, ensure_ascii=False, separators=(",", ":")) + "\n")
            batch.clear()
    if batch:
        for response in score_chunk(batch, arguments, domain_model_paths, model_cache):
            sys.stdout.write(json.dumps(response, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()
    assert_process_budget()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
