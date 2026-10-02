"""Explicitly shared P1 state and label helpers from the CUA-S1 adapter."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

SYSTEM1_MODELS_DIRECTORY = Path(__file__).resolve().parents[1]
CUA_S1_DIRECTORY = SYSTEM1_MODELS_DIRECTORY / "cua_s1"
if str(CUA_S1_DIRECTORY) not in sys.path:
    sys.path.insert(0, str(CUA_S1_DIRECTORY))


def _load_shared_module(name: str, path: Path):
    existing = sys.modules.get(name)
    if existing is not None:
        return existing
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load shared CUA-S1 module from {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


_CUA_ADAPTER = _load_shared_module(
    "_docuvia_cua_s1_adapter", CUA_S1_DIRECTORY / "adapter.py"
)
_CUA_CONSTANTS = sys.modules["constants"]
_CUA_RESOURCE_BUDGET = _load_shared_module(
    "_docuvia_cua_s1_resource_budget", CUA_S1_DIRECTORY / "resource_budget.py"
)

_LAYA_DIRECTORY = str(Path(__file__).resolve().parent)
if _LAYA_DIRECTORY in sys.path:
    sys.path.remove(_LAYA_DIRECTORY)
sys.path.insert(0, _LAYA_DIRECTORY)

EncodedExample = _CUA_ADAPTER.EncodedExample
TrainingTargets = _CUA_ADAPTER.TrainingTargets
encode_example = _CUA_ADAPTER.encode_example
is_trusted_label = _CUA_ADAPTER.is_trusted_label
repository_family = _CUA_ADAPTER.repository_family
state_repository_family = _CUA_ADAPTER.state_repository_family
state_request_id = _CUA_ADAPTER.state_request_id
training_targets = _CUA_ADAPTER.training_targets

CANDIDATE_OPTION_KIND = _CUA_CONSTANTS.CANDIDATE_OPTION_KIND
LABEL_CANDIDATE_MISS_KEY = _CUA_CONSTANTS.LABEL_CANDIDATE_MISS_KEY
LABEL_NEGATIVE_TARGET_IDS_KEY = _CUA_CONSTANTS.LABEL_NEGATIVE_TARGET_IDS_KEY
LABEL_POSITIVE_TARGET_IDS_KEY = _CUA_CONSTANTS.LABEL_POSITIVE_TARGET_IDS_KEY
OPTION_ATTRIBUTES_KEY = _CUA_CONSTANTS.OPTION_ATTRIBUTES_KEY
OPTION_ID_KEY = _CUA_CONSTANTS.OPTION_ID_KEY
OPTION_KIND_KEY = _CUA_CONSTANTS.OPTION_KIND_KEY
OPTIONS_KEY = _CUA_CONSTANTS.OPTIONS_KEY
TARGET_ID_KEY = _CUA_CONSTANTS.TARGET_ID_KEY
UNKNOWN_OPTION_ID = _CUA_CONSTANTS.UNKNOWN_OPTION_ID
VERIFY_OPTION_ID = _CUA_CONSTANTS.VERIFY_OPTION_ID

ResourceSnapshot = _CUA_RESOURCE_BUDGET.ResourceSnapshot
process_rss_bytes = _CUA_RESOURCE_BUDGET.process_rss_bytes
system_free_memory_percent = _CUA_RESOURCE_BUDGET.system_free_memory_percent

__all__ = [
    "CANDIDATE_OPTION_KIND",
    "EncodedExample",
    "LABEL_CANDIDATE_MISS_KEY",
    "LABEL_NEGATIVE_TARGET_IDS_KEY",
    "LABEL_POSITIVE_TARGET_IDS_KEY",
    "OPTION_ATTRIBUTES_KEY",
    "OPTION_ID_KEY",
    "OPTION_KIND_KEY",
    "OPTIONS_KEY",
    "ResourceSnapshot",
    "TARGET_ID_KEY",
    "TrainingTargets",
    "UNKNOWN_OPTION_ID",
    "VERIFY_OPTION_ID",
    "encode_example",
    "is_trusted_label",
    "process_rss_bytes",
    "repository_family",
    "state_repository_family",
    "state_request_id",
    "system_free_memory_percent",
    "training_targets",
]
