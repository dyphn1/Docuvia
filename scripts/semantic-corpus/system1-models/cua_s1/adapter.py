"""Pure P1 state/label encoding shared by training and scoring entry points."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Mapping

from constants import (
    CANDIDATE_OPTION_KIND,
    CALL_CALLEE_NAME_KEY,
    CALL_CONTEXT_KEY,
    CALL_EXPRESSION_KEY,
    CALL_GENERIC_HINTS_KEY,
    CALL_KIND_KEY,
    CALL_RECEIVER_HINT_KEY,
    CALL_SOURCE_WINDOW_KEY,
    CALLER_CONTEXT_KEY,
    CALLER_FILE_PATH_KEY,
    CALLER_SYMBOL_KEY,
    CONFIRMED_REVIEW_STATUS,
    CANDIDATE_PREFIX_TEMPLATE,
    CONTEXT_CALL_BYTES,
    CONTEXT_CALLER_BYTES,
    CONTEXT_CALLER_TEMPLATE,
    CONTEXT_CALL_TEMPLATE,
    CONTEXT_FIELD_SEPARATOR,
    CONTEXT_IMPORT_BINDING_BYTES,
    CONTEXT_IMPORT_TEMPLATE,
    CONTEXT_RECEIVER_TEMPLATE,
    CONTEXT_RECEIVER_BYTES,
    CONTEXT_SOURCE_WINDOW_BYTES,
    CONTEXT_SOURCE_WINDOW_FIELD_BYTES,
    CONTEXT_SOURCE_WINDOW_PREFIX,
    CONTEXT_KEY,
    CONTEXT_TEXT_KEY,
    DECLARATION_KIND_CODE_BY_KIND,
    DECLARATION_KIND_KEY,
    EMPTY_CONTEXT_VALUE,
    EVIDENCE_CODE_BY_TIER_A_KIND,
    EVIDENCE_STATUS_CODE_BY_STATUS,
    EVIDENCE_STATUS_KEY,
    FALSE_CONTEXT_VALUE,
    FORBIDDEN_STATE_KEYS,
    IMPORT_BARREL_STATUS_KEY,
    IMPORT_BINDING_KEY,
    IMPORT_IMPORTED_KEY,
    IMPORT_KIND_KEY,
    IMPORT_LOCAL_KEY,
    IMPORT_PATH_ALIAS_KEY,
    IMPORT_SOURCE_SPECIFIER_KEY,
    LABEL_CANDIDATE_MISS_KEY,
    LABEL_NEGATIVE_TARGET_IDS_KEY,
    LABEL_ORACLE_STATUS_KEY,
    LABEL_POSITIVE_TARGET_IDS_KEY,
    LABEL_REVIEW_STATUS_KEY,
    MAX_CONTEXT_BYTES,
    MAX_OPTION_BYTES,
    OPTION_TRUNCATION_MARKER,
    OPTION_ATTRIBUTES_KEY,
    OPTION_ID_KEY,
    OPTION_KIND_KEY,
    OPTION_TEXT_KEY,
    OPTIONS_KEY,
    REPO_ID_KEY,
    REQUEST_ID_KEY,
    REQUEST_KEY,
    RESOLVED_ORACLE_STATUS,
    TARGET_ID_KEY,
    TARGET_PATH_ELLIPSIS,
    TARGET_SIGNATURE_SEPARATOR,
    TIER_A_EVIDENCE_KEY,
    TIER_A_RANK_KEY,
    TRUNCATION_MARKER,
    TRUE_CONTEXT_VALUE,
    UNKNOWN_EVIDENCE_CODE,
    UNKNOWN_DECLARATION_KIND_CODE,
    UNKNOWN_EVIDENCE_STATUS_CODE,
    UNKNOWN_RANK_CODE,
    UNKNOWN_OPTION_ID,
    VERIFY_OPTION_ID,
)


@dataclass(frozen=True)
class EncodedExample:
    """CUA-S1 byte text plus stable option identity ordering."""

    context: str
    options: tuple[str, ...]
    option_ids: tuple[str, ...]


def _reject_label_fields(value: Any, path: str = "state") -> None:
    if isinstance(value, Mapping):
        for key, item in value.items():
            if key in FORBIDDEN_STATE_KEYS:
                raise ValueError(f"label-only field is forbidden in scorer input: {path}.{key}")
            _reject_label_fields(item, f"{path}.{key}")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            _reject_label_fields(item, f"{path}[{index}]")


def _truncate_utf8(text: str, maximum: int, marker: str = TRUNCATION_MARKER) -> str:
    encoded = text.encode("utf-8")
    if len(encoded) <= maximum:
        return text
    marker_bytes = marker.encode("utf-8")
    if maximum < len(marker_bytes):
        prefix = encoded[:maximum]
        while prefix:
            try:
                return prefix.decode("utf-8")
            except UnicodeDecodeError:
                prefix = prefix[:-1]
        return ""
    prefix = encoded[: maximum - len(marker_bytes)]
    while prefix:
        try:
            return prefix.decode("utf-8") + marker
        except UnicodeDecodeError:
            prefix = prefix[:-1]
    return marker


def _middle_truncate_utf8(text: str, maximum: int, marker: str = TARGET_PATH_ELLIPSIS) -> str:
    encoded = text.encode("utf-8")
    if len(encoded) <= maximum:
        return text
    marker_bytes = marker.encode("utf-8")
    if maximum < len(marker_bytes) + 2:
        return _truncate_utf8(text, maximum, marker="")
    remaining = maximum - len(marker_bytes)
    left_length = (remaining + 1) // 2
    right_length = remaining - left_length
    left = encoded[:left_length]
    while left:
        try:
            left_text = left.decode("utf-8")
            break
        except UnicodeDecodeError:
            left = left[:-1]
    else:
        left_text = ""
    right = encoded[len(encoded) - right_length :] if right_length else b""
    while right:
        try:
            right_text = right.decode("utf-8")
            break
        except UnicodeDecodeError:
            right = right[1:]
    else:
        right_text = ""
    return left_text + marker + right_text


def _context_value(value: Any) -> str:
    if value is None or value == "":
        return EMPTY_CONTEXT_VALUE
    if isinstance(value, bool):
        return TRUE_CONTEXT_VALUE if value else FALSE_CONTEXT_VALUE
    if isinstance(value, list):
        return ",".join(_context_value(item) for item in value)
    return str(value)


def _context_import_binding(value: Any) -> str:
    binding = value if isinstance(value, Mapping) else {}
    kind = _context_value(binding.get(IMPORT_KIND_KEY))
    local = _context_value(binding.get(IMPORT_LOCAL_KEY))
    imported = _context_value(binding.get(IMPORT_IMPORTED_KEY))
    specifier = _context_value(binding.get(IMPORT_SOURCE_SPECIFIER_KEY))
    barrel = _context_value(binding.get(IMPORT_BARREL_STATUS_KEY))
    path_alias = _context_value(binding.get(IMPORT_PATH_ALIAS_KEY))
    return _truncate_utf8(
        CONTEXT_IMPORT_TEMPLATE.format(
            kind=kind,
            local=local,
            imported=imported,
            specifier=specifier,
            barrel=barrel,
            path=path_alias,
        ),
        CONTEXT_IMPORT_BINDING_BYTES,
    )


def _context_caller(value: Any) -> str:
    caller = value if isinstance(value, Mapping) else {}
    symbol = _context_value(caller.get(CALLER_SYMBOL_KEY))
    file_path = _context_value(caller.get(CALLER_FILE_PATH_KEY))
    prefix = CONTEXT_CALLER_TEMPLATE.format(symbol=symbol, path="")
    path_budget = max(0, CONTEXT_CALLER_BYTES - len(prefix.encode("utf-8")))
    bounded_path = _middle_truncate_utf8(file_path, path_budget)
    return _truncate_utf8(prefix + bounded_path, CONTEXT_CALLER_BYTES)


def _context_receiver(value: Any) -> str:
    call = value if isinstance(value, Mapping) else {}
    receiver = _context_value(call.get(CALL_RECEIVER_HINT_KEY))
    generics = _context_value(call.get(CALL_GENERIC_HINTS_KEY))
    return _truncate_utf8(
        CONTEXT_RECEIVER_TEMPLATE.format(receiver=receiver, generics=generics),
        CONTEXT_RECEIVER_BYTES,
    )


def _context_call(value: Any) -> str:
    call = value if isinstance(value, Mapping) else {}
    kind = _context_value(call.get(CALL_KIND_KEY))
    callee = _context_value(call.get(CALL_CALLEE_NAME_KEY))
    expression = _context_value(call.get(CALL_EXPRESSION_KEY))
    return _truncate_utf8(
        CONTEXT_CALL_TEMPLATE.format(kind=kind, callee=callee, expression=expression),
        CONTEXT_CALL_BYTES,
    )


def _context_source_window(value: Any) -> str:
    call = value if isinstance(value, Mapping) else {}
    window = _context_value(call.get(CALL_SOURCE_WINDOW_KEY))
    prefix = CONTEXT_SOURCE_WINDOW_PREFIX
    window_budget = max(
        0,
        CONTEXT_SOURCE_WINDOW_BYTES - CONTEXT_SOURCE_WINDOW_FIELD_BYTES,
    )
    return prefix + _truncate_utf8(window, window_budget)


def _canonical_context(raw: Any) -> str:
    if not isinstance(raw, str):
        raise ValueError("P1 context.text must be a string")
    try:
        decoded = json.loads(raw)
    except json.JSONDecodeError as error:
        raise ValueError("P1 context.text must contain the bounded context object") from error
    if not isinstance(decoded, dict):
        raise ValueError("P1 context.text must encode an object")
    if CALLER_CONTEXT_KEY not in decoded or CALL_CONTEXT_KEY not in decoded:
        raise ValueError("P1 context is missing caller or call syntax evidence")
    call = decoded.get(CALL_CONTEXT_KEY)
    fields = (
        _context_import_binding(decoded.get(IMPORT_BINDING_KEY)),
        _context_caller(decoded.get(CALLER_CONTEXT_KEY)),
        _context_receiver(call),
        _context_call(call),
        _context_source_window(call),
    )
    context = CONTEXT_FIELD_SEPARATOR.join(fields)
    return _truncate_utf8(context, MAX_CONTEXT_BYTES)


def _candidate_target_id(target_id: str, maximum: int) -> str:
    if "#" not in target_id:
        return _middle_truncate_utf8(target_id, maximum)
    file_path, symbol_and_container = target_id.split("#", 1)
    suffix = f"#{symbol_and_container}"
    suffix_bytes = len(suffix.encode("utf-8"))
    if suffix_bytes > maximum:
        raise ValueError("candidate symbol and container do not fit the fixed option budget")
    path_budget = maximum - suffix_bytes
    return _middle_truncate_utf8(file_path, path_budget) + suffix


def _candidate_text(option: Mapping[str, Any]) -> str:
    attributes = option.get(OPTION_ATTRIBUTES_KEY)
    if not isinstance(attributes, Mapping):
        attributes = {}
    rank = attributes.get(TIER_A_RANK_KEY)
    rank_code = f"r{rank}" if rank in (0, 1, 2) else UNKNOWN_RANK_CODE
    evidence = attributes.get(TIER_A_EVIDENCE_KEY)
    evidence_code = (
        EVIDENCE_CODE_BY_TIER_A_KIND.get(evidence, UNKNOWN_EVIDENCE_CODE)
        if isinstance(evidence, str)
        else UNKNOWN_EVIDENCE_CODE
    )
    declaration_kind = attributes.get(DECLARATION_KIND_KEY)
    kind_code = (
        DECLARATION_KIND_CODE_BY_KIND.get(declaration_kind, UNKNOWN_DECLARATION_KIND_CODE)
        if isinstance(declaration_kind, str)
        else UNKNOWN_DECLARATION_KIND_CODE
    )
    evidence_status = attributes.get(EVIDENCE_STATUS_KEY)
    status_code = (
        EVIDENCE_STATUS_CODE_BY_STATUS.get(evidence_status, UNKNOWN_EVIDENCE_STATUS_CODE)
        if isinstance(evidence_status, str)
        else UNKNOWN_EVIDENCE_STATUS_CODE
    )
    priority = CANDIDATE_PREFIX_TEMPLATE.format(
        rank=rank_code,
        evidence=evidence_code,
        kind=kind_code,
        status=status_code,
    )
    target = attributes.get(TARGET_ID_KEY)
    if not isinstance(target, str) or not target:
        raise ValueError("candidate option is missing its targetId")
    delimiter_bytes = len(TARGET_SIGNATURE_SEPARATOR.encode("utf-8"))
    target_budget = MAX_OPTION_BYTES - len(priority.encode("utf-8")) - delimiter_bytes
    bounded_target = _candidate_target_id(target, target_budget)
    signature = str(option.get(OPTION_TEXT_KEY, ""))
    signature_budget = (
        MAX_OPTION_BYTES
        - len(priority.encode("utf-8"))
        - len(bounded_target.encode("utf-8"))
        - delimiter_bytes
    )
    bounded_signature = _truncate_utf8(
        signature,
        signature_budget,
        marker=OPTION_TRUNCATION_MARKER,
    )
    encoded = priority + bounded_target + TARGET_SIGNATURE_SEPARATOR + bounded_signature
    if len(encoded.encode("utf-8")) > MAX_OPTION_BYTES:
        raise ValueError("candidate option exceeds the fixed CUA-S1 byte token budget")
    return encoded


def encode_example(state: Mapping[str, Any]) -> EncodedExample:
    """Encode a P1 record without consulting any labels or oracle fields."""
    _reject_label_fields(state)
    request = state.get(REQUEST_KEY)
    if not isinstance(request, Mapping):
        raise ValueError("P1 state record is missing request")
    context = request.get(CONTEXT_KEY)
    if not isinstance(context, Mapping):
        raise ValueError("P1 request is missing context")
    raw_context = context.get(CONTEXT_TEXT_KEY)
    encoded_context = _canonical_context(raw_context)
    options = request.get(OPTIONS_KEY)
    if not isinstance(options, list) or len(options) < 2:
        raise ValueError("P1 request must contain at least the UNKNOWN and VERIFY options")
    option_ids: list[str] = []
    option_texts: list[str] = []
    for option in options:
        if not isinstance(option, Mapping):
            raise ValueError("P1 option must be an object")
        option_id = option.get(OPTION_ID_KEY)
        kind = option.get(OPTION_KIND_KEY)
        if not isinstance(option_id, str) or not option_id:
            raise ValueError("P1 option is missing its stable id")
        if option_id in option_ids:
            raise ValueError(f"duplicate P1 option id: {option_id}")
        if kind == CANDIDATE_OPTION_KIND:
            text = _candidate_text(option)
        else:
            text = _truncate_utf8(f"{kind}: {option.get(OPTION_TEXT_KEY, '')}", MAX_OPTION_BYTES)
        option_ids.append(option_id)
        option_texts.append(text)
    if option_ids[-2:] != [UNKNOWN_OPTION_ID, VERIFY_OPTION_ID]:
        raise ValueError("P1 controls must end with UNKNOWN and VERIFY_WITH_LSP")
    return EncodedExample(encoded_context, tuple(option_texts), tuple(option_ids))


def is_trusted_label(labels: Mapping[str, Any]) -> bool:
    positive = labels.get(LABEL_POSITIVE_TARGET_IDS_KEY)
    negative = labels.get(LABEL_NEGATIVE_TARGET_IDS_KEY)
    if labels.get(LABEL_REVIEW_STATUS_KEY) != CONFIRMED_REVIEW_STATUS:
        return False
    if labels.get(LABEL_ORACLE_STATUS_KEY) != RESOLVED_ORACLE_STATUS:
        return False
    if not isinstance(positive, list) or not positive:
        return False
    if not isinstance(negative, list):
        return False
    return not set(positive).intersection(negative)


def training_targets(request: Mapping[str, Any], labels: Mapping[str, Any]) -> list[float]:
    """Create independent BCE targets without creating options outside P1."""
    options = request.get(OPTIONS_KEY)
    positive = labels.get(LABEL_POSITIVE_TARGET_IDS_KEY)
    if not isinstance(options, list) or not isinstance(positive, list):
        raise ValueError("request options and positive target ids must be arrays")
    positive_targets = {target for target in positive if isinstance(target, str)}
    candidate_gold_found = False
    targets: list[float] = []
    for index, option in enumerate(options):
        if not isinstance(option, Mapping):
            raise ValueError("P1 option must be an object")
        if option.get(OPTION_KIND_KEY) == CANDIDATE_OPTION_KIND:
            attributes = option.get(OPTION_ATTRIBUTES_KEY)
            target_id = attributes.get(TARGET_ID_KEY) if isinstance(attributes, Mapping) else None
            is_positive = isinstance(target_id, str) and target_id in positive_targets
            targets.append(1.0 if is_positive else 0.0)
            candidate_gold_found = candidate_gold_found or is_positive
        else:
            targets.append(0.0)
    no_candidate_gold = not candidate_gold_found
    candidate_miss = labels.get(LABEL_CANDIDATE_MISS_KEY)
    if not isinstance(candidate_miss, bool):
        raise ValueError("candidateMiss must be boolean")
    for index, option in enumerate(options):
        if option.get(OPTION_ID_KEY) == UNKNOWN_OPTION_ID:
            targets[index] = 1.0 if no_candidate_gold else 0.0
        elif option.get(OPTION_ID_KEY) == VERIFY_OPTION_ID:
            targets[index] = 1.0 if (candidate_miss or no_candidate_gold) else 0.0
    return targets


def repository_family(repo_id: str) -> str:
    """Match the P2 owner/repository fold normalization exactly."""
    value = repo_id.strip()
    if value.startswith("https://"):
        value = value[len("https://") :]
    elif value.startswith("http://"):
        value = value[len("http://") :]
    if value.startswith("git@"):
        value = value[len("git@") :]
    value = value.replace(":", "/", 1)
    if value.endswith(".git"):
        value = value[:-4]
    parts = [part for part in value.split("/") if part]
    family = "/".join(parts[-2:])
    if len(family.split("/")) != 2:
        raise ValueError(f"invalid repository-family identity: {repo_id}")
    return family


def state_request_id(state: Mapping[str, Any]) -> str:
    request = state.get(REQUEST_KEY)
    request_id = request.get(REQUEST_ID_KEY) if isinstance(request, Mapping) else None
    if not isinstance(request_id, str) or not request_id:
        raise ValueError("P1 state record is missing requestId")
    return request_id


def state_repository_family(state: Mapping[str, Any]) -> str:
    request = state.get(REQUEST_KEY)
    evidence = request.get("evidence") if isinstance(request, Mapping) else None
    repo_id = evidence.get(REPO_ID_KEY) if isinstance(evidence, Mapping) else None
    if not isinstance(repo_id, str):
        raise ValueError("P1 state record is missing evidence.repoId")
    return repository_family(repo_id)
