"""Pool-only independent-BCE feasibility check for query routing."""

from __future__ import annotations

import json
import math
import os
import pathlib
import re
import sys
import time
from collections import Counter
from typing import Any, Mapping

os.environ["OMP_NUM_THREADS"] = "1"
os.environ["OPENBLAS_NUM_THREADS"] = "1"
os.environ["MKL_NUM_THREADS"] = "1"
os.environ["VECLIB_MAXIMUM_THREADS"] = "1"

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[2]
DATASET = ROOT / "evaluate/results/semantic-corpus/v1/system1-dataset-v2"
OUTPUT = ROOT / "evaluate/results/semantic-corpus/v1/system1-query-routing-v1"
POOL_RESULTS = OUTPUT / "pool-outcomes.json"
CLASSIFIER_RESULTS = OUTPUT / "classifier-results.json"
ADAPTER_DIRECTORY = ROOT / "scripts/semantic-corpus/system1-models/cua_s1"
sys.path.insert(0, str(ADAPTER_DIRECTORY))
from adapter import is_trusted_label, state_repository_family  # noqa: E402

QUERY_LABELS = ("q1", "q2", "q3", "no-query-resolves")
SPLITS = ("train", "calibration")
L2_PENALTY = 0.1
MAX_ITERATIONS = 240


