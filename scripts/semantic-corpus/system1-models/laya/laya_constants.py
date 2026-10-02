"""Fixed Laya P4 model, data, and resource limits."""

from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parent
REPOSITORY_ROOT = PACKAGE_ROOT.parents[3]
DEFAULT_DATASET_DIRECTORY = (
    REPOSITORY_ROOT
    / "evaluate"
    / "results"
    / "semantic-corpus"
    / "v1"
    / "system1-dataset-v2"
)
DEFAULT_BASE_MODEL_DIRECTORY = Path.home() / "runs" / "laya-s1-full" / "model"
DEFAULT_OUTPUT_DIRECTORY = (
    REPOSITORY_ROOT
    / "evaluate"
    / "results"
    / "semantic-corpus"
    / "v1"
    / "system1-models"
    / "laya"
    / "domain-adapt-independent-event-v1"
)
DEFAULT_EVAL_DIRECTORY = (
    REPOSITORY_ROOT
    / "evaluate"
    / "results"
    / "semantic-corpus"
    / "v1"
    / "system1-eval-v2"
    / "laya-independent-event-v1"
)

TRAINING_SPLITS = ("train", "calibration")
STATE_FILE_SUFFIX = "-state.jsonl"
LABEL_FILE_SUFFIX = "-labels.jsonl"
MAX_STATE_LINE_BYTES = 2_000_000
MAX_LABEL_LINE_BYTES = 100_000
MAX_PROCESS_RSS_BYTES = 6 * 1024 * 1024 * 1024
MIN_SYSTEM_FREE_MEMORY_PERCENT = 25
SERVING_RSS_CEILING_BYTES = 512 * 1024 * 1024

ENCODER_BATCH_SIZE = 4
INFERENCE_BATCH_SIZE = 4
TRAINING_BATCH_SIZE = 128
MAX_SEQUENCE_LENGTH = 256
HIDDEN_SIZE = 768
HEAD_HIDDEN_SIZE = 256
TRAINING_EPOCHS = 1
BASE_SEED = 553
FOLD_SEED_OFFSET = 1009
LEARNING_RATE = 0.001
WEIGHT_DECAY = 0.0001
MAX_GRADIENT_NORM = 1.0
PROGRESS_INTERVAL_SECONDS = 180
RESOURCE_CHECK_INTERVAL_SECONDS = 30

SCORER_ID = "laya-independent-event-v1"
SCORER_VERSION = "0.0.0+553.p4-independent-event-v1"
SCORER_CONFIG_NAME = "scorer-config.json"
TRAINING_MANIFEST_NAME = "training-manifest.json"
DIAGNOSTICS_NAME = "diagnostics-oof.json"
ROUTER_REPORT_NAME = "router-feasibility.json"
EVENT_FEATURE_FILE_NAME = "pool-option-features.f32"
EVENT_INDEX_FILE_NAME = "pool-option-events.jsonl"
HEAD_WEIGHTS_NAME = "head.safetensors"
HEAD_CONFIG_NAME = "head.json"

CONTROL_UNKNOWN_ID = "UNKNOWN"
CONTROL_VERIFY_ID = "VERIFY_WITH_LSP"
STATUS_OK = "ok"
STATUS_ERROR = "error"
SCORE_KIND_RAW = "raw"
