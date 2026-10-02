import { SYSTEM1_DATASET_V2_DIRECTORY } from "../system1-constants.js";
export {
  SYSTEM1_AMBIGUITY_CLASSES,
  SYSTEM1_AMBIGUITY_CLASS_ORDER,
} from "../system1-constants.js";

export const SYSTEM1_EVAL_SCHEMA_VERSION = 1;
export const SYSTEM1_EVAL_OUTPUT_SCHEMA_VERSION = 1;
export const SYSTEM1_EVAL_PROTOCOL_VERSION = "system1-eval-protocol/v2";
export const SYSTEM1_EVAL_CORPUS_MANIFEST_RELATIVE_PATH =
  "../run-c/corpus-manifest.json";
export const SYSTEM1_EVAL_DATASET_DIRECTORY = SYSTEM1_DATASET_V2_DIRECTORY;
export const SYSTEM1_EVAL_OUTPUT_PATH = {
  DATASET_DIRECTORY_NAME: "system1-dataset",
  EVALUATION_DIRECTORY_NAME: "system1-eval",
  VERSION_SEPARATOR: "-v",
} as const;
export const SYSTEM1_EVAL_OUTPUT_PATH_ERRORS = {
  INVALID_DATASET_DIRECTORY:
    "System-1 dataset directory must be named system1-dataset or system1-dataset-vN.",
} as const;
export const SYSTEM1_EVAL_CORPUS_MANIFEST_ERRORS = {
  PIN_MISMATCH: "Corpus manifest does not match the frozen policy pin.",
  MISSING_POLICY_PIN: "Frozen policy has no corpus manifest pin.",
} as const;
export const SYSTEM1_EVAL_NO_CONFIG_SENTINEL = "no-weights-config";
export const SYSTEM1_EVAL_IN_PROCESS_COMMAND = "in-process";
export const SYSTEM1_EVAL_DEFAULT_BASELINE_VERSION = "1";
export const SYSTEM1_EVAL_RUNTIME_UNAVAILABLE = "unavailable";
export const SYSTEM1_EVAL_SCORER_RUNTIME_KEY_PREFIX = "scorer.";
export const SYSTEM1_EVAL_REPLAY_DIRECTORY_PREFIX = "system1-eval-replay-";
export const SYSTEM1_EVAL_JSON_LINE_ENDING = "\n";
export const SYSTEM1_EVAL_OUTPUT_DIRECTORY_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;
export const SYSTEM1_EVAL_FINAL_EVALUATION_MODE = "final-evaluation";
export const SYSTEM1_EVAL_CLI_SEPARATOR = "--";

export const SYSTEM1_EVAL_SCORE_KIND = {
  RAW: "raw",
} as const;

export const SYSTEM1_EVAL_SCORER_STATUSES = {
  OK: "ok",
  TIMEOUT: "timeout",
  ERROR: "error",
  OOD: "ood",
} as const;

export const SYSTEM1_EVAL_ACTIONS = {
  COMMIT: "commit",
  UNKNOWN: "unknown",
  VERIFY: "verify",
} as const;

export const SYSTEM1_EVAL_THRESHOLD_STATUSES = {
  CERTIFIED: "certified",
  UNCERTIFIABLE: "uncertifiable",
} as const;

export const SYSTEM1_EVAL_CALIBRATION_METHOD = "isotonic-pava-v1";
export const SYSTEM1_EVAL_CERTIFICATION_MODES = {
  CALIBRATION_ONLY: "calibration-only",
  LEAVE_ONE_FAMILY_OUT: "leave-one-family-out",
} as const;
export const SYSTEM1_EVAL_OOF_DIAGNOSTIC_KINDS = {
  CERTIFIED: "certified",
  BEST_POOLED_LOWER_BOUND: "best-pooled-lower-bound",
  STRICTEST: "strictest",
  LEAST_STRICT: "least-strict",
} as const;
export const SYSTEM1_EVAL_DEFAULT_MIN_FAMILY_COMMITS = 200;
export const SYSTEM1_EVAL_TRAINING_MODES = {
  NO_TRAINING: "no-training",
  FOLDED: "folded",
} as const;
export const SYSTEM1_EVAL_RESPONSE_FOLD_FAMILY_KEY = "foldFamily";
export const SYSTEM1_EVAL_FAMILY_REQUIREMENT =
  "every-family-at-or-above-minimum-meets-target-point-precision";

export const SYSTEM1_EVAL_BASELINE_IDS = {
  TIER_A_RANK_PRIOR: "tierA-rank-prior",
  SINGLE_RANK0: "single-rank0",
  ALWAYS_VERIFY: "always-verify",
} as const;

