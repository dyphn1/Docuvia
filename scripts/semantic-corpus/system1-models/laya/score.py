"""State-only JSONL adapter for the unchanged System-1 P2 external-scorer protocol."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
import time
from pathlib import Path
from typing import Any, Mapping

os.environ["OMP_NUM_THREADS"] = "4"
os.environ["MKL_NUM_THREADS"] = "4"
os.environ["VECLIB_MAXIMUM_THREADS"] = "4"
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"

import torch
from safetensors.torch import load_file

from adapter import encode_example, state_repository_family, state_request_id
from laya_constants import (
    DEFAULT_OUTPUT_DIRECTORY,
    HEAD_CONFIG_NAME,
    HEAD_WEIGHTS_NAME,
    HIDDEN_SIZE,
    INFERENCE_BATCH_SIZE,
    MAX_STATE_LINE_BYTES,
    RESOURCE_CHECK_INTERVAL_SECONDS,
    SCORER_CONFIG_NAME,
    SCORE_KIND_RAW,
    STATUS_ERROR,
    STATUS_OK,
    TRAINING_MANIFEST_NAME,
    CONTROL_UNKNOWN_ID,
    CONTROL_VERIFY_ID,
)
from model import EncoderSession, OptionScoringHead, encode_text_pairs, load_encoder
from resource_budget import check_resource_budget
from train import sha256_file


PROGRESS_INTERVAL_SECONDS = 180


def error_response(request_id: str) -> dict[str, Any]:
    return {
        "requestId": request_id,
        "status": STATUS_ERROR,
        "scoreKind": SCORE_KIND_RAW,
        "scores": {},
    }


def success_response(
    request_id: str,
    encoded: Any,
    option_probabilities: tuple[float, ...] | list[float],
    fold_family: str | None,
) -> dict[str, Any]:
    if len(encoded.option_ids) != len(option_probabilities):
        raise ValueError("option ids and probabilities must have equal lengths")
    scores: dict[str, float] = {}
    for option_id, probability in zip(
        encoded.option_ids, option_probabilities, strict=True
    ):
        if not math.isfinite(probability) or not 0.0 <= probability <= 1.0:
            raise ValueError("option probabilities must be finite values in [0, 1]")
        scores[option_id] = round(float(probability), 6)
    response: dict[str, Any] = {
        "requestId": request_id,
        "status": STATUS_OK,
        "scoreKind": SCORE_KIND_RAW,
        "scores": scores,
    }
    if fold_family is not None:
        response["foldFamily"] = fold_family
    return response


def _load_head(directory: Path) -> OptionScoringHead:
    config_path = directory / HEAD_CONFIG_NAME
    weights_path = directory / HEAD_WEIGHTS_NAME
    config = json.loads(config_path.read_text(encoding="utf-8"))
    if (
        config.get("schema") != "laya-system1-option-head/v1"
        or config.get("inputSize") != HIDDEN_SIZE
        or config.get("outputCount") != 1
    ):
        raise ValueError(f"invalid Laya option-head config: {config_path}")
    head = OptionScoringHead(
        input_size=config["inputSize"], hidden_size=config["hiddenSize"]
    )
    head.load_state_dict(load_file(str(weights_path), device="cpu"), strict=True)
    head.eval()
    return head


class LayaScorer:
    """One loaded Laya encoder shared by all family heads and state-only clients."""

    def __init__(
        self,
        weights_directory: Path,
        *,
        emit_progress: bool = True,
    ) -> None:
        self._started = time.monotonic()
        self.weights_directory = weights_directory.expanduser().resolve()
        self.config_path = self.weights_directory.parent / SCORER_CONFIG_NAME
        self.config = json.loads(self.config_path.read_text(encoding="utf-8"))
        if self.config.get("schema") != "laya-system1-scorer-config/v1":
            raise ValueError("Laya scorer config schema is unsupported")
        manifest_path = self.config_path.parent / TRAINING_MANIFEST_NAME
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if (
            sha256_file(self.config_path) != manifest.get("scorerConfigSha256")
            or manifest.get("scorerId") != self.config.get("scorerId")
            or manifest.get("version") != self.config.get("scorerVersion")
        ):
            raise ValueError("Laya scorer config hash does not match its manifest")
        self.pool_families = set(self.config.get("poolFamilies", []))
        fold_paths = self.config.get("foldModelPaths")
        if not isinstance(fold_paths, Mapping) or set(fold_paths) != self.pool_families:
            raise ValueError("Laya scorer config has incomplete LOFO head paths")
        expected_fold_hashes = manifest.get("foldModelHashes")
        if not isinstance(expected_fold_hashes, Mapping):
            raise ValueError("Laya training manifest is missing fold head hashes")
        for family, path in fold_paths.items():
            fold_metadata = expected_fold_hashes.get(family)
            expected = (
                fold_metadata.get("weightsSha256")
                if isinstance(fold_metadata, Mapping)
                else None
            )
            expected_config = (
                fold_metadata.get("configSha256")
                if isinstance(fold_metadata, Mapping)
                else None
            )
            head_directory = self.weights_directory / path
            if (
                not isinstance(expected, str)
                or sha256_file(head_directory / HEAD_WEIGHTS_NAME) != expected
                or not isinstance(expected_config, str)
                or sha256_file(head_directory / HEAD_CONFIG_NAME) != expected_config
            ):
                raise ValueError(f"Laya fold head hash mismatch for {family}")
        self.fold_heads = {
            family: _load_head(self.weights_directory / path)
            for family, path in fold_paths.items()
        }
        final_path = self.config.get("finalModelPath")
        if not isinstance(final_path, str):
            raise ValueError("Laya scorer config is missing its final head path")
        final_hashes = manifest.get("finalModelHashes")
        expected_final_hash = final_hashes.get("weightsSha256") if isinstance(final_hashes, Mapping) else None
        expected_final_config_hash = (
            final_hashes.get("configSha256") if isinstance(final_hashes, Mapping) else None
        )
        final_directory = self.weights_directory / final_path
        if (
            not isinstance(expected_final_hash, str)
            or sha256_file(final_directory / HEAD_WEIGHTS_NAME) != expected_final_hash
            or not isinstance(expected_final_config_hash, str)
            or sha256_file(final_directory / HEAD_CONFIG_NAME) != expected_final_config_hash
        ):
            raise ValueError("Laya final head hash mismatch")
        self.final_head = _load_head(self.weights_directory / final_path)
        base_model_directory = Path(self.config["baseModelDirectory"])
        expected_hash = self.config.get("baseModelSha256")
        if not isinstance(expected_hash, str) or sha256_file(base_model_directory / "model.safetensors") != expected_hash:
            raise ValueError("Laya base encoder checkpoint hash mismatch")
        self.encoder_session: EncoderSession = load_encoder(base_model_directory)
        self.max_sequence_length = int(self.config["maxSequenceLength"])
        self.emit_progress = emit_progress
        self.requests_scored = 0
        self._last_progress = time.monotonic()
        snapshot = check_resource_budget("Laya scorer loaded")
        self._write_progress(
            "laya-score-loaded",
            requests=0,
            option_events=0,
            snapshot=snapshot,
            elapsed_seconds=time.monotonic() - self._started,
        )

    @staticmethod
    def _write_progress(
        event: str,
        *,
        requests: int,
        option_events: int,
        snapshot: Any,
        elapsed_seconds: float | None = None,
    ) -> None:
        progress_path = os.environ.get("LAYA_PROGRESS_LOG")
        if not progress_path:
            return
        path = Path(progress_path).expanduser().resolve()
        path.parent.mkdir(parents=True, exist_ok=True)
        record = {
            "event": event,
            "elapsedSeconds": round(elapsed_seconds, 3) if elapsed_seconds is not None else None,
            "requests": requests,
            "optionEvents": option_events,
            "rssBytes": snapshot.process_rss_bytes,
            "freeMemoryPercent": snapshot.system_free_memory_percent,
        }
        with path.open("a", encoding="utf-8") as output:
            output.write(json.dumps(record, sort_keys=True, separators=(",", ":")) + "\n")

    def score_batch(self, states: list[dict[str, Any]]) -> list[dict[str, Any]]:
        responses: list[dict[str, Any] | None] = [None] * len(states)
        encoded_rows: list[tuple[int, str, Any, str | None]] = []
        contexts: list[str] = []
        options: list[str] = []
        event_locations: list[tuple[int, int, str]] = []
        probability_rows: list[list[float | None]] = [[] for _ in states]
        last_resource_check = time.monotonic()

        for index, state in enumerate(states):
            request_id = state_request_id(state)
            try:
                encoded = encode_example(state)
                family = state_repository_family(state)
                fold_family = family if family in self.pool_families else None
                encoded_rows.append((index, request_id, encoded, fold_family))
                probability_rows[index] = [None] * len(encoded.option_ids)
                for option_index, option_text in enumerate(encoded.options):
                    contexts.append(encoded.context)
                    options.append(option_text)
                    event_locations.append((index, option_index, family))
            except Exception as error:
                if isinstance(error, MemoryError):
                    raise
                responses[index] = error_response(request_id)

        for batch_start in range(0, len(contexts), INFERENCE_BATCH_SIZE):
            batch_stop = min(batch_start + INFERENCE_BATCH_SIZE, len(contexts))
            features = encode_text_pairs(
                self.encoder_session,
                contexts[batch_start:batch_stop],
                options[batch_start:batch_stop],
                max_length=self.max_sequence_length,
            )
            by_head: dict[str, list[int]] = {}
            for local_index, (_state_index, _option_index, family) in enumerate(
                event_locations[batch_start:batch_stop]
            ):
                head_key = family if family in self.fold_heads else "final"
                by_head.setdefault(head_key, []).append(local_index)
            with torch.inference_mode():
                for head_key, local_indices in by_head.items():
                    head = self.fold_heads[head_key] if head_key != "final" else self.final_head
                    tensor_indices = torch.tensor(local_indices, dtype=torch.long)
                    logits = head(features.index_select(0, tensor_indices))
                    probabilities = torch.sigmoid(logits).tolist()
                    for local_index, probability in zip(
                        local_indices, probabilities, strict=True
                    ):
                        state_index, option_index, _family = event_locations[
                            batch_start + local_index
                        ]
                        probability_rows[state_index][option_index] = float(probability)
            now = time.monotonic()
            if now - last_resource_check >= RESOURCE_CHECK_INTERVAL_SECONDS:
                check_resource_budget("Laya scorer batch progress")
                last_resource_check = now

        for index, request_id, encoded, fold_family in encoded_rows:
            row_probabilities = probability_rows[index]
            if any(value is None for value in row_probabilities):
                responses[index] = error_response(request_id)
                continue
            responses[index] = success_response(
                request_id,
                encoded,
                [float(value) for value in row_probabilities if value is not None],
                fold_family,
            )
        self.requests_scored += len(states)
        final_snapshot = check_resource_budget("Laya scorer batch complete")
        self._write_progress(
            "laya-score-batch-complete",
            requests=len(states),
            option_events=len(contexts),
            snapshot=final_snapshot,
            elapsed_seconds=time.monotonic() - self._started,
        )
        now = time.monotonic()
        if self.emit_progress and now - self._last_progress >= PROGRESS_INTERVAL_SECONDS:
            print(
                json.dumps(
                    {
                        "event": "laya-score-progress",
                        "requestsScored": self.requests_scored,
                        "rssBytes": final_snapshot.process_rss_bytes,
                        "freeMemoryPercent": final_snapshot.system_free_memory_percent,
                    },
                    sort_keys=True,
                ),
                file=sys.stderr,
                flush=True,
            )
            self._last_progress = now
        return [response or error_response("invalid-request") for response in responses]


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--weights-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIRECTORY / "models",
        help="Directory containing final/ and folds/ option heads.",
    )
    return parser.parse_args()


def _stdin_states() -> None:
    torch.set_num_threads(4)
    torch.set_num_interop_threads(1)
    torch.use_deterministic_algorithms(True)
    scorer = LayaScorer(parse_arguments().weights_dir)
    pending: list[dict[str, Any]] = []
    for raw_line in sys.stdin.buffer:
        if len(raw_line) > MAX_STATE_LINE_BYTES:
            print(json.dumps(error_response("invalid-request"), separators=(",", ":")))
            continue
        try:
            value = json.loads(raw_line)
            if not isinstance(value, dict):
                raise ValueError("state line must be an object")
            pending.append(value)
        except (json.JSONDecodeError, ValueError):
            print(json.dumps(error_response("invalid-request"), separators=(",", ":")))
            continue
        if len(pending) >= 64:
            for response in scorer.score_batch(pending):
                print(json.dumps(response, ensure_ascii=False, separators=(",", ":")))
            sys.stdout.flush()
            pending.clear()
    if pending:
        for response in scorer.score_batch(pending):
            print(json.dumps(response, ensure_ascii=False, separators=(",", ":")))
    sys.stdout.flush()
    check_resource_budget("Laya scorer complete")


if __name__ == "__main__":
    _stdin_states()
