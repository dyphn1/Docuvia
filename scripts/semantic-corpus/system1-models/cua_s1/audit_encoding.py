"""Pool-only encoding audit; the gate must pass before training is launched."""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path
from typing import Any, Iterator

from adapter import encode_example, is_trusted_label
from constants import (
    AUDIT_CANDIDATE_COUNT_FIELD,
    AUDIT_CANDIDATE_PAIR_COUNT_FIELD,
    AUDIT_DUPLICATE_PAIR_COUNT_FIELD,
    AUDIT_FILES_READ_FIELD,
    AUDIT_FILES_SHA256_FIELD,
    AUDIT_GATE_FIELD,
    AUDIT_GATE_PASSED_FIELD,
    AUDIT_GOLD_ABSENT_REQUEST_COUNT_FIELD,
    AUDIT_GOLD_COLLISION_PAIR_COUNT_FIELD,
    AUDIT_GOLD_COLLISION_REQUEST_COUNT_FIELD,
    AUDIT_GOLD_DECOY_PAIR_COUNT_FIELD,
    AUDIT_GOLD_MAX_RATE_FIELD,
    AUDIT_GOLD_PAIR_RATE_FIELD,
    AUDIT_GOLD_REQUEST_RATE_FIELD,
    AUDIT_GOLD_DECOY_REQUEST_COUNT_FIELD,
    AUDIT_GENUINE_DECLARATION_PAIR_COUNT_FIELD,
    AUDIT_IDENTICAL_PAIR_RATE_FIELD,
    AUDIT_IDENTICAL_REQUEST_RATE_FIELD,
    AUDIT_MULTI_COLLISION_COUNT_FIELD,
    AUDIT_MULTI_REQUEST_COUNT_FIELD,
    AUDIT_OVERALL_FIELD,
    AUDIT_REQUEST_COUNT_FIELD,
    AUDIT_SCHEMA_FIELD,
    AUDIT_SOURCE_SPECIFIER_RATE_FIELD,
    AUDIT_SPECIFIER_COUNT_FIELD,
    AUDIT_SPECIFIER_SURVIVED_FIELD,
    AUDIT_SPLITS_FIELD,
    AUDIT_SYMBOL_COUNT_FIELD,
    AUDIT_SYMBOL_MIN_RATE_FIELD,
    AUDIT_SYMBOL_RATE_FIELD,
    AUDIT_SYMBOL_SURVIVED_FIELD,
    AUDIT_TRAINING_STARTED_FIELD,
    AUDIT_TRUSTED_REQUEST_COUNT_FIELD,
    AUDIT_UNTRUSTED_REQUEST_COUNT_FIELD,
    CANDIDATE_OPTION_KIND,
    DEFAULT_DATASET_DIRECTORY,
    DEFAULT_MODEL_DIRECTORY,
    ENCODING_AUDIT_REPORT_NAME,
    ENCODING_AUDIT_SCHEMA,
    ENCODING_AUDIT_SPLITS,
    IMPORT_BINDING_KEY,
    IMPORT_SOURCE_SPECIFIER_KEY,
    LABEL_POSITIVE_TARGET_IDS_KEY,
    LABEL_FILE_SUFFIX,
    MAX_GOLD_DECOY_COLLISION_RATE,
    MAX_LABEL_LINE_BYTES,
    MAX_STATE_LINE_BYTES,
    OPTIONS_KEY,
    OPTION_ATTRIBUTES_KEY,
    OPTION_ID_KEY,
    OPTION_KIND_KEY,
    OPTION_TEXT_KEY,
    REQUEST_ID_KEY,
    REQUEST_KEY,
    STATE_FILE_SUFFIX,
    TARGET_ID_KEY,
    MIN_CANDIDATE_SYMBOL_SURVIVAL_RATE,
)


