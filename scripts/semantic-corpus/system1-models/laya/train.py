"""Train nested-LOFO option heads over frozen Laya/mmBERT pool embeddings."""

from __future__ import annotations

import argparse
import gc
import hashlib
import importlib.metadata
import json
import os
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Iterator, Mapping

os.environ["OMP_NUM_THREADS"] = "4"
os.environ["MKL_NUM_THREADS"] = "4"
os.environ["VECLIB_MAXIMUM_THREADS"] = "4"
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"

import torch
import torch.nn.functional as functional
from safetensors.torch import save_file

from adapter import EventTargets, build_event_targets, encode_example
from cua_contract import (
    CANDIDATE_OPTION_KIND,
    LABEL_CANDIDATE_MISS_KEY,
    LABEL_POSITIVE_TARGET_IDS_KEY,
    OPTION_ATTRIBUTES_KEY,
    OPTION_ID_KEY,
    OPTION_KIND_KEY,
    OPTIONS_KEY,
    TARGET_ID_KEY,
    is_trusted_label,
    state_repository_family,
    state_request_id,
)
from laya_constants import (
    BASE_SEED,
    CONTROL_UNKNOWN_ID,
    CONTROL_VERIFY_ID,
    DEFAULT_BASE_MODEL_DIRECTORY,
    DEFAULT_DATASET_DIRECTORY,
    DEFAULT_OUTPUT_DIRECTORY,
    DIAGNOSTICS_NAME,
    ENCODER_BATCH_SIZE,
    EVENT_FEATURE_FILE_NAME,
    EVENT_INDEX_FILE_NAME,
    FOLD_SEED_OFFSET,
    HEAD_CONFIG_NAME,
    HEAD_WEIGHTS_NAME,
    HIDDEN_SIZE,
    LABEL_FILE_SUFFIX,
    LEARNING_RATE,
    MAX_GRADIENT_NORM,
    MAX_LABEL_LINE_BYTES,
    MAX_PROCESS_RSS_BYTES,
    MAX_SEQUENCE_LENGTH,
    MAX_STATE_LINE_BYTES,
    PROGRESS_INTERVAL_SECONDS,
    RESOURCE_CHECK_INTERVAL_SECONDS,
    SCORER_CONFIG_NAME,
    SCORER_ID,
    SCORER_VERSION,
    STATE_FILE_SUFFIX,
    TRAINING_BATCH_SIZE,
    TRAINING_EPOCHS,
    TRAINING_MANIFEST_NAME,
    TRAINING_SPLITS,
    WEIGHT_DECAY,
)
from model import EncoderSession, OptionScoringHead, encode_text_pairs, load_encoder
from resource_budget import check_resource_budget


PROJECTION_SCHEMA = "laya-system1-smoke-projection/v1"
TRAINING_SCHEMA = "laya-system1-training-manifest/v1"
DIAGNOSTICS_SCHEMA = "laya-system1-oof-components/v1"
SCORER_CONFIG_SCHEMA = "laya-system1-scorer-config/v1"
PROJECTION_LIMIT_SECONDS = 10 * 60 * 60
DEFAULT_SMOKE_REPORT = DEFAULT_OUTPUT_DIRECTORY / "training-projection.json"


@dataclass(frozen=True)
class PoolRequest:
    request_id: str
    split: str
    family: str
    call_kind: str
    import_kind: str
    encoded: Any
    option_kinds: tuple[str, ...]
    target_ids: tuple[str | None, ...]
    option_attributes: tuple[dict[str, Any], ...]
    targets: EventTargets
    trusted: bool
    candidate_miss: bool
    positive_target_ids: tuple[str, ...]
    feature_start: int

    @property
    def option_count(self) -> int:
        return len(self.encoded.option_ids)


