import {
  DocuviaError,
  ErrorCodes,
  SemanticDecisionLimits,
  SemanticDecisionOptionKinds,
  SemanticDecisionTasks,
  type SemanticDecisionRequest,
} from "@workspace/contracts";
import {
  hasKeys,
  IDENTITY_KEYS,
  isIdentity,
  isDataArray,
  isNonBlank,
  isRecord,
} from "./semantic-decision-shapes.js";

function isAttribute(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value === "number") return Number.isFinite(value);
  return typeof value === "string" || typeof value === "boolean";
}

function isContext(
  value: unknown,
  extraKeys: readonly string[] = [],
): value is Record<string, unknown> {
  if (
    !isRecord(value) ||
    !hasKeys(value, ["text", ...extraKeys], ["attributes"])
  )
    return false;
  if (typeof value.text !== "string") return false;
  if (!Object.hasOwn(value, "attributes")) return true;
  return (
    isRecord(value.attributes) &&
    Reflect.ownKeys(value.attributes).every(
      (key) =>
        typeof key === "string" &&
        isAttribute((value.attributes as Record<string, unknown>)[key]),
    )
  );
}

function isOption(value: unknown): boolean {
  if (!isContext(value, ["id", "kind"]) || !isNonBlank(value.id)) return false;
  return Object.values(SemanticDecisionOptionKinds).some(
    (kind) => kind === value.kind,
  );
}

function hasLegalOptions(options: readonly unknown[], task: unknown): boolean {
  if (!Array.from(options).every(isOption)) return false;
  const entries = options as { id: string; kind: string }[];
  const count = (kind: string): number =>
    entries.filter((option) => option.kind === kind).length;
  if (new Set(entries.map((option) => option.id)).size !== entries.length)
    return false;
  if (
    count(SemanticDecisionOptionKinds.UNKNOWN) !== 1 ||
    count(SemanticDecisionOptionKinds.VERIFY) > 1
  )
    return false;
  return (
    task !== SemanticDecisionTasks.NEEDS_VERIFICATION ||
    (count(SemanticDecisionOptionKinds.CANDIDATE) === 0 &&
      count(SemanticDecisionOptionKinds.VERIFY) === 1)
  );
}

function checkOptionLimits(options: readonly unknown[]): void {
  if (options.length > SemanticDecisionLimits.MAX_OPTIONS) {
    throw new DocuviaError(
      ErrorCodes.SEMANTIC_INPUT_LIMIT_EXCEEDED,
      "Semantic option limit exceeded",
    );
  }
  if (!isDataArray(options)) {
    throw new DocuviaError(
      ErrorCodes.SEMANTIC_INVALID_REQUEST,
      "Semantic options must be a dense data array",
    );
  }
  const candidateCount = options.filter(
    (value) =>
      isRecord(value) && value.kind === SemanticDecisionOptionKinds.CANDIDATE,
  ).length;
  if (candidateCount > SemanticDecisionLimits.MAX_CANDIDATES) {
    throw new DocuviaError(
      ErrorCodes.SEMANTIC_INPUT_LIMIT_EXCEEDED,
      "Semantic option limit exceeded",
    );
  }
}

function isRequestShape(value: unknown): value is SemanticDecisionRequest {
  if (
    !isRecord(value) ||
    !hasKeys(value, [
      ...IDENTITY_KEYS,
      "task",
      "language",
      "relation",
      "context",
      "options",
    ])
  )
    return false;
  if (
    !isIdentity(value) ||
    !isNonBlank(value.language) ||
    !isNonBlank(value.relation)
  )
    return false;
  if (!Object.values(SemanticDecisionTasks).some((task) => task === value.task))
    return false;
  return (
    isContext(value.context) &&
    Array.isArray(value.options) &&
    hasLegalOptions(value.options, value.task)
  );
}

export function validateSemanticRequest(
  value: unknown,
): SemanticDecisionRequest {
  if (isRecord(value) && Array.isArray(value.options))
    checkOptionLimits(value.options);
  if (!isRequestShape(value)) {
    throw new DocuviaError(
      ErrorCodes.SEMANTIC_INVALID_REQUEST,
      "Invalid semantic decision request",
    );
  }
  const serialized = JSON.stringify(value);
  if (
    Buffer.byteLength(serialized, "utf8") >
    SemanticDecisionLimits.MAX_INPUT_BYTES
  ) {
    throw new DocuviaError(
      ErrorCodes.SEMANTIC_INPUT_LIMIT_EXCEEDED,
      "Semantic request UTF-8 byte limit exceeded",
    );
  }
  return JSON.parse(serialized) as SemanticDecisionRequest;
}