def _json_lines(path: Path, maximum_line_bytes: int, description: str) -> Iterator[dict[str, Any]]:
    with path.open("rb") as source:
        for line_number, raw in enumerate(source, start=1):
            if len(raw) > maximum_line_bytes:
                raise ValueError(f"{description} line {line_number} exceeds its byte limit")
            value = json.loads(raw)
            if not isinstance(value, dict):
                raise ValueError(f"{description} line {line_number} is not an object")
            yield value


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _paired_pool_rows(dataset_directory: Path, split: str) -> Iterator[tuple[dict[str, Any], dict[str, Any]]]:
    if split not in ENCODING_AUDIT_SPLITS:
        raise ValueError(f"encoding audit is restricted to {ENCODING_AUDIT_SPLITS}")
    state_path = dataset_directory / f"{split}{STATE_FILE_SUFFIX}"
    label_path = dataset_directory / f"{split}{LABEL_FILE_SUFFIX}"
    states = _json_lines(state_path, MAX_STATE_LINE_BYTES, f"{split} state")
    labels = _json_lines(label_path, MAX_LABEL_LINE_BYTES, f"{split} labels")
    for row_number, (state, label) in enumerate(zip(states, labels, strict=True), start=1):
        request = state.get(REQUEST_KEY)
        request_id = request.get(REQUEST_ID_KEY) if isinstance(request, dict) else None
        if request_id != label.get(REQUEST_ID_KEY):
            raise ValueError(f"{split} state/label requestId mismatch on row {row_number}")
        yield state, label


def validate_audit_gate(
    report: dict[str, Any],
    current_files_sha256: dict[str, str],
) -> None:
    expected_files = [
        f"{split}{suffix}"
        for split in ENCODING_AUDIT_SPLITS
        for suffix in (STATE_FILE_SUFFIX, LABEL_FILE_SUFFIX)
    ]
    if report.get(AUDIT_SCHEMA_FIELD) != ENCODING_AUDIT_SCHEMA:
        raise ValueError("training requires a recognized encoding-audit report")
    if report.get(AUDIT_TRAINING_STARTED_FIELD) is not False:
        raise ValueError("encoding audit must be completed before training")
    if report.get(AUDIT_FILES_READ_FIELD) != expected_files:
        raise ValueError("encoding audit must cover only the train/calibration files")
    if report.get(AUDIT_FILES_SHA256_FIELD) != current_files_sha256:
        raise ValueError("encoding audit hashes do not match the fitting-pool files")
    split_reports = report.get(AUDIT_SPLITS_FIELD)
    if not isinstance(split_reports, dict) or set(split_reports) != set(ENCODING_AUDIT_SPLITS):
        raise ValueError("encoding audit is missing a fitting split")
    if not report.get(AUDIT_GATE_FIELD, {}).get(AUDIT_GATE_PASSED_FIELD):
        raise ValueError("encoding audit gate failed")
    if not report.get(AUDIT_OVERALL_FIELD, {}).get(AUDIT_GATE_FIELD, {}).get(
        AUDIT_GATE_PASSED_FIELD
    ):
        raise ValueError("overall encoding audit gate failed")
    if any(
        not split_report.get(AUDIT_GATE_FIELD, {}).get(AUDIT_GATE_PASSED_FIELD)
        for split_report in split_reports.values()
    ):
        raise ValueError("a train/calibration encoding audit gate failed")


def _candidate_target(option: dict[str, Any]) -> str:
    attributes = option.get(OPTION_ATTRIBUTES_KEY)
    target_id = attributes.get(TARGET_ID_KEY) if isinstance(attributes, dict) else None
    return target_id if isinstance(target_id, str) else ""


def _is_same_declaration(first: dict[str, Any], second: dict[str, Any]) -> bool:
    first_attributes = first.get(OPTION_ATTRIBUTES_KEY)
    second_attributes = second.get(OPTION_ATTRIBUTES_KEY)
    first_target = first_attributes.get(TARGET_ID_KEY) if isinstance(first_attributes, dict) else None
    second_target = second_attributes.get(TARGET_ID_KEY) if isinstance(second_attributes, dict) else None
    return first_target == second_target and first.get(OPTION_TEXT_KEY) == second.get(OPTION_TEXT_KEY)


