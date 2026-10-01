"""Stream train/calibration rows into deterministic nested-LOFO CUA-S1 models."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any, Iterator

os.environ["OMP_NUM_THREADS"] = "4"
os.environ["MKL_NUM_THREADS"] = "4"
os.environ["VECLIB_MAXIMUM_THREADS"] = "4"

import torch
import torch.nn.functional as functional
from cua_s1.model import ChoiceExample, make_system, save_checkpoint

from audit_encoding import validate_audit_gate
from adapter import (
    TrainingTargets,
    encode_example,
    is_trusted_label,
    state_repository_family,
    training_targets,
)
from constants import (
    AUDIT_FILES_SHA256_FIELD,
    BASE_SEED,
    DEFAULT_DATASET_DIRECTORY,
    DEFAULT_MODEL_DIRECTORY,
    ENCODING_AUDIT_REPORT_NAME,
    ENCODING_AUDIT_SPLITS,
    LABEL_FILE_SUFFIX,
    MAX_LABEL_LINE_BYTES,
    MAX_STATE_LINE_BYTES,
    MODEL_CONFIG,
    ROUTING_HEAD_FILENAME,
    REQUEST_KEY,
    SCORER_VERSION,
    STATE_FILE_SUFFIX,
    TORCH_THREADS,
    TRAINING_BATCH_SIZE,
    TRAINING_CONFIG,
    TRAINING_EPOCHS,
    TRAIN_LOG_BATCH_INTERVAL,
    TRAINING_SPLITS,
    WEIGHT_DECAY,
    LEARNING_RATE,
    MAX_GRADIENT_NORM,
)
from resource_budget import (
    check_resource_budget as enforce_resource_budget,
    check_process_rss_budget,
    process_rss_bytes,
)
from routed_model import RoutedModel, save_routing_head


LOWEST_SYSTEM_FREE_MEMORY_PERCENT = 100

def canonical_json(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def safe_slug(family: str) -> str:
    suffix = hashlib.sha256(family.encode("utf-8")).hexdigest()[:8]
    return re.sub(r"[^A-Za-z0-9._-]+", "__", family) + "-" + suffix


def _line_json(stream: Any, maximum: int, description: str) -> Iterator[dict[str, Any]]:
    for line_number, raw in enumerate(stream, start=1):
        if len(raw) > maximum:
            raise ValueError(f"{description} line {line_number} exceeds its bounded byte limit")
        try:
            value = json.loads(raw)
        except json.JSONDecodeError as error:
            raise ValueError(f"invalid {description} JSON on line {line_number}") from error
        if not isinstance(value, dict):
            raise ValueError(f"{description} line {line_number} must be an object")
        yield value


def paired_rows(dataset_directory: Path, split: str) -> Iterator[tuple[dict[str, Any], dict[str, Any]]]:
    state_path = dataset_directory / f"{split}{STATE_FILE_SUFFIX}"
    labels_path = dataset_directory / f"{split}{LABEL_FILE_SUFFIX}"
    with state_path.open("rb") as state_file, labels_path.open("rb") as labels_file:
        states = _line_json(state_file, MAX_STATE_LINE_BYTES, f"{split} state")
        labels = _line_json(labels_file, MAX_LABEL_LINE_BYTES, f"{split} labels")
        for row_number, (state, label) in enumerate(zip(states, labels, strict=True), start=1):
            request = state.get(REQUEST_KEY)
            state_id = request.get("requestId") if isinstance(request, dict) else None
            if state_id != label.get("requestId"):
                raise ValueError(f"{split} state/label requestId mismatch on row {row_number}")
            yield state, label


def pool_families(dataset_directory: Path) -> list[str]:
    families: set[str] = set()
    for split in TRAINING_SPLITS:
        state_path = dataset_directory / f"{split}{STATE_FILE_SUFFIX}"
        with state_path.open("rb") as state_file:
            for state in _line_json(state_file, MAX_STATE_LINE_BYTES, f"{split} state"):
                families.add(state_repository_family(state))
    result = sorted(families)
    if len(result) != 7:
        raise ValueError(f"P3 nested LOFO expects seven pool families, found {len(result)}")
    return result


def fold_training_plan(families: list[str]) -> dict[str, list[str]]:
    """Build deterministic leave-one-family-out assignments with no self-fit."""
    unique_families = sorted(set(families))
    if len(unique_families) != len(families):
        raise ValueError("LOFO family list contains duplicates")
    if len(unique_families) < 2:
        raise ValueError("LOFO requires at least two repository families")
    plan = {
        held_out: [family for family in unique_families if family != held_out]
        for held_out in unique_families
    }
    if any(held_out in training for held_out, training in plan.items()):
        raise AssertionError("a LOFO training fold contains its held-out family")
    return plan


def check_resource_budget() -> int:
    global LOWEST_SYSTEM_FREE_MEMORY_PERCENT
    snapshot = enforce_resource_budget("training")
    LOWEST_SYSTEM_FREE_MEMORY_PERCENT = min(
        LOWEST_SYSTEM_FREE_MEMORY_PERCENT,
        snapshot.system_free_memory_percent,
    )
    return snapshot.process_rss_bytes


def seed_everything(seed: int) -> None:
    torch.manual_seed(seed)


def examples_for_family(
    dataset_directory: Path,
    training_families: set[str],
) -> Iterator[tuple[str, ChoiceExample, TrainingTargets]]:
    for split in TRAINING_SPLITS:
        for state, labels in paired_rows(dataset_directory, split):
            if state_repository_family(state) not in training_families or not is_trusted_label(labels):
                continue
            encoded = encode_example(state)
            request = state[REQUEST_KEY]
            targets = training_targets(request, labels)
            if len(targets.option_targets) != len(encoded.option_ids):
                raise ValueError("encoded options and BCE targets have different lengths")
            yield split, ChoiceExample(encoded.context, encoded.options, 0), targets


def _empty_label_counts() -> dict[str, int]:
    return {
        "requestCount": 0,
        "trustedRequestCount": 0,
        "excludedUntrustedRequestCount": 0,
        "positiveCandidateCount": 0,
        "confirmedNegativeCandidateCount": 0,
        "maskedCandidateCount": 0,
        "routingPositiveCount": 0,
        "routingNegativeCount": 0,
    }


def _add_counts(target: dict[str, int], addition: dict[str, int]) -> None:
    for key, value in addition.items():
        target[key] += value


def optional_mean(total: float, count: int) -> float | None:
    """Return a stable training diagnostic mean when its split has observations."""
    return round(total / count, 8) if count else None


def training_label_counts(dataset_directory: Path) -> dict[str, Any]:
    """Count trusted candidate labels and masked candidates by split and family."""
    by_split_family: dict[str, dict[str, dict[str, int]]] = {}
    by_split: dict[str, dict[str, int]] = {}
    by_family: dict[str, dict[str, int]] = {}
    for split in TRAINING_SPLITS:
        split_totals = _empty_label_counts()
        family_counts: dict[str, dict[str, int]] = {}
        for state, labels in paired_rows(dataset_directory, split):
            family = state_repository_family(state)
            family_totals = family_counts.setdefault(family, _empty_label_counts())
            all_family_totals = by_family.setdefault(family, _empty_label_counts())
            counts = _empty_label_counts()
            counts["requestCount"] = 1
            if is_trusted_label(labels):
                targets = training_targets(state[REQUEST_KEY], labels)
                counts["trustedRequestCount"] = 1
                counts["positiveCandidateCount"] = sum(
                    weight > 0 and value == 1
                    for value, weight in zip(
                        targets.option_targets,
                        targets.option_weights,
                        strict=True,
                    )
                )
                counts["confirmedNegativeCandidateCount"] = sum(
                    weight > 0 and value == 0 and is_candidate
                    for value, weight, is_candidate in zip(
                        targets.option_targets,
                        targets.option_weights,
                        targets.candidate_mask,
                        strict=True,
                    )
                )
                counts["maskedCandidateCount"] = sum(
                    is_candidate and weight == 0
                    for weight, is_candidate in zip(
                        targets.option_weights,
                        targets.candidate_mask,
                        strict=True,
                    )
                )
                counts[
                    "routingPositiveCount" if targets.routing_target == 1 else "routingNegativeCount"
                ] = 1
            else:
                counts["excludedUntrustedRequestCount"] = 1
            _add_counts(split_totals, counts)
            _add_counts(family_totals, counts)
            _add_counts(all_family_totals, counts)
        by_split[split] = split_totals
        by_split_family[split] = family_counts
    return {
        "bySplit": by_split,
        "bySplitFamily": by_split_family,
        "byFamily": by_family,
    }


def masked_top_option_indices(logits: torch.Tensor, option_mask: torch.Tensor) -> torch.Tensor:
    """Choose top real options while excluding CUA-S1's batch padding positions."""
    masked_logits = logits.masked_fill(
        ~option_mask,
        torch.finfo(logits.dtype).min,
    )
    return masked_logits.argmax(dim=1)


