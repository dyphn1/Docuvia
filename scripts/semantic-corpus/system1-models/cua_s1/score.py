"""CPU JSONL scorer adapter for CUA-S1 and the P2 external protocol."""

from __future__ import annotations

import argparse
import json
import os
import resource
import sys
from pathlib import Path
from typing import Any

os.environ["OMP_NUM_THREADS"] = "4"
os.environ["MKL_NUM_THREADS"] = "4"
os.environ["VECLIB_MAXIMUM_THREADS"] = "4"

import torch
from cua_s1.model import ChoiceExample, load_checkpoint

from adapter import encode_example, state_repository_family
from constants import (
    CHECKPOINT_PATH_KEY,
    FOLD_FAMILY_KEY,
    INFERENCE_BATCH_SIZE,
    MAX_PROCESS_RSS_BYTES,
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
)

torch.set_num_threads(4)
torch.set_num_interop_threads(1)
torch.use_deterministic_algorithms(True)


def rss_bytes() -> int:
    value = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return int(value if sys.platform == "darwin" else value * 1024)


def assert_process_budget() -> None:
    process_rss = rss_bytes()
    if process_rss > MAX_PROCESS_RSS_BYTES:
        raise MemoryError(f"scorer process RSS exceeded 3 GiB: {process_rss} bytes")


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
    if not isinstance(fold_families, dict) or not isinstance(checkpoint_paths, dict):
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


def score_chunk(
    states: list[dict[str, Any]],
    arguments: argparse.Namespace,
    domain_model_paths: tuple[dict[str, str], set[str], Path] | None,
    model_cache: dict[str, tuple[Any, Any]],
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
                model, collator, _ = load_checkpoint(checkpoint, "cpu")
                model.eval()
                model_cache[checkpoint] = (model, collator)
            model, collator = model_cache[checkpoint]
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
                    probabilities = torch.sigmoid(model(batch)).cpu()
                for local_index, (state_index, encoded, fold_family) in enumerate(batch_rows):
                    score_map = {
                        option_id: round(float(probability), 6)
                        for option_id, probability in zip(
                            encoded.option_ids,
                            probabilities[local_index, : len(encoded.option_ids)],
                            strict=True,
                        )
                    }
                    request_id = request_id_of(states[state_index])
                    response: dict[str, Any] = {
                        REQUEST_ID_KEY: request_id,
                        STATUS_KEY: STATUS_OK,
                        SCORE_KIND_KEY: SCORE_KIND_RAW,
                        SCORES_KEY: score_map,
                    }
                    if fold_family is not None:
                        response[FOLD_FAMILY_KEY] = fold_family
                    responses[state_index] = response
            except Exception:
                for state_index, _encoded, _fold_family in batch_rows:
                    responses[state_index] = error_response(request_id_of(states[state_index]))
    return [response or error_response(request_id_of(state)) for response, state in zip(responses, states, strict=True)]


def main() -> int:
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
    if rss_bytes() > MAX_PROCESS_RSS_BYTES:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
