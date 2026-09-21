import {
  SemanticDecisionStatuses,
  SemanticDecisionUnavailableCodes,
  type ISemanticDecisionProvider,
  type SemanticDecisionAvailability,
  type SemanticDecisionOutcome,
  type SemanticDecisionRequest,
} from "@workspace/contracts";

const MODEL_NOT_INSTALLED =
  "semantic decision model is not installed in this foundation slice";

/**
 * Feature-provider boundary for the future local System-1 model.
 *
 * This first slice deliberately ships no model/runtime. Keeping the unavailable behavior here
 * proves the dependency boundary before model dependencies or weights are introduced: Docuvia can
 * resolve the capability through contracts/factory, while every model-specific artifact remains
 * confined to this package in the next slice.
 */
export class SemanticDecisionProvider implements ISemanticDecisionProvider {
  readonly name = "local-semantic-decision";

  async checkAvailability(): Promise<SemanticDecisionAvailability> {
    return {
      available: false,
      reason: MODEL_NOT_INSTALLED,
      capabilities: [],
    };
  }

  async score(
    request: SemanticDecisionRequest,
  ): Promise<SemanticDecisionOutcome> {
    return {
      status: SemanticDecisionStatuses.UNAVAILABLE,
      scores: [],
      unavailableCode: SemanticDecisionUnavailableCodes.MODEL_NOT_INSTALLED,
      unavailableReason: MODEL_NOT_INSTALLED,
      schemaVersion: request.schemaVersion,
      requestId: request.requestId,
      featureSchemaVersion: request.featureSchemaVersion,
      evidence: request.evidence,
    };
  }
}