def _empty_counts() -> Counter[str]:
    return Counter()


def _add_sample(
    counts: Counter[str],
    state: dict[str, Any],
    labels: dict[str, Any],
) -> None:
    request = state[REQUEST_KEY]
    options = request[OPTIONS_KEY]
    encoded = encode_example(state)
    encoded_by_id = dict(zip(encoded.option_ids, encoded.options, strict=True))
    candidates = [
        option
        for option in options
        if isinstance(option, dict) and option.get(OPTION_KIND_KEY) == CANDIDATE_OPTION_KIND
    ]
    candidate_texts = [encoded_by_id[option[OPTION_ID_KEY]] for option in candidates]
    counts[AUDIT_REQUEST_COUNT_FIELD] += 1
    counts[AUDIT_CANDIDATE_COUNT_FIELD] += len(candidates)
    if is_trusted_label(labels):
        counts[AUDIT_TRUSTED_REQUEST_COUNT_FIELD] += 1
    else:
        counts[AUDIT_UNTRUSTED_REQUEST_COUNT_FIELD] += 1

    for option, text in zip(candidates, candidate_texts, strict=True):
        target_id = _candidate_target(option)
        if "#" in target_id and target_id.partition("#")[2]:
            counts[AUDIT_SYMBOL_COUNT_FIELD] += 1
            counts[AUDIT_SYMBOL_SURVIVED_FIELD] += target_id[target_id.index("#") :] in text
    context_text = request.get("context", {}).get("text", "")
    context_value = json.loads(context_text) if isinstance(context_text, str) else {}
    import_binding = context_value.get(IMPORT_BINDING_KEY) or {}
    source_specifier = (
        import_binding.get(IMPORT_SOURCE_SPECIFIER_KEY)
        if isinstance(import_binding, dict)
        else None
    )
    if isinstance(source_specifier, str) and source_specifier:
        counts[AUDIT_SPECIFIER_COUNT_FIELD] += 1
        counts[AUDIT_SPECIFIER_SURVIVED_FIELD] += source_specifier in encoded.context

    if len(candidates) > 1:
        counts[AUDIT_MULTI_REQUEST_COUNT_FIELD] += 1
        pair_count = len(candidates) * (len(candidates) - 1) // 2
        duplicate_pairs = 0
        for first_index in range(len(candidates)):
            for second_index in range(first_index + 1, len(candidates)):
                if candidate_texts[first_index] == candidate_texts[second_index]:
                    duplicate_pairs += 1
                if _is_same_declaration(candidates[first_index], candidates[second_index]):
                    counts[AUDIT_GENUINE_DECLARATION_PAIR_COUNT_FIELD] += 1
        counts[AUDIT_CANDIDATE_PAIR_COUNT_FIELD] += pair_count
        counts[AUDIT_DUPLICATE_PAIR_COUNT_FIELD] += duplicate_pairs
        counts[AUDIT_MULTI_COLLISION_COUNT_FIELD] += duplicate_pairs > 0

    if not is_trusted_label(labels) or len(candidates) < 2:
        return
    positive_target_ids = labels.get(LABEL_POSITIVE_TARGET_IDS_KEY)
    if not isinstance(positive_target_ids, list):
        return
    positives = set(item for item in positive_target_ids if isinstance(item, str))
    candidate_targets = [_candidate_target(option) for option in candidates]
    gold_indexes = [index for index, target in enumerate(candidate_targets) if target in positives]
    decoy_indexes = [index for index, target in enumerate(candidate_targets) if target not in positives]
    if not gold_indexes:
        counts[AUDIT_GOLD_ABSENT_REQUEST_COUNT_FIELD] += 1
        return
    if not decoy_indexes:
        return
    counts[AUDIT_GOLD_DECOY_REQUEST_COUNT_FIELD] += 1
    request_collision = False
    for gold_index in gold_indexes:
        for decoy_index in decoy_indexes:
            if _is_same_declaration(candidates[gold_index], candidates[decoy_index]):
                continue
            counts[AUDIT_GOLD_DECOY_PAIR_COUNT_FIELD] += 1
            if candidate_texts[gold_index] == candidate_texts[decoy_index]:
                counts[AUDIT_GOLD_COLLISION_PAIR_COUNT_FIELD] += 1
                request_collision = True
    counts[AUDIT_GOLD_COLLISION_REQUEST_COUNT_FIELD] += request_collision


