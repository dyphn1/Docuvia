import { SemanticDecisionLimits } from "@workspace/contracts";

export const SYSTEM1_FEATURE_SCHEMA_VERSION = "system1-option-selection/v2";
export const SYSTEM1_PREVIOUS_FEATURE_SCHEMA_VERSION =
  "system1-option-selection/v1";
export const SYSTEM1_PREVIOUS_EXPORT_SCHEMA_VERSION = 1;
export const SYSTEM1_EXPORT_SCHEMA_VERSION = 2;
export const SYSTEM1_SUPPORTED_EXPORT_SCHEMA_VERSIONS = [
  SYSTEM1_PREVIOUS_EXPORT_SCHEMA_VERSION,
  SYSTEM1_EXPORT_SCHEMA_VERSION,
] as const;
export const SYSTEM1_SOURCE_CORPUS_VERSION = "1";
export const SYSTEM1_PREVIOUS_DATASET_DIRECTORY =
  "evaluate/results/semantic-corpus/v1/system1-dataset";
export const SYSTEM1_DATASET_V2_DIRECTORY =
  "evaluate/results/semantic-corpus/v1/system1-dataset-v2";
export const SYSTEM1_DATASET_IMPACT_SCHEMA = "system1-dataset-impact/v1";
export const SYSTEM1_DATASET_IMPACT_FILE_NAME = "declaration-impact.json";
export const SYSTEM1_EXPORT_REPLAY_HASH_SCHEMA =
  "system1-export-replay-hashes/v1";
export const SYSTEM1_DATASET_IMPACT_FIELD_NAMES = {
  DECLARATION_KIND: "declarationKind",
  EVIDENCE_STATUS: "evidenceStatus",
  SIGNATURE: "signature",
  TARGET_ID: "targetId",
} as const;
export const SYSTEM1_DATASET_IMPACT_ERRORS = {
  BLANK_STATE_ROW: "System-1 dataset impact found a blank state row.",
  DUPLICATE_REQUEST_ID: "System-1 dataset impact found a duplicate request id.",
  ROW_SET_MISMATCH: "System-1 dataset state rows differ between versions.",
  CANDIDATE_SET_MISMATCH:
    "System-1 dataset candidate identities differ between versions.",
  TARGET_ID_MISMATCH:
    "System-1 dataset candidate target ids differ between versions.",
} as const;
export const SYSTEM1_MEMORY_FLOOR_PERCENT = 12;
export const SYSTEM1_TIER_A_REPLAY_MISMATCH_REASON =
  "tier-a-candidate-replay-mismatch";

export const SYSTEM1_EXCLUSION_REASONS = {
  INVALID_CALL_SITE_ID: "invalid-call-site-id",
  CALL_SITE_NOT_FOUND: "tier-a-call-site-not-found",
  CANDIDATE_EVIDENCE_UNAVAILABLE: "tier-a-candidate-evidence-unavailable",
  SYSTEM1_INPUT_BYTE_LIMIT: "system1-input-byte-limit",
} as const;

export const SYSTEM1_USAGE = {
  EVALUATION_ONLY: "evaluation-only",
  TRAINING_AND_EVALUATION: "training-and-evaluation",
} as const;

export const SYSTEM1_OPTION_IDS = {
  UNKNOWN: "UNKNOWN",
  VERIFY_WITH_LSP: "VERIFY_WITH_LSP",
} as const;

export const SYSTEM1_REQUEST_ID_PREFIX = "system1:";
export const SYSTEM1_JSON_LINE_ENDING = "\n";
export const SYSTEM1_CONSTRUCTOR_SYMBOL_NAME = "constructor";

export const SYSTEM1_SOURCE = {
  LANGUAGE: "typescript",
  RELATION: "cross-file-call",
} as const;

export const SYSTEM1_OPTION_TEXT = {
  UNKNOWN:
    "Insufficient supported target evidence; this does not mean no dependency.",
  VERIFY_WITH_LSP: "Request authoritative language-server verification.",
} as const;