export const SYSTEM1_EVAL_BASELINE_RANK_SCORES = [0.9, 0.55, 0.3] as const;
export const SYSTEM1_EVAL_BASELINE_UNKNOWN_SCORE = 0.25;
export const SYSTEM1_EVAL_BASELINE_VERIFY_SCORE = 0.75;
export const SYSTEM1_EVAL_BASELINE_NO_CANDIDATE_UNKNOWN_SCORE = 0.8;
export const SYSTEM1_EVAL_BASELINE_NO_CANDIDATE_VERIFY_SCORE = 0.1;
export const SYSTEM1_EVAL_SINGLE_RANK0_SCORE = 0.99;
export const SYSTEM1_EVAL_SINGLE_RANK0_OTHER_SCORE = 0.01;
export const SYSTEM1_EVAL_SINGLE_RANK0_UNKNOWN_SCORE = 0.8;
export const SYSTEM1_EVAL_SINGLE_RANK0_VERIFY_SCORE = 0.2;
export const SYSTEM1_EVAL_SINGLE_RANK0_WITH_CANDIDATE_UNKNOWN_SCORE = 0.1;
export const SYSTEM1_EVAL_ALWAYS_VERIFY_SCORE = 1;

export const SYSTEM1_EVAL_PRECISION_TARGETS = [0.99, 0.995, 0.999] as const;
export const SYSTEM1_EVAL_PRECISION_TARGET_KEYS = [
  "0.990",
  "0.995",
  "0.999",
] as const;
export const SYSTEM1_EVAL_ONE_SIDED_ALPHA = 0.05;
export const SYSTEM1_EVAL_WILSON_Z_95 = 1.959963984540054;
export const SYSTEM1_EVAL_BETA_INVERSE_ITERATIONS = 64;
export const SYSTEM1_EVAL_BETA_FRACTION_MAX_ITERATIONS = 200;
export const SYSTEM1_EVAL_BETA_FRACTION_MIN_VALUE = 1e-300;
export const SYSTEM1_EVAL_BETA_FRACTION_EPSILON = 3e-14;
export const SYSTEM1_EVAL_LOG_TWO_PI_HALF = 0.9189385332046727;
export const SYSTEM1_EVAL_LANCZOS_G = 7;
export const SYSTEM1_EVAL_LANCZOS_COEFFICIENTS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028,
  771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
] as const;

export const SYSTEM1_EVAL_RELIABILITY_BIN_COUNT = 15;
export const SYSTEM1_EVAL_RELIABILITY_BIN_KEYS = {
  LOWER: "lowerBound",
  UPPER: "upperBound",
} as const;
export const SYSTEM1_EVAL_CANDIDATE_MISSING_EVIDENCE = "missing";
export const SYSTEM1_EVAL_CANDIDATE_SIZE_OVERFLOW_BUCKET = "33+";
export const SYSTEM1_EVAL_MISSING_EVIDENCE_KEYS = {
  HAS: "has-missing-evidence",
  NONE: "no-missing-evidence",
} as const;
export const SYSTEM1_EVAL_BATCH_SIZE = 64;
export const SYSTEM1_EVAL_BATCH_TIMEOUT_MS = 30_000;
export const SYSTEM1_EVAL_STDOUT_LIMIT_BYTES = 64 * 1024 * 1024;
export const SYSTEM1_EVAL_STDERR_LIMIT_BYTES = 4 * 1024 * 1024;

export const SYSTEM1_EVAL_LABEL_STATUSES = {
  REVIEW_CONFIRMED: "confirmed",
  REVIEW_CONFLICT: "conflict",
  ORACLE_RESOLVED: "resolved",
} as const;

export const SYSTEM1_EVAL_LABEL_EXCLUSION_REASONS = {
  LABEL_CONFLICT: "label-conflict",
  REVIEW_NOT_CONFIRMED: "review-status-not-confirmed",
  ORACLE_NOT_RESOLVED: "oracle-not-resolved",
  EMPTY_POSITIVE_SET: "empty-positive-target-set",
} as const;

export const SYSTEM1_EVAL_SLICE_DIMENSIONS = {
  AMBIGUITY_CLASS: "ambiguity-class",
  NOT_DETECTED_CLASS: "not-detected-class",
  REPO_FAMILY: "repo-family",
  CANDIDATE_SET_SIZE: "candidate-set-size",
  MISSING_EVIDENCE: "missing-evidence",
} as const;

export const SYSTEM1_EVAL_CANDIDATE_SIZE_BUCKETS = [
  { key: "0", minimum: 0, maximum: 0 },
  { key: "1", minimum: 1, maximum: 1 },
  { key: "2-4", minimum: 2, maximum: 4 },
  { key: "5-8", minimum: 5, maximum: 8 },
  { key: "9-16", minimum: 9, maximum: 16 },
  { key: "17-32", minimum: 17, maximum: 32 },
] as const;

export const SYSTEM1_EVAL_FILE_NAMES = {
  POLICY: "policy.json",
  POLICY_HASH: "policy.sha256",
  COMPARISON_POLICY: "comparison-policy.json",
  COMPARISON_POLICY_HASH: "comparison-policy.sha256",
  SCORER_MANIFEST: "scorer-manifest.json",
  SCORER_MANIFEST_HASH: "scorer-manifest.sha256",
  METRICS: "metrics.json",
  SLICES: "slices.json",
  REPORT: "report.md",
  REPLAY_HASHES: "replay-hashes.json",
  TIMING: "timing.json",
  SEAL: (split: string) => `${split}-seal.json`,
  RESPONSES: (split: string) => `${split}-responses.jsonl`,
} as const;

