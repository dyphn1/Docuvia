/**
 * Model-agnostic contract for #468's bounded local semantic decision layer.
 *
 * The contract intentionally exposes only Docuvia-domain inputs/outputs. Model files,
 * tokenizer/runtime types, tensors, embeddings, and provider-specific configuration must remain
 * inside the implementation package. The caller supplies a bounded option set; the provider may
 * score those options but must never invent an out-of-band dependency target.
 */
export const SemanticDecisionTasks = {
  EDGE_RELATION: "edge-relation",
  IMPACT_RELEVANCE: "impact-relevance",
  NEEDS_VERIFICATION: "needs-verification",
} as const;

export type SemanticDecisionTask =
  (typeof SemanticDecisionTasks)[keyof typeof SemanticDecisionTasks];

export const SemanticDecisionOptionKinds = {
  CANDIDATE: "candidate",
  UNKNOWN: "unknown",
  VERIFY: "verify",
} as const;

export type SemanticDecisionOptionKind =
  (typeof SemanticDecisionOptionKinds)[keyof typeof SemanticDecisionOptionKinds];

export type SemanticDecisionAttributeValue =
  | string
  | number
  | boolean
  | null;

export interface SemanticDecisionContext {
  /** Compact, caller-prepared evidence. The provider is not allowed to crawl the repository. */
  text: string;
  /** Stable structured hints such as language/relation type; no model/runtime objects. */
  attributes?: Readonly<Record<string, SemanticDecisionAttributeValue>>;
}

export interface SemanticDecisionOption {
  /** Stable caller-owned identity used to correlate scores back to Docuvia candidates. */
  id: string;
  kind: SemanticDecisionOptionKind;
  /** Compact representation of this bounded option/candidate. */
  text: string;
  attributes?: Readonly<Record<string, SemanticDecisionAttributeValue>>;
}

export interface SemanticDecisionRequest {
  task: SemanticDecisionTask;
  context: SemanticDecisionContext;
  /**
   * The complete legal decision surface for this request. The model may score only these options.
   * Callers should include UNKNOWN and/or VERIFY explicitly when those outcomes are valid.
   */
  options: readonly SemanticDecisionOption[];
}

export interface SemanticDecisionScore {
  optionId: string;
  /** Calibrated probability-like score in [0, 1]. Policy thresholds are owned by Docuvia. */
  probability: number;
}

export interface SemanticDecisionModelIdentity {
  /** Implementation-defined provider name, useful for provenance and calibration tracking. */
  provider: string;
  /** Stable model identifier. No filesystem path or runtime-specific handle may leak here. */
  modelId: string;
  modelVersion?: string;
}

export interface SemanticDecisionAvailability {
  available: boolean;
  reason?: string;
}

export interface SemanticDecisionOutcome {
  scores: readonly SemanticDecisionScore[];
  model?: SemanticDecisionModelIdentity;
  /**
   * Honest-degradation signal. When set, scores must be empty and the caller keeps the existing
   * deterministic/LSP path rather than converting absence into a guessed decision.
   */
  unavailableReason?: string;
}

export interface ISemanticDecisionProvider {
  readonly name: string;
  /** Checks whether the package-owned model/runtime can serve requests in this process. */
  checkAvailability(): Promise<SemanticDecisionAvailability>;
  /**
   * Scores only request.options. This method does not apply accept/abstain/verify thresholds;
   * policy remains in Docuvia orchestration/domain code so model swaps cannot silently change
   * product semantics.
   */
  score(request: SemanticDecisionRequest): Promise<SemanticDecisionOutcome>;
}