def _rate(numerator: int, denominator: int) -> float | None:
    if denominator == 0:
        return None
    return round(numerator / denominator, 8)


def _report_counts(counts: Counter[str]) -> dict[str, Any]:
    report = dict(counts)
    for field in (
        AUDIT_REQUEST_COUNT_FIELD,
        AUDIT_TRUSTED_REQUEST_COUNT_FIELD,
        AUDIT_UNTRUSTED_REQUEST_COUNT_FIELD,
        AUDIT_CANDIDATE_COUNT_FIELD,
        AUDIT_MULTI_REQUEST_COUNT_FIELD,
        AUDIT_MULTI_COLLISION_COUNT_FIELD,
        AUDIT_CANDIDATE_PAIR_COUNT_FIELD,
        AUDIT_DUPLICATE_PAIR_COUNT_FIELD,
        AUDIT_SYMBOL_COUNT_FIELD,
        AUDIT_SYMBOL_SURVIVED_FIELD,
        AUDIT_SPECIFIER_COUNT_FIELD,
        AUDIT_SPECIFIER_SURVIVED_FIELD,
        AUDIT_GOLD_DECOY_REQUEST_COUNT_FIELD,
        AUDIT_GOLD_COLLISION_REQUEST_COUNT_FIELD,
        AUDIT_GOLD_DECOY_PAIR_COUNT_FIELD,
        AUDIT_GOLD_COLLISION_PAIR_COUNT_FIELD,
        AUDIT_GENUINE_DECLARATION_PAIR_COUNT_FIELD,
        AUDIT_GOLD_ABSENT_REQUEST_COUNT_FIELD,
    ):
        report[field] = counts[field]
    report[AUDIT_SYMBOL_RATE_FIELD] = _rate(
        counts[AUDIT_SYMBOL_SURVIVED_FIELD],
        counts[AUDIT_CANDIDATE_COUNT_FIELD],
    )
    report[AUDIT_SOURCE_SPECIFIER_RATE_FIELD] = _rate(
        counts[AUDIT_SPECIFIER_SURVIVED_FIELD],
        counts[AUDIT_SPECIFIER_COUNT_FIELD],
    )
    report[AUDIT_IDENTICAL_REQUEST_RATE_FIELD] = _rate(
        counts[AUDIT_MULTI_COLLISION_COUNT_FIELD],
        counts[AUDIT_MULTI_REQUEST_COUNT_FIELD],
    )
    report[AUDIT_IDENTICAL_PAIR_RATE_FIELD] = _rate(
        counts[AUDIT_DUPLICATE_PAIR_COUNT_FIELD],
        counts[AUDIT_CANDIDATE_PAIR_COUNT_FIELD],
    )
    report[AUDIT_GOLD_PAIR_RATE_FIELD] = _rate(
        counts[AUDIT_GOLD_COLLISION_PAIR_COUNT_FIELD],
        counts[AUDIT_GOLD_DECOY_PAIR_COUNT_FIELD],
    )
    report[AUDIT_GOLD_REQUEST_RATE_FIELD] = _rate(
        counts[AUDIT_GOLD_COLLISION_REQUEST_COUNT_FIELD],
        counts[AUDIT_GOLD_DECOY_REQUEST_COUNT_FIELD],
    )
    passed = (
        report[AUDIT_SYMBOL_RATE_FIELD] is not None
        and report[AUDIT_SYMBOL_RATE_FIELD] >= MIN_CANDIDATE_SYMBOL_SURVIVAL_RATE
        and report[AUDIT_GOLD_PAIR_RATE_FIELD] is not None
        and report[AUDIT_GOLD_PAIR_RATE_FIELD] <= MAX_GOLD_DECOY_COLLISION_RATE
        and report[AUDIT_GOLD_REQUEST_RATE_FIELD] is not None
        and report[AUDIT_GOLD_REQUEST_RATE_FIELD] <= MAX_GOLD_DECOY_COLLISION_RATE
    )
    report[AUDIT_GATE_FIELD] = {
        AUDIT_SYMBOL_MIN_RATE_FIELD: MIN_CANDIDATE_SYMBOL_SURVIVAL_RATE,
        AUDIT_GOLD_MAX_RATE_FIELD: MAX_GOLD_DECOY_COLLISION_RATE,
        AUDIT_GATE_PASSED_FIELD: passed,
    }
    return report


