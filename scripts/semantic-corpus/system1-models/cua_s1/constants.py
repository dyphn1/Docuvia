"""Fixed P3 CUA-S1 encoding and training constants."""

from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parent
REPOSITORY_ROOT = PACKAGE_ROOT.parents[3]
DEFAULT_DATASET_DIRECTORY = (
    REPOSITORY_ROOT / "evaluate" / "results" / "semantic-corpus" / "v1" / "system1-dataset"
)
DEFAULT_MODEL_DIRECTORY = (
    REPOSITORY_ROOT / "evaluate" / "results" / "semantic-corpus" / "v1" / "system1-models" / "cua-s1"
)

TRAINING_SPLITS = ("train", "calibration")
STATE_FILE_SUFFIX = "-state.jsonl"
LABEL_FILE_SUFFIX = "-labels.jsonl"
REQUEST_KEY = "request"
REQUEST_ID_KEY = "requestId"
REPO_ID_KEY = "repoId"
CONTEXT_KEY = "context"
CONTEXT_TEXT_KEY = "text"
CALLER_CONTEXT_KEY = "caller"
CALL_CONTEXT_KEY = "call"
IMPORT_BINDING_KEY = "importBinding"
CALLER_FILE_PATH_KEY = "filePath"
CALLER_SYMBOL_KEY = "symbol"
CALL_CALLEE_NAME_KEY = "calleeName"
CALL_EXPRESSION_KEY = "expression"
CALL_KIND_KEY = "kind"
CALL_RECEIVER_HINT_KEY = "receiverHint"
CALL_GENERIC_HINTS_KEY = "genericHints"
CALL_SOURCE_WINDOW_KEY = "sourceWindow"
IMPORT_KIND_KEY = "kind"
IMPORT_LOCAL_KEY = "local"
IMPORT_IMPORTED_KEY = "imported"
IMPORT_SOURCE_SPECIFIER_KEY = "sourceSpecifier"
IMPORT_BARREL_STATUS_KEY = "barrelStatus"
IMPORT_PATH_ALIAS_KEY = "pathAlias"
OPTIONS_KEY = "options"
OPTION_ID_KEY = "id"
OPTION_KIND_KEY = "kind"
OPTION_TEXT_KEY = "text"
OPTION_ATTRIBUTES_KEY = "attributes"
TARGET_ID_KEY = "targetId"
TIER_A_RANK_KEY = "tierARank"
TIER_A_EVIDENCE_KEY = "tierAEvidence"
EVIDENCE_STATUS_KEY = "evidenceStatus"
DECLARATION_KIND_KEY = "declarationKind"
UNKNOWN_OPTION_ID = "UNKNOWN"
VERIFY_OPTION_ID = "VERIFY_WITH_LSP"
CANDIDATE_OPTION_KIND = "candidate"
UNKNOWN_OPTION_KIND = "unknown"
VERIFY_OPTION_KIND = "verify"
LABEL_POSITIVE_TARGET_IDS_KEY = "positiveTargetIds"
LABEL_NEGATIVE_TARGET_IDS_KEY = "negativeTargetIds"
LABEL_REVIEW_STATUS_KEY = "reviewStatus"
LABEL_ORACLE_STATUS_KEY = "oracleStatus"
LABEL_CANDIDATE_MISS_KEY = "candidateMiss"
CONFIRMED_REVIEW_STATUS = "confirmed"
RESOLVED_ORACLE_STATUS = "resolved"
TRUSTED_SAMPLE_KEY = "trusted"
STATUS_KEY = "status"
STATUS_OK = "ok"
STATUS_ERROR = "error"
SCORE_KIND_KEY = "scoreKind"
SCORE_KIND_RAW = "raw"
SCORES_KEY = "scores"
FOLD_FAMILY_KEY = "foldFamily"
CHECKPOINT_PATH_KEY = "checkpointPath"
POOL_FAMILIES_KEY = "poolFamilies"