def read_json_lines(path: pathlib.Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


def category(features: dict[str, float], name: str, value: Any) -> None:
    if value is not None:
        features[f"cat:{name}={value}"] = 1.0


def number(features: dict[str, float], name: str, value: float) -> None:
    features[f"num:{name}"] = float(value)


def bucket(value: int, boundaries: tuple[int, ...]) -> str:
    for boundary in boundaries:
        if value <= boundary:
            return f"le-{boundary}"
    return f"gt-{boundaries[-1]}"


def name_shape(value: Any) -> str:
    if not isinstance(value, str) or not value:
        return "empty"
    if "." in value:
        return "qualified"
    if value[0].isupper():
        return "pascal"
    if "_" in value:
        return "snake"
    if any(char.isupper() for char in value[1:]):
        return "camel"
    if value.isidentifier():
        return "identifier"
    return "other"


def expression_features(features: dict[str, float], expression: str) -> None:
    checks = {
        "has_this": r"\bthis\b",
        "has_super": r"\bsuper\b",
        "has_new": r"\bnew\b",
        "has_await": r"\bawait\b",
        "has_optional_chain": r"\?\.",
        "has_non_null": r"!\.",
        "has_type_arguments": r"<[^>]+>\s*\(",
        "has_as_assertion": r"\bas\s+[A-Za-z_$]",
        "has_string_literal": r"['\"`][^'\"`]*['\"`]",
        "has_array_literal": r"\[[^\]]*\]",
        "has_conditional": r"\?[^.?]",
        "has_chained_call": r"\)\s*\.\s*[A-Za-z_$]",
    }
    for feature, pattern in checks.items():
        number(features, feature, float(bool(re.search(pattern, expression))))
    identifier_count = len(re.findall(r"[A-Za-z_$][\w$]*", expression))
    dot_count = expression.count(".")
    call_count = expression.count("(")
    number(features, "expression_identifier_count", min(identifier_count, 20) / 20)
    number(features, "expression_dot_count", min(dot_count, 8) / 8)
    number(features, "expression_call_count", min(call_count, 8) / 8)


def state_features(state: Mapping[str, Any]) -> dict[str, float]:
    request = state["request"]
    context = json.loads(request["context"]["text"])
    caller = context.get("caller") or {}
    call = context.get("call") or {}
    binding = context.get("importBinding") or {}
    features: dict[str, float] = {}

    category(features, "call_kind", call.get("kind", "missing"))
    category(features, "callee_shape", name_shape(call.get("calleeName")))
    category(features, "caller_symbol_shape", name_shape(caller.get("symbol")))
    symbol = caller.get("symbol", "")
    category(features, "caller_symbol_segments", bucket(symbol.count(".") + 1, (1, 2, 3)))
    file_path = caller.get("filePath", "")
    file_parts = pathlib.PurePosixPath(file_path).parts
    category(features, "caller_extension", pathlib.PurePosixPath(file_path).suffix or "none")
    category(features, "caller_top_directory", file_parts[0] if file_parts else "none")
    category(features, "caller_directory_depth", bucket(max(len(file_parts) - 1, 0), (1, 2, 4, 8)))
    category(features, "caller_test_path", "yes" if any(part in {"test", "tests", "__tests__"} for part in file_parts) else "no")

    expression = call.get("expression", "")
    expression_features(features, expression if isinstance(expression, str) else "")
    receiver = call.get("receiverHint")
    category(features, "receiver_shape", name_shape(receiver) if receiver else "none")
    generic_hints = call.get("genericHints") or []
    category(features, "generic_hint_count", bucket(len(generic_hints), (0, 1, 2, 4)))

    category(features, "import_present", "yes" if binding else "no")
    if binding:
        category(features, "import_kind", binding.get("kind", "missing"))
        category(features, "import_barrel_status", binding.get("barrelStatus", "missing"))
        category(features, "import_path_alias", "yes" if binding.get("pathAlias") else "no")
        local_name = binding.get("local")
        imported_name = binding.get("imported")
        category(features, "import_local_shape", name_shape(local_name))
        category(features, "imported_shape", name_shape(imported_name))
        category(features, "import_renamed", "yes" if local_name != imported_name else "no")
        specifier = binding.get("sourceSpecifier", "")
        category(features, "specifier_form", "relative" if specifier.startswith(".") else "absolute" if specifier.startswith("/") else "bare")
        category(features, "specifier_extension", pathlib.PurePosixPath(specifier).suffix or "none")
        category(features, "specifier_index", "yes" if re.search(r"(?:^|/)index(?:\.|$)", specifier) else "no")
        number(features, "specifier_depth", min(specifier.count("/"), 8) / 8)
    else:
        category(features, "import_kind", "none")
        category(features, "import_barrel_status", "none")

    source_window = call.get("sourceWindow", "")
    source_window = source_window if isinstance(source_window, str) else ""
    for keyword in ("this", "new", "super", "await", "return", "extends", "implements", "constructor", "inject", "create"):
        number(features, f"window_has_{keyword}", float(bool(re.search(rf"\b{keyword}\b", source_window))))
    token_count = len(re.findall(r"[A-Za-z_$][\w$]*", source_window))
    category(features, "source_window_token_count", bucket(token_count, (8, 16, 32, 64)))
    return features


def tier_a_features(state: Mapping[str, Any]) -> dict[str, float]:
    options = [option for option in state["request"]["options"] if option.get("kind") == "candidate"]
    features: dict[str, float] = {}
    count = len(options)
    category(features, "tier_a_candidate_count", bucket(count, (2, 3, 4, 8, 16)))
    number(features, "tier_a_candidate_count_scaled", min(count, 32) / 32)
    ranks = Counter()
    evidence = Counter()
    declaration_kinds = Counter()
    evidence_status = Counter()
    overloads = []
    for option in options:
        attributes = option.get("attributes") or {}
        ranks[attributes.get("tierARank", "missing")] += 1
        evidence[attributes.get("tierAEvidence", "missing")] += 1
        declaration_kinds[attributes.get("declarationKind", "missing")] += 1
        evidence_status[attributes.get("evidenceStatus", "missing")] += 1
        if isinstance(attributes.get("overloadCount"), (int, float)):
            overloads.append(float(attributes["overloadCount"]))
    for rank in (0, 1, 2, "missing"):
        number(features, f"tier_a_rank_{rank}_fraction", ranks[rank] / max(count, 1))
    for name, counts in (
        ("evidence", evidence),
        ("declaration", declaration_kinds),
        ("evidence_status", evidence_status),
    ):
        for key, value in counts.items():
            category(features, f"tier_a_{name}", key)
            number(features, f"tier_a_{name}_{key}_fraction", value / max(count, 1))
    number(features, "tier_a_max_overload_count", min(max(overloads, default=0), 16) / 16)
    return features


class FeatureEncoder:
    def __init__(self, feature_rows: list[dict[str, float]]) -> None:
        names = sorted({name for row in feature_rows for name in row})
        self.indices = {name: index for index, name in enumerate(names)}

    def transform(self, rows: list[dict[str, float]]) -> np.ndarray:
        matrix = np.zeros((len(rows), len(self.indices)), dtype=np.float64)
        for row_index, row in enumerate(rows):
            for name, value in row.items():
                column = self.indices.get(name)
                if column is not None:
                    matrix[row_index, column] = value
        return matrix


def sigmoid(values: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-np.clip(values, -35.0, 35.0)))


def spectral_norm_squared(matrix: np.ndarray) -> float:
    if matrix.shape[1] == 0:
        return 0.0
    vector = np.ones(matrix.shape[1], dtype=np.float64)
    vector /= np.linalg.norm(vector)
    eigenvalue = 0.0
    for _ in range(24):
        updated = matrix.T @ (matrix @ vector) / max(matrix.shape[0], 1)
        norm = float(np.linalg.norm(updated))
        if norm == 0:
            return 0.0
        vector = updated / norm
        eigenvalue = float(vector @ (matrix.T @ (matrix @ vector) / max(matrix.shape[0], 1)))
    return eigenvalue


