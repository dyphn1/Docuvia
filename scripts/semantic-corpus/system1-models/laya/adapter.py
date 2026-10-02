"""Laya option events using CUA-S1's canonical P1 state and candidate-label helpers."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

from cua_contract import (
    CANDIDATE_OPTION_KIND,
    LABEL_CANDIDATE_MISS_KEY,
    LABEL_POSITIVE_TARGET_IDS_KEY,
    OPTION_ATTRIBUTES_KEY,
    OPTION_ID_KEY,
    OPTION_KIND_KEY,
    OPTIONS_KEY,
    TARGET_ID_KEY,
    UNKNOWN_OPTION_ID,
    VERIFY_OPTION_ID,
    EncodedExample,
    encode_example,
    is_trusted_label,
    state_repository_family,
    state_request_id,
    training_targets,
)


@dataclass(frozen=True)
class EventTargets:
    """Candidate and protocol-control targets, kept in the original option order."""

    candidate_mask: tuple[bool, ...]
    candidate_targets: tuple[float, ...]
    candidate_weights: tuple[float, ...]
    control_targets: tuple[float, ...]
    control_weights: tuple[float, ...]


def build_event_targets(
    request: Mapping[str, Any], labels: Mapping[str, Any]
) -> EventTargets:
    """Reuse CUA's masked candidate labels and apply the documented v1 control labels."""
    shared_targets = training_targets(request, labels)
    options = request.get(OPTIONS_KEY)
    positive_targets = labels.get(LABEL_POSITIVE_TARGET_IDS_KEY)
    candidate_miss = labels.get(LABEL_CANDIDATE_MISS_KEY)
    if (
        not isinstance(options, list)
        or not isinstance(positive_targets, list)
        or not isinstance(candidate_miss, bool)
    ):
        raise ValueError("request options and control target labels are malformed")

    candidate_target_ids: set[str] = set()
    for option in options:
        if not isinstance(option, Mapping):
            raise ValueError("P1 option must be an object")
        if option.get(OPTION_KIND_KEY) != CANDIDATE_OPTION_KIND:
            continue
        attributes = option.get(OPTION_ATTRIBUTES_KEY)
        target_id = attributes.get(TARGET_ID_KEY) if isinstance(attributes, Mapping) else None
        if isinstance(target_id, str):
            candidate_target_ids.add(target_id)

    has_gold_candidate = bool(candidate_target_ids.intersection(positive_targets))
    unknown_target = 0.0 if has_gold_candidate else 1.0
    verify_target = 1.0 if candidate_miss or not has_gold_candidate else 0.0
    trusted = is_trusted_label(labels)
    control_targets: list[float] = []
    control_weights: list[float] = []
    for option in options:
        if option.get(OPTION_KIND_KEY) == CANDIDATE_OPTION_KIND:
            control_targets.append(0.0)
            control_weights.append(0.0)
            continue
        option_id = option.get(OPTION_ID_KEY)
        if option_id == UNKNOWN_OPTION_ID:
            control_targets.append(unknown_target)
        elif option_id == VERIFY_OPTION_ID:
            control_targets.append(verify_target)
        else:
            raise ValueError(f"unsupported non-candidate protocol option: {option_id}")
        control_weights.append(1.0 if trusted else 0.0)

    return EventTargets(
        candidate_mask=shared_targets.candidate_mask,
        candidate_targets=shared_targets.option_targets,
        candidate_weights=shared_targets.option_weights,
        control_targets=tuple(control_targets),
        control_weights=tuple(control_weights),
    )


__all__ = [
    "EncodedExample",
    "EventTargets",
    "build_event_targets",
    "encode_example",
    "state_repository_family",
    "state_request_id",
]
