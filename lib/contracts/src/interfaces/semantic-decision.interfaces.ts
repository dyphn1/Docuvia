/**
 * Model-agnostic bounded scoring contract (PLAT-011 / issue #468 Phase 0).
 * Runtime, tensors, tokenizer, weights and model-specific configuration stay in the provider.
 */
export const SemanticDecisionTasks = {
  EDGE_RELATION: "edge-relation",
  IMPACT_RELEVANCE: "impact-relevance",
  NEEDS_VERIFICATION: "needs-verification",
} as const;
export type SemanticDecisionTask =
  (typeof SemanticDecisionTasks)[keyof typeof SemanticDecisionTasks];

/** None of these tasks is a single-target softmax. Multiple call targets can be legal. */
export const SemanticDecisionTaskSemantics = {
  "edge-relation": "multi-target",
  "impact-relevance": "independent-relevance",
  "needs-verification": "independent-verification",
} as const;

export const SemanticDecisionOptionKinds = {
  CANDIDATE: "candidate",
  UNKNOWN: "unknown",
  VERIFY: "verify",
} as const;
export type SemanticDecisionOptionKind =
  (typeof SemanticDecisionOptionKinds)[keyof typeof SemanticDecisionOptionKinds];

export const SemanticDecisionSchemaVersion = 1 as const;
export const SemanticDecisionLimits = {
  MAX_CANDIDATES: 32,
  MAX_OPTIONS: 34,
  MAX_INPUT_BYTES: 32 * 1024,
} as const;
export const SemanticDecisionStatuses = {
  SCORED: "scored",
  UNAVAILABLE: "unavailable",
} as const;
export const SemanticDecisionScoreKinds = {
  RAW: "raw",
  CALIBRATED: "calibrated",
} as const;
export const SemanticDecisionUnavailableCodes = {
  MODEL_NOT_INSTALLED: "model-not-installed",
  UNSUPPORTED_CAPABILITY: "unsupported-capability",
} as const;

export type SemanticDecisionAttributeValue = string | number | boolean | null;
export interface SemanticDecisionContext {
  /** Caller-prepared evidence; the provider must not crawl the repository. */
  readonly text: string;
  readonly attributes?: Readonly<Record<string, SemanticDecisionAttributeValue>>;
}
export interface SemanticDecisionOption extends SemanticDecisionContext {
  /** Non-blank, unique caller-owned ID. No normalization or invented output IDs. */
  readonly id: string;
  readonly kind: SemanticDecisionOptionKind;
}

export interface SemanticDecisionEvidenceIdentity {
  readonly repoId: string;
  readonly worktreeId: string;
  readonly projectId: string;
  /** Content/config snapshot, including dirty content; HEAD alone is insufficient. */
  readonly snapshotHash: string;
  /** Hash of the ordered candidate IDs and their evidence, prepared by the caller. */
  readonly candidateSetHash: string;
  /** Truncated evidence cannot produce a successful scored outcome. */
  readonly truncated: boolean;
}
export interface SemanticDecisionRequestIdentity {
  readonly schemaVersion: typeof SemanticDecisionSchemaVersion;
  readonly requestId: string;
  readonly featureSchemaVersion: string;
  readonly evidence: SemanticDecisionEvidenceIdentity;
}
export interface SemanticDecisionRequest extends SemanticDecisionRequestIdentity {
  readonly task: SemanticDecisionTask;
  readonly language: string;
  readonly relation: string;
  readonly context: SemanticDecisionContext;
  /** Exactly one UNKNOWN; at most one VERIFY. Zero candidates is a legal unknown-only request. */
  readonly options: readonly SemanticDecisionOption[];
}
export interface SemanticDecisionCallOptions {
  /** Absolute Unix milliseconds; expiry (including equality) rejects with SEMANTIC_DEADLINE_EXCEEDED. */
  readonly deadlineUnixMs?: number;
  /** In-process cancellation only; never serialized into evidence/cache identity. */
  readonly signal?: AbortSignal;
}
export interface SemanticDecisionScore {
  readonly optionId: string;
  /** Finite [0,1] score; only a calibrated outcome claims calibrated confidence. Never a fact. */
  readonly probability: number;
}
export interface SemanticDecisionModelIdentity {
  readonly provider: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly artifactHash: string;
}
export interface SemanticDecisionCapability {
  readonly task: SemanticDecisionTask;
  readonly language: string;
  readonly relation: string;
  readonly featureSchemaVersion: string;
  readonly maxCandidates: number;
  readonly maxInputBytes: number;
}
export interface SemanticDecisionAvailability {
  readonly available: boolean;
  readonly reason?: string;
  /** Exact supported slices, not speculative task names. Foundation provider advertises none. */
  readonly capabilities: readonly SemanticDecisionCapability[];
}
export interface SemanticDecisionScoredOutcome extends SemanticDecisionRequestIdentity {
  readonly status: typeof SemanticDecisionStatuses.SCORED;
  /** Exactly one score per input option, in request order. Values need not sum to one. */
  readonly scores: readonly SemanticDecisionScore[];
  readonly model: SemanticDecisionModelIdentity;
  readonly scoreKind: (typeof SemanticDecisionScoreKinds)[keyof typeof SemanticDecisionScoreKinds];
  /** Non-blank for calibrated results; null for raw scores. */
  readonly calibrationVersion: string | null;
  readonly unavailableReason?: never;
}
export interface SemanticDecisionUnavailableOutcome extends SemanticDecisionRequestIdentity {
  readonly status: typeof SemanticDecisionStatuses.UNAVAILABLE;
  readonly scores: readonly [];
  readonly unavailableCode: (typeof SemanticDecisionUnavailableCodes)[keyof typeof SemanticDecisionUnavailableCodes];
  readonly unavailableReason: string;
  readonly model?: never;
  readonly scoreKind?: never;
  readonly calibrationVersion?: never;
}
export type SemanticDecisionOutcome =
  | SemanticDecisionScoredOutcome
  | SemanticDecisionUnavailableOutcome;

/** Future domain policy output, deliberately separate from provider scores and authoritative facts. */
export interface SemanticDecisionPolicyResult extends SemanticDecisionRequestIdentity {
  readonly policyVersion: string;
  readonly calibrationVersion: string | null;
  readonly decision: "accept" | "abstain" | "verify";
  readonly reason: string;
  /** Even accept only means probable; authoritative verification is a separate operation. */
  readonly verified: false;
}

/** Pure domain validation, resolved by token. No model imports, policy thresholds or graph writes. */
export interface ISemanticDecisionValidator {
  validateRequest(value: unknown): SemanticDecisionRequest;
  validateOutcome(request: SemanticDecisionRequest, value: unknown): SemanticDecisionOutcome;
}
export interface ISemanticDecisionProvider {
  readonly name: string;
  checkAvailability(): Promise<SemanticDecisionAvailability>;
  /**
   * Only supplied options may be scored. UNKNOWN / VERIFY scores are evidence, not policy.
   * Implementations honor cancellation/deadline before and during work and reject with typed
   * DocuviaError; expected no-model/unsupported capability returns unavailable, never a guess.
   * Consumers validate requests and responses with ISemanticDecisionValidator before use.
   */
  score(request: SemanticDecisionRequest, options?: SemanticDecisionCallOptions): Promise<SemanticDecisionOutcome>;
}