class LogisticModel:
    def __init__(self, weights: np.ndarray | None, bias: float, constant: float | None, iterations: int) -> None:
        self.weights = weights
        self.bias = bias
        self.constant = constant
        self.iterations = iterations

    def predict(self, matrix: np.ndarray) -> np.ndarray:
        if self.constant is not None:
            return np.full(matrix.shape[0], self.constant, dtype=np.float64)
        assert self.weights is not None
        return sigmoid(matrix @ self.weights + self.bias)


def fit_logistic(matrix: np.ndarray, targets: np.ndarray) -> LogisticModel:
    positives = int(targets.sum())
    if positives == 0 or positives == len(targets):
        prior = (positives + 0.5) / (len(targets) + 1.0)
        return LogisticModel(None, math.log(prior / (1.0 - prior)), prior, 0)
    weights = np.zeros(matrix.shape[1], dtype=np.float64)
    prior = (positives + 0.5) / (len(targets) + 1.0)
    bias = math.log(prior / (1.0 - prior))
    lipschitz = 0.25 * spectral_norm_squared(matrix) + L2_PENALTY
    step_size = 1.0 / max(lipschitz, 1e-6)
    iterations = 0
    for iteration in range(MAX_ITERATIONS):
        probabilities = sigmoid(matrix @ weights + bias)
        residuals = probabilities - targets
        gradient = matrix.T @ residuals / len(targets) + L2_PENALTY * weights
        bias_gradient = float(residuals.mean())
        weights -= step_size * gradient
        bias -= step_size * bias_gradient
        iterations = iteration + 1
        if float(np.linalg.norm(gradient)) < 1e-6 and abs(bias_gradient) < 1e-6:
            break
    return LogisticModel(weights, bias, None, iterations)


def binary_cross_entropy(targets: np.ndarray, probabilities: np.ndarray) -> float:
    clipped = np.clip(probabilities, 1e-15, 1.0 - 1e-15)
    losses = -(targets * np.log(clipped) + (1.0 - targets) * np.log(1.0 - clipped))
    return float(losses.mean()) if len(losses) else 0.0


def auroc(targets: np.ndarray, probabilities: np.ndarray) -> float | None:
    positives = int(targets.sum())
    negatives = len(targets) - positives
    if positives == 0 or negatives == 0:
        return None
    ordered = sorted(zip(probabilities.tolist(), targets.tolist()), key=lambda item: item[0])
    rank_sum = 0.0
    index = 0
    while index < len(ordered):
        end = index + 1
        while end < len(ordered) and ordered[end][0] == ordered[index][0]:
            end += 1
        average_rank = ((index + 1) + end) / 2.0
        rank_sum += average_rank * sum(int(target) for _, target in ordered[index:end])
        index = end
    return (rank_sum - positives * (positives + 1) / 2.0) / (positives * negatives)


def average_precision(targets: np.ndarray, probabilities: np.ndarray) -> float | None:
    positives = int(targets.sum())
    if positives == 0:
        return None
    ordered = sorted(zip(probabilities.tolist(), targets.tolist()), key=lambda item: item[0], reverse=True)
    true_positive = 0
    false_positive = 0
    previous_recall = 0.0
    score = 0.0
    index = 0
    while index < len(ordered):
        end = index + 1
        while end < len(ordered) and ordered[end][0] == ordered[index][0]:
            end += 1
        group_positive = sum(int(target) for _, target in ordered[index:end])
        true_positive += group_positive
        false_positive += (end - index) - group_positive
        recall = true_positive / positives
        precision = true_positive / (true_positive + false_positive)
        score += (recall - previous_recall) * precision
        previous_recall = recall
        index = end
    return score


def metric_record(targets: np.ndarray, probabilities: np.ndarray) -> dict[str, Any]:
    return {
        "rows": int(len(targets)),
        "positiveRows": int(targets.sum()),
        "negativeRows": int(len(targets) - targets.sum()),
        "positiveRate": float(targets.mean()) if len(targets) else None,
        "bce": binary_cross_entropy(targets, probabilities),
        "auroc": auroc(targets, probabilities),
        "averagePrecision": average_precision(targets, probabilities),
    }


def equal_target_sets(left: list[str], right: list[str]) -> bool:
    return set(left) == set(right)