def independent_event_losses(
    option_logits: torch.Tensor,
    routing_logits: torch.Tensor,
    option_targets: torch.Tensor,
    option_weights: torch.Tensor,
    option_mask: torch.Tensor,
    routing_targets: torch.Tensor,
) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
    """Compute masked per-option BCE and request-level routing BCE separately."""
    stable_logits = option_logits.masked_fill(~option_mask, 0.0)
    option_losses = functional.binary_cross_entropy_with_logits(
        stable_logits,
        option_targets,
        reduction="none",
    )
    effective_weights = option_weights * option_mask
    candidate_loss = (option_losses * effective_weights).sum() / effective_weights.sum().clamp_min(1.0)
    routing_losses = functional.binary_cross_entropy_with_logits(
        routing_logits,
        routing_targets,
        reduction="none",
    )
    return candidate_loss, routing_losses.mean(), option_losses, effective_weights, routing_losses


def configure_training_runtime() -> None:
    torch.set_num_threads(TORCH_THREADS)
    torch.set_num_interop_threads(1)
    torch.use_deterministic_algorithms(True)


def train_model(
    dataset_directory: Path,
    output_directory: Path,
    training_families: list[str],
    seed: int,
    model_metadata: dict[str, Any],
    label: str,
    max_examples: int | None = None,
) -> dict[str, Any]:
    seed_everything(seed)
    option_model, collator = make_system(MODEL_CONFIG, "cpu")
    model = RoutedModel(option_model, MODEL_CONFIG["width"])
    model.train()
    optimizer = torch.optim.AdamW(model.parameters(), lr=LEARNING_RATE, weight_decay=WEIGHT_DECAY)
    check_resource_budget()
    epoch_resources: list[dict[str, Any]] = []
    trained_example_count = 0

    for epoch in range(1, TRAINING_EPOCHS + 1):
        epoch_started = time.monotonic()
        batch_examples: list[ChoiceExample] = []
        batch_targets: list[TrainingTargets] = []
        batch_splits: list[str] = []
        batch_losses: list[float] = []
        rows_seen = 0
        batch_number = 0
        split_diagnostics = {
            split: {
                "examples": 0,
                "candidateSupervisedExamples": 0,
                "candidateLossSum": 0.0,
                "routingLossSum": 0.0,
                "candidateTop1Examples": 0,
                "candidatePositiveTop1Count": 0,
                "routingCorrectCount": 0,
            }
            for split in TRAINING_SPLITS
        }

        def update_batch() -> None:
            nonlocal batch_number
            if not batch_examples:
                return
            batch = collator(batch_examples)
            target_width = batch["option_mask"].shape[1]
            targets = torch.zeros((len(batch_examples), target_width), dtype=torch.float32)
            target_weights = torch.zeros_like(targets)
            candidate_mask = torch.zeros_like(batch["option_mask"])
            routing_targets = torch.zeros(len(batch_examples), dtype=torch.float32)
            for row_index, target_row in enumerate(batch_targets):
                option_count = len(target_row.option_targets)
                targets[row_index, :option_count] = torch.tensor(
                    target_row.option_targets,
                    dtype=torch.float32,
                )
                target_weights[row_index, :option_count] = torch.tensor(
                    target_row.option_weights,
                    dtype=torch.float32,
                )
                candidate_mask[row_index, :option_count] = torch.tensor(
                    target_row.candidate_mask,
                    dtype=torch.bool,
                )
                routing_targets[row_index] = target_row.routing_target
            option_logits, routing_logits = model(batch)
            option_mask = batch["option_mask"]
            (
                candidate_loss,
                routing_loss,
                option_losses,
                effective_weights,
                route_losses,
            ) = independent_event_losses(
                option_logits,
                routing_logits,
                targets,
                target_weights,
                option_mask,
                routing_targets,
            )
            loss = candidate_loss + routing_loss
            row_candidate_denominators = effective_weights.sum(dim=1)
            row_candidate_losses = (option_losses * effective_weights).sum(dim=1) / (
                row_candidate_denominators.clamp_min(1.0)
            )
            top_options = masked_top_option_indices(option_logits, candidate_mask)
            route_predictions = torch.sigmoid(routing_logits) >= 0.5
            for row_index, split in enumerate(batch_splits):
                diagnostic = split_diagnostics[split]
                diagnostic["examples"] += 1
                diagnostic["routingLossSum"] += float(route_losses[row_index].detach().item())
                diagnostic["routingCorrectCount"] += bool(
                    route_predictions[row_index].item() == bool(batch_targets[row_index].routing_target)
                )
                if row_candidate_denominators[row_index] > 0:
                    diagnostic["candidateSupervisedExamples"] += 1
                    diagnostic["candidateLossSum"] += float(
                        row_candidate_losses[row_index].detach().item()
                    )
                if candidate_mask[row_index].any():
                    diagnostic["candidateTop1Examples"] += 1
                    selected_index = int(top_options[row_index].detach().item())
                    diagnostic["candidatePositiveTop1Count"] += (
                        batch_targets[row_index].option_targets[selected_index] >= 1.0
                    )
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), MAX_GRADIENT_NORM)
            optimizer.step()
            check_process_rss_budget("training")
            batch_loss = float(loss.detach().item())
            batch_losses.append(batch_loss)
            batch_number += 1
            if batch_number % TRAIN_LOG_BATCH_INTERVAL == 0:
                print(
                    json.dumps(
                        {
                            "event": "training-batch",
                            "model": label,
                            "epoch": epoch,
                            "batch": batch_number,
                            "examplesSeen": rows_seen,
                            "meanCandidateBce": round(float(candidate_loss.detach().item()), 8),
                            "meanRoutingBce": round(float(routing_loss.detach().item()), 8),
                            "processRssBytes": check_resource_budget(),
                            "systemFreeMemoryPercent": LOWEST_SYSTEM_FREE_MEMORY_PERCENT,
                        },
                        sort_keys=True,
                    ),
                    flush=True,
                )
            batch_examples.clear()
            batch_targets.clear()
            batch_splits.clear()

        for split, example, target_row in examples_for_family(
            dataset_directory,
            set(training_families),
        ):
            batch_examples.append(example)
            batch_targets.append(target_row)
            batch_splits.append(split)
            rows_seen += 1
            if len(batch_examples) >= TRAINING_BATCH_SIZE:
                update_batch()
            if rows_seen % (TRAINING_BATCH_SIZE * 4) == 0:
                check_resource_budget()
            if max_examples is not None and rows_seen >= max_examples:
                break
        update_batch()
        if rows_seen == 0:
            raise ValueError(f"no trusted examples available for model {label}")
        trained_example_count = rows_seen
        rss_bytes = check_resource_budget()
        train_diagnostics = {
            split: {
                "examples": values["examples"],
                "candidateSupervisedExamples": values["candidateSupervisedExamples"],
                "meanCandidateBcePerSupervisedRequest": optional_mean(
                    values["candidateLossSum"],
                    values["candidateSupervisedExamples"],
                ),
                "candidateTop1Examples": values["candidateTop1Examples"],
                "candidatePositiveTop1Count": values["candidatePositiveTop1Count"],
                "candidatePositiveTop1Rate": optional_mean(
                    values["candidatePositiveTop1Count"],
                    values["candidateTop1Examples"],
                ),
                "meanRoutingBce": optional_mean(
                    values["routingLossSum"],
                    values["examples"],
                ),
                "routingAccuracyAt0_5": optional_mean(
                    values["routingCorrectCount"],
                    values["examples"],
                ),
            }
            for split, values in split_diagnostics.items()
        }
        epoch_data = {
            "epoch": epoch,
            "examples": rows_seen,
            "meanBatchLoss": round(sum(batch_losses) / len(batch_losses), 8),
            "trainSplitDiagnostics": train_diagnostics,
            "elapsedSeconds": round(time.monotonic() - epoch_started, 3),
            "processRssBytes": rss_bytes,
            "systemFreeMemoryPercent": LOWEST_SYSTEM_FREE_MEMORY_PERCENT,
        }
        epoch_resources.append(epoch_data)
        print(json.dumps({"model": label, **epoch_data}, sort_keys=True), flush=True)

    model.eval()
    output_directory.mkdir(parents=True, exist_ok=True)
    checkpoint_path = output_directory / "model.safetensors"
    checkpoint_config = dict(MODEL_CONFIG)
    checkpoint_metadata = {
        **model_metadata,
        "seed": seed,
        "trainedExampleCountPerEpoch": trained_example_count,
    }
    save_checkpoint(checkpoint_path, model.option_model, checkpoint_config, checkpoint_metadata)
    config_path = checkpoint_path.with_suffix(".json")
    routing_path, routing_config_path = save_routing_head(
        output_directory / ROUTING_HEAD_FILENAME,
        model.routing_head,
        MODEL_CONFIG["width"],
    )
    return {
        "checkpointFile": "model.safetensors",
        "weightsSha256": sha256_file(checkpoint_path),
        "checkpointConfigSha256": sha256_file(config_path),
        "routingHeadFile": routing_path.name,
        "routingHeadSha256": sha256_file(routing_path),
        "routingHeadConfigSha256": sha256_file(routing_config_path),
        "trainingFamilies": sorted(training_families),
        "trainingExampleCountPerEpoch": trained_example_count,
        "seed": seed,
        "epochs": epoch_resources,
        "modelSizeBytes": sum(
            path.stat().st_size
            for path in (checkpoint_path, config_path, routing_path, routing_config_path)
        ),
    }


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(canonical_json(value) + b"\n")


