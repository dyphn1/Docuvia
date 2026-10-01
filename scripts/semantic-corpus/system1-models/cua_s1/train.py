"""Stream train/calibration rows into deterministic nested-LOFO CUA-S1 models."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import resource
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
from adapter import encode_example, is_trusted_label, state_repository_family, training_targets
from constants import (
    AUDIT_FILES_SHA256_FIELD,
    BASE_SEED,
    DEFAULT_DATASET_DIRECTORY,
    DEFAULT_MODEL_DIRECTORY,
    ENCODING_AUDIT_REPORT_NAME,
    ENCODING_AUDIT_SPLITS,
    LABEL_FILE_SUFFIX,
    MAX_LABEL_LINE_BYTES,
    MAX_PROCESS_RSS_BYTES,
    MAX_STATE_LINE_BYTES,
    MODEL_CONFIG,
    REQUEST_KEY,
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


def process_rss_bytes() -> int:
    value = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return int(value if sys.platform == "darwin" else value * 1024)


def check_resource_budget() -> int:
    rss_bytes = process_rss_bytes()
    if rss_bytes > MAX_PROCESS_RSS_BYTES:
        raise MemoryError(f"training process RSS exceeded 3 GiB: {rss_bytes} bytes")
    return rss_bytes


def seed_everything(seed: int) -> None:
    torch.manual_seed(seed)


def examples_for_family(
    dataset_directory: Path,
    training_families: set[str],
) -> Iterator[tuple[str, ChoiceExample, list[float]]]:
    for split in TRAINING_SPLITS:
        for state, labels in paired_rows(dataset_directory, split):
            if state_repository_family(state) not in training_families or not is_trusted_label(labels):
                continue
            encoded = encode_example(state)
            request = state[REQUEST_KEY]
            targets = training_targets(request, labels)
            if len(targets) != len(encoded.option_ids):
                raise ValueError("encoded options and BCE targets have different lengths")
            yield split, ChoiceExample(encoded.context, encoded.options, 0), targets


def masked_top_option_indices(logits: torch.Tensor, option_mask: torch.Tensor) -> torch.Tensor:
    """Choose top real options while excluding CUA-S1's batch padding positions."""
    masked_logits = logits.masked_fill(
        ~option_mask,
        torch.finfo(logits.dtype).min,
    )
    return masked_logits.argmax(dim=1)


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
) -> dict[str, Any]:
    seed_everything(seed)
    model, collator = make_system(MODEL_CONFIG, "cpu")
    model.train()
    optimizer = torch.optim.AdamW(model.parameters(), lr=LEARNING_RATE, weight_decay=WEIGHT_DECAY)
    epoch_resources: list[dict[str, Any]] = []
    trained_example_count = 0

    for epoch in range(1, TRAINING_EPOCHS + 1):
        epoch_started = time.monotonic()
        batch_examples: list[ChoiceExample] = []
        batch_targets: list[list[float]] = []
        batch_splits: list[str] = []
        batch_losses: list[float] = []
        rows_seen = 0
        batch_number = 0
        split_diagnostics = {
            split: {"examples": 0, "lossSum": 0.0, "positiveTop1Count": 0}
            for split in TRAINING_SPLITS
        }

        def update_batch() -> None:
            nonlocal batch_number
            if not batch_examples:
                return
            batch = collator(batch_examples)
            target_width = batch["option_mask"].shape[1]
            targets = torch.zeros((len(batch_examples), target_width), dtype=torch.float32)
            for row_index, target_row in enumerate(batch_targets):
                targets[row_index, : len(target_row)] = torch.tensor(target_row, dtype=torch.float32)
            logits = model(batch)
            mask = batch["option_mask"]
            stable_logits = logits.masked_fill(~mask, 0.0)
            losses = functional.binary_cross_entropy_with_logits(stable_logits, targets, reduction="none")
            loss = (losses * mask).sum() / mask.sum().clamp_min(1)
            row_losses = (losses * mask).sum(dim=1) / mask.sum(dim=1).clamp_min(1)
            top_options = masked_top_option_indices(logits, mask)
            for row_index, split in enumerate(batch_splits):
                diagnostic = split_diagnostics[split]
                diagnostic["examples"] += 1
                diagnostic["lossSum"] += float(row_losses[row_index].detach().item())
                selected_index = int(top_options[row_index].detach().item())
                diagnostic["positiveTop1Count"] += batch_targets[row_index][selected_index] >= 1.0
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), MAX_GRADIENT_NORM)
            optimizer.step()
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
                            "meanOptionBce": round(batch_loss, 8),
                            "processRssBytes": check_resource_budget(),
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
            if rows_seen % (TRAINING_BATCH_SIZE * 16) == 0:
                check_resource_budget()
        update_batch()
        if rows_seen == 0:
            raise ValueError(f"no trusted examples available for model {label}")
        trained_example_count = rows_seen
        rss_bytes = check_resource_budget()
        train_diagnostics = {
            split: {
                "examples": values["examples"],
                "meanPerRequestOptionBce": round(
                    values["lossSum"] / values["examples"],
                    8,
                )
                if values["examples"]
                else None,
                "positiveTop1Count": values["positiveTop1Count"],
                "positiveTop1Rate": round(
                    values["positiveTop1Count"] / values["examples"],
                    8,
                )
                if values["examples"]
                else None,
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
    save_checkpoint(checkpoint_path, model, checkpoint_config, checkpoint_metadata)
    config_path = checkpoint_path.with_suffix(".json")
    return {
        "checkpointFile": "model.safetensors",
        "weightsSha256": sha256_file(checkpoint_path),
        "checkpointConfigSha256": sha256_file(config_path),
        "trainingFamilies": sorted(training_families),
        "trainingExampleCountPerEpoch": trained_example_count,
        "seed": seed,
        "epochs": epoch_resources,
        "modelSizeBytes": checkpoint_path.stat().st_size + config_path.stat().st_size,
    }


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(canonical_json(value) + b"\n")


def main() -> int:
    configure_training_runtime()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset-dir", type=Path, default=DEFAULT_DATASET_DIRECTORY)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_MODEL_DIRECTORY / "domain-adapt-v2")
    parser.add_argument("--encoding-audit", type=Path)
    args = parser.parse_args()
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
    print(
        json.dumps(
            {
                "event": "training-start",
                "families": families,
                "encodingAuditSha256": sha256_file(audit_path),
                "encodingAuditFilesSha256": audit_report[AUDIT_FILES_SHA256_FIELD],
                "processRssBytes": initial_rss,
            },
            sort_keys=True,
        ),
        flush=True,
    )

    configuration_hash = hashlib.sha256(canonical_json({"model": MODEL_CONFIG, "training": TRAINING_CONFIG})).hexdigest()
    fold_plan = {
        family: [candidate for candidate in families if candidate != family]
        for family in families
    }
    if any(family in training for family, training in fold_plan.items()):
        raise AssertionError("a LOFO training fold contains its held-out family")
    output_directory.mkdir(parents=True, exist_ok=True)
    model_directory = output_directory / "models"
    fold_manifests: dict[str, Any] = {}
    resource_records: list[dict[str, Any]] = []
    run_started = time.monotonic()

    for fold_index, family in enumerate(families):
        fold_started = time.monotonic()
        slug = safe_slug(family)
        fold_result = train_model(
            dataset_directory,
            model_directory / "folds" / slug,
            fold_plan[family],
            BASE_SEED + fold_index * 1009,
            {"modelRole": "oof-fold", "foldFamily": family},
            f"fold:{family}",
        )
        fold_result["elapsedSeconds"] = round(time.monotonic() - fold_started, 3)
        fold_manifests[family] = fold_result
        resource_records.append({"foldFamily": family, "epochs": fold_result["epochs"]})

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
        "schema": "cua-s1-system1-scorer-config/v1",
        "modelConfig": MODEL_CONFIG,
        "trainingConfig": TRAINING_CONFIG,
        "modelTrainingConfigSha256": configuration_hash,
        "poolFamilies": families,
        "foldTrainingFamilies": fold_plan,
        "foldWeightsSha256": {
            family: fold_manifests[family]["weightsSha256"] for family in families
        },
        "foldModelPaths": {
            family: f"folds/{safe_slug(family)}/model.safetensors" for family in families
        },
        "finalWeightsSha256": final_result["weightsSha256"],
        "finalCheckpointConfigSha256": final_result["checkpointConfigSha256"],
    }
    configuration_bytes = canonical_json(scorer_configuration) + b"\n"
    configuration_sha256 = hashlib.sha256(configuration_bytes).hexdigest()
    (output_directory / "scorer-config.json").write_bytes(configuration_bytes)

    training_manifest = {
        "schema": "cua-s1-system1-training-manifest/v1",
        "scorerId": "cua-s1",
        "scorerVersion": "0.0.0+system1-p3-encoding-v2",
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
        "foldModels": fold_manifests,
        "finalModel": final_result,
        "p2TrainingManifest": p2_training_manifest,
    }
    write_json(output_directory / "training-manifest.json", training_manifest)
    write_json(output_directory / "training-resource.json", {
        "elapsedSeconds": round(time.monotonic() - run_started, 3),
        "initialProcessRssBytes": initial_rss,
        "models": resource_records,
        "finalProcessRssBytes": process_rss_bytes(),
    })
    print(
        json.dumps(
            {
                "event": "training-complete",
                "outputDirectory": str(output_directory),
                "configurationSha256": configuration_sha256,
                "elapsedSeconds": round(time.monotonic() - run_started, 3),
                "finalModelSizeBytes": final_result["modelSizeBytes"],
            },
            sort_keys=True,
        ),
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