export const SYSTEM1_EVAL_RUNTIME_KEYS = {
  NODE: "node",
  V8: "v8",
  TYPESCRIPT: "typescript",
  PNPM: "pnpm",
} as const;

export const SYSTEM1_EVAL_CLI_FLAGS = {
  FINAL_EVALUATION: "--final-evaluation",
  DATASET_DIRECTORY: "--dataset-dir",
  SCORER_ID: "--scorer-id",
  SCORER_VERSION: "--scorer-version",
  SCORER_COMMAND: "--scorer-command",
  SCORER_ARGS_JSON: "--scorer-args-json",
  SCORER_RUNTIME_JSON: "--scorer-runtime-json",
  WEIGHTS_CONFIG: "--weights-config",
  BATCH_SIZE: "--batch-size",
  BATCH_TIMEOUT_MS: "--batch-timeout-ms",
  CERTIFICATION_MODE: "--certification-mode",
  SCORER_TRAINING_MANIFEST_JSON: "--scorer-training-manifest-json",
} as const;

export const SYSTEM1_EVAL_RESPONSE_KEYS = [
  "requestId",
  "scoreKind",
  "scores",
  "status",
] as const;

export const SYSTEM1_EVAL_REPORT_TEXT = {
  TITLE: "# System-1 offline evaluation",
  SUMMARY_HEADER: "## Headline comparison table",
  SLICES_HEADER: "## Per-slice tables",
  SEALS_HEADER: "## Sealed evaluation inputs",
  POLICY_HEADER: "## Frozen policy",
  CERTIFICATION_MODES_HEADER: "## Calibration-only vs LOFO certification",
  LOFO_FAMILY_HEADER: "## LOFO out-of-fold family diagnostics",
  ACCOUNTING_FUNNEL_HEADER: "## Per-split accounting funnel",
  RISK_COVERAGE_HEADER: "## Risk-coverage and calibration diagnostics",
  REGRESSION_CHECK_NOTICE:
    "Temporal and test values are regression checks under protocol v2, not fresh evidence, because held-out numbers were previously observed.",
  METRIC_PROVENANCE_DESCRIPTION:
    "Under LOFO, train and calibration decisions, precision and calibration metrics use each request's out-of-fold calibrator. Under calibration-only, calibration metrics are in-sample; train rows are not used by that policy.",
  LOFO_POLICY_DESCRIPTION:
    "LOFO fits one isotonic map per held-out repository family from the other train+calibration families, certifies on pooled OOF duplicate groups and applies the minimum-family group-precision gate.",
  CALIBRATION_ONLY_POLICY_DESCRIPTION:
    "Calibration-only fits its isotonic map and certifies the pooled threshold on calibration duplicate groups using the one-sided 95% Clopper–Pearson lower bound.",
  ROW_LEVEL_COMPARISON_DESCRIPTION:
    "The row-level threshold is a retrospective comparison to the prior counting unit; only duplicate-group thresholds control v2 policy decisions.",
  CALIBRATION_ONLY_COMPARISON:
    "The calibration-only comparison fits and certifies on in-sample calibration duplicate groups alone. A target is uncertifiable if no threshold passes its mode's certification gates.",
  LOFO_COMPARISON:
    "The LOFO comparison fits fold-specific maps and certifies on out-of-fold train+calibration duplicate groups. A target is uncertifiable if no threshold passes its mode's certification gates.",
  NO_RATE: "n/a",
  NO_SEALS: "No held-out seals were read.",
  IN_SAMPLE: "in-sample",
  OUT_OF_FOLD: "out-of-fold",
  TARGET_MET: "yes",
  TARGET_MISSED: "NO",
} as const;

export const SYSTEM1_EVAL_REPORT_COLUMNS = [
  "split",
  "target",
  "certification",
  "group precision provenance / held-out target",
  "row-level precision provenance / held-out target",
  "commit / LSP avoidance",
  "duplicate-group commit / LSP avoidance",
  "exact-set precision (95% CI)",
  "duplicate-group exact-set precision (95% CI)",
  "gold-positive coverage",
  "false-safe / trusted request",
  "independent commits / minimum N",
  "ECE (measured on split)",
  "Brier (measured on split)",
  "UNKNOWN",
  "VERIFY_WITH_LSP",
] as const;

export const SYSTEM1_EVAL_SLICE_REPORT_COLUMNS = [
  "split",
  "key",
  "samples",
  "trusted",
  "precision target",
  "commit / avoidance (rows)",
  "commit / avoidance (groups)",
  "exact-set precision (rows, 95% CI)",
  "exact-set precision (groups, 95% CI)",
  "false-safe",
  "ECE (split)",
  "Brier (split)",
  "UNKNOWN",
  "VERIFY",
] as const;