def main() -> int:
    configure_training_runtime()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset-dir", type=Path, default=DEFAULT_DATASET_DIRECTORY)
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_MODEL_DIRECTORY / "domain-adapt-independent-v2",
    )
    parser.add_argument("--encoding-audit", type=Path)
    parser.add_argument("--smoke", action="store_true")
    parser.add_argument("--smoke-examples", type=int, default=1024)
    args = parser.parse_args()
    if args.smoke_examples <= 0:
        parser.error("--smoke-examples must be positive")
    dataset_directory = args.dataset_dir.resolve()
    output_directory = args.output_dir.resolve()
    if not (dataset_directory / f"train{STATE_FILE_SUFFIX}").is_file():
        raise FileNotFoundError(f"P1 fitting state file is missing under {dataset_directory}")
    if output_directory == dataset_directory or dataset_directory in output_directory.parents:
        raise ValueError("model outputs must not be written inside the P1 dataset directory")
    audit_path = (
        args.encoding_audit.resolve()
        if args.encoding_audit is not None
        else output_directory / ENCODING_AUDIT_REPORT_NAME
    )
    audit_report = json.loads(audit_path.read_text(encoding="utf-8"))
    audit_files = [
        f"{split}{suffix}"
        for split in ENCODING_AUDIT_SPLITS
        for suffix in (STATE_FILE_SUFFIX, LABEL_FILE_SUFFIX)
    ]
    current_files_sha256 = {
        relative_path: sha256_file(dataset_directory / relative_path)
        for relative_path in audit_files
    }
    validate_audit_gate(audit_report, current_files_sha256)
    families = pool_families(dataset_directory)
    initial_rss = check_resource_budget()
    initial_free_memory_percent = LOWEST_SYSTEM_FREE_MEMORY_PERCENT
    label_counts = training_label_counts(dataset_directory)
    fold_plan = fold_training_plan(families)
    print(
        json.dumps(
            {
                "event": "training-start",
                "families": families,
                "encodingAuditSha256": sha256_file(audit_path),
                "encodingAuditFilesSha256": audit_report[AUDIT_FILES_SHA256_FIELD],
                "processRssBytes": initial_rss,
                "systemFreeMemoryPercent": initial_free_memory_percent,
                "smoke": args.smoke,
                "foldCount": 1 if args.smoke else len(families),
                "trainingExampleLimit": args.smoke_examples if args.smoke else None,
            },
            sort_keys=True,
        ),
        flush=True,
    )

    configuration_hash = hashlib.sha256(
        canonical_json({"model": MODEL_CONFIG, "training": TRAINING_CONFIG})
    ).hexdigest()
    output_directory.mkdir(parents=True, exist_ok=True)
    write_json(output_directory / "training-label-counts.json", label_counts)
    model_directory = output_directory / "models"
    fold_manifests: dict[str, Any] = {}
    resource_records: list[dict[str, Any]] = []
    run_started = time.monotonic()

    fold_families = families[:1] if args.smoke else families
    for fold_index, family in enumerate(fold_families):
        fold_started = time.monotonic()
        slug = safe_slug(family)
        fold_result = train_model(
            dataset_directory,
            model_directory / "folds" / slug,
            fold_plan[family],
            BASE_SEED + fold_index * 1009,
            {"modelRole": "oof-fold", "foldFamily": family},
            f"fold:{family}",
            args.smoke_examples if args.smoke else None,
        )
        fold_result["elapsedSeconds"] = round(time.monotonic() - fold_started, 3)
        fold_manifests[family] = fold_result
        resource_records.append({"foldFamily": family, "epochs": fold_result["epochs"]})

    if args.smoke:
        smoke_report = {
            "schema": "cua-s1-independent-event-smoke/v1",
            "datasetDirectory": str(dataset_directory),
            "outputDirectory": str(output_directory),
            "heldOutFamily": fold_families[0],
            "trainingFamilies": fold_plan[fold_families[0]],
            "maxExamples": args.smoke_examples,
            "model": fold_manifests[fold_families[0]],
            "elapsedSeconds": round(time.monotonic() - run_started, 3),
            "initialProcessRssBytes": initial_rss,
            "initialSystemFreeMemoryPercent": initial_free_memory_percent,
            "minimumSystemFreeMemoryPercent": LOWEST_SYSTEM_FREE_MEMORY_PERCENT,
            "finalProcessRssBytes": process_rss_bytes(),
        }
        write_json(output_directory / "smoke-report.json", smoke_report)
        print(json.dumps({"event": "training-smoke-complete", **smoke_report}, sort_keys=True), flush=True)
        return 0

    final_started = time.monotonic()
    final_result = train_model(
        dataset_directory,
        model_directory / "final",
        families,
        BASE_SEED + len(families) * 1009,
        {"modelRole": "final-pool-model", "foldFamily": None},
        "final:all-pool-families",
    )
    final_result["elapsedSeconds"] = round(time.monotonic() - final_started, 3)
    resource_records.append({"foldFamily": "final", "epochs": final_result["epochs"]})

    p2_training_manifest = {
        "mode": "folded",
        "foldTrainingFamilies": fold_plan,
        "heldOutTrainingFamilies": families,
    }
    scorer_configuration = {
        "schema": "cua-s1-system1-scorer-config/v2",
        "modelConfig": MODEL_CONFIG,
        "trainingConfig": TRAINING_CONFIG,
        "routingHeadFile": ROUTING_HEAD_FILENAME,
        "scoreComposition": TRAINING_CONFIG["scoreComposition"],
        "modelTrainingConfigSha256": configuration_hash,
        "poolFamilies": families,
        "foldTrainingFamilies": fold_plan,
        "foldWeightsSha256": {
            family: fold_manifests[family]["weightsSha256"] for family in families
        },
        "foldRoutingHeadSha256": {
            family: fold_manifests[family]["routingHeadSha256"] for family in families
        },
        "foldModelPaths": {
            family: f"folds/{safe_slug(family)}/model.safetensors" for family in families
        },
        "finalWeightsSha256": final_result["weightsSha256"],
        "finalCheckpointConfigSha256": final_result["checkpointConfigSha256"],
        "finalRoutingHeadSha256": final_result["routingHeadSha256"],
        "finalRoutingHeadConfigSha256": final_result["routingHeadConfigSha256"],
    }
    configuration_bytes = canonical_json(scorer_configuration) + b"\n"
    configuration_sha256 = hashlib.sha256(configuration_bytes).hexdigest()
    (output_directory / "scorer-config.json").write_bytes(configuration_bytes)

    training_manifest = {
        "schema": "cua-s1-system1-training-manifest/v2",
        "scorerId": "cua-s1",
        "scorerVersion": SCORER_VERSION,
        "configurationSha256": configuration_sha256,
        "encodingAuditSha256": sha256_file(audit_path),
        "encodingAuditFilesSha256": audit_report[AUDIT_FILES_SHA256_FIELD],
        "runtimeVersions": {
            "python": sys.version.split()[0],
            "torch": torch.__version__,
            "cuaS1": __import__("cua_s1").__version__,
        },
        "modelConfig": MODEL_CONFIG,
        "trainingConfig": TRAINING_CONFIG,
        "foldTrainingFamilies": fold_plan,
        "heldOutTrainingFamilies": families,
        "labelCounts": label_counts,
        "routingTargetDefinition": (
            "positive iff the row is trusted (review confirmed and oracle resolved), the gold "
            "positive target set is nonempty, and every positive target is in the candidate set"
        ),
        "candidateTargetDefinition": (
            "positiveTargetIds receive target 1; negativeTargetIds receive target 0; all other "
            "candidate options and protocol controls have loss weight 0"
        ),
        "foldModels": fold_manifests,
        "finalModel": final_result,
        "p2TrainingManifest": p2_training_manifest,
    }
    write_json(output_directory / "training-manifest.json", training_manifest)
    final_snapshot = enforce_resource_budget("training completion")
    write_json(
        output_directory / "training-resource.json",
        {
            "elapsedSeconds": round(time.monotonic() - run_started, 3),
            "initialProcessRssBytes": initial_rss,
            "initialSystemFreeMemoryPercent": initial_free_memory_percent,
            "minimumSystemFreeMemoryPercent": LOWEST_SYSTEM_FREE_MEMORY_PERCENT,
            "models": resource_records,
            "finalProcessRssBytes": final_snapshot.process_rss_bytes,
            "finalSystemFreeMemoryPercent": final_snapshot.system_free_memory_percent,
        },
    )
    print(
        json.dumps(
            {
                "event": "training-complete",
                "outputDirectory": str(output_directory),
                "configurationSha256": configuration_sha256,
                "elapsedSeconds": round(time.monotonic() - run_started, 3),
                "finalModelSizeBytes": final_result["modelSizeBytes"],
                "totalModelSizeBytes": sum(
                    result["modelSizeBytes"]
                    for result in [*fold_manifests.values(), final_result]
                ),
                "minimumSystemFreeMemoryPercent": LOWEST_SYSTEM_FREE_MEMORY_PERCENT,
            },
            sort_keys=True,
        ),
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