MAX_CONTEXT_BYTES = 1024
MAX_OPTION_BYTES = 96
TRUNCATION_MARKER = " [truncated]"
OPTION_TRUNCATION_MARKER = "…"
TARGET_PATH_ELLIPSIS = "…"
CONTEXT_IMPORT_BINDING_BYTES = 320
CONTEXT_CALLER_BYTES = 184
CONTEXT_RECEIVER_BYTES = 112
CONTEXT_CALL_BYTES = 216
CONTEXT_SOURCE_WINDOW_BYTES = 160
CONTEXT_FIELD_SEPARATOR = " | "
TARGET_SIGNATURE_SEPARATOR = " "
CANDIDATE_PREFIX_TEMPLATE = "{rank} {evidence} {kind} {status} "
EMPTY_CONTEXT_VALUE = "-"
TRUE_CONTEXT_VALUE = "1"
FALSE_CONTEXT_VALUE = "0"
UNKNOWN_RANK_CODE = "r?"
UNKNOWN_EVIDENCE_CODE = "other"
UNKNOWN_DECLARATION_KIND_CODE = "u"
UNKNOWN_EVIDENCE_STATUS_CODE = "m"
EVIDENCE_STATUS_CODE_BY_STATUS = {"present": "p", "missing": "m"}
DECLARATION_KIND_CODE_BY_KIND = {
    "class": "c",
    "function": "f",
    "interface": "i",
    "method": "m",
    "property": "p",
    "type-alias": "t",
    "unknown": "u",
    "variable": "v",
}
EVIDENCE_CODE_BY_TIER_A_KIND = {
    "tier-a-calls-edge": "call",
    "tier-a-same-name": "name",
    "tier-a-imports-file": "file",
}
OPTION_FIELD_SEPARATOR = " "
CONTEXT_IMPORT_TEMPLATE = "import {kind} {local}->{imported} from={specifier} barrel={barrel} path={path}"
CONTEXT_CALLER_TEMPLATE = "caller={symbol} file={path}"
CONTEXT_RECEIVER_TEMPLATE = "receiver={receiver} generic={generics}"
CONTEXT_CALL_TEMPLATE = "call {kind} callee={callee} expr={expression}"
CONTEXT_SOURCE_WINDOW_PREFIX = "window="
CONTEXT_SOURCE_WINDOW_FIELD_BYTES = 7
MAX_STATE_LINE_BYTES = 2_000_000
MAX_LABEL_LINE_BYTES = 100_000
TRAINING_EPOCHS = 1
TRAINING_BATCH_SIZE = 8
TRAIN_LOG_BATCH_INTERVAL = 250
INFERENCE_BATCH_SIZE = 4
LEARNING_RATE = 0.0003
WEIGHT_DECAY = 0.0001
MAX_GRADIENT_NORM = 1.0
BASE_SEED = 553
TORCH_THREADS = 4
MAX_PROCESS_RSS_BYTES = 3 * 1024 * 1024 * 1024

MODEL_CONFIG = {
    "encoder": "tinyx",
    "width": 128,
    "rank": 128,
    "context_tokens": MAX_CONTEXT_BYTES,
    "option_tokens": MAX_OPTION_BYTES,
    "layers": 2,
    "heads": 4,
    "dropout": 0.1,
}

TRAINING_CONFIG = {
    "epochs": TRAINING_EPOCHS,
    "batchSize": TRAINING_BATCH_SIZE,
    "batchLogInterval": TRAIN_LOG_BATCH_INTERVAL,
    "learningRate": LEARNING_RATE,
    "weightDecay": WEIGHT_DECAY,
    "maxGradientNorm": MAX_GRADIENT_NORM,
    "baseSeed": BASE_SEED,
    "torchThreads": TORCH_THREADS,
    "device": "cpu",
    "loss": "independent-option-bce-with-logits-v1",
    "optimizer": "AdamW",
    "earlyStopping": False,
}