def run_audit(dataset_directory: Path) -> dict[str, Any]:
    split_counts: dict[str, Counter[str]] = {}
    for split in ENCODING_AUDIT_SPLITS:
        counts = _empty_counts()
        for state, labels in _paired_pool_rows(dataset_directory, split):
            _add_sample(counts, state, labels)
        split_counts[split] = counts
    overall = _empty_counts()
    for counts in split_counts.values():
        overall.update(counts)
    split_reports = {
        split: _report_counts(counts)
        for split, counts in split_counts.items()
    }
    overall_report = _report_counts(overall)
    files_read = [
        f"{split}{suffix}"
        for split in ENCODING_AUDIT_SPLITS
        for suffix in (STATE_FILE_SUFFIX, LABEL_FILE_SUFFIX)
    ]
    files_sha256 = {
        relative_path: _file_sha256(dataset_directory / relative_path)
        for relative_path in files_read
    }
    return {
        AUDIT_SCHEMA_FIELD: ENCODING_AUDIT_SCHEMA,
        AUDIT_FILES_READ_FIELD: files_read,
        AUDIT_FILES_SHA256_FIELD: files_sha256,
        AUDIT_TRAINING_STARTED_FIELD: False,
        AUDIT_SPLITS_FIELD: split_reports,
        AUDIT_OVERALL_FIELD: overall_report,
        AUDIT_GATE_FIELD: {
            AUDIT_SYMBOL_MIN_RATE_FIELD: MIN_CANDIDATE_SYMBOL_SURVIVAL_RATE,
            AUDIT_GOLD_MAX_RATE_FIELD: MAX_GOLD_DECOY_COLLISION_RATE,
            AUDIT_GATE_PASSED_FIELD: (
                overall_report[AUDIT_GATE_FIELD][AUDIT_GATE_PASSED_FIELD]
                and all(
                    report[AUDIT_GATE_FIELD][AUDIT_GATE_PASSED_FIELD]
                    for report in split_reports.values()
                )
            ),
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset-dir", type=Path, default=DEFAULT_DATASET_DIRECTORY)
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_MODEL_DIRECTORY / "domain-adapt-v2" / ENCODING_AUDIT_REPORT_NAME,
    )
    arguments = parser.parse_args()
    dataset_directory = arguments.dataset_dir.resolve()
    output_path = arguments.output.resolve()
    if output_path == dataset_directory or dataset_directory in output_path.parents:
        raise ValueError("encoding audit output must not be written inside the P1 dataset")
    report = run_audit(dataset_directory)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(report, sort_keys=True, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                AUDIT_GATE_PASSED_FIELD: report[AUDIT_GATE_FIELD][AUDIT_GATE_PASSED_FIELD],
                AUDIT_OVERALL_FIELD: report[AUDIT_OVERALL_FIELD],
                "output": str(output_path),
            },
            sort_keys=True,
        ),
        flush=True,
    )
    return 0 if report[AUDIT_GATE_FIELD][AUDIT_GATE_PASSED_FIELD] else 1


if __name__ == "__main__":
    raise SystemExit(main())