export const SYSTEM1_BYTE_LIMITS = {
  CALL_EXPRESSION: 384,
  CALLEE_NAME: 128,
  SOURCE_WINDOW: 1536,
  CALLER_FILE: 256,
  CALLER_SYMBOL: 192,
  RECEIVER_HINT: 128,
  GENERIC_HINT: 128,
  MAX_GENERIC_HINTS: 4,
  IMPORT_LOCAL: 128,
  IMPORTED_NAME: 128,
  IMPORT_SPECIFIER: 256,
  TARGET_ID: 512,
  CANDIDATE_SIGNATURE: 256,
  CONTEXT: 4096,
  REQUEST: SemanticDecisionLimits.MAX_INPUT_BYTES,
} as const;

export const SYSTEM1_CALL_KINDS = {
  BARE: "bare",
  MEMBER: "member",
  THIS: "this",
  ARG_CHAIN: "arg-chain",
  NAMESPACE: "namespace",
} as const;

export const SYSTEM1_TIER_A_RANKS = {
  CALL_EDGE: 0,
  IMPORTED_FILE: 1,
  NAME_MATCH: 2,
} as const;

export const SYSTEM1_TIER_A_EVIDENCE = {
  CALL_EDGE: "tier-a-calls-edge",
  IMPORTED_FILE: "tier-a-imports-file",
  NAME_MATCH: "tier-a-same-name",
} as const;

export const SYSTEM1_AMBIGUITY_CLASSES = {
  ALIAS_RENAMED_IMPORT: "alias/renamed import",
  BARREL_REEXPORT: "barrel/re-export",
  PATH_ALIAS: "path alias",
  GENERIC_FACTORY: "generic factory",
  OVERLOADS: "overloads",
  FLUENT_CHAINED_CALL: "fluent/chained call",
  DI_REGISTRY_LOOKUP: "DI/registry lookup",
  FRAMEWORK_CONVENTION: "framework convention",
  COMPUTED_BOUNDED_IMPORT: "computed-but-bounded import",
  RUNTIME_STRING_TOKEN: "runtime string token",
  UNRESOLVED_RECEIVER_SMALL_SET: "unresolved receiver with small candidate set",
  GENERATED_WRAPPER_FACADE: "generated wrapper/facade",
  OTHER_PLAIN: "other/plain",
} as const;

export const SYSTEM1_AMBIGUITY_CLASS_ORDER = Object.values(
  SYSTEM1_AMBIGUITY_CLASSES,
);

export const SYSTEM1_DECLARATION_KINDS = {
  FUNCTION: "function",
  METHOD: "method",
  CONSTRUCTOR: "constructor",
  CLASS: "class",
  VARIABLE: "variable",
  PROPERTY: "property",
  INTERFACE: "interface",
  METHOD_SIGNATURE: "method-signature",
  TYPE_ALIAS: "type-alias",
  ENUM: "enum",
  MODULE: "module",
  UNKNOWN: "unknown",
} as const;

export const SYSTEM1_EVIDENCE_STATUSES = {
  PRESENT: "present",
  MISSING: "missing",
} as const;

export const SYSTEM1_IMPORT_KINDS = {
  NAMED: "named",
  DEFAULT: "default",
  NAMESPACE: "namespace",
} as const;

export const SYSTEM1_BARREL_STATUSES = {
  YES: "yes",
  NO: "no",
  UNRESOLVED: "unresolved",
} as const;

export const SYSTEM1_SPLITS = {
  TRAIN: "train",
  CALIBRATION: "calibration",
  TEMPORAL: "temporal",
  TEST: "test",
} as const;

export const SYSTEM1_HELD_OUT_SPLITS = [
  SYSTEM1_SPLITS.TEMPORAL,
  SYSTEM1_SPLITS.TEST,
] as const;

export const SYSTEM1_FILE_NAMES = {
  STATE: (split: string) => `${split}-state.jsonl`,
  LABELS: (split: string) => `${split}-labels.jsonl`,
  SEAL: (split: string) => `${split}-seal.json`,
  EXCLUDED: "excluded.jsonl",
  REPORT: "export-report.json",
  LABELS_REPORT: "labels-report.json",
  REPLAY_HASHES: "replay-hashes.json",
  DECLARATION_IMPACT: SYSTEM1_DATASET_IMPACT_FILE_NAME,
} as const;