def collect_pool_rows(
    pool: Mapping[str, Any],
) -> tuple[
    list[dict[str, Any]],
    list[dict[str, float]],
    list[dict[str, float]],
    list[str],
    float,
    float,
]:
    states: dict[str, dict[str, Any]] = {}
    labels: dict[str, dict[str, Any]] = {}
    for split in SPLITS:
        for state in read_json_lines(DATASET / f"{split}-state.jsonl"):
            request_id = state["request"]["requestId"]
            states[request_id] = state
        for label in read_json_lines(DATASET / f"{split}-labels.jsonl"):
            labels[label["requestId"]] = label

    result_rows = []
    state_only_features = []
    state_and_tier_a_features = []
    families = []
    state_feature_extraction_ms = 0.0
    tier_a_feature_extraction_ms = 0.0
    for outcome in pool["requests"]:
        request_id = outcome["requestId"]
        state = states.get(request_id)
        label = labels.get(request_id)
        if state is None or label is None:
            raise ValueError(f"Pool output cannot be joined to state/label row {request_id}")
        trusted = is_trusted_label(label)
        if trusted != outcome["trusted"]:
            raise ValueError(f"Trusted-label semantics diverged for {request_id}")
        candidates = [option for option in state["request"]["options"] if option.get("kind") == "candidate"]
        if not trusted or len(candidates) < 2:
            continue
        query_targets = []
        query_labels: dict[str, int] = {}
        positives = label["positiveTargetIds"]
        for query in ("q1", "q2", "q3"):
            result = outcome["queries"][query]
            target_ids = [result["targetId"]] if result["status"] == "commit" else []
            resolved = bool(target_ids) and equal_target_sets(target_ids, positives)
            query_labels[query] = int(resolved)
            if resolved:
                query_targets.append(query)
        query_labels["no-query-resolves"] = int(not query_targets)
        feature_started = time.perf_counter()
        feature_row = state_features(state)
        state_feature_extraction_ms += (time.perf_counter() - feature_started) * 1000.0
        tier_a_started = time.perf_counter()
        tier_a_feature_row = tier_a_features(state)
        tier_a_feature_extraction_ms += (time.perf_counter() - tier_a_started) * 1000.0
        result_rows.append(
            {
                "requestId": request_id,
                "family": state_repository_family(state),
                "labels": query_labels,
            }
        )
        state_only_features.append(feature_row)
        state_and_tier_a_features.append({**feature_row, **tier_a_feature_row})
        families.append(state_repository_family(state))
    return (
        result_rows,
        state_only_features,
        state_and_tier_a_features,
        families,
        state_feature_extraction_ms,
        tier_a_feature_extraction_ms,
    )


def evaluate_variant(
    feature_rows: list[dict[str, float]],
    target_matrix: dict[str, np.ndarray],
    families: list[str],
) -> dict[str, Any]:
    all_encoder = FeatureEncoder(feature_rows)
    all_matrix = all_encoder.transform(feature_rows)
    in_sample: dict[str, Any] = {}
    in_sample_iterations: dict[str, int] = {}
    for label in QUERY_LABELS:
        model = fit_logistic(all_matrix, target_matrix[label])
        probabilities = model.predict(all_matrix)
        in_sample[label] = metric_record(target_matrix[label], probabilities)
        in_sample_iterations[label] = model.iterations

    oof_probabilities = {label: np.zeros(len(feature_rows), dtype=np.float64) for label in QUERY_LABELS}
    family_rows: dict[str, dict[str, Any]] = {}
    fit_ms = 0.0
    inference_ms = 0.0
    total_iterations: Counter[str] = Counter()
    for held_out in sorted(set(families)):
        train_indices = [index for index, family in enumerate(families) if family != held_out]
        held_indices = [index for index, family in enumerate(families) if family == held_out]
        if not train_indices or not held_indices:
            raise ValueError(f"Invalid LOFO fold for {held_out}")
        train_features = [feature_rows[index] for index in train_indices]
        held_features = [feature_rows[index] for index in held_indices]
        encoder = FeatureEncoder(train_features)
        train_matrix = encoder.transform(train_features)
        started = time.perf_counter()
        held_matrix = encoder.transform(held_features)
        inference_ms += (time.perf_counter() - started) * 1000.0
        fold_probabilities: dict[str, np.ndarray] = {}
        for label in QUERY_LABELS:
            fit_started = time.perf_counter()
            model = fit_logistic(train_matrix, target_matrix[label][train_indices])
            fit_ms += (time.perf_counter() - fit_started) * 1000.0
            prediction_started = time.perf_counter()
            fold_probabilities[label] = model.predict(held_matrix)
            inference_ms += (time.perf_counter() - prediction_started) * 1000.0
            total_iterations[label] += model.iterations
            oof_probabilities[label][held_indices] = fold_probabilities[label]
        family_rows[held_out] = {
            "requests": len(held_indices),
            "features": len(encoder.indices),
            "metrics": {
                label: metric_record(
                    target_matrix[label][held_indices], fold_probabilities[label]
                )
                for label in QUERY_LABELS
            },
        }
    lofo = {
        label: metric_record(target_matrix[label], oof_probabilities[label])
        for label in QUERY_LABELS
    }
    return {
        "featureCountInSample": len(all_encoder.indices),
        "featureCountByHeldOutFamily": {
            family: entry["features"] for family, entry in family_rows.items()
        },
        "inSample": in_sample,
        "inSampleFitIterations": in_sample_iterations,
        "lofoOof": lofo,
        "lofoByHeldOutFamily": family_rows,
        "lofoFitIterationsTotal": dict(total_iterations),
        "lofoFitWallTimeMs": fit_ms,
        "lofoFeatureTransformAndPredictionMsPerRequest": inference_ms / max(len(feature_rows), 1),
        "objective": {
            "type": "independent binary cross-entropy with L2 penalty",
            "l2Penalty": L2_PENALTY,
            "maxIterations": MAX_ITERATIONS,
            "solver": "deterministic full-batch gradient descent",
            "multilabel": True,
            "softmax": False,
        },
    }