def canonical_json(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode(
        "utf-8"
    )


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.replace(path)


def _read_jsonl(stream: Any, maximum: int, description: str) -> Iterator[dict[str, Any]]:
    for line_number, raw in enumerate(stream, start=1):
        if len(raw) > maximum:
            raise ValueError(f"{description} line {line_number} exceeds its bounded byte limit")
        value = json.loads(raw)
        if not isinstance(value, dict):
            raise ValueError(f"{description} line {line_number} must be an object")
        yield value


def paired_rows(dataset_directory: Path, split: str) -> Iterator[tuple[dict[str, Any], dict[str, Any]]]:
    if split not in TRAINING_SPLITS:
        raise ValueError(f"training access to split {split!r} is forbidden")
    state_path = dataset_directory / f"{split}{STATE_FILE_SUFFIX}"
    labels_path = dataset_directory / f"{split}{LABEL_FILE_SUFFIX}"
    with state_path.open("rb") as state_stream, labels_path.open("rb") as label_stream:
        states = _read_jsonl(state_stream, MAX_STATE_LINE_BYTES, f"{split} state")
        labels = _read_jsonl(label_stream, MAX_LABEL_LINE_BYTES, f"{split} labels")
        for row_number, (state, label) in enumerate(zip(states, labels, strict=True), start=1):
            if state_request_id(state) != label.get("requestId"):
                raise ValueError(f"{split} state/label requestId mismatch on row {row_number}")
            yield state, label


def pool_families(dataset_directory: Path) -> list[str]:
    families: set[str] = set()
    for split in TRAINING_SPLITS:
        state_path = dataset_directory / f"{split}{STATE_FILE_SUFFIX}"
        with state_path.open("rb") as source:
            for state in _read_jsonl(source, MAX_STATE_LINE_BYTES, f"{split} state"):
                families.add(state_repository_family(state))
    return sorted(families)


def fold_training_plan(families: list[str]) -> dict[str, Any]:
    """Build one train-on-six/score-on-one fold per pool family plus the final family set."""
    unique_families = sorted(set(families))
    if len(unique_families) != len(families):
        raise ValueError("LOFO family list contains duplicates")
    if len(unique_families) < 2:
        raise ValueError("LOFO requires at least two repository families")
    fold_training = {
        held_out: [family for family in unique_families if family != held_out]
        for held_out in unique_families
    }
    plan = {
        "mode": "folded",
        "foldTrainingFamilies": fold_training,
        "heldOutTrainingFamilies": unique_families,
    }
    assert_fold_isolation(plan, unique_families)
    return plan


def assert_fold_isolation(plan: Mapping[str, Any], families: list[str]) -> None:
    """Assert exact LOFO membership before loading the encoder or fitting any head."""
    expected = sorted(set(families))
    folds = plan.get("foldTrainingFamilies")
    if not isinstance(folds, Mapping) or sorted(folds) != expected:
        raise ValueError("LOFO plan must declare every pool family exactly once")
    if sorted(plan.get("heldOutTrainingFamilies", [])) != expected:
        raise ValueError("final model must declare training on all pool families")
    for held_out in expected:
        members = folds[held_out]
        if not isinstance(members, list) or held_out in members:
            raise ValueError(f"LOFO fold {held_out} includes its held-out family")
        if sorted(members) != [family for family in expected if family != held_out]:
            raise ValueError(f"LOFO fold training families are incomplete for {held_out}")


def _request_record(
    state: Mapping[str, Any],
    labels: Mapping[str, Any],
    split: str,
    feature_start: int,
) -> PoolRequest:
    request = state.get("request")
    if not isinstance(request, Mapping):
        raise ValueError("P1 state record is missing request")
    options = request.get(OPTIONS_KEY)
    if not isinstance(options, list):
        raise ValueError("P1 request is missing options")
    encoded = encode_example(state)
    targets = build_event_targets(request, labels)
    if len(encoded.option_ids) != len(options) or len(targets.candidate_mask) != len(options):
        raise AssertionError("encoded options and training targets are misaligned")
    ids: list[str | None] = []
    kinds: list[str] = []
    attributes: list[dict[str, Any]] = []
    for option in options:
        attrs = option.get(OPTION_ATTRIBUTES_KEY)
        attributes.append(dict(attrs) if isinstance(attrs, Mapping) else {})
        option_kind = option.get(OPTION_KIND_KEY)
        kinds.append(str(option_kind))
        target_id = attributes[-1].get(TARGET_ID_KEY)
        ids.append(target_id if isinstance(target_id, str) else None)
    candidate_miss = labels.get(LABEL_CANDIDATE_MISS_KEY)
    positive = labels.get(LABEL_POSITIVE_TARGET_IDS_KEY)
    if not isinstance(candidate_miss, bool) or not isinstance(positive, list):
        raise ValueError("training labels are missing candidateMiss or positiveTargetIds")
    if any(not isinstance(target, str) for target in positive):
        raise ValueError("positiveTargetIds must contain only strings")
    context_value = request.get("context")
    raw_context = context_value.get("text") if isinstance(context_value, Mapping) else None
    if not isinstance(raw_context, str):
        raise ValueError("P1 request context is missing text")
    context_object = json.loads(raw_context)
    call = context_object.get("call") if isinstance(context_object, dict) else None
    binding = context_object.get("importBinding") if isinstance(context_object, dict) else None
    return PoolRequest(
        request_id=state_request_id(state),
        split=split,
        family=state_repository_family(state),
        call_kind=str(call.get("kind")) if isinstance(call, Mapping) else "unknown",
        import_kind=str(binding.get("kind")) if isinstance(binding, Mapping) else "unknown",
        encoded=encoded,
        option_kinds=tuple(kinds),
        target_ids=tuple(ids),
        option_attributes=tuple(attributes),
        targets=targets,
        trusted=is_trusted_label(labels),
        candidate_miss=candidate_miss,
        positive_target_ids=tuple(sorted(set(positive))),
        feature_start=feature_start,
    )


def count_pool_events(dataset_directory: Path) -> dict[str, Any]:
    """Count fitting events and masked/trusted labels without opening held-out splits."""
    family_counts: dict[str, dict[str, int]] = {}
    split_counts: dict[str, dict[str, int]] = {}
    request_count = candidate_count = control_count = trainable_count = masked_count = 0
    trusted_count = untrusted_count = 0
    for split in TRAINING_SPLITS:
        split_row = {
            "requests": 0,
            "candidateOptions": 0,
            "protocolControls": 0,
            "trustedRequests": 0,
            "untrustedRequests": 0,
            "trainableCandidateEvents": 0,
            "maskedCandidateEvents": 0,
        }
        for state, labels in paired_rows(dataset_directory, split):
            request = state["request"]
            targets = build_event_targets(request, labels)
            family = state_repository_family(state)
            family_row = family_counts.setdefault(
                family, {"requests": 0, "trainableEvents": 0, "candidateOptions": 0}
            )
            split_row["requests"] += 1
            family_row["requests"] += 1
            request_count += 1
            if is_trusted_label(labels):
                split_row["trustedRequests"] += 1
                trusted_count += 1
            else:
                split_row["untrustedRequests"] += 1
                untrusted_count += 1
            for index, is_candidate in enumerate(targets.candidate_mask):
                if is_candidate:
                    split_row["candidateOptions"] += 1
                    family_row["candidateOptions"] += 1
                    candidate_count += 1
                    if targets.candidate_weights[index] > 0:
                        split_row["trainableCandidateEvents"] += 1
                        family_row["trainableEvents"] += 1
                        trainable_count += 1
                    else:
                        split_row["maskedCandidateEvents"] += 1
                        masked_count += 1
                else:
                    split_row["protocolControls"] += 1
                    control_count += 1
                    if targets.control_weights[index] > 0:
                        family_row["trainableEvents"] += 1
                        trainable_count += 1
        split_counts[split] = split_row
    return {
        "requests": request_count,
        "candidateOptions": candidate_count,
        "protocolControls": control_count,
        "trainableEvents": trainable_count,
        "maskedCandidateEvents": masked_count,
        "trustedRequests": trusted_count,
        "untrustedRequests": untrusted_count,
        "splits": split_counts,
        "families": family_counts,
    }


def _event_target_arrays(request: PoolRequest) -> tuple[list[float], list[float]]:
    targets: list[float] = []
    weights: list[float] = []
    for index, is_candidate in enumerate(request.targets.candidate_mask):
        if is_candidate:
            targets.append(request.targets.candidate_targets[index])
            weights.append(request.targets.candidate_weights[index])
        else:
            targets.append(request.targets.control_targets[index])
            weights.append(request.targets.control_weights[index])
    return targets, weights


def collect_pool_features(
    dataset_directory: Path,
    session: EncoderSession,
    *,
    allowed_families: set[str] | None = None,
    limit_events: int | None = None,
) -> tuple[torch.Tensor, list[PoolRequest], dict[str, Any]]:
    """Encode only train/calibration state-option pairs with a frozen local encoder."""
    requests: list[PoolRequest] = []
    feature_chunks: list[torch.Tensor] = []
    pending_contexts: list[str] = []
    pending_options: list[str] = []
    event_count = 0
    minimum_free = 100
    maximum_rss = 0
    last_check = time.monotonic()
    last_progress = last_check
    encoding_started = last_check

    def flush() -> None:
        nonlocal maximum_rss, minimum_free, last_check
        if not pending_contexts:
            return
        feature_chunks.append(
            encode_text_pairs(session, pending_contexts, pending_options)
        )
        pending_contexts.clear()
        pending_options.clear()
        if time.monotonic() - last_check >= RESOURCE_CHECK_INTERVAL_SECONDS:
            snapshot = check_resource_budget("Laya pool feature extraction")
            maximum_rss = max(maximum_rss, snapshot.process_rss_bytes)
            minimum_free = min(minimum_free, snapshot.system_free_memory_percent)
            last_check = time.monotonic()

    initial = check_resource_budget("Laya pool feature extraction start")
    maximum_rss = initial.process_rss_bytes
    minimum_free = initial.system_free_memory_percent
    for split in TRAINING_SPLITS:
        for state, labels in paired_rows(dataset_directory, split):
            family = state_repository_family(state)
            if allowed_families is not None and family not in allowed_families:
                continue
            if limit_events is not None and event_count >= limit_events:
                break
            request = _request_record(state, labels, split, event_count)
            requests.append(request)
            for option_text in request.encoded.options:
                pending_contexts.append(request.encoded.context)
                pending_options.append(option_text)
                event_count += 1
                if len(pending_contexts) >= ENCODER_BATCH_SIZE:
                    flush()
            if time.monotonic() - last_progress >= PROGRESS_INTERVAL_SECONDS:
                snapshot = check_resource_budget("Laya pool feature extraction progress")
                maximum_rss = max(maximum_rss, snapshot.process_rss_bytes)
                minimum_free = min(minimum_free, snapshot.system_free_memory_percent)
                elapsed = time.monotonic() - encoding_started
                print(
                    json.dumps(
                        {
                            "event": "laya-feature-progress",
                            "examplesSeen": event_count,
                            "requestsSeen": len(requests),
                            "elapsedSeconds": round(elapsed, 3),
                            "rssBytes": snapshot.process_rss_bytes,
                            "freeMemoryPercent": snapshot.system_free_memory_percent,
                        },
                        sort_keys=True,
                    ),
                    flush=True,
                )
                last_progress = time.monotonic()
    flush()
    final = check_resource_budget("Laya pool feature extraction complete")
    maximum_rss = max(maximum_rss, final.process_rss_bytes)
    minimum_free = min(minimum_free, final.system_free_memory_percent)
    features = torch.cat(feature_chunks, dim=0) if feature_chunks else torch.empty((0, HIDDEN_SIZE))
    if len(features) != event_count:
        raise AssertionError("feature extraction changed option event order or count")
    return features, requests, {
        "eventCount": event_count,
        "requestCount": len(requests),
        "elapsedSeconds": time.monotonic() - encoding_started,
        "peakRssBytes": maximum_rss,
        "minimumFreeMemoryPercent": minimum_free,
    }


def independent_event_loss(
    logits: torch.Tensor,
    candidate_targets: torch.Tensor,
    candidate_weights: torch.Tensor,
    control_targets: torch.Tensor,
    control_weights: torch.Tensor,
) -> torch.Tensor:
    """Sum separate weighted BCE losses; masked candidates and controls do not contribute."""
    losses: list[torch.Tensor] = []
    for targets, weights in (
        (candidate_targets, candidate_weights),
        (control_targets, control_weights),
    ):
        active = weights > 0
        if active.any():
            losses.append(
                functional.binary_cross_entropy_with_logits(
                    logits[active], targets[active], reduction="mean"
                )
            )
    if not losses:
        raise ValueError("a training batch must contain at least one weighted event")
    return torch.stack(losses).sum()


def _fit_head(
    features: torch.Tensor,
    requests: list[PoolRequest],
    training_families: set[str],
    *,
    seed: int,
    progress_name: str,
    epochs: int = TRAINING_EPOCHS,
) -> tuple[OptionScoringHead, dict[str, Any]]:
    indices: list[int] = []
    candidate_target_values: list[float] = []
    candidate_weight_values: list[float] = []
    control_target_values: list[float] = []
    control_weight_values: list[float] = []
    for request in requests:
        if request.family not in training_families:
            continue
        for offset in range(request.option_count):
            index = request.feature_start + offset
            candidate_weight = request.targets.candidate_weights[offset]
            control_weight = request.targets.control_weights[offset]
            if candidate_weight <= 0 and control_weight <= 0:
                continue
            indices.append(index)
            candidate_target_values.append(request.targets.candidate_targets[offset])
            candidate_weight_values.append(candidate_weight)
            control_target_values.append(request.targets.control_targets[offset])
            control_weight_values.append(control_weight)
    if not indices:
        raise ValueError(f"no trusted weighted events for model {progress_name}")

    torch.manual_seed(seed)
    head = OptionScoringHead()
    head.train()
    optimizer = torch.optim.AdamW(head.parameters(), lr=LEARNING_RATE, weight_decay=WEIGHT_DECAY)
    index_tensor = torch.tensor(indices, dtype=torch.long)
    candidate_target_tensor = torch.tensor(candidate_target_values, dtype=torch.float32)
    candidate_weight_tensor = torch.tensor(candidate_weight_values, dtype=torch.float32)
    control_target_tensor = torch.tensor(control_target_values, dtype=torch.float32)
    control_weight_tensor = torch.tensor(control_weight_values, dtype=torch.float32)
    started = time.monotonic()
    last_check = started
    last_progress = started
    initial_snapshot = check_resource_budget(f"Laya head training {progress_name} start")
    peak_rss = initial_snapshot.process_rss_bytes
    minimum_free = initial_snapshot.system_free_memory_percent
    batch_losses: list[float] = []
    for epoch in range(epochs):
        for start in range(0, len(indices), TRAINING_BATCH_SIZE):
            stop = min(start + TRAINING_BATCH_SIZE, len(indices))
            optimizer.zero_grad(set_to_none=True)
            logits = head(features[index_tensor[start:stop]])
            loss = independent_event_loss(
                logits,
                candidate_target_tensor[start:stop],
                candidate_weight_tensor[start:stop],
                control_target_tensor[start:stop],
                control_weight_tensor[start:stop],
            )
            loss.backward()
            torch.nn.utils.clip_grad_norm_(head.parameters(), MAX_GRADIENT_NORM)
            optimizer.step()
            batch_losses.append(float(loss.detach()))
            now = time.monotonic()
            if now - last_check >= RESOURCE_CHECK_INTERVAL_SECONDS:
                snapshot = check_resource_budget(f"Laya head training {progress_name}")
                peak_rss = max(peak_rss, snapshot.process_rss_bytes)
                minimum_free = min(minimum_free, snapshot.system_free_memory_percent)
                last_check = now
            if now - last_progress >= PROGRESS_INTERVAL_SECONDS:
                snapshot = check_resource_budget(f"Laya head training {progress_name}")
                peak_rss = max(peak_rss, snapshot.process_rss_bytes)
                minimum_free = min(minimum_free, snapshot.system_free_memory_percent)
                print(
                    json.dumps(
                        {
                            "event": "laya-training-progress",
                            "model": progress_name,
                            "epoch": epoch + 1,
                            "examplesSeen": stop,
                            "examplesTotal": len(indices),
                            "meanLoss": round(sum(batch_losses) / len(batch_losses), 7),
                            "rssBytes": snapshot.process_rss_bytes,
                            "freeMemoryPercent": snapshot.system_free_memory_percent,
                        },
                        sort_keys=True,
                    ),
                    flush=True,
                )
                last_progress = time.monotonic()
    final_snapshot = check_resource_budget(f"Laya head training {progress_name} complete")
    peak_rss = max(peak_rss, final_snapshot.process_rss_bytes)
    minimum_free = min(minimum_free, final_snapshot.system_free_memory_percent)
    head.eval()
    return head, {
        "weightedEvents": len(indices),
        "candidateWeightedEvents": sum(weight > 0 for weight in candidate_weight_values),
        "controlWeightedEvents": sum(weight > 0 for weight in control_weight_values),
        "meanLoss": sum(batch_losses) / len(batch_losses),
        "elapsedSeconds": time.monotonic() - started,
        "peakRssBytes": peak_rss,
        "minimumFreeMemoryPercent": minimum_free,
    }


def _fit_projection(
    smoke: Mapping[str, Any], full_counts: Mapping[str, Any], families: list[str]
) -> dict[str, Any]:
    smoke_features = smoke["featureExtraction"]
    smoke_head = smoke["headTraining"]
    feature_rate = smoke_features["eventCount"] / max(smoke_features["elapsedSeconds"], 1e-9)
    head_rate = smoke_head["weightedEvents"] / max(smoke_head["elapsedSeconds"], 1e-9)
    counts_by_family = full_counts["families"]
    final_events = sum(row["trainableEvents"] for row in counts_by_family.values())
    nested_events = final_events + sum(
        final_events - counts_by_family[held_out]["trainableEvents"] for held_out in families
    )
    projected_feature_seconds = full_counts["candidateOptions"] + full_counts["protocolControls"]
    projected_feature_seconds /= max(feature_rate, 1e-9)
    projected_head_seconds = nested_events / max(head_rate, 1e-9)
    total = smoke["modelLoadSeconds"] + projected_feature_seconds + projected_head_seconds
    full_finetune_minimum_bytes = smoke["modelParameterCount"] * 16 + (
        smoke["modelLayerCount"]
        * ENCODER_BATCH_SIZE
        * MAX_SEQUENCE_LENGTH
        * HIDDEN_SIZE
        * 4
    )
    smoke_peak_rss_bytes = max(
        smoke_features["peakRssBytes"], smoke_head.get("peakRssBytes", 0)
    )
    full_finetune_process_floor_bytes = smoke_peak_rss_bytes + (
        smoke["modelParameterCount"] * 12
    )
    return {
        "schema": PROJECTION_SCHEMA,
        "chosenConfiguration": {
            "encoder": "Laya Agent ModernBERT encoder, frozen",
            "adaptation": "one independently trained binary option head per LOFO fold and final model",
            "maxSequenceLength": MAX_SEQUENCE_LENGTH,
            "encoderBatchSize": ENCODER_BATCH_SIZE,
            "headBatchSize": TRAINING_BATCH_SIZE,
            "epochsPerHead": TRAINING_EPOCHS,
            "device": "cpu",
            "torchThreads": 4,
            "torchInteropThreads": 1,
        },
        "fullFineTuneMemoryLowerBoundBytes": full_finetune_minimum_bytes,
        "fullFineTuneMemoryLowerBoundIncludes": [
            "float32 model weights",
            "float32 gradients",
            "two float32 Adam states",
            "one saved float32 hidden-state tensor per encoder layer for the smoke batch",
        ],
        "fullFineTuneMemoryLowerBoundExcludes": [
            "attention and feed-forward saved activations beyond layer outputs",
            "tokenizer and Python runtime",
            "allocator overhead",
        ],
        "fullFineTuneConservativeProcessFloorBytes": full_finetune_process_floor_bytes,
        "fullFineTuneConservativeProcessFloorIncludes": [
            "smoke process peak RSS, including float32 encoder weights and runtime",
            "one float32 gradient tensor per encoder parameter",
            "two float32 Adam state tensors per encoder parameter",
        ],
        "fullFineTuneRejectedByRssCap": (
            full_finetune_process_floor_bytes >= MAX_PROCESS_RSS_BYTES
        ),
        "configurationSelectionReason": (
            "Frozen encoder and independently trained heads selected because the conservative "
            "full-fine-tune process floor reaches or exceeds the 6 GiB cap before saved "
            "activations; the smoke-projected nested frozen-head run remains within 10 hours."
        ),
        "eventCountForOneEncoderPass": full_counts["candidateOptions"]
        + full_counts["protocolControls"],
        "weightedHeadEventsAcrossSevenFoldsAndFinal": nested_events,
        "smokeFeatureEventsPerSecond": round(feature_rate, 4),
        "smokeHeadEventsPerSecond": round(head_rate, 4),
        "projectedFeatureSeconds": round(projected_feature_seconds, 3),
        "projectedHeadSeconds": round(projected_head_seconds, 3),
        "projectedModelLoadSeconds": round(smoke["modelLoadSeconds"], 3),
        "estimatedFullNestedSeconds": round(total, 3),
        "estimatedFullNestedHours": round(total / 3600, 4),
        "processRssCapBytes": MAX_PROCESS_RSS_BYTES,
        "systemFreeMemoryFloorPercent": 25,
    }


def _serialize_pool_index(path: Path, requests: list[PoolRequest], features: torch.Tensor) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    features.numpy().astype("float32", copy=False).tofile(path.with_name(EVENT_FEATURE_FILE_NAME))
    with path.with_name(EVENT_INDEX_FILE_NAME).open("w", encoding="utf-8") as output:
        for request in requests:
            row = {
                "requestId": request.request_id,
                "split": request.split,
                "family": request.family,
                "featureStart": request.feature_start,
                "optionIds": request.encoded.option_ids,
                "optionKinds": request.option_kinds,
                "targetIds": request.target_ids,
                "candidateTargets": request.targets.candidate_targets,
                "candidateWeights": request.targets.candidate_weights,
                "controlTargets": request.targets.control_targets,
                "controlWeights": request.targets.control_weights,
                "trusted": request.trusted,
                "candidateMiss": request.candidate_miss,
                "positiveTargetIds": request.positive_target_ids,
            }
            output.write(json.dumps(row, sort_keys=True, separators=(",", ":")) + "\n")


def _diagnostics(
    features: torch.Tensor,
    requests: list[PoolRequest],
    fold_heads: Mapping[str, OptionScoringHead],
    final_head: OptionScoringHead,
    output_path: Path,
) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    top1_correct = {split: [0, 0] for split in TRAINING_SPLITS}
    multi_top1_correct = {split: [0, 0] for split in TRAINING_SPLITS}
    for request in requests:
        head = fold_heads.get(request.family, final_head)
        start = request.feature_start
        stop = start + request.option_count
        with torch.inference_mode():
            probabilities = torch.sigmoid(head(features[start:stop])).tolist()
        candidates: list[dict[str, Any]] = []
        controls: list[dict[str, Any]] = []
        for index, (option_id, kind, target_id, probability) in enumerate(
            zip(
                request.encoded.option_ids,
                request.option_kinds,
                request.target_ids,
                probabilities,
                strict=True,
            )
        ):
            if kind == CANDIDATE_OPTION_KIND:
                candidates.append(
                    {
                        "optionId": option_id,
                        "targetId": target_id,
                        "rawCandidateProbability": round(float(probability), 8),
                        "candidateTarget": request.targets.candidate_targets[index],
                        "candidateMaskWeight": request.targets.candidate_weights[index],
                        "tierARank": request.option_attributes[index].get("tierARank"),
                        "tierAEvidence": request.option_attributes[index].get("tierAEvidence"),
                    }
                )
            else:
                controls.append(
                    {
                        "optionId": option_id,
                        "rawControlProbability": round(float(probability), 8),
                        "controlTarget": request.targets.control_targets[index],
                        "controlMaskWeight": request.targets.control_weights[index],
                    }
                )
        best = max(candidates, key=lambda row: row["rawCandidateProbability"]) if candidates else None
        exact = bool(
            request.trusted
            and not request.candidate_miss
            and best is not None
            and set(request.positive_target_ids) == {best["targetId"]}
        )
        eligible = request.trusted and bool(request.positive_target_ids)
        if eligible:
            top1_correct[request.split][0] += int(exact)
            top1_correct[request.split][1] += 1
            if len(candidates) > 1:
                multi_top1_correct[request.split][0] += int(exact)
                multi_top1_correct[request.split][1] += 1
        rows.append(
            {
                "requestId": request.request_id,
                "split": request.split,
                "repoFamily": request.family,
                "callKind": request.call_kind,
                "importKind": request.import_kind,
                "foldFamily": request.family if request.family in fold_heads else None,
                "trusted": request.trusted,
                "candidateMiss": request.candidate_miss,
                "positiveTargetIds": request.positive_target_ids,
                "candidateCount": len(candidates),
                "candidates": candidates,
                "controls": controls,
                "candidateTop1OptionId": best["optionId"] if best else None,
                "candidateTop1Exact": exact if eligible else None,
            }
        )
    report = {
        "schema": DIAGNOSTICS_SCHEMA,
        "sourceSplits": list(TRAINING_SPLITS),
        "heldOutSplitsRead": [],
        "scoreSemantics": "independent sigmoid probability for each option; no route composition",
        "requestCount": len(rows),
        "requests": rows,
        "candidateTop1Diagnostic": {
            "gate": False,
            "allEligible": {
                split: {"exact": counts[0], "eligible": counts[1]}
                for split, counts in top1_correct.items()
            },
            "multiCandidate": {
                split: {"exact": counts[0], "eligible": counts[1]}
                for split, counts in multi_top1_correct.items()
            },
        },
    }
    write_json(output_path, report)
    return report


def _save_head(directory: Path, head: OptionScoringHead) -> tuple[str, str]:
    directory.mkdir(parents=True, exist_ok=True)
    weights_path = directory / HEAD_WEIGHTS_NAME
    config_path = directory / HEAD_CONFIG_NAME
    save_file(
        {name: tensor.detach().cpu().contiguous() for name, tensor in head.state_dict().items()},
        str(weights_path),
        metadata={"schema": "laya-system1-option-head/v1"},
    )
    write_json(
        config_path,
        {
            "schema": "laya-system1-option-head/v1",
            "inputSize": HIDDEN_SIZE,
            "hiddenSize": 256,
            "outputCount": 1,
            "score": "independent-sigmoid-probability",
        },
    )
    return sha256_file(weights_path), sha256_file(config_path)


def run_smoke(
    dataset_directory: Path,
    base_model_directory: Path,
    output_directory: Path,
    *,
    sample_events: int = 1024,
) -> dict[str, Any]:
    families = pool_families(dataset_directory)
    if len(families) != 7:
        raise ValueError(f"P4 expects seven pool families, found {len(families)}")
    plan = fold_training_plan(families)
    assert_fold_isolation(plan, families)
    counts = count_pool_events(dataset_directory)
    held_out = families[0]
    training_families = set(plan["foldTrainingFamilies"][held_out])
    started = time.monotonic()
    load_started = time.monotonic()
    session = load_encoder(base_model_directory)
    load_seconds = time.monotonic() - load_started
    model_parameter_count = sum(parameter.numel() for parameter in session.encoder.parameters())
    model_layer_count = int(session.encoder.config.num_hidden_layers)
    feature_started = time.monotonic()
    features, requests, feature_metrics = collect_pool_features(
        dataset_directory,
        session,
        allowed_families=training_families,
        limit_events=sample_events,
    )
    feature_metrics["elapsedSeconds"] = time.monotonic() - feature_started
    head, head_metrics = _fit_head(
        features,
        requests,
        training_families,
        seed=BASE_SEED + FOLD_SEED_OFFSET,
        progress_name=f"smoke-excluding-{held_out}",
    )
    minimum_free = min(
        feature_metrics["minimumFreeMemoryPercent"], head_metrics["minimumFreeMemoryPercent"]
    )
    full_counts = counts
    projection = _fit_projection(
        {
            "featureExtraction": feature_metrics,
            "headTraining": head_metrics,
            "modelLoadSeconds": load_seconds,
            "modelParameterCount": model_parameter_count,
            "modelLayerCount": model_layer_count,
        },
        full_counts,
        families,
    )
    report = {
        **projection,
        "smoke": {
            "foldHeldOutFamily": held_out,
            "trainingFamilies": sorted(training_families),
            "requestedSampleEvents": sample_events,
            "actualExamples": feature_metrics["eventCount"],
            "requests": feature_metrics["requestCount"],
            "modelLoadSeconds": round(load_seconds, 3),
            "featureExtraction": feature_metrics,
            "headTraining": head_metrics,
            "elapsedSeconds": round(time.monotonic() - started, 3),
            "peakRssBytes": max(
                feature_metrics["peakRssBytes"], head_metrics["peakRssBytes"]
            ),
            "minimumFreeMemoryPercent": minimum_free,
            "modelParameterCount": model_parameter_count,
            "modelLayerCount": model_layer_count,
        },
        "poolCounts": counts,
    }
    output_directory.mkdir(parents=True, exist_ok=True)
    weights_hash, config_hash = _save_head(output_directory / "smoke-fold", head)
    report["smoke"]["headSha256"] = weights_hash
    report["smoke"]["headConfigSha256"] = config_hash
    write_json(output_directory / "training-projection.json", report)
    print(json.dumps({"event": "laya-smoke-complete", "report": str(output_directory / "training-projection.json"), "estimatedFullNestedHours": projection["estimatedFullNestedHours"], "peakRssBytes": report["smoke"]["peakRssBytes"], "minimumFreeMemoryPercent": minimum_free}, sort_keys=True), flush=True)
    return report


def _training_counts(requests: list[PoolRequest]) -> dict[str, Any]:
    result = {split: {"requests": 0, "trusted": 0, "positiveCandidates": 0, "confirmedNegativeCandidates": 0, "maskedCandidates": 0, "controlEvents": 0} for split in TRAINING_SPLITS}
    by_family: dict[str, dict[str, int]] = {}
    for request in requests:
        row = result[request.split]
        family = by_family.setdefault(request.family, {"positiveCandidates": 0, "confirmedNegativeCandidates": 0, "maskedCandidates": 0, "controlEvents": 0, "requests": 0})
        row["requests"] += 1
        family["requests"] += 1
        if request.trusted:
            row["trusted"] += 1
        for index, is_candidate in enumerate(request.targets.candidate_mask):
            if is_candidate:
                weight = request.targets.candidate_weights[index]
                target = request.targets.candidate_targets[index]
                if weight <= 0:
                    row["maskedCandidates"] += 1
                    family["maskedCandidates"] += 1
                elif target == 1.0:
                    row["positiveCandidates"] += 1
                    family["positiveCandidates"] += 1
                else:
                    row["confirmedNegativeCandidates"] += 1
                    family["confirmedNegativeCandidates"] += 1
            elif request.targets.control_weights[index] > 0:
                row["controlEvents"] += 1
                family["controlEvents"] += 1
    return {"bySplit": result, "byFamily": by_family}


def _runtime_versions() -> dict[str, str]:
    package_names = ("laya", "transformers", "torch", "safetensors", "tokenizers")
    return {name: importlib.metadata.version(name) for name in package_names}


def run_full_training(
    dataset_directory: Path,
    base_model_directory: Path,
    output_directory: Path,
    projection_path: Path,
) -> dict[str, Any]:
    families = pool_families(dataset_directory)
    if len(families) != 7:
        raise ValueError(f"P4 expects seven pool families, found {len(families)}")
    plan = fold_training_plan(families)
    assert_fold_isolation(plan, families)
    projection = json.loads(projection_path.read_text(encoding="utf-8"))
    if projection.get("schema") != PROJECTION_SCHEMA:
        raise ValueError("full training requires a valid Laya smoke projection")
    estimate = projection.get("estimatedFullNestedSeconds")
    if not isinstance(estimate, (int, float)) or estimate > PROJECTION_LIMIT_SECONDS:
        raise RuntimeError("smoke projection exceeds the 10-hour full-run budget")

    output_directory.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    check_resource_budget("Laya full training start")
    session = load_encoder(base_model_directory)
    features, requests, feature_metrics = collect_pool_features(dataset_directory, session)
    counts = _training_counts(requests)
    fold_heads: dict[str, OptionScoringHead] = {}
    fold_metrics: dict[str, Any] = {}
    fold_hashes: dict[str, Any] = {}
    models_directory = output_directory / "models"
    for fold_index, held_out in enumerate(families):
        training_families = set(plan["foldTrainingFamilies"][held_out])
        if held_out in training_families:
            raise AssertionError("fold isolation failed before fitting")
        head, metrics = _fit_head(
            features,
            requests,
            training_families,
            seed=BASE_SEED + FOLD_SEED_OFFSET * (fold_index + 1),
            progress_name=f"exclude-{held_out}",
        )
        fold_heads[held_out] = head
        fold_directory = models_directory / "folds" / _family_slug(held_out)
        weight_hash, config_hash = _save_head(fold_directory, head)
        fold_metrics[held_out] = metrics
        fold_hashes[held_out] = {
            "weightsSha256": weight_hash,
            "configSha256": config_hash,
            "trainingFamilies": sorted(training_families),
        }
        del head
        gc.collect()
    final_head, final_metrics = _fit_head(
        features,
        requests,
        set(families),
        seed=BASE_SEED + FOLD_SEED_OFFSET * (len(families) + 1),
        progress_name="final-all-families",
    )
    final_weight_hash, final_config_hash = _save_head(models_directory / "final", final_head)
    _serialize_pool_index(output_directory, requests, features)
    diagnostics = _diagnostics(
        features,
        requests,
        fold_heads,
        final_head,
        output_directory / DIAGNOSTICS_NAME,
    )
    scorer_config = {
        "schema": SCORER_CONFIG_SCHEMA,
        "scorerId": SCORER_ID,
        "scorerVersion": SCORER_VERSION,
        "baseModelDirectory": str(base_model_directory.expanduser().resolve()),
        "baseModelSha256": sha256_file(base_model_directory.expanduser().resolve() / "model.safetensors"),
        "poolFamilies": families,
        "foldTrainingFamilies": plan["foldTrainingFamilies"],
        "heldOutTrainingFamilies": plan["heldOutTrainingFamilies"],
        "foldModelPaths": {
            family: f"folds/{_family_slug(family)}" for family in families
        },
        "finalModelPath": "final",
        "maxSequenceLength": MAX_SEQUENCE_LENGTH,
        "scoreKind": "raw",
        "scoreSemantics": "independent sigmoid probability per candidate and v1 protocol-control event",
        "routerComposition": None,
    }
    scorer_config_path = output_directory / SCORER_CONFIG_NAME
    write_json(scorer_config_path, scorer_config)
    training_manifest = {
        "schema": TRAINING_SCHEMA,
        "scorerId": SCORER_ID,
        "version": SCORER_VERSION,
        "trainingPlan": plan,
        "trainingSplits": list(TRAINING_SPLITS),
        "heldOutSplitsOpened": [],
        "datasetDirectory": str(dataset_directory.resolve()),
        "datasetFilesSha256": {
            f"{split}{suffix}": sha256_file(dataset_directory / f"{split}{suffix}")
            for split in TRAINING_SPLITS
            for suffix in (STATE_FILE_SUFFIX, LABEL_FILE_SUFFIX)
        },
        "runtimeVersions": _runtime_versions(),
        "baseModelDirectory": scorer_config["baseModelDirectory"],
        "baseModelSha256": scorer_config["baseModelSha256"],
        "baseEncoderFrozen": True,
        "baseEncoderParameters": sum(parameter.numel() for parameter in session.encoder.parameters()),
        "configuration": projection["chosenConfiguration"],
        "smokeProjection": {
            "path": str(projection_path.resolve()),
            "estimatedFullNestedSeconds": projection["estimatedFullNestedSeconds"],
            "estimatedFullNestedHours": projection["estimatedFullNestedHours"],
            "smokeSeconds": projection["smoke"]["elapsedSeconds"],
            "smokePeakRssBytes": projection["smoke"]["peakRssBytes"],
            "smokeMinimumFreeMemoryPercent": projection["smoke"]["minimumFreeMemoryPercent"],
            "fullFineTuneMemoryLowerBoundBytes": projection["fullFineTuneMemoryLowerBoundBytes"],
            "fullFineTuneConservativeProcessFloorBytes": projection[
                "fullFineTuneConservativeProcessFloorBytes"
            ],
            "fullFineTuneRejectedByRssCap": projection["fullFineTuneRejectedByRssCap"],
            "configurationSelectionReason": projection[
                "configurationSelectionReason"
            ],
            "chosenConfiguration": projection["chosenConfiguration"],
        },
        "resource": {
            "processRssCapBytes": MAX_PROCESS_RSS_BYTES,
            "minimumSystemFreeMemoryPercent": 25,
            "peakProcessRssBytes": max(
                feature_metrics["peakRssBytes"],
                max(metric["peakRssBytes"] for metric in fold_metrics.values()),
                final_metrics["peakRssBytes"],
            ),
            "minimumFreeMemoryPercent": min(
                feature_metrics["minimumFreeMemoryPercent"],
                min(metric["minimumFreeMemoryPercent"] for metric in fold_metrics.values()),
                final_metrics["minimumFreeMemoryPercent"],
            ),
        },
        "featureExtraction": feature_metrics,
        "labelCounts": counts,
        "foldTraining": fold_metrics,
        "finalTraining": final_metrics,
        "foldModelHashes": fold_hashes,
        "finalModelHashes": {
            "weightsSha256": final_weight_hash,
            "configSha256": final_config_hash,
        },
        "scorerConfigSha256": sha256_file(scorer_config_path),
        "oofDiagnosticsSha256": sha256_file(output_directory / DIAGNOSTICS_NAME),
        "totalElapsedSeconds": round(time.monotonic() - started, 3),
    }
    write_json(output_directory / TRAINING_MANIFEST_NAME, training_manifest)
    print(
        json.dumps(
            {
                "event": "laya-training-complete",
                "outputDirectory": str(output_directory),
                "elapsedSeconds": training_manifest["totalElapsedSeconds"],
                "peakRssBytes": training_manifest["resource"]["peakProcessRssBytes"],
                "minimumFreeMemoryPercent": training_manifest["resource"]["minimumFreeMemoryPercent"],
            },
            sort_keys=True,
        ),
        flush=True,
    )
    return training_manifest


def _family_slug(family: str) -> str:
    readable = "__".join(part for part in family.replace("/", "__").split() if part)
    digest = hashlib.sha256(family.encode("utf-8")).hexdigest()[:8]
    return f"{readable}-{digest}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset-dir", type=Path, default=DEFAULT_DATASET_DIRECTORY)
    parser.add_argument("--base-model-dir", type=Path, default=DEFAULT_BASE_MODEL_DIRECTORY)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIRECTORY)
    parser.add_argument("--smoke", action="store_true")
    parser.add_argument("--smoke-events", type=int, default=1024)
    parser.add_argument("--projection", type=Path, default=DEFAULT_SMOKE_REPORT)
    arguments = parser.parse_args()
    torch.set_num_threads(4)
    torch.set_num_interop_threads(1)
    torch.use_deterministic_algorithms(True)
    if arguments.smoke:
        run_smoke(
            arguments.dataset_dir.resolve(),
            arguments.base_model_dir,
            arguments.output_dir.resolve(),
            sample_events=arguments.smoke_events,
        )
    else:
        run_full_training(
            arguments.dataset_dir.resolve(),
            arguments.base_model_dir,
            arguments.output_dir.resolve(),
            arguments.projection.resolve(),
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