export const SYSTEM1_FACTORY_NAME_PREFIXES = [
  "create",
  "make",
  "build",
  "provide",
  "resolve",
] as const;

export const SYSTEM1_FACTORY_NAME_SUFFIXES = ["factory", "provider"] as const;

export const SYSTEM1_DI_RECEIVER_NAMES = [
  "container",
  "injector",
  "registry",
  "serviceLocator",
] as const;

export const SYSTEM1_DI_LOOKUP_METHODS = ["get", "resolve", "inject"] as const;

export const SYSTEM1_FRAMEWORK_PACKAGES = ["@nestjs/", "@angular/"] as const;

export const SYSTEM1_FRAMEWORK_DECORATORS = [
  "Component",
  "Controller",
  "Directive",
  "Inject",
  "Injectable",
  "Module",
  "Pipe",
] as const;

export const SYSTEM1_FRAMEWORK_REGISTRIES = [
  {
    receiver: "moduleRef",
    type: "ModuleRef",
    sourceSpecifier: "@nestjs/core",
  },
  {
    receiver: "injector",
    type: "Injector",
    sourceSpecifier: "@angular/core",
  },
] as const;

export const SYSTEM1_FRAMEWORK_REGISTRY_METHODS = ["get", "resolve"] as const;

export const SYSTEM1_GENERATED_PATH_COMPONENTS = [
  "generated",
  "gen",
  "facade",
  "wrappers",
] as const;

export const SYSTEM1_GENERATED_FILE_MARKERS = [".generated.", ".gen."] as const;

export const SYSTEM1_CALL_SOURCE_LINES = {
  BEFORE: 1,
  AFTER: 1,
} as const;

export const SYSTEM1_BOUNDED_IMPORT_MAX_BYTES = 512;
export const SYSTEM1_UNRESOLVED_RECEIVER_MAX_CANDIDATES = 4;
export const SYSTEM1_UNRESOLVED_RECEIVER_MIN_CANDIDATES = 2;
export const SYSTEM1_MAX_BARREL_DEPTH = 5;
export const SYSTEM1_CANDIDATE_LIMIT = SemanticDecisionLimits.MAX_CANDIDATES;
export const SYSTEM1_CALLER_ID_LIMIT = 256;
export const SYSTEM1_SAMPLE_ID_LIMIT = 1024;
export const SYSTEM1_IGNORABLE_TSCONFIG_DIAGNOSTIC_CODES = [18003] as const;

export const SYSTEM1_LIMIT_ERROR_MESSAGE =
  "System-1 evidence exceeds an explicit byte limit";
export const SYSTEM1_RESERVED_CANDIDATE_ID_ERROR =
  "Tier A candidate IDs must be unique and cannot use reserved option IDs";
export const SYSTEM1_LICENSE_LEAKAGE_ERROR_MESSAGE =
  "Evaluation-only source cannot enter a fitting partition";

export const SYSTEM1_PARTITIONS = [
  SYSTEM1_SPLITS.TRAIN,
  SYSTEM1_SPLITS.CALIBRATION,
  SYSTEM1_SPLITS.TEMPORAL,
  SYSTEM1_SPLITS.TEST,
] as const;

export const SYSTEM1_BUILTIN_TYPE_NAMES = [
  "Array",
  "Map",
  "ReadonlyMap",
  "Set",
  "ReadonlySet",
  "RegExp",
  "String",
  "Subject",
  "BehaviorSubject",
  "ReplaySubject",
] as const;

export const SYSTEM1_BUILTIN_MEMBER_METHODS = [
  "add",
  "delete",
  "get",
  "has",
  "next",
  "pop",
  "push",
  "set",
  "shift",
  "slice",
  "splice",
  "subscribe",
  "test",
  "unshift",
] as const;