MIN_CANDIDATE_SYMBOL_SURVIVAL_RATE = 0.99
MAX_GOLD_DECOY_COLLISION_RATE = 0.01
ENCODING_AUDIT_SPLITS = ("train", "calibration")
ENCODING_AUDIT_REPORT_NAME = "encoding-audit.json"
ENCODING_AUDIT_SCHEMA = "cua-s1-system1-encoding-audit/v1"
AUDIT_SCHEMA_FIELD = "schema"
AUDIT_FILES_READ_FIELD = "filesRead"
AUDIT_FILES_SHA256_FIELD = "filesSha256"
AUDIT_TRAINING_STARTED_FIELD = "trainingStarted"
AUDIT_SPLITS_FIELD = "splits"
AUDIT_OVERALL_FIELD = "overall"
AUDIT_GATE_FIELD = "gate"
AUDIT_GATE_PASSED_FIELD = "passed"
AUDIT_SYMBOL_RATE_FIELD = "candidateSymbolSurvivalRate"
AUDIT_GOLD_PAIR_RATE_FIELD = "goldIdenticalToDecoyPairRate"
AUDIT_GOLD_REQUEST_RATE_FIELD = "goldIdenticalToDecoyRequestRate"
AUDIT_IDENTICAL_REQUEST_RATE_FIELD = "multiRequestDuplicateEncodingRate"
AUDIT_IDENTICAL_PAIR_RATE_FIELD = "candidatePairDuplicateEncodingRate"
AUDIT_SOURCE_SPECIFIER_RATE_FIELD = "sourceSpecifierSurvivalRate"
AUDIT_REQUEST_COUNT_FIELD = "requestCount"
AUDIT_TRUSTED_REQUEST_COUNT_FIELD = "trustedRequestCount"
AUDIT_UNTRUSTED_REQUEST_COUNT_FIELD = "untrustedRequestCount"
AUDIT_CANDIDATE_COUNT_FIELD = "candidateCount"
AUDIT_MULTI_REQUEST_COUNT_FIELD = "multiCandidateRequestCount"
AUDIT_MULTI_COLLISION_COUNT_FIELD = "multiRequestsWithDuplicateEncodings"
AUDIT_CANDIDATE_PAIR_COUNT_FIELD = "candidatePairCount"
AUDIT_DUPLICATE_PAIR_COUNT_FIELD = "duplicateEncodingPairCount"
AUDIT_SYMBOL_COUNT_FIELD = "candidateWithSymbolCount"
AUDIT_SYMBOL_SURVIVED_FIELD = "candidateSymbolSurvivedCount"
AUDIT_SPECIFIER_COUNT_FIELD = "sourceSpecifierRequestCount"
AUDIT_SPECIFIER_SURVIVED_FIELD = "sourceSpecifierSurvivedCount"
AUDIT_GOLD_DECOY_REQUEST_COUNT_FIELD = "trustedMultiRequestsWithGoldAndDecoy"
AUDIT_GOLD_COLLISION_REQUEST_COUNT_FIELD = "requestsWithGoldIdenticalToDecoy"
AUDIT_GOLD_DECOY_PAIR_COUNT_FIELD = "goldDecoyPairCount"
AUDIT_GOLD_COLLISION_PAIR_COUNT_FIELD = "goldIdenticalToDecoyPairCount"
AUDIT_GENUINE_DECLARATION_PAIR_COUNT_FIELD = "genuinelyIdenticalDeclarationPairCount"
AUDIT_GOLD_ABSENT_REQUEST_COUNT_FIELD = "trustedMultiRequestsWithNoGoldCandidate"
AUDIT_SYMBOL_MIN_RATE_FIELD = "requiredCandidateSymbolSurvivalRate"
AUDIT_GOLD_MAX_RATE_FIELD = "maximumGoldDecoyCollisionRate"

FORBIDDEN_STATE_KEYS = frozenset(
    {
        "oracle",
        "oracleStatus",
        "review",
        "reviewStatus",
        "checker",
        "checkerStatus",
        "labels",
        "positiveTargetIds",
        "negativeTargetIds",
        "candidateMiss",
        "gold",
    }
)