def main() -> None:
    if not POOL_RESULTS.exists():
        raise FileNotFoundError(f"Pool result is missing: {POOL_RESULTS}")
    pool = json.loads(POOL_RESULTS.read_text(encoding="utf-8"))
    if pool.get("stage") != "pool":
        raise ValueError("Classifier input must be the pool-only query output.")
    (
        rows,
        state_features_only,
        state_features_with_tier_a,
        families,
        state_feature_extraction_ms,
        tier_a_feature_extraction_ms,
    ) = collect_pool_rows(pool)
    if len(set(families)) != 7:
        raise ValueError(f"Expected seven pool families, found {len(set(families))}.")
    target_matrix = {
        label: np.array([row["labels"][label] for row in rows], dtype=np.float64)
        for label in QUERY_LABELS
    }
    state_result = evaluate_variant(state_features_only, target_matrix, families)
    tier_a_result = evaluate_variant(state_features_with_tier_a, target_matrix, families)
    payload = {
        "schemaVersion": 1,
        "frozenRuleSourceSha256": pool["frozenRuleSourceSha256"],
        "trainingScope": {
            "splits": list(SPLITS),
            "requests": len(rows),
            "families": sorted(set(families)),
            "trustedMultiCandidateOnly": True,
            "heldOutSplitsRead": False,
            "featureInputsExclude": ["labels", "query outputs", "gold ids", "request id", "family", "duplicate group"],
        },
        "labelDefinition": {
            "q1": "Q1 commits and its single target equals the exact positive target set",
            "q2": "Q2 commits and its single target equals the exact positive target set",
            "q3": "Q3 commits and its single target equals the exact positive target set",
            "no-query-resolves": "no Q1/Q2/Q3 commit equals the exact positive target set; route to LSP",
            "independentEvents": True,
            "objective": "separate BCE per label; no softmax",
        },
        "labels": {
            label: {
                "positiveRows": int(target_matrix[label].sum()),
                "negativeRows": int(len(rows) - target_matrix[label].sum()),
                "prevalence": float(target_matrix[label].mean()),
            }
            for label in QUERY_LABELS
        },
        "stateOnly": state_result,
        "statePlusTierA": {
            **tier_a_result,
            "additionalFeatures": [
                "candidate count",
                "Tier A rank fractions",
                "Tier A evidence fractions",
                "evidence status fractions",
                "declaration kind fractions",
                "maximum overload count",
            ],
        },
        "featureExtraction": {
            "stateOnlyTotalMs": state_feature_extraction_ms,
            "stateOnlyMsPerRequest": state_feature_extraction_ms / max(len(rows), 1),
            "tierAAdditionalTotalMs": tier_a_feature_extraction_ms,
            "tierAAdditionalMsPerRequest": tier_a_feature_extraction_ms / max(len(rows), 1),
        },
    }
    OUTPUT.mkdir(parents=True, exist_ok=True)
    CLASSIFIER_RESULTS.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "requests": len(rows),
                "families": len(set(families)),
                "output": str(CLASSIFIER_RESULTS.relative_to(ROOT)),
                "ruleHash": pool["frozenRuleSourceSha256"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
